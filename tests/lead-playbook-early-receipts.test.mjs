import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {structuredThread,structuredClassification} from './helpers/lead-conversation-v2-thread.mjs';
import {claimEarlyAutomatedLeadReceipt,claimEarlyPlaybookDraftReceipt} from '../lib/lead-playbook-receipts.mjs';
import {formatMetaSms} from '../lib/meta-lead-policy.mjs';
import {recordPlaybookQuoEvent} from '../lib/lead-playbook-ingest.js';

const env={LEAD_PLAYBOOK_ENABLED:'true',LEAD_CONVERSATION_V2_ENABLED:'true',META_TEST_MODE:'true',META_TEST_RECIPIENTS:'+14192620424',LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',QUO_FROM_NUMBER:'+14195550188'};
const body='A check works, or you can keep a card on file through the secure portal.';
function event(text=body,id='early-provider'){
  return {direction:'outbound',from:env.QUO_FROM_NUMBER,to:'+14192620424',text,providerMessageId:id,eventId:'event-'+id,createdAt:new Date().toISOString(),authorType:'human',userId:'fixture-human',userIds:['fixture-human'],authorTypes:['human']};
}
function fixture(){
  const db=leadTestDatabase();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES ('early-lead','question','facebook','new','Fictional Example','+14192620424','{}')").run();
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode) VALUES ('early-conv','early-lead','org-opwp','facebook_lead','backend','approved')").run();
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,state_json) VALUES ('early-conv','early-lead','{\"stage\":\"confirm_details_sent\"}')").run();
  return db;
}
function draft(db,id='early-draft'){
  db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,intent,confidence,body,final_body,template_key,policy_version,status,send_claim,claimed_at) VALUES (?,'early-conv','early-lead','question_payment',1,?,?,'structured_playbook_v2','fixture','sending',?,CURRENT_TIMESTAMP)").run(id,body,body,'claim-'+id);
}
function meta(db,{purpose='confirmation'}={}){
  const text='Hi Test, this is Craig with Ohio Pet Waste Pros. Did I get your form details right?';
  db.sqlite.prepare("INSERT INTO meta_sms_jobs(id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status,attempted_at) VALUES ('early-meta',?,'fixture-trigger','early-lead','org-opwp','early-conv',?,'sending',CURRENT_TIMESTAMP)").run(purpose,text);
  return formatMetaSms(text,{firstMessage:true});
}
test('early customer draft receipts bind only the first provider ID without completing the draft or state',async()=>{
  const db=fixture();draft(db);
  const before=db.sqlite.prepare("SELECT state_json,revision FROM lead_playbook_state WHERE conversation_id='early-conv'").get();
  assert.equal(await claimEarlyPlaybookDraftReceipt(db,env,event()),true);
  assert.deepEqual({...db.sqlite.prepare('SELECT status,send_claim,provider_message_id FROM lead_reply_drafts').get()},{status:'sending',send_claim:'claim-early-draft',provider_message_id:'early-provider'});
  assert.deepEqual({...db.sqlite.prepare("SELECT state_json,revision FROM lead_playbook_state WHERE conversation_id='early-conv'").get()},{...before});
  assert.equal(await claimEarlyPlaybookDraftReceipt(db,env,event(body,'manual-copy')),false);db.sqlite.close();
});
test('a manually copied pending draft is never an early automated receipt',async()=>{
  const db=fixture();draft(db);db.sqlite.prepare("UPDATE lead_reply_drafts SET status='pending',send_claim=NULL,claimed_at=NULL").run();
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event()),false);assert.equal(db.sqlite.prepare('SELECT provider_message_id FROM lead_reply_drafts').get().provider_message_id,null);db.sqlite.close();
});
test('early automated receipt proof requires exact body, recipient, line, claimed time and stored provider thread',async()=>{
  const db=fixture();draft(db);
  for(const change of [{text:body+' changed'},{to:'+14195550101'},{from:'+14195550102'},{createdAt:new Date(Date.now()-600000).toISOString()}])assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,{...event(),...change}),false);
  db.sqlite.prepare("UPDATE lead_conversations SET external_thread_id='provider-thread'").run();
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event()),false);
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,{...event(),conversationId:'provider-thread'}),true);db.sqlite.close();
});
test('ambiguous simultaneous identical customer draft claims cannot borrow each other\'s provider receipt',async()=>{
  const db=fixture();draft(db);draft(db,'other-draft');
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event()),false);
  assert.equal(db.sqlite.prepare('SELECT count(*) count FROM lead_reply_drafts WHERE provider_message_id IS NOT NULL').get().count,0);db.sqlite.close();
});
test('early Meta confirmation receipts bind the formatted STOP-footer body and retain sending status',async()=>{
  const db=fixture(),text=meta(db);
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event(text)),true);
  assert.deepEqual({...db.sqlite.prepare('SELECT status,provider_message_id FROM meta_sms_jobs').get()},{status:'sending',provider_message_id:'early-provider'});
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event(text,'manual-copy')),false);
  db.sqlite.prepare("UPDATE meta_sms_jobs SET status='sent'").run();
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event(text)),true,'The accepted-ID gap before the ordinary message ledger is also backend-owned');db.sqlite.close();
});
test('early Meta proof does not recognize a different body or a disabled cadence purpose',async()=>{
  for(const purpose of ['reply','follow_up','signup']){
    const db=fixture(),text=meta(db,{purpose});
    assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event(text)),false);db.sqlite.close();
  }
  const db=fixture(),text=meta(db);
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,env,event(text+' altered')),false);assert.equal(db.sqlite.prepare('SELECT provider_message_id FROM meta_sms_jobs').get().provider_message_id,null);db.sqlite.close();
});
test('disabled V2 receipt matching is inert',async()=>{
  const db={prepare(){assert.fail('Disabled receipt helper must not query storage');}};
  assert.equal(await claimEarlyAutomatedLeadReceipt(db,{...env,LEAD_CONVERSATION_V2_ENABLED:'false'},event()),false);
});
test('the real V2 customer transport accepts an early human-attributed API receipt once and keeps the next question active',async t=>{
  const f=await structuredThread(t,{notifications:false}),priorFetch=globalThis.fetch;
  const plans=[structuredClassification(['question_price'],{extracted:{dogs:2,frequency:'once_a_week'}}),structuredClassification(['question_payment'])];
  f.env.AI.run=async(model,request)=>{
    f.modelCalls.push({model,request});assert.ok(request.text?.format?.type==='json_schema'||request.response_format?.type==='json_schema');
    return {response:JSON.stringify(plans[f.modelCalls.length-1])};
  };
  let calls=0,lastBody='',insideStatus;
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(String(input));
    if(url.href!=='https://api.openphone.com/v1/messages'||options.method!=='POST')return priorFetch(input,options);
    const message=JSON.parse(options.body),providerId='customer-'+crypto.randomUUID();calls++;lastBody=message.content;
    assert.deepEqual(message.to,['+14192620424']);f.customer.push(message.content);f.requests.push({path:url.pathname,method:'POST'});
    const before=f.db.sqlite.prepare('SELECT revision FROM lead_playbook_state WHERE conversation_id=?').get(f.conversationId).revision;
    await recordPlaybookQuoEvent(f.db,f.env,{...event(message.content,providerId),from:f.env.QUO_FROM_NUMBER,userId:'fixture-craig-user',userIds:['fixture-craig-user']});
    insideStatus=f.db.sqlite.prepare('SELECT status,provider_message_id FROM lead_reply_drafts WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1').get(f.conversationId);
    assert.equal(insideStatus.status,'sending');assert.equal(insideStatus.provider_message_id,providerId);
    assert.equal(f.db.sqlite.prepare('SELECT revision FROM lead_playbook_state WHERE conversation_id=?').get(f.conversationId).revision,before);
    assert.deepEqual({...f.db.sqlite.prepare('SELECT owner,automation_mode FROM lead_conversations WHERE id=?').get(f.conversationId)},{owner:'backend',automation_mode:'approved'});
    return Response.json({data:{id:providerId}});
  });
  const first=await f.inbound('how much for 2 dogs every week?',structuredClassification(['question_price'],{extracted:{dogs:2,frequency:'once_a_week'}}));
  assert.equal(first.draft.status,'sent');assert.match(first.body,/\$105 per month/);assert.equal(calls,1);
  const second=await f.inbound('can i pay by check?',structuredClassification(['question_payment']));assert.equal(second.draft.status,'sent');assert.match(second.body,/A check works/);assert.equal(calls,2);
  await f.manual(lastBody);assert.equal(f.db.sqlite.prepare('SELECT automation_mode FROM lead_conversations WHERE id=?').get(f.conversationId).automation_mode,'paused');
});
test('the real Meta confirmation sender accepts its early callback without a human takeover or duplicate send',async t=>{
  const db=leadTestDatabase();t.after(()=>db.sqlite.close());
  const {storeMetaLead,processMetaConfirmations}=await import('../lib/meta-lead-workflow.mjs');
  db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0").run();
  db.sqlite.prepare("INSERT INTO meta_automation_releases(id,organization_id,policy_version,approved_by,evidence,approved_at) VALUES ('fixture-early-release','org-opwp','meta-confirmation-v2-test','fixture','Offline test only',datetime('now','-1 minute'))").run();
  const config={...env,DB:db,META_AUTOMATION_ENABLED:'false',META_TEST_APPROVAL_ID:'fixture-early-release',META_TEST_FORM_IDS:'fixture-form',META_ALLOWED_PAGE_IDS:'fixture-page',QUO_API_KEY:'fixture',
    QUO_HUMAN_USER_IDS:'fixture-human',META_APPROVED_SMS_FORMS:JSON.stringify({'fixture-form':{pageId:'fixture-page',consentField:'sms_consent',version:'fixture-disclosure',disclosure:'Fixture automated quote texts. Reply STOP to opt out.'}})};
  const fields={full_name:'Test Lead Craig',phone_number:'+14192620424',zip_code:'43551',number_of_dogs:'2',service_frequency:'weekly',contact_preference:'text',sms_consent:'yes'};
  const stored=await storeMetaLead(db,config,{id:'fixture-early-meta',form_id:'fixture-form',created_time:new Date().toISOString(),field_data:Object.entries(fields).map(([name,value])=>({name,values:[value]}))},{leadId:'fixture-early-meta',formId:'fixture-form',pageId:'fixture-page'});
  const submissionId=stored.id;
  let calls=0;
  const options={submissionId,textSafety:async()=>({verified:true,doNotText:false}),fetcher:async(_url,request)=>{
    calls++;const message=JSON.parse(request.body);assert.deepEqual(message.to,['+14192620424']);assert.match(message.content,/\n\nReply STOP to opt out$/);
    await recordPlaybookQuoEvent(db,config,event(message.content,'early-meta-provider'));
    const inside=db.sqlite.prepare('SELECT status,provider_message_id FROM meta_sms_jobs WHERE submission_id=?').get(submissionId);
    assert.equal(inside.status,'sending');assert.equal(inside.provider_message_id,'early-meta-provider');
    assert.deepEqual({...db.sqlite.prepare('SELECT owner,automation_mode FROM lead_conversations WHERE submission_id=?').get(submissionId)},{owner:'backend',automation_mode:'approved'});
    return Response.json({data:{id:'early-meta-provider'}});
  }};
  const first=await processMetaConfirmations(config,options);assert.equal(first.sent,1);assert.equal(calls,1);
  await processMetaConfirmations(config,options);assert.equal(calls,1);
  const job=db.sqlite.prepare('SELECT status,provider_message_id FROM meta_sms_jobs WHERE submission_id=?').get(submissionId);assert.equal(job.status,'sent');assert.equal(job.provider_message_id,'early-meta-provider');
});
