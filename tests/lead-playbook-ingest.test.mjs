import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {quoLearningScope,resolveQuoAuthor,ownerAfterOutbound,normalizeMetaLearningEvents} from '../lib/playbook-ownership.mjs';
import {normalizeQuoMessageEvent} from '../lib/quo-webhook.mjs';
import {recordPlaybookQuoEvent,recordPlaybookMetaEvent,processPlaybookInbound,runScheduledPlaybook,preparePlaybookIntros} from '../lib/lead-playbook-ingest.js';
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../tmp/test-migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../tmp/test-migrations/'+name,import.meta.url),'utf8'));const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),execute(){const p=sqlite.prepare(sql);return p.columns().length?{results:p.all(...args),meta:{changes:0}}:{results:[],meta:{changes:Number(p.run(...args).changes)}};}});return {sqlite,prepare:sql=>stmt(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const r=statements.map(s=>s.execute());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
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
test('verified noncustomers can receive an intro draft using only fake directory reads',async()=>{
  const db=database();seedIntro(db);const result=await preparePlaybookIntros(db,env,{loadCustomerDirectory:emptyDirectory});
  assert.equal(result.drafted,1);assert.equal(db.sqlite.prepare('SELECT status FROM lead_reply_drafts').get().status,'pending');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_messages').get().n,0);
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
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
    const state=JSON.parse(db.sqlite.prepare("SELECT state_json FROM lead_playbook_state WHERE conversation_id='conv'").get().state_json);assert.equal(state.details.address,address);
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
  assert.equal(result.reason,'route_day_requires_confirmation');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n,0);
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
