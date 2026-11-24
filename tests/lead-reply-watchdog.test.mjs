import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {runLeadReplyWatchdog} from '../lib/lead-reply-watchdog.mjs';
import {notifyPlaybookOwner,queuePlaybookOwnerNotice,flushPlaybookOwnerNotices} from '../lib/lead-playbook-notifications.mjs';
import {playbookHash} from '../lib/lead-playbook-links.mjs';

const now = new Date('2026-11-23T18:00:00Z');
const config = {LEAD_PLAYBOOK_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_ENABLED:'true',LEAD_REPLY_WATCHDOG_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_CHANNELS:'sms',LEAD_PLAYBOOK_CRAIG_CELL:'+14195550199',QUO_FROM_NUMBER:'+14195550188',QUO_API_KEY:'fabricated'};
function fixture({phone='+14195550100',text='How much does weekly service cost?',at='2026-11-23T17:57:59Z'}={}) {
  const db=leadTestDatabase();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES ('watch-lead','question','facebook','new','Fictional Lead',?,'{}')").run(phone);
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,last_inbound_at) VALUES ('watch-conv','watch-lead','org-opwp','facebook_lead','backend',?)").run(at);
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,state_json) VALUES ('watch-conv','watch-lead','{\"stage\":\"confirm_details_sent\"}')").run();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by,created_at) VALUES ('watch-inbound','watch-conv','org-opwp','inbound','quo_sms',?,'fixture',?)").run(text,at);
  return db;
}
function outbound(db,{at='2026-11-23T17:58:30Z',status='delivered',author='craig'}={}) {
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by,created_at,delivery_status,author) VALUES ('watch-outbound','watch-conv','org-opwp','outbound','quo_sms','I can help with that.','fixture',?,?,?)").run(at,status,author);
}
function transport(check=()=>{}) {
  const sent=[];
  return {sent,options:{fetcher:async(url,request)=>{assert.equal(url,'https://api.openphone.com/v1/messages');const body=JSON.parse(request.body);check(body);sent.push(body);return Response.json({id:'watch-alert-'+sent.length});}}};
}
function afterOwnerClaim(db, callback) {
  return {...db,prepare(sql) {
    const wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async run(){const result=await statement.run();await callback();return result;}});
    const statement=db.prepare(sql);
    return /UPDATE lead_playbook_owner_notifications SET status='sending'/.test(sql) ? wrap(statement) : statement;
  }};
}
test('watchdog is inert unless all independent feature gates are enabled',async()=>{
  const db={prepare(){assert.fail('Disabled watchdog must not access storage');}};
  for(const change of [{LEAD_PLAYBOOK_ENABLED:'false'},{LEAD_PLAYBOOK_NOTIFY_ENABLED:'false'},{LEAD_REPLY_WATCHDOG_ENABLED:'false'}])assert.equal((await runLeadReplyWatchdog({...config,...change},{db,now})).enabled,false);
});
test('watchdog alerts once for an unanswered inbound with its reason and exact staff thread link',async()=>{
  const db=fixture(),t=transport(body=>{
    assert.deepEqual(body.to,[config.LEAD_PLAYBOOK_CRAIG_CELL]);
    assert.match(body.content,/^\[OPWP STAFF ALERT\]/);
    assert.match(body.content,/unanswered_inbound/);
    assert.match(body.content,/How much does weekly service cost/);
    assert.match(body.content,/\/admin\/quote-funnel\/\?lead=watch-lead/);
  });
  const first=await runLeadReplyWatchdog(config,{db,now,notificationOptions:t.options});
  assert.equal(first.acceptedCount,1);assert.equal(first.eligible,1);
  const second=await runLeadReplyWatchdog(config,{db,now:new Date(now.getTime()+60000),notificationOptions:t.options});
  assert.equal(second.eligible,0);assert.equal(t.sent.length,1);
  assert.equal(db.sqlite.prepare('SELECT event_key FROM lead_playbook_owner_notifications').get().event_key,'unanswered:unanswered_inbound:watch-inbound');
  db.sqlite.close();
});
test('a recent or subsequently answered inbound never queues an unanswered alert',async()=>{
  for(const setup of [db=>db.sqlite.prepare("UPDATE lead_messages SET created_at='2026-11-23T17:58:01Z'").run(),db=>outbound(db),db=>outbound(db,{author:'backend'})]){
    const db=fixture();setup(db);const t=transport();
    const result=await runLeadReplyWatchdog(config,{db,now,notificationOptions:t.options});
    assert.equal(result.eligible,0);assert.equal(t.sent.length,0);db.sqlite.close();
  }
});
test('the proactive 60-second setting alerts at 60 seconds and not at 59 seconds',async()=>{
  for (const [at,expected] of [['2026-11-23T17:59:00Z',1],['2026-11-23T17:59:01Z',0]]) {
    const db=fixture({at}),t=transport();
    const result=await runLeadReplyWatchdog({...config,LEAD_REPLY_WATCHDOG_SECONDS:'60'},{db,now,notificationOptions:t.options});
    assert.equal(result.acceptedCount,expected);assert.equal(t.sent.length,expected);db.sqlite.close();
  }
});
test('an accepted draft without its final message ledger receipt counts as a reply',async()=>{
  const db=fixture(),t=transport();
  db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,inbound_message_id,intent,confidence,body,policy_version,status,provider_message_id) VALUES ('accepted-reply','watch-conv','watch-lead','watch-inbound','question_price',1,'A safe reply','fixture','sent','accepted-provider-id')").run();
  const result=await runLeadReplyWatchdog(config,{db,now,notificationOptions:t.options});
  assert.equal(result.eligible,0);assert.equal(t.sent.length,0);db.sqlite.close();
});
test('a newer inbound resets the watchdog deadline and an old message is never alerted',async()=>{
  const db=fixture(),t=transport();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by,created_at) VALUES ('new-inbound','watch-conv','org-opwp','inbound','quo_sms','Actually I have another question','fixture','2026-11-23T17:59:30Z')").run();
  const result=await runLeadReplyWatchdog(config,{db,now,notificationOptions:t.options});
  assert.equal(result.eligible,0);assert.equal(t.sent.length,0);db.sqlite.close();
});
test('a delayed watchdog notice is cancelled if Craig answers before the flush',async()=>{
  const db=fixture(),t=transport();
  await queuePlaybookOwnerNotice(db,config,{kind:'lead_review',submissionId:'watch-lead',conversationId:'watch-conv',eventKey:'unanswered:unanswered_inbound:watch-inbound'},{now});
  outbound(db);
  const result=await flushPlaybookOwnerNotices(db,config,{now,...t.options});
  assert.equal(result.cancelled,1);assert.equal(t.sent.length,0);db.sqlite.close();
});
test('a reply arriving after the owner-alert claim still cancels the alert before transport',async()=>{
  const db=fixture(),t=transport(),raced=afterOwnerClaim(db,()=>outbound(db));
  const result=await runLeadReplyWatchdog(config,{db:raced,now,notificationOptions:t.options});
  assert.equal(result.cancelled,1);assert.equal(t.sent.length,0);
  assert.equal(db.sqlite.prepare('SELECT error_code FROM lead_playbook_owner_notifications').get().error_code,'unanswered_inbound_resolved');db.sqlite.close();
});
test('STOP arriving after an owner-alert claim blocks SMS to the shared Craig test phone',async()=>{
  const db=fixture({phone:'+14192620424'}),t=transport();
  const raced=afterOwnerClaim(db,async()=>db.sqlite.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES ('org-opwp',?,'opted_out','fixture','fixture')").run(await playbookHash('+14192620424')));
  const env={...config,META_TEST_MODE:'true',META_TEST_RECIPIENTS:'+14192620424',LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true'};
  const result=await notifyPlaybookOwner(raced,env,{kind:'lead_review',submissionId:'watch-lead',conversationId:'watch-conv',eventKey:'cash:watch-inbound'},{now,...t.options});
  assert.equal(result.cancelled,1);assert.equal(t.sent.length,0);
  assert.equal(db.sqlite.prepare('SELECT error_code FROM lead_playbook_owner_notifications').get().error_code,'owner_sms_suppressed');db.sqlite.close();
});
test('STOP, opt-out, suppression and closed/deleted threads never create watchdog notices',async()=>{
  for(const setup of [
    db=>db.sqlite.prepare("UPDATE lead_messages SET body='stop pls'").run(),
    db=>db.sqlite.prepare("UPDATE lead_messages SET body='unsubscribe'").run(),
    async db=>db.sqlite.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES ('org-opwp',?,'opted_out','fixture','fixture')").run(await playbookHash('+14195550100')),
    db=>db.sqlite.prepare("UPDATE submissions SET status='deleted'").run(),
    db=>db.sqlite.prepare("UPDATE lead_conversations SET status='resolved'").run(),
    db=>db.sqlite.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json='{\"stage\":\"closed_lost\"}',stage='closed_lost',revision=revision+1").run(),
  ]){
    const db=fixture(),t=transport();await setup(db);
    const result=await runLeadReplyWatchdog(config,{db,now,notificationOptions:t.options});
    assert.equal(result.eligible,0);assert.equal(t.sent.length,0);db.sqlite.close();
  }
});
test('a manually paused open thread can still alert Craig about a later unanswered question',async()=>{
  const db=fixture(),t=transport();
  db.sqlite.prepare("UPDATE lead_conversations SET owner='craig',automation_mode='paused'").run();
  const result=await runLeadReplyWatchdog(config,{db,now,notificationOptions:t.options});
  assert.equal(result.acceptedCount,1);assert.equal(t.sent.length,1);db.sqlite.close();
});
test('test-mode alerts use only the sole Craig recipient without reading an owner-cell override',async()=>{
  const db=fixture({phone:'+14192620424'}),t=transport(body=>assert.deepEqual(body.to,['+14192620424']));
  const env={...config,META_TEST_MODE:'true',META_TEST_RECIPIENTS:'+14192620424',LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',LEAD_PLAYBOOK_CRAIG_CELL:'+14195550199'};
  const result=await runLeadReplyWatchdog(env,{db,now,notificationOptions:t.options});
  assert.equal(result.acceptedCount,1);assert.equal(t.sent.length,1);db.sqlite.close();
});
test('test-mode alerts fail closed for other leads, multiple recipients or a missing controlled gate',async()=>{
  for(const change of [{phone:'+14195550100'},{META_TEST_RECIPIENTS:'+14192620424,+14195550199'},{LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'false'}]){
    const db=fixture({phone:change.phone||'+14192620424'}),t=transport();
    const env={...config,META_TEST_MODE:'true',META_TEST_RECIPIENTS:'+14192620424',LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',...change};
    const result=await runLeadReplyWatchdog(env,{db,now,notificationOptions:t.options});
    assert.equal(result.eligible,0);assert.equal(t.sent.length,0);db.sqlite.close();
  }
});
test('SMS-only configuration never queues or sends an email alert',async()=>{
  const db=fixture(),t=transport();let emails=0;
  const result=await notifyPlaybookOwner(db,{...config,OWNER_NOTIFICATION_EMAIL:'owner@example.test'},{kind:'lead_review',submissionId:'watch-lead',conversationId:'watch-conv',eventKey:'cash:watch-inbound'},{now,...t.options,emailSender:async()=>{emails++;return 'should-not-send';}});
  assert.equal(result.acceptedCount,1);assert.equal(emails,0);assert.equal(db.sqlite.prepare('SELECT count(*) count FROM lead_playbook_owner_notifications WHERE channel=\'email\'').get().count,0);db.sqlite.close();
});
test('unknown notification channels fail closed instead of silently enabling another channel',async()=>{
  const db=fixture(),t=transport();
  const result=await notifyPlaybookOwner(db,{...config,LEAD_PLAYBOOK_NOTIFY_CHANNELS:'unknown'},{kind:'lead_review',submissionId:'watch-lead',conversationId:'watch-conv',eventKey:'cash:watch-inbound'},{now,...t.options});
  assert.equal(result.acceptedCount,0);assert.equal(t.sent.length,0);assert.equal(db.sqlite.prepare('SELECT count(*) count FROM lead_playbook_owner_notifications').get().count,0);db.sqlite.close();
});
test('changing channel policy to SMS-only cancels already queued email before any provider call',async()=>{
  const db=fixture(),t=transport();let emails=0;
  await queuePlaybookOwnerNotice(db,{...config,LEAD_PLAYBOOK_NOTIFY_CHANNELS:'sms,email'},{kind:'lead_review',submissionId:'watch-lead',conversationId:'watch-conv',eventKey:'cash:watch-inbound'},{now});
  const result=await flushPlaybookOwnerNotices(db,{...config,OWNER_NOTIFICATION_EMAIL:'owner@example.test'},{now,...t.options,emailSender:async()=>{emails++;return 'should-not-send';}});
  assert.equal(result.acceptedCount,1);assert.equal(result.cancelled,1);assert.equal(emails,0);db.sqlite.close();
});
