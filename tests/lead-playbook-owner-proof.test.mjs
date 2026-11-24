import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {notifyPlaybookOwner,isPlaybookOwnerNotificationReceipt} from '../lib/lead-playbook-notifications.mjs';
import {recordPlaybookQuoEvent} from '../lib/lead-playbook-ingest.js';
import {structuredThread,structuredClassification} from './helpers/lead-conversation-v2-thread.mjs';
import {composeStructuredPlaybookReply} from '../lib/lead-playbook-replies-v2.mjs';

const env={LEAD_PLAYBOOK_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_ENABLED:'true',LEAD_CONVERSATION_V2_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_CHANNELS:'sms',META_TEST_MODE:'true',META_TEST_RECIPIENTS:'+14192620424',LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',QUO_FROM_NUMBER:'+14195550188',QUO_API_KEY:'fabricated',QUO_HUMAN_USER_IDS:'fixture-human'};
const notice={kind:'lead_review',submissionId:'proof-lead',conversationId:'proof-conv',eventKey:'price_pushback:proof-inbound'};
function fixture(){
  const db=leadTestDatabase();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES ('proof-lead','question','facebook','new','Fictional Example','+14192620424','{}')").run();
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode) VALUES ('proof-conv','proof-lead','org-opwp','facebook_lead','backend','approved')").run();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES ('proof-inbound','proof-conv','org-opwp','inbound','quo_sms','That price is high','fixture')").run();
  return db;
}
function event(text,id='staff-provider'){
  return {direction:'outbound',from:env.QUO_FROM_NUMBER,to:'+14192620424',text,providerMessageId:id,eventId:'fixture-'+id,createdAt:new Date().toISOString(),authorType:'user',userId:'fixture-human',userIds:['fixture-human'],authorTypes:['user']};
}
test('an owner alert receipt that arrives before the send response never pauses the lead thread',async()=>{
  const db=fixture();let content='';
  await notifyPlaybookOwner(db,env,notice,{fetcher:async(_url,request)=>{
    content=JSON.parse(request.body).content;
    assert.match(content,/alert=/);
    const inflight=db.sqlite.prepare('SELECT error_code,provider_message_id FROM lead_playbook_owner_notifications').get();
    assert.match(inflight.error_code,/^staff_sms_v2:[a-f0-9]{64}$/);assert.equal(inflight.provider_message_id,null);
    await recordPlaybookQuoEvent(db,env,event(content));
    assert.deepEqual({...db.sqlite.prepare("SELECT owner,automation_mode FROM lead_conversations WHERE id='proof-conv'").get()},{owner:'backend',automation_mode:'approved'});
    return Response.json({id:'staff-provider'});
  }});
  const receipt=db.sqlite.prepare('SELECT status,error_code,provider_message_id FROM lead_playbook_owner_notifications').get();
  assert.deepEqual({...receipt},{status:'accepted',error_code:null,provider_message_id:'staff-provider'});
  await recordPlaybookQuoEvent(db,env,event(content,'different-manual-provider'));
  assert.deepEqual({...db.sqlite.prepare("SELECT owner,automation_mode FROM lead_conversations WHERE id='proof-conv'").get()},{owner:'craig',automation_mode:'paused'});
  db.sqlite.close();
});
test('a staff-looking prefix without a claimed exact proof is never an automated receipt',async()=>{
  const db=fixture();
  assert.equal(await isPlaybookOwnerNotificationReceipt(db,env,event('[OPWP STAFF ALERT] A manually typed message')),false);
  await recordPlaybookQuoEvent(db,env,event('[OPWP STAFF ALERT] A manually typed message','prefix-only-manual'));
  assert.equal(db.sqlite.prepare("SELECT automation_mode FROM lead_conversations WHERE id='proof-conv'").get().automation_mode,'paused');
  db.sqlite.close();
});
test('in-flight proof requires exact body, recipient, business line and bounded event time',async()=>{
  const db=fixture();
  await notifyPlaybookOwner(db,env,notice,{fetcher:async(_url,request)=>{
    const text=JSON.parse(request.body).content;
    for(const change of [{text:text+' changed'},{to:'+14195550101'},{from:'+14195550102'},{createdAt:new Date(Date.now()-600000).toISOString()}])assert.equal(await isPlaybookOwnerNotificationReceipt(db,env,{...event(text,'wrong-proof'),...change}),false);
    assert.equal(await isPlaybookOwnerNotificationReceipt(db,env,event(text,'first-exact')),true);
    assert.equal(await isPlaybookOwnerNotificationReceipt(db,env,event(text,'second-different')),false);
    return Response.json({id:'first-exact'});
  }});
  assert.equal(db.sqlite.prepare('SELECT status FROM lead_playbook_owner_notifications').get().status,'accepted');db.sqlite.close();
});
test('a lost send response preserves the proof for a bounded matching late receipt without retrying',async()=>{
  const db=fixture();let text='',sends=0;
  await notifyPlaybookOwner(db,env,notice,{fetcher:async(_url,request)=>{sends++;text=JSON.parse(request.body).content;throw new Error('Fabricated response loss');}});
  const pending=db.sqlite.prepare('SELECT status,error_code FROM lead_playbook_owner_notifications').get();
  assert.equal(pending.status,'uncertain');assert.match(pending.error_code,/^staff_sms_v2:/);
  assert.equal(await isPlaybookOwnerNotificationReceipt(db,env,event(text,'late-delivery')),true);
  await notifyPlaybookOwner(db,env,notice,{fetcher(){assert.fail('Unknown provider outcome must not automatically retry');}});
  assert.equal(sends,1);db.sqlite.close();
});
test('a staff takeover while the final Airtable permission check awaits blocks the actual V2 transport',async t=>{
  const f=await structuredThread(t,{notifications:false});
  const {sendLeadMessage}=await import('../lib/lead-assistant.js');
  const lead=f.db.sqlite.prepare("SELECT s.*,c.id conversation_id,c.owner,c.automation_mode,c.status conversation_status,c.last_inbound_at,c.unread_count FROM submissions s JOIN lead_conversations c ON c.submission_id=s.id WHERE c.id=?").get(f.conversationId);
  const decision=composeStructuredPlaybookReply({classification:structuredClassification(['question_payment']),lead,state:f.readState(),conversation:{owner:'backend',automation_mode:'approved'}});
  await assert.rejects(sendLeadMessage(f.db,f.env,lead,decision.body,'playbook-approved:fixture-review',true,{
    templateKey:decision.templateKey,structuredSlots:decision.slots,
    textSafety:async()=>{
      // Owner-only admin takeover deliberately leaves the prior mode approved;
      // the final transport boundary must check owner independently.
      f.db.sqlite.prepare("UPDATE lead_conversations SET owner='craig' WHERE id=?").run(f.conversationId);
      return {verified:true,doNotText:false};
    },
  }),error=>error.code==='text_safety_blocked');
  assert.equal(f.customer.length,0);assert.equal(f.requests.filter(request=>request.method==='POST').length,0);
});
test('the real V2 classifier-to-SMS pipeline accepts both price and cash notices without a legacy escalation hold or manual pause',async t=>{
  const f=await structuredThread(t);
  f.env.LEAD_PLAYBOOK_NOTIFY_CHANNELS='sms';
  const priorFetch=globalThis.fetch,staff=[],allRecipients=[];
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(String(input));
    if(url.href!=='https://api.openphone.com/v1/messages'||options.method!=='POST')return priorFetch(input,options);
    const message=JSON.parse(options.body),providerId='sms-'+crypto.randomUUID();
    f.requests.push({path:url.pathname,method:'POST'});allRecipients.push(...message.to);
    assert.deepEqual(message.to,['+14192620424']);assert.equal(message.from,f.env.QUO_FROM_NUMBER);
    if(message.content.startsWith('[OPWP STAFF ALERT]')){
      const queued=f.db.sqlite.prepare("SELECT id,status,error_code,provider_message_id FROM lead_playbook_owner_notifications WHERE status='sending' ORDER BY rowid DESC LIMIT 1").get();
      assert.ok(queued);assert.equal(queued.provider_message_id,null);assert.match(queued.error_code,/^staff_sms_v2:/);
      // Real provider metadata can identify the account user even for an API
      // message. The early receipt must match the persisted staff proof first.
      const result=await recordPlaybookQuoEvent(f.db,f.env,{direction:'outbound',from:message.from,to:message.to[0],text:message.content,
        providerMessageId:providerId,eventId:'event-'+providerId,createdAt:new Date().toISOString(),authorType:'user',userId:'fixture-craig-user',userIds:['fixture-craig-user'],authorTypes:['user']});
      assert.equal(result.skipped,'owner_notification');
      staff.push({body:message.content,id:providerId});
    }else f.customer.push(message.content);
    return Response.json({data:{id:providerId}});
  });
  const inbound='thats kinda high, can i pay cash or check?';
  const turn=await f.inbound(inbound,structuredClassification(['objection_price','request_cash','question_payment'],{needs_owner:true,owner_reason:'price_pushback',sentiment:'negative'}));
  assert.equal(f.modelCalls.length,1);assert.equal(turn.draft.status,'sent');assert.equal(f.customer.length,1);
  assert.match(turn.body,/A check works/);assert.match(turn.body,/Cash.*offline with Craig/);assert.match(turn.body,/Craig follow up.*price/);
  assert.doesNotMatch(turn.body,/\$|discount|\u2013|\u2014/);
  assert.equal(turn.state.escalation_reason,undefined,'V2 notices must not depend on the obsolete whole-thread escalation field');
  assert.ok(turn.state.topic_holds.includes('price_pushback'));assert.ok(turn.state.topic_holds.includes('cash'));
  const notices=f.db.sqlite.prepare('SELECT event_key,channel,status,provider_message_id,error_code FROM lead_playbook_owner_notifications ORDER BY event_key').all();
  assert.equal(notices.length,2);assert.ok(notices.every(row=>row.channel==='sms'&&row.status==='accepted'&&row.provider_message_id&&row.error_code===null));
  for(const reason of ['price_pushback','cash']){
    assert.ok(notices.some(row=>row.event_key.startsWith(reason+':')));
    const alert=staff.find(row=>row.body.includes('('+reason+')'));
    assert.ok(alert,reason);assert.ok(alert.body.includes(inbound));assert.ok(alert.body.includes('https://admin.example.test/admin/quote-funnel/?lead='+f.submissionId));
  }
  assert.equal(f.notices.length,0,'The production SMS-only setting must never send email');
  assert.deepEqual({...f.db.sqlite.prepare('SELECT owner,automation_mode FROM lead_conversations WHERE id=?').get(f.conversationId)},{owner:'backend',automation_mode:'approved'});
  const next=await f.inbound('ok whats weekly for 2 dogs again?',structuredClassification(['question_price'],{extracted:{dogs:2,frequency:'once_a_week'}}));
  assert.equal(next.draft.status,'sent');assert.match(next.body,/\$105 per month/);assert.equal(f.customer.length,2);assert.equal(staff.length,2);
  assert.ok(allRecipients.length===4&&allRecipients.every(phone=>phone==='+14192620424'));
});
