import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase as database} from './helpers/lead-inbox-fixture.mjs';
import {quoLearningScope,resolveQuoAuthor,ownerAfterOutbound,normalizeMetaLearningEvents} from '../lib/playbook-ownership.mjs';
import {normalizeQuoMessageEvent} from '../lib/quo-webhook.mjs';
import {recordPlaybookQuoEvent,recordPlaybookMetaEvent,processPlaybookInbound,runScheduledPlaybook,preparePlaybookIntros} from '../lib/lead-playbook-ingest.js';
import {setPlaybookOwner} from '../lib/lead-playbook-service.js';
import {playbookHash} from '../lib/lead-playbook-links.mjs';
const env={LEAD_PLAYBOOK_ENABLED:'true',LEAD_PLAYBOOK_HASH_KEY:'fabricated-key-for-tests-only-123456789',QUO_FROM_NUMBER:'+14195550100',QUO_LEARNING_NUMBERS:'+15675550100',QUO_HUMAN_USER_IDS:'human-example'};
const event={eventId:'event-example',providerMessageId:'AC-example',direction:'outbound',from:env.QUO_FROM_NUMBER,to:'+14195550199',text:'Hello Avery Example, email avery@example.test about 123 Test Street.',createdAt:'2026-11-19T15:00:00.000Z',userId:'human-example'};
function seed(db,owner='backend'){db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,email,payload) VALUES ('lead','question','website','new','Avery Example',?,?,?)").run(event.to,'avery@example.test',JSON.stringify({follow_up_consent:true,address:'123 Test Street',quote_context:{dogs:1,frequency:'once_a_week',yard_size:'tiny',last_cleaned:'two_weeks'}}));db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner,last_outbound_at) VALUES ('conv','lead','org-opwp',?,'2026-11-19T14:00:00Z')").run(owner);db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1 WHERE organization_id='org-opwp'").run();}
test('outgoing normalization captures reviewed authorship metadata only for delivered messages',()=>{const normalized=normalizeQuoMessageEvent({id:'EV-example',type:'message.delivered',data:{object:{id:'AC-example',direction:'outgoing',from:event.from,to:[event.to],text:'Example text',createdBy:{id:'human-example',type:'user'}}}});assert.equal(normalized.direction,'outbound');assert.equal(normalized.userId,'human-example');assert.equal(normalizeQuoMessageEvent({id:'EV-x',type:'message.failed',data:{object:{id:'AC-x',direction:'outgoing',text:'Example'}}}),null);});
test('only explicit human mapping or backend evidence can override Sona fallback',()=>{assert.equal(resolveQuoAuthor(event,{}),'sona');assert.equal(resolveQuoAuthor(event,env),'craig');assert.equal(resolveQuoAuthor({...event,authorType:'sona'},env),'sona');assert.equal(resolveQuoAuthor(event,env,{approvedDraft:true}),'backend');assert.equal(ownerAfterOutbound('backend','craig'),'craig');assert.equal(ownerAfterOutbound('backend','craig',{matchesPendingDraft:true}),'backend');assert.equal(quoLearningScope(env,{...event,from:env.QUO_LEARNING_NUMBERS}).learningOnly,true);});
test('all new ingest and cron paths are inert without the release flag',async()=>{const db={prepare(){throw new Error('New table touched while disabled');}};for(const fn of [()=>recordPlaybookQuoEvent(db,{},event),()=>recordPlaybookMetaEvent(db,{},event),()=>processPlaybookInbound(db,{},{}),()=>runScheduledPlaybook({DB:db}),()=>preparePlaybookIntros(db,{})])assert.equal((await fn()).disabled,true);});
test('outgoing manual capture flips owner, records once, and redacts learning prose',async()=>{const db=database();seed(db);await recordPlaybookQuoEvent(db,env,event);await recordPlaybookQuoEvent(db,env,event);assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='conv'").get().owner,'craig');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_messages').get().n,1);const turn=db.sqlite.prepare('SELECT * FROM playbook_turns').get();assert.equal(turn.author,'craig');assert.doesNotMatch(turn.body_redacted,/Avery|Example|avery@|123 Test|5550199/);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM playbook_turns').get().n,1);});
test('unknown outbound author switches a backend thread to Sona and blocks drafts',async()=>{const db=database();seed(db);await recordPlaybookQuoEvent(db,env,{...event,userId:'unreviewed-user'});assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='conv'").get().owner,'sona');const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:{...event,direction:'inbound',from:event.to,to:event.from,providerMessageId:'AC-in',text:'Yes'}});assert.equal(result.skipped,'owner_or_closed');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);});
test('industry line captures redacted learning without creating a main lead thread',async()=>{const db=database();await recordPlaybookQuoEvent(db,env,{...event,from:env.QUO_LEARNING_NUMBERS});assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_conversations').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM playbook_turns').get().n,1);});
test('Messenger and Instagram normalize scoped messages and never invoke a sender',async()=>{const db=database(),config={...env,META_ALLOWED_PAGE_IDS:'page-example',META_ALLOWED_INSTAGRAM_IDS:'ig-example'};const body={object:'page',entry:[{id:'page-example',messaging:[{sender:{id:'lead-psid'},recipient:{id:'page-example'},timestamp:1795100400000,message:{mid:'mid-example',text:'How much for one dog?'}}]}]};const events=normalizeMetaLearningEvents(body,config);assert.equal(events[0].kind,'meta_messenger');await recordPlaybookMetaEvent(db,config,events[0]);await recordPlaybookMetaEvent(db,config,events[0]);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM playbook_turns').get().n,1);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);assert.throws(()=>normalizeMetaLearningEvents(body,{...config,META_ALLOWED_PAGE_IDS:'other'}),/authorized/);const ig=normalizeMetaLearningEvents({...body,object:'instagram',entry:[{...body.entry[0],id:'ig-example',messaging:[{...body.entry[0].messaging[0],recipient:{id:'ig-example'}}]}]},config);assert.equal(ig[0].kind,'meta_instagram');});

test('explicit Sona evidence overrides a matching draft or recorded backend identity',async()=>{
  assert.equal(resolveQuoAuthor({...event,authorType:'sona'},env,{approvedDraft:true,knownBackend:true}),'sona');
  assert.equal(resolveQuoAuthor({...event,userId:'sona-fixture'},{...env,QUO_SONA_USER_IDS:'sona-fixture'},{knownBackend:true}),'sona');
  const db=database();seed(db);await recordPlaybookQuoEvent(db,env,event);
  await recordPlaybookQuoEvent(db,env,{...event,authorType:'sona'});
  assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='conv'").get().owner,'sona');
  assert.equal(db.sqlite.prepare('SELECT author FROM lead_messages').get().author,'sona');
  assert.equal(db.sqlite.prepare('SELECT author FROM playbook_turns').get().author,'sona');
});
const inbound={...event,direction:'inbound',from:event.to,to:event.from,providerMessageId:'AC-directory-in',text:'Yes'};
const emptyDirectory=async()=>({ok:true,complete:true,rows:[]});
test('a backend form lead matching either customer directory escalates without a draft',async()=>{
  for(const matched of ['/api/v1/clients/active','/api/v1/clients/active_no_subscription']){
    const db=database();seed(db);const paths=[];
    const loadCustomerDirectory=async path=>{paths.push(path);return {ok:true,complete:true,rows:path===matched?[{cell_phone_number:event.to}]:[]};};
    const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:inbound},{loadCustomerDirectory});
    assert.equal(result.reason,'existing_customer');assert.equal(result.escalated,true);
    assert.equal(paths.length,2);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
    assert.equal(db.sqlite.prepare("SELECT stage FROM lead_playbook_state WHERE conversation_id='conv'").get().stage,'escalated');
  }
});
test('ordinary existing-customer threads remain outside lead automation for affirmations, support and prospective inquiries',async()=>{
  for(const text of ['Yes that is correct','How much is weekly cleanup for a second property?','Please skip my service','I have a billing issue']){
    const db=database();seed(db);let sends=0,modelCalls=0;
    db.sqlite.exec("UPDATE lead_conversations SET automation_mode='approved';UPDATE lead_automation_settings SET human_review_required=0");
    const config={...env,LEAD_PLAYBOOK_AUTO_SEND_ENABLED:'true',LEAD_CLASSIFIER_ENABLED:'true',AI:{run(){modelCalls++;assert.fail('Customer hold must happen before paid classification');}}};
    const result=await processPlaybookInbound(db,config,{conversationId:'conv',submissionId:'lead',event:{...inbound,text}},{
      loadCustomerDirectory:async()=>({ok:true,complete:true,rows:[{cell_phone_number:event.to}]}),
      sender:async()=>{sends++;assert.fail('Ordinary existing customer must not receive a lead text');},
    });
    assert.equal(result.reason,'existing_customer',text);assert.equal(result.escalated,true,text);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0,text);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM lead_messages WHERE direction='outbound'").get().n,0,text);
    assert.deepEqual([sends,modelCalls],[0,0],text);db.sqlite.close();
  }
});
test('an ownership handback does not authorize a new inquiry from an existing customer',async()=>{
  const db=database();seed(db);
  await setPlaybookOwner(db,env,'conv','craig');await setPlaybookOwner(db,env,'conv','backend');
  const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:{...inbound,text:'Can I get a quote for another property?'}},{loadCustomerDirectory:async()=>({ok:true,complete:true,rows:[{cell_phone_number:event.to}]})});
  assert.equal(result.reason,'existing_customer');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);db.sqlite.close();
});
test('STOP, wrong-number and suppressed contacts cannot be overridden by customer-directory or test settings',async()=>{
  for(const [text,suppressed,reason] of [['STOP',false,'stop'],['Wrong number',false,'wrong_number'],['Yes that is correct',true,'suppressed']]){
    const db=database();seed(db);let reads=0,sends=0;
    if(suppressed)db.sqlite.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES('org-opwp',?,'fixture STOP','fixture','fixture')").run(await playbookHash(event.to));
    const result=await processPlaybookInbound(db,{...env,LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',META_TEST_RECIPIENTS:event.to},{conversationId:'conv',submissionId:'lead',event:{...inbound,text}},{loadCustomerDirectory:async()=>{reads++;throw new Error('Must not query a directory for STOP or suppression');},sender:async()=>{sends++;assert.fail('Suppressed or STOP must not send');}});
    assert.equal(result.reason,reason);assert.deepEqual([reads,sends],[0,0]);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);db.sqlite.close();
  }
});
test('incomplete or unavailable customer verification fails closed before any inbound draft',async()=>{
  for(const loadCustomerDirectory of [async()=>({ok:false,complete:false,rows:[]}),async()=>{throw new Error('fabricated unavailable directory');}]){
    const db=database();seed(db);
    const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:inbound},{loadCustomerDirectory});
    assert.equal(result.reason,'customer_directory_unverified');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
  }
});
function seedIntro(db){
  seed(db);db.sqlite.exec("UPDATE lead_conversations SET last_outbound_at=NULL");
  db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at) VALUES('fixture-follow-up','lead',?,'fixture consent','v1',CURRENT_TIMESTAMP,datetime('now','-1 hour'))").run(event.to);
  db.sqlite.exec("INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status) VALUES('fixture-sms','fixture-follow-up','lead','customer_sms','queued')");
}
test('the first form intro verifies customers and defers on a match or unavailable directory',async()=>{
  for(const loadCustomerDirectory of [async()=>({ok:true,complete:true,rows:[{phone_number:event.to}]}),async()=>({ok:true,complete:false,rows:[]})]){
    const db=database();seedIntro(db);
    const result=await preparePlaybookIntros(db,env,{loadCustomerDirectory});
    assert.equal(result.drafted,0);assert.equal(result.escalated,1);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
    let calls=0;await preparePlaybookIntros(db,env,{loadCustomerDirectory:async()=>{calls++;throw new Error('must not retry escalation');}});assert.equal(calls,0);
  }
});

test('customer-directory holds immediately notify both owner channels once without drafting or texting the customer',async()=>{
  for(const path of ['inbound','intro'])for(const matched of [true,false]){
    const db=database();if(path==='intro')seedIntro(db);else seed(db);
    db.sqlite.exec("UPDATE lead_conversations SET automation_mode='approved';UPDATE lead_automation_settings SET human_review_required=0");
    let sms=0,email=0,customerSends=0,directoryReads=0;
    const config={...env,LEAD_PLAYBOOK_AUTO_SEND_ENABLED:'true',LEAD_PLAYBOOK_NOTIFY_ENABLED:'true',LEAD_PLAYBOOK_CRAIG_CELL:'+14195550198',LEAD_PLAYBOOK_LINK_SECRET:'fabricated-directory-alert-secret-123456789',QUO_API_KEY:'fabricated',OWNER_NOTIFICATION_EMAIL:'owner@example.test'};
    const options={now:new Date('2026-11-22T03:00:00Z'),loadCustomerDirectory:async()=>{directoryReads++;return matched?{ok:true,complete:true,rows:[{cell_phone_number:event.to}]}:{ok:false,complete:false,rows:[]};},sender:async()=>{customerSends++;throw new Error('Customer must stay held');},notificationOptions:{fetcher:async(_url,request)=>{sms++;const message=JSON.parse(request.body);assert.deepEqual(message.to,[config.LEAD_PLAYBOOK_CRAIG_CELL]);assert.match(message.content,/^\[OPWP STAFF ALERT\] /);assert.doesNotMatch(message.content,/Reply STOP to opt out|Text STOP to unsubscribe/i);assert.match(message.content,/\/admin\/quote-funnel\//);return Response.json({id:'directory-owner-sms'});},emailSender:async(_env,message)=>{email++;assert.equal(message.to,config.OWNER_NOTIFICATION_EMAIL);return 'directory-owner-email';}}};
    const run=()=>path==='intro'?preparePlaybookIntros(db,config,options):processPlaybookInbound(db,config,{conversationId:'conv',submissionId:'lead',event:inbound},options);
    const result=await run();assert.equal(result.escalated,path==='intro'?1:true);
    const initialReads=directoryReads;await run();
    assert.equal(directoryReads,initialReads);assert.deepEqual([sms,email,customerSends],[1,1,0]);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
    const notices=db.sqlite.prepare('SELECT kind,status FROM lead_playbook_owner_notifications').all();assert.equal(notices.length,2);assert.ok(notices.every(row=>row.kind==='lead_review'&&row.status==='accepted'));
    const state=JSON.parse(db.sqlite.prepare("SELECT state_json FROM lead_playbook_state WHERE conversation_id='conv'").get().state_json);assert.equal(state.escalation_reason,matched?'existing_customer':'customer_directory_unverified');
  }
});
test('verified noncustomers can receive an intro draft using only fake directory reads',async()=>{
  const db=database();seedIntro(db);const result=await preparePlaybookIntros(db,env,{loadCustomerDirectory:emptyDirectory});
  assert.equal(result.drafted,1);assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts').get().status,'pending');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_messages').get().n,0);
});

test('Facebook confirmation stays in its immediate confirmation ledger without an intro draft',async()=>{
  const db=database();seedIntro(db);db.sqlite.exec("UPDATE lead_conversations SET channel='facebook_lead'");let reads=0;
  const result=await preparePlaybookIntros(db,env,{loadCustomerDirectory:async()=>{reads++;return {ok:true,complete:true,rows:[]};}});
  assert.equal(result.drafted,0);assert.equal(reads,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT status FROM quote_follow_up_deliveries').get().status,'queued');
});
test('Facebook inbound-first forms retain backend ownership and prepare a reply',async()=>{
  const db=database();seed(db);db.sqlite.exec("UPDATE lead_conversations SET channel='facebook_lead',last_outbound_at=NULL");
  const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:inbound},{loadCustomerDirectory:emptyDirectory});
  assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='conv'").get().owner,'backend');assert.ok(result.draft);
});
test('Sona or unknown Facebook receipts retain backend ownership without approving an exact draft',async()=>{
  for(const metadata of [{authorType:'sona'},{userId:'unmapped-fixture'}]){
    const db=database();seed(db);db.sqlite.exec("UPDATE lead_conversations SET channel='facebook_lead'");
    db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,organization_id,intent,confidence,body,policy_version) VALUES ('fb-draft','conv','lead','org-opwp','other',0,?,'fixture')").run(event.text+'\n\nReply STOP to opt out');
    await recordPlaybookQuoEvent(db,env,{...event,userId:null,...metadata});
    assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='conv'").get().owner,'backend');
    assert.equal(db.sqlite.prepare("SELECT status FROM lead_reply_drafts WHERE id='fb-draft'").get().status,'pending');assert.equal(db.sqlite.prepare('SELECT author FROM lead_messages').get().author,'sona');
  }
});
test('controlled intro selection finds its approved recipient beyond old rows without drafting historical leads',async()=>{
  const db=database();
  for(let index=0;index<15;index++){
    db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES (?,'partial_quote','website','new','Fictional historical lead','4195550101',?)").run('older-'+index,JSON.stringify({follow_up_consent:true}));
    db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner) VALUES (?,?,'org-opwp','backend')").run('old-conv-'+index,'older-'+index);
    db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at) VALUES (?,?,'4195550101','fixture consent','v1',CURRENT_TIMESTAMP,datetime('now','-1 hour'))").run('old-follow-'+index,'older-'+index);
    db.sqlite.prepare("INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status) VALUES (?,?,?,'customer_sms','queued')").run('old-sms-'+index,'old-follow-'+index,'older-'+index);
  }
  seedIntro(db);let reads=0;
  const result=await preparePlaybookIntros(db,{...env,LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true',META_TEST_RECIPIENTS:event.to},{limit:1,loadCustomerDirectory:async()=>{reads++;return {ok:true,complete:true,rows:[]};}});
  assert.equal(result.drafted,1);assert.equal(reads,2);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_playbook_state').get().n,1);assert.equal(db.sqlite.prepare('SELECT submission_id FROM lead_reply_drafts').get().submission_id,'lead');
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM quote_follow_up_deliveries WHERE submission_id LIKE 'older-%' AND status='queued'").get().n,15);
});
test('a submitted website question is preserved as an inbound and uncertain reply stays in approval',async()=>{
  const db=database();seedIntro(db);
  db.sqlite.prepare("UPDATE submissions SET payload=? WHERE id='lead'").run(JSON.stringify({follow_up_consent:true,pending_quote_question:'Can you explain a special yard situation?'}));
  await preparePlaybookIntros(db,{...env,LEAD_PLAYBOOK_AUTO_SEND_ENABLED:'true'},{loadCustomerDirectory:emptyDirectory,sender:async()=>{throw new Error('Uncertain text must not auto-send');}});
  const draft=db.sqlite.prepare('SELECT * FROM lead_reply_drafts').get();
  assert.equal(draft.status,'pending');assert.equal(draft.template_key,null);assert.equal(draft.confidence,0);assert.match(draft.body,/Craig review your question/);assert.doesNotMatch(draft.body,/saw that you filled out/);
  assert.equal(db.sqlite.prepare("SELECT body FROM lead_messages WHERE direction='inbound'").get().body,'Can you explain a special yard situation?');
});
test('verified Facebook replies automatically send overnight while unknown questions produce pending drafts',async()=>{
  const db=database();seed(db);db.sqlite.exec("UPDATE lead_conversations SET channel='facebook_lead',automation_mode='approved';UPDATE lead_automation_settings SET human_review_required=0");let sends=0;
  const configured={...env,LEAD_PLAYBOOK_AUTO_SEND_ENABLED:'true'};
  const options={loadCustomerDirectory:emptyDirectory,now:new Date('2026-11-20T02:00:00Z'),sender:async()=>{sends++;return {provider_message_id:'fb-night-verified'};}};
  const verified=await processPlaybookInbound(db,configured,{conversationId:'conv',submissionId:'lead',event:inbound},options);
  assert.equal(verified.draft.status,'sent');assert.equal(sends,1);
  const duplicate=await processPlaybookInbound(db,configured,{conversationId:'conv',submissionId:'lead',event:inbound},options);assert.equal(duplicate.duplicate,true);assert.equal(sends,1);
  const unknown=await processPlaybookInbound(db,configured,{conversationId:'conv',submissionId:'lead',event:{...inbound,providerMessageId:'fb-uncertain-inbound',text:'This is an unusual situation nobody understands.'}},options);
  assert.equal(unknown.draft.status,'pending');assert.equal(unknown.draft.confidence,0);assert.equal(unknown.draft.template_key,null);assert.equal(sends,1);
});
function seedAuditedRoute(db,source){
  seed(db);
  const state={stage:'details_confirmed',details_confirmed:true,details:{dogs:1,frequency:'once_a_week',yardTier:'tiny',lastCleaned:'two_weeks',address:'123 Test Street',city:'Maumee',zip:'43537'}};
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,stage,state_json) VALUES('conv','lead','details_confirmed',?)").run(JSON.stringify(state));
  if(source==='workspace')db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES('lead_workspace:org-opwp:lead',?,'success',CURRENT_TIMESTAMP)").run(JSON.stringify({handoffKey:'fixture-current-address',intake:{address:'123 Test Street',city:'Maumee',zip:'43537'},routeAudit:{actor:'fixture-owner',day:'Friday',handoffKey:'fixture-current-address'}}));
  else db.sqlite.prepare("INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,review_reason,response_state,route_guidance,route_audited_at) VALUES('lead','org-opwp','fixture-meta-lead','fixture-form','fixture-page','fixture://source','',?,?,CURRENT_TIMESTAMP)").run(JSON.stringify({details:{address:'123 Test Street'}}),JSON.stringify({approvedDays:['Friday'],auditedBy:'fixture-owner'}));
}
test('changed and out-of-area addresses cannot inherit a previously audited route day',async()=>{
  for(const source of ['workspace','meta'])for(const address of ['124 Test Street','999 Remote Road Columbus OH 43215']){
    const db=database();seedAuditedRoute(db,source);
    const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:{...inbound,text:address}},{loadCustomerDirectory:emptyDirectory});
    assert.equal(result.escalated,true);assert.equal(result.reason,'route_day_requires_confirmation');
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,1);
    assert.equal(result.draft.status,'pending');assert.equal(result.draft.template_key,null);assert.doesNotMatch(result.draft.body,/\$|schedule for/);
    const state=JSON.parse(result.draft.state_json);assert.equal(state.details.address,address);
  }
});
test('an audited route remains usable only for the same normalized service address',async()=>{
  for(const source of ['workspace','meta']){
    const db=database();seedAuditedRoute(db,source);
    const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:{...inbound,text:'123 TEST STREET.'}},{loadCustomerDirectory:emptyDirectory});
    assert.equal(result.draft.template_key,'quote_recurring');assert.match(result.draft.body,/schedule for Friday\./);
  }
});
test('a rotated workspace handoff key invalidates the retained route audit',async()=>{
  const db=database();seedAuditedRoute(db,'workspace');
  const workspace=JSON.parse(db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='lead_workspace:org-opwp:lead'").get().payload);
  workspace.handoffKey='fixture-new-address';workspace.intake.address='124 Test Street';
  db.sqlite.prepare("UPDATE airtable_cockpit_snapshots SET payload=? WHERE snapshot_key='lead_workspace:org-opwp:lead'").run(JSON.stringify(workspace));
  const result=await processPlaybookInbound(db,env,{conversationId:'conv',submissionId:'lead',event:{...inbound,text:'124 Test Street'}},{loadCustomerDirectory:emptyDirectory});
  assert.equal(result.reason,'route_day_requires_confirmation');assert.equal(result.draft.status,'pending');assert.equal(result.draft.template_key,null);assert.doesNotMatch(result.draft.body,/\$|schedule for/);
});
test('duplicate historical human receipts do not undo an explicit handback',async()=>{
  const db=database();seed(db);await recordPlaybookQuoEvent(db,env,event);
  db.sqlite.prepare("UPDATE lead_conversations SET owner='backend',owner_event_at=?,owner_event_id='manual:fixture-handback',owner_event_priority=3 WHERE id='conv'").run(new Date().toISOString());
  await recordPlaybookQuoEvent(db,env,event);
  assert.equal(db.sqlite.prepare("SELECT owner,owner_event_id FROM lead_conversations WHERE id='conv'").get().owner,'backend');
  assert.equal(db.sqlite.prepare("SELECT owner_event_id FROM lead_conversations WHERE id='conv'").get().owner_event_id,'manual:fixture-handback');
});
test('ordered ownership lets Sona win equal-time provider ties and ignores older human turns',async()=>{
  for(const sonaFirst of [false,true]){
    const db=database();seed(db);
    const human={...event,providerMessageId:'zz-human-fixture'},sona={...event,providerMessageId:'aa-sona-fixture',userId:'unreviewed-user',text:'Example software reply'};
    for(const item of sonaFirst?[sona,human]:[human,sona])await recordPlaybookQuoEvent(db,env,item);
    await recordPlaybookQuoEvent(db,env,{...human,providerMessageId:'later-delivery-of-old-human',createdAt:'2026-11-18T14:00:00Z'});
    const row=db.sqlite.prepare("SELECT owner,owner_event_id,owner_event_priority FROM lead_conversations WHERE id='conv'").get();assert.equal(row.owner,'sona');assert.equal(row.owner_event_id,sona.providerMessageId);assert.equal(row.owner_event_priority,2);
  }
});
test('backend delivery writes never restore an owner from a stale earlier snapshot',async()=>{
  const db=database();seed(db);db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,automated,created_by,author) VALUES('known-backend','conv','org-opwp','outbound','quo_sms',?,'Example backend text',1,'fixture','backend')").run(event.providerMessageId);
  const batch=db.batch;let changed=false;
  db.batch=async statements=>{if(!changed){changed=true;db.sqlite.prepare("UPDATE lead_conversations SET owner='craig',owner_event_at=?,owner_event_id='manual:concurrent-takeover',owner_event_priority=3 WHERE id='conv'").run(new Date().toISOString());}return batch(statements);};
  await recordPlaybookQuoEvent(db,env,event);assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='conv'").get().owner,'craig');
});
test('raw Quo Sona metadata wins over any human or known backend signal',()=>{
  for(const fields of [{authorType:'assistant',createdBy:{type:'user',id:'human-example'}},{authorType:'user',author:{type:'sona'}},{userId:'human-example',createdByUserId:'sona-fixture'}]){
    const normalized=normalizeQuoMessageEvent({id:'fixture-raw-event',type:'message.delivered',data:{object:{id:'fixture-raw-message',direction:'outgoing',from:event.from,to:[event.to],text:'Example raw reply',...fields}}});
    assert.equal(resolveQuoAuthor(normalized,{...env,QUO_SONA_USER_IDS:'sona-fixture'},{knownBackend:true,approvedDraft:true}),'sona');
  }
});
