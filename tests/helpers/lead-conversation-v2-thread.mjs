import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {leadTestDatabase} from './lead-inbox-fixture.mjs';
import {mockAirtableSafetyRead} from './airtable-text-safety-fixture.mjs';
import {normalizeQuoMessageEvent} from '../../lib/quo-webhook.mjs';

// Exercise the actual webhook/ingest/draft/sender modules, replacing only Worker
// bindings and external I/O. These model fixtures test state/transport, not LLM
// semantic accuracy (which is measured separately against the real provider).
const imports={
  './cloudflare':"export const getRuntimeEnv=()=>({SNG_API_KEY:'fixture-only'});",
  './airtable':"export const ensureFreshAirtableCockpitSnapshot=()=>{throw Error('Unexpected Airtable refresh');};",
  './outbound-request':'export const outboundFetch=(url,options)=>fetch(url,options);',
  './route-partner':"export const OPWP_ORGANIZATION_ID='org-opwp';",
};
const hooks=registerHooks({resolve(specifier,context,next){
  if(Object.hasOwn(imports,specifier))return{url:'data:text/javascript,'+encodeURIComponent(imports[specifier]),shortCircuit:true};
  return next(specifier==='./sweepandgo'?'./sweepandgo.js':specifier,context);
}});
let recordInboundQuoMessage,processPlaybookInbound,recordPlaybookQuoEvent;
try{
  ({recordInboundQuoMessage}=await import('../../lib/lead-assistant.js'));
  ({processPlaybookInbound,recordPlaybookQuoEvent}=await import('../../lib/lead-playbook-ingest.js'));
  await import('../../lib/submission-notifications.js');
}finally{hooks.deregister();}

export const craigTestPhone='+14192620424';
const business='+14195550121';
export const structuredClassification=(intents,extra={})=>({intents,confirms_details:'no',corrections:{},extracted:{},sentiment:'neutral',needs_owner:false,owner_reason:'none',confidence:.95,...extra});

export async function structuredThread(t,{phone=craigTestPhone,automation='approved',owner='backend',notifications=true}={}){
  const smsImport=registerHooks({resolve(specifier,context,next){return next(specifier==='./lead-assistant'?'./lead-assistant.js':specifier,context);}});
  t.after(()=>smsImport.deregister());
  const db=leadTestDatabase();t.after(()=>db.sqlite.close());
  const submissionId=crypto.randomUUID(),conversationId=crypto.randomUUID(),createdAt=new Date().toISOString();
  const facts={name:'Example Lead',dogs:2,frequency:'once_a_week',city:'Perrysburg',zip:'43551'};
  const payload={...facts,number_of_dogs:2,clean_up_frequency:'Weekly',sms_consent_evidence:{valid:true,formId:'fixture-v2',pageId:'fixture-page'},follow_up_consent:true};
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,zip,payload)VALUES(?,'partial_quote','facebook_lead','new',?,?,?,?)").run(submissionId,facts.name,phone,facts.zip,JSON.stringify(payload));
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode,last_outbound_at)VALUES(?,?,'org-opwp','facebook_lead',?,?,CURRENT_TIMESTAMP)").run(conversationId,submissionId,owner,automation);
  db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0 WHERE organization_id='org-opwp'").run();
  db.sqlite.prepare("INSERT INTO growth_leads(submission_id,organization_id,stage,updated_by)VALUES(?,'org-opwp','contacted','fixture')").run(submissionId);
  db.sqlite.prepare("INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,review_reason)VALUES(?,'org-opwp',?,'fixture-v2','fixture-page','https://example.test/form','')").run(submissionId,'fixture-'+submissionId);
  const state={stage:'confirm_details_sent',details_confirmed:false,details:facts,meta_confirmation_sent:true};
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,stage,state_json,revision)VALUES(?,?,'confirm_details_sent',?,1)").run(conversationId,submissionId,JSON.stringify(state));
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author)VALUES(?,?,'org-opwp','outbound','quo_sms',?,'Approved form confirmation','delivered',1,'fixture','backend')").run(crypto.randomUUID(),conversationId,'intro-'+submissionId);
  db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)VALUES('business_cockpit',?,'success',?)").run(JSON.stringify({opwp:{customers:[{fields:{Status:'Active',City:'Perrysburg',ZIP:'43551'}},{fields:{Status:'Active',City:'Holland',ZIP:'43528'}},{fields:{Status:'Inactive',City:'Elmore',ZIP:'43416'}}]}}),createdAt);
  const customer=[],notices=[],requests=[],modelCalls=[];
  let modelPlan=structuredClassification(['unclear']);
  const env={LEAD_CONVERSATION_V2_ENABLED:'true',LEAD_CLASSIFIER_ENABLED:'true',LEAD_CLASSIFIER_PROVIDER:'workers_ai',LEAD_CLASSIFIER_MODEL:'@cf/openai/gpt-oss-120b',LEAD_CLASSIFIER_DAILY_CAP:'100',LEAD_CLASSIFIER_TIMEOUT_MS:'50',
    LEAD_PLAYBOOK_ENABLED:'true',LEAD_PLAYBOOK_AUTO_SEND_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_ENABLED:notifications?'true':'false',LEAD_PLAYBOOK_NOTIFY_CHANNELS:'email',
    META_TEST_MODE:'true',META_AUTOMATION_ENABLED:'false',META_TEST_RECIPIENTS:craigTestPhone,LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',
    LEAD_PLAYBOOK_ADMIN_ORIGIN:'https://admin.example.test',LEAD_PLAYBOOK_LINK_SECRET:'fictional-v2-signing-key-never-used-externally',LEAD_PLAYBOOK_CRAIG_CELL:craigTestPhone,
    QUO_FROM_NUMBER:business,QUO_API_KEY:'fixture-only',AIRTABLE_API_KEY:'fixture-only',QUO_HUMAN_USER_IDS:'fixture-craig-user',
    OWNER_NOTIFICATION_EMAIL:'office@example.test',EMAIL_SENDING_ENABLED:'true',EMAIL_FROM:'sender@example.test',
    EMAIL:{async send(message){notices.push(message);return{messageId:'email-'+crypto.randomUUID()};}},
    AI:{async run(model,request){
      modelCalls.push({model,request});
      assert.equal(model,'@cf/openai/gpt-oss-120b');assert.ok(Array.isArray(request.input));
      assert.equal(request.text.format.type,'json_schema');assert.equal(request.text.format.name,'lead_classifier');assert.equal(request.text.format.strict,false);
      assert.equal(request.reasoning.effort,'medium');assert.equal(request.max_output_tokens,1500);
      assert.equal(request.messages,undefined);assert.equal(request.response_format,undefined);
      const value=typeof modelPlan==='function'?await modelPlan():modelPlan;
      return{id:'response-'+crypto.randomUUID(),object:'response',status:'completed',model,
        output:[{type:'message',role:'assistant',content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value)}]}],
        usage:{input_tokens:100,output_tokens:100,total_tokens:200}};
    }}};
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(String(input)),method=options.method||'GET';requests.push({path:url.pathname,method});
    assert.ok(!url.pathname.replace(/\/$/,'').endsWith('/api/onboard'),'An informational SMS may never call onboarding');
    const safety=mockAirtableSafetyRead(input,options);if(safety)return safety;
    if(url.origin==='https://openapi.sweepandgo.com'&&method==='GET'&&['/api/v1/clients/active','/api/v1/clients/active_no_subscription'].includes(url.pathname))return Response.json([]);
    if(url.href==='https://api.openphone.com/v1/messages'&&method==='POST'){
      const message=JSON.parse(options.body);assert.equal(message.from,business);assert.deepEqual(message.to,[craigTestPhone]);
      assert.doesNotMatch(message.content,/[\u2013\u2014]/);customer.push(message.content);return Response.json({data:{id:'sms-'+crypto.randomUUID()}});
    }
    throw Error('Unexpected external I/O in structured conversation fixture: '+method+' '+url.origin+url.pathname);
  });
  const readState=()=>JSON.parse(db.sqlite.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=?').get(conversationId).state_json);
  async function inbound(text,classification=structuredClassification(['unclear']),{directOptions}={}){
    modelPlan=classification;
    const providerId='in-'+crypto.randomUUID(),time=new Date().toISOString(),before=customer.length;
    const event=normalizeQuoMessageEvent({id:'event-'+providerId,type:'message.received',data:{object:{id:providerId,direction:'incoming',from:phone,to:[business],createdAt:time,text}}});
    assert.ok(event);
    let result;
    if(directOptions){
      db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author,created_at)VALUES(?,?,'org-opwp','inbound','quo_sms',?,?,'delivered',0,'quo-webhook','lead',?)").run(crypto.randomUUID(),conversationId,providerId,text,time);
      db.sqlite.prepare("UPDATE lead_conversations SET last_inbound_at=?,status='open' WHERE id=?").run(time,conversationId);
      result=await processPlaybookInbound(db,env,{conversationId,submissionId,event},directOptions);
    }else result=await recordInboundQuoMessage(db,env,event,{syncTextStatus:async()=>({verified:true})});
    const sent=customer.slice(before);assert.ok(sent.length<=1,'Exactly one composed reply per customer inbound');
    const draft=db.sqlite.prepare('SELECT d.* FROM lead_reply_drafts d JOIN lead_messages m ON m.id=d.inbound_message_id WHERE m.provider_message_id=? AND d.conversation_id=?').get(providerId,conversationId);
    return {text,body:sent[0]||'',draft,state:readState(),event,result};
  }
  async function manual(text,{userId='fixture-craig-user',authorType='human'}={}){
    const providerId='manual-'+crypto.randomUUID();
    const event=normalizeQuoMessageEvent({id:'event-'+providerId,type:'message.delivered',data:{object:{id:providerId,direction:'outgoing',from:business,to:[phone],text,createdAt:new Date().toISOString(),userId,authorType}}});
    await recordPlaybookQuoEvent(db,env,event);return event;
  }
  async function sendDraft(id){const {sendVerifiedPlaybookDraft}=await import('../../lib/lead-playbook-service.js');return sendVerifiedPlaybookDraft(db,env,id);}
  return{db,env,submissionId,conversationId,facts,customer,notices,requests,modelCalls,inbound,manual,readState,sendDraft};
}
