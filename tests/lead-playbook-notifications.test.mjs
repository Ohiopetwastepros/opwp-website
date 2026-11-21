import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {notifyPlaybookOwner,flushPlaybookOwnerNotices,queuePlaybookOwnerNotice} from '../lib/lead-playbook-notifications.mjs';

const config={LEAD_PLAYBOOK_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_ENABLED:'true',LEAD_PLAYBOOK_LINK_SECRET:'fabricated-notification-link-secret-123456',LEAD_PLAYBOOK_CRAIG_CELL:'+14195550199',QUO_FROM_NUMBER:'+14195550188',QUO_API_KEY:'fabricated',OWNER_NOTIFICATION_EMAIL:'owner@example.test'};
const night=new Date('2026-11-22T03:00:00Z');
function fixture(){
  const db=leadTestDatabase();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES ('notice-lead','question','website','new','Fictional Example','4195550100','{}')").run();
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner) VALUES ('notice-conv','notice-lead','org-opwp','backend')").run();
  db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,organization_id,intent,confidence,body,policy_version,expires_at) VALUES ('notice-draft','notice-conv','notice-lead','org-opwp','other',0,'A fictional suggested reply','fixture','2099-01-01 00:00:00')").run();
  return {db,notice:{kind:'pending_draft',submissionId:'notice-lead',conversationId:'notice-conv',draftId:'notice-draft',eventKey:'draft:notice-draft'}};
}
test('owner alerts are inert without their independent release gate',async()=>{
  const db={prepare(){throw new Error('Unexpected storage access');}};
  assert.equal((await notifyPlaybookOwner(db,{},{})).enabled,false);
  assert.equal((await flushPlaybookOwnerNotices(db,{LEAD_PLAYBOOK_ENABLED:'true'})).enabled,false);
});
test('nighttime owner SMS and email each send once with private draft links and no customer details',async()=>{
  const {db,notice}=fixture();let sms=0,email=0;
  const options={now:night,fetcher:async(_url,request)=>{sms++;const body=JSON.parse(request.body);assert.deepEqual(body.to,[config.LEAD_PLAYBOOK_CRAIG_CELL]);assert.match(body.content,/\/admin\/playbook\/d\//);assert.doesNotMatch(body.content,/Fictional Example|4195550100/);return Response.json({data:{id:'sms-notice'}});},emailSender:async(_env,message)=>{email++;assert.equal(message.to,config.OWNER_NOTIFICATION_EMAIL);assert.match(message.text,/\/admin\/playbook\/d\//);assert.doesNotMatch(message.text,/Fictional Example|4195550100/);assert.match(message.idempotencyKey,/^playbook-owner\//);return 'email-notice';}};
  const result=await notifyPlaybookOwner(db,config,notice,options);
  assert.equal(result.acceptedCount,2);
  await notifyPlaybookOwner(db,config,notice,options);
  assert.deepEqual([sms,email],[1,1]);
  assert.deepEqual(db.sqlite.prepare('SELECT channel,status FROM lead_playbook_owner_notifications ORDER BY channel').all().map(row=>({...row})),[{channel:'email',status:'accepted'},{channel:'sms',status:'accepted'}]);
});

test('every staff alert kind has an explicit staff label and no customer opt-out footer',async()=>{
  for(const kind of ['pending_draft','signup_ready','property_walk','lead_review']){
    const {db,notice}=fixture();let sms=0,email=0;
    const result=await notifyPlaybookOwner(db,config,{...notice,kind,draftId:kind==='pending_draft'?notice.draftId:null,eventKey:kind},{now:night,
      fetcher:async(_url,request)=>{
        sms++;const message=JSON.parse(request.body);
        assert.match(message.content,/^\[OPWP STAFF ALERT\] A lead /);
        assert.doesNotMatch(message.content,/Reply STOP to opt out/i);
        return Response.json({id:'staff-sms-'+kind});
      },emailSender:async(_env,message)=>{
        email++;assert.match(message.subject,/^\[OPWP STAFF ALERT\] A lead /);
        assert.match(message.text,/^\[OPWP STAFF ALERT\] A lead /);
        assert.match(message.html,/<p>\[OPWP STAFF ALERT\] A lead /);
        assert.doesNotMatch([message.subject,message.text,message.html].join(' '),/Reply STOP to opt out/i);
        return 'staff-email-'+kind;
      }});
    assert.equal(result.acceptedCount,2);assert.deepEqual([sms,email],[1,1]);
    db.sqlite.close();
  }
});

test('staff alerts remain clearly labelled when the configured owner cell normalizes to the lead phone',async()=>{
  const {db,notice}=fixture();let sms=0,email=0;
  const env={...config,LEAD_PLAYBOOK_CRAIG_CELL:'(419) 555-0100',LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',META_TEST_RECIPIENTS:'+14195550100'};
  const result=await notifyPlaybookOwner(db,env,{...notice,kind:'lead_review',draftId:null},{now:night,
    fetcher:async(_url,request)=>{
      sms++;const message=JSON.parse(request.body);
      assert.deepEqual(message.to,['+14195550100']);
      assert.match(message.content,/^\[OPWP STAFF ALERT\] A lead question needs your review\. https:\/\//);
      assert.doesNotMatch(message.content,/Reply STOP to opt out/i);
      return Response.json({id:'shared-owner-staff-alert'});
    },emailSender:async(_env,message)=>{email++;assert.equal(message.to,config.OWNER_NOTIFICATION_EMAIL);return 'shared-owner-email';}});
  assert.equal(result.acceptedCount,2);assert.deepEqual([sms,email],[1,1]);
  assert.equal(db.sqlite.prepare("SELECT provider_message_id FROM lead_playbook_owner_notifications WHERE channel='sms'").get().provider_message_id,'shared-owner-staff-alert');
  db.sqlite.close();
});
test('an uncertain SMS cannot suppress email or automatically send another SMS',async()=>{
  const {db,notice}=fixture();let sms=0,email=0;
  const options={now:night,fetcher:async()=>{sms++;throw new Error('Fabricated response loss');},emailSender:async()=>{email++;return 'email-only';}};
  const first=await notifyPlaybookOwner(db,config,notice,options);
  assert.equal(first.uncertain,1);assert.equal(first.acceptedCount,1);
  await flushPlaybookOwnerNotices(db,config,options);
  assert.deepEqual([sms,email],[1,1]);
  assert.equal(db.sqlite.prepare("SELECT status FROM lead_playbook_owner_notifications WHERE channel='sms'").get().status,'uncertain');
});
test('missing SMS configuration leaves only that channel queued while email succeeds',async()=>{
  const {db,notice}=fixture();let sms=0,email=0;
  const options={now:night,fetcher:async()=>{sms++;return Response.json({id:'configured-later'});},emailSender:async()=>{email++;return 'email-first';}};
  const result=await notifyPlaybookOwner(db,{...config,QUO_API_KEY:''},notice,options);
  assert.equal(result.deferred,1);assert.equal(email,1);assert.equal(sms,0);
  await flushPlaybookOwnerNotices(db,config,options);
  assert.deepEqual([sms,email],[1,1]);
});
test('a changed or expired draft cancels queued notices without a provider call',async()=>{
  for(const change of ["UPDATE lead_reply_drafts SET status='superseded'","UPDATE lead_reply_drafts SET expires_at='2000-01-01 00:00:00'"]){
    const {db,notice}=fixture();await queuePlaybookOwnerNotice(db,config,notice);db.sqlite.exec(change);
    const result=await flushPlaybookOwnerNotices(db,config,{now:night,fetcher(){throw new Error('Must not send');},emailSender(){throw new Error('Must not send');}});
    assert.equal(result.cancelled,2);
  }
});
test('signup and property-walk alerts reach only the configured owner during controlled customer tests',async()=>{
  const {db}=fixture();let sms=0,email=0;
  const env={...config,LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',META_TEST_RECIPIENTS:'+14195550100'};
  for(const kind of ['signup_ready','property_walk'])await notifyPlaybookOwner(db,env,{kind,submissionId:'notice-lead',conversationId:'notice-conv',eventKey:kind},{now:night,fetcher:async(_url,request)=>{sms++;assert.deepEqual(JSON.parse(request.body).to,[config.LEAD_PLAYBOOK_CRAIG_CELL]);return Response.json({id:'owner-'+kind});},emailSender:async(_env,message)=>{email++;assert.equal(message.to,config.OWNER_NOTIFICATION_EMAIL);assert.match(message.text,/\/admin\/quote-funnel\//);return 'owner-email-'+kind;}});
  assert.deepEqual([sms,email],[2,2]);
});
test('concurrent flushes atomically claim independent channels once',async()=>{
  const {db,notice}=fixture();await queuePlaybookOwnerNotice(db,config,notice);let sms=0,email=0,nested=false;
  const options={now:night,emailSender:async()=>{email++;return 'concurrent-email';},fetcher:async()=>{sms++;if(!nested){nested=true;await flushPlaybookOwnerNotices(db,config,options);}return Response.json({id:'concurrent-sms'});}};
  await flushPlaybookOwnerNotices(db,config,options);
  assert.deepEqual([sms,email],[1,1]);
});
