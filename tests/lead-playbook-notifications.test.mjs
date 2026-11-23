import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {notifyPlaybookOwner,flushPlaybookOwnerNotices,queuePlaybookOwnerNotice,playbookOwnerNoticeReasonAllowed} from '../lib/lead-playbook-notifications.mjs';

const config={LEAD_PLAYBOOK_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_ENABLED:'true',LEAD_PLAYBOOK_LINK_SECRET:'fabricated-notification-link-secret-123456',LEAD_PLAYBOOK_CRAIG_CELL:'+14195550199',QUO_FROM_NUMBER:'+14195550188',QUO_API_KEY:'fabricated',OWNER_NOTIFICATION_EMAIL:'owner@example.test'};
const night=new Date('2026-11-22T03:00:00Z');
function fixture(){
  const db=leadTestDatabase();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES ('notice-lead','question','website','new','Fictional Example','4195550100','{}')").run();
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner) VALUES ('notice-conv','notice-lead','org-opwp','backend')").run();
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES ('notice-inbound','notice-conv','org-opwp','inbound','quo_sms','We have eight dogs and need a custom price.','fixture')").run();
  db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,organization_id,inbound_message_id,intent,confidence,body,policy_version,reason,state_json,expires_at) VALUES ('notice-draft','notice-conv','notice-lead','org-opwp','notice-inbound','other',0,'A fictional suggested reply','fixture','custom_pricing','{\"stage\":\"escalated\",\"escalation_reason\":\"custom_pricing\"}','2099-01-01 00:00:00')").run();
  return {db,notice:{kind:'pending_draft',submissionId:'notice-lead',conversationId:'notice-conv',draftId:'notice-draft',eventKey:'draft:notice-draft'}};
}
test('owner alerts are inert without their independent release gate',async()=>{
  const db={prepare(){throw new Error('Unexpected storage access');}};
  assert.equal((await notifyPlaybookOwner(db,{},{})).enabled,false);
  assert.equal((await flushPlaybookOwnerNotices(db,{LEAD_PLAYBOOK_ENABLED:'true'})).enabled,false);
});
test('nighttime real exception alerts send once with private links, the exact reason and linked customer text',async()=>{
  const {db,notice}=fixture();let sms=0,email=0;
  function checkStaffContext(text) {
    assert.match(text,/\/admin\/playbook\/d\//);
    assert.match(text,/Reason: The request needs a custom price \(custom_pricing\)/);
    assert.match(text,/Customer said: "We have eight dogs and need a custom price\."/);
    assert.match(text,/Fictional Example/);
    assert.ok(text.replace(/\D/g,'').includes('4195550100'));
  }
  const options={now:night,fetcher:async(_url,request)=>{
    sms++;const body=JSON.parse(request.body);
    assert.deepEqual(body.to,[config.LEAD_PLAYBOOK_CRAIG_CELL]);
    checkStaffContext(body.content);
    return Response.json({data:{id:'sms-notice'}});
  },emailSender:async(_env,message)=>{
    email++;assert.equal(message.to,config.OWNER_NOTIFICATION_EMAIL);checkStaffContext(message.text);
    assert.match(message.html,/<q>We have eight dogs and need a custom price\.<\/q>/);
    assert.match(message.idempotencyKey,/^playbook-owner\//);
    return 'email-notice';
  }};
  const result=await notifyPlaybookOwner(db,config,notice,options);
  assert.equal(result.acceptedCount,2);
  await notifyPlaybookOwner(db,config,notice,options);
  assert.deepEqual([sms,email],[1,1]);
  assert.deepEqual(db.sqlite.prepare('SELECT channel,status FROM lead_playbook_owner_notifications ORDER BY channel').all().map(row=>({...row})),[{channel:'email',status:'accepted'},{channel:'sms',status:'accepted'}]);
});

test('every staff alert kind has an explicit staff label and no customer opt-out footer',async()=>{
  for(const kind of ['pending_draft','signup_ready','property_walk','lead_review']){
    const {db,notice}=fixture();let sms=0,email=0;
    const result=await notifyPlaybookOwner(db,config,{...notice,kind,draftId:kind==='pending_draft'?notice.draftId:null,eventKey:kind==='lead_review'?'custom_pricing:notice-inbound':`${kind}:notice-inbound`},{now:night,
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
  const result=await notifyPlaybookOwner(db,env,{...notice,kind:'lead_review',draftId:null,eventKey:'custom_pricing:notice-inbound'},{now:night,
    fetcher:async(_url,request)=>{
      sms++;const message=JSON.parse(request.body);
      assert.deepEqual(message.to,['+14195550100']);
      assert.match(message.content,/^\[OPWP STAFF ALERT\] A lead question needs your review\. Reason:/);
      assert.match(message.content,/custom_pricing/);
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

test('ordinary unclear detail drafts remain in the workspace without owner alerts',async()=>{
  for(const reason of ['detail_clarification','ambiguous_correction','unrecognized_form_details','measurement_requires_review','approved_template']){
    const {db,notice}=fixture();
    db.sqlite.prepare('UPDATE lead_reply_drafts SET reason=?,state_json=?').run(reason,JSON.stringify({stage:'escalated',expected:'yardTier',escalation_reason:reason}));
    const result=await notifyPlaybookOwner(db,config,notice,{now:night,fetcher(){assert.fail('No staff SMS for ordinary detail collection');},emailSender(){assert.fail('No staff email for ordinary detail collection');}});
    assert.equal(result.accepted,false,reason);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM lead_playbook_owner_notifications').get().n,0,reason);
    assert.equal(playbookOwnerNoticeReasonAllowed(reason),false);
    db.sqlite.close();
  }
});

test('already queued ordinary detail alerts are cancelled before any provider call',async()=>{
  const {db,notice}=fixture();
  await queuePlaybookOwnerNotice(db,config,notice);
  db.sqlite.prepare("UPDATE lead_reply_drafts SET reason='detail_clarification',state_json=?").run(JSON.stringify({stage:'collect_details',expected:'lastCleaned'}));
  const result=await flushPlaybookOwnerNotices(db,config,{now:night,fetcher(){assert.fail('Must not send');},emailSender(){assert.fail('Must not send');}});
  assert.equal(result.cancelled,2);
  assert.deepEqual(db.sqlite.prepare('SELECT status,error_code FROM lead_playbook_owner_notifications').all().map(row=>({...row})),[
    {status:'cancelled',error_code:'not_staff_exception'},{status:'cancelled',error_code:'not_staff_exception'},
  ]);
  db.sqlite.close();
});

test('real exception categories include a specific reason instead of a generic review prompt',async()=>{
  for(const reason of ['property_walk','signup_ready','identity_question','custom_pricing','route_day_requires_confirmation','service_billing_or_anger','existing_customer','customer_directory_unverified','outside_service_area','intent_needs_review','price_objection']){
    const {db,notice}=fixture();let sent=0;
    db.sqlite.prepare('UPDATE lead_reply_drafts SET reason=?').run(reason);
    const result=await notifyPlaybookOwner(db,config,notice,{now:night,fetcher:async(_url,request)=>{sent++;const text=JSON.parse(request.body).content;assert.ok(text.includes(`(${reason})`));assert.match(text,/Customer said: "We have eight dogs and need a custom price\."/);return Response.json({id:'exception-'+reason});},emailSender:async()=>{sent++;return 'exception-email-'+reason;}});
    assert.equal(result.acceptedCount,2,reason);assert.equal(sent,2,reason);
    db.sqlite.close();
  }
});

test('a delayed no-draft alert quotes its exact inbound rather than a newer message',async()=>{
  const {db,notice}=fixture();
  await queuePlaybookOwnerNotice(db,config,{...notice,kind:'lead_review',draftId:null,eventKey:'custom_pricing:notice-inbound'});
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by,created_at) VALUES ('newer-message','notice-conv','org-opwp','inbound','quo_sms','A completely unrelated later answer','fixture','2098-01-01')").run();
  const result=await flushPlaybookOwnerNotices(db,config,{now:night,fetcher:async(_url,request)=>{const text=JSON.parse(request.body).content;assert.match(text,/We have eight dogs/);assert.doesNotMatch(text,/unrelated later/);return Response.json({id:'original-context'});},emailSender:async()=> 'original-context-email'});
  assert.equal(result.acceptedCount,2);
  db.sqlite.close();
});

test('no-draft directory alerts derive the exact reason and original inbound from their durable event key',async()=>{
  const {db,notice}=fixture();
  const result=await notifyPlaybookOwner(db,config,{...notice,kind:'lead_review',draftId:null,eventKey:'directory-review:notice-conv:existing_customer:notice-inbound'},{now:night,fetcher:async(_url,request)=>{const text=JSON.parse(request.body).content;assert.match(text,/An existing customer needs personal review \(existing_customer\)/);assert.match(text,/We have eight dogs/);assert.match(text,/\/admin\/quote-funnel\//);return Response.json({id:'directory-context'});},emailSender:async()=> 'directory-context-email'});
  assert.equal(result.acceptedCount,2);
  db.sqlite.close();
});

test('state-derived reasons require the same referenced inbound and never borrow a stale exception',async()=>{
  for(const referencedId of ['notice-inbound','another-message']){
    const {db,notice}=fixture();let sent=0;
    db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,state_json) VALUES ('notice-conv','notice-lead',?)").run(JSON.stringify({stage:'escalated',escalation_reason:'custom_pricing',last_inbound_message_id:'notice-inbound'}));
    const result=await notifyPlaybookOwner(db,config,{...notice,kind:'lead_review',draftId:null,eventKey:referencedId},{now:night,fetcher:async()=>{sent++;return Response.json({id:'state-context'});},emailSender:async()=>{sent++;return 'state-context-email';}});
    assert.equal(sent,referencedId==='notice-inbound'?2:0);
    assert.equal(result.accepted,referencedId==='notice-inbound');
    db.sqlite.close();
  }
});

test('staff customer excerpts are bounded and HTML escaped with control characters removed',async()=>{
  const {db,notice}=fixture();
  const text='Please review <img src=x onerror="bad()"> & this quote.\r\n\u202e'+ 'More detail. '.repeat(150)+'\u0000';
  db.sqlite.prepare('UPDATE lead_messages SET body=? WHERE id=?').run(text,'notice-inbound');
  let content,email;
  const result=await notifyPlaybookOwner(db,config,notice,{now:night,fetcher:async(_url,request)=>{content=JSON.parse(request.body).content;return Response.json({id:'bounded-context'});},emailSender:async(_env,message)=>{email=message;return 'bounded-context-email';}});
  assert.equal(result.acceptedCount,2);
  assert.match(content,/Please review <img src=x onerror="bad\(\)"> & this quote\./);assert.doesNotMatch(content,/[\u0000\r\n\u202e]/);assert.ok(content.length<1000);
  assert.match(content,/More detail\..*?\.\.\."/);
  assert.match(content,/Prior quote: None recorded/);
  assert.match(content,/https:\/\/[^\s]+\/admin\/playbook\/d\//);
  assert.match(email.html,/&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp;/);assert.doesNotMatch(email.html,/<img/);
  db.sqlite.close();
});

test('a missing referenced inbound never causes an alert to quote a different customer turn',async()=>{
  const {db,notice}=fixture();
  const result=await notifyPlaybookOwner(db,config,{...notice,kind:'lead_review',draftId:null,eventKey:'custom_pricing:missing-message'},{now:night,fetcher:async(_url,request)=>{const text=JSON.parse(request.body).content;assert.match(text,/custom_pricing/);assert.doesNotMatch(text,/Customer said:|eight dogs/);return Response.json({id:'no-invented-context'});},emailSender:async()=> 'no-invented-context-email'});
  assert.equal(result.acceptedCount,2);
  db.sqlite.close();
});
