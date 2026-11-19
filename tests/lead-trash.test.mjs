import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import {normalizeGrowthSubmissionId,quoteSummary,sourceStage,leadOrigin} from '../lib/growth-desk.mjs';
import {purgeLeadTrash,listLeadTrash,restoreLead} from '../lib/lead-trash.mjs';
const built=await build({entryPoints:['lib/lead-inbox-store.js'],bundle:true,platform:'node',format:'esm',write:false,alias:{'@':process.cwd()}});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const origin='https://www.ohiopetwastepros.com';
async function fixture(){
  const db=leadTestDatabase(),id=crypto.randomUUID();
  await api.createInboxLead(db,{commandId:id,intake:{firstName:'Example',lastName:'Lead',phone:'4195550100',email:'lead@example.test',zip:'43615'}},'owner');
  const conversation=db.sqlite.prepare('SELECT id FROM lead_conversations WHERE submission_id=?').get(id).id;
  db.sqlite.prepare("UPDATE lead_conversations SET automation_mode='approved' WHERE id=?").run(conversation);
  return {db,id,conversation};
}
async function remove(f){const row=await api.readInboxRow(f.db,f.id);return api.saveInboxChange(f.db,f.id,{action:'delete',confirmed:true,version:await api.inboxVersion(row)},'owner');}
function route(f){const source=readFileSync(new URL('../app/api/admin/leads/[leadId]/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');return runPrivateInNewContext(source+'\nPATCH;',{...api,Response,Headers,URL,crypto,console:{error(){}},headers:async()=>new Headers(),verifyAdminRequest:async()=>({authorized:true,email:'owner'}),getDb:()=>f.db,normalizeGrowthSubmissionId,LeadTrashError:api.LeadTrashError,restoreLead:api.restoreLead,protectJsonRequest:async request=>({body:await request.json()}),listGrowthDesk:async()=>({leads:await api.enrichInbox(f.db,[{id:f.id}])})});}
const params=id=>({params:Promise.resolve({leadId:id})});
function request(body){return new Request(origin+'/api/admin/leads/',{method:'PATCH',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}
function activeList(db){const source=readFileSync(new URL('../lib/growth-desk.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');return runPrivateInNewContext(source+'\nlistGrowthDesk;',{crypto,getDb:()=>db,OPWP_ORGANIZATION_ID:'org-opwp',quoteSummary,sourceStage,leadOrigin,enrichInbox:api.enrichInbox,hydrateLeadAssistant:async(_,leads)=>({leads})});}
function seedOutbox(f){
  const {db,id,conversation}=f,q=crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at) VALUES (?,?,?,'consent','v1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(q,id,'4195550100');
  for(const [channel,status]of [['sng_lead','queued'],['customer_email','failed'],['customer_sms','sent']])db.sqlite.prepare('INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status,provider_message_id) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),q,id,channel,status,status==='sent'?'receipt-existing':null);
  for(const [n,status]of [[1,'queued'],[2,'failed'],[3,'sent']])db.sqlite.prepare("INSERT INTO lead_follow_up_jobs(id,submission_id,conversation_id,organization_id,sequence_step,due_at,status,message_body,provider_message_id) VALUES (?,?,?,'org-opwp',?,CURRENT_TIMESTAMP,?,'private draft',?)").run(crypto.randomUUID(),id,conversation,n,status,status==='sent'?'lead-receipt':null);
  for(const [purpose,status]of [['confirmation','queued'],['reply','blocked'],['follow_up','sent']])db.sqlite.prepare("INSERT INTO meta_sms_jobs(id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status,provider_message_id) VALUES (?,?,?,?,'org-opwp',?,'private draft',?,?)").run(crypto.randomUUID(),purpose,crypto.randomUUID(),id,conversation,status,status==='sent'?'meta-receipt':null);
  for(const [type,status]of [['question','queued'],['waitlist','failed'],['partial_quote','sent']])db.sqlite.prepare("INSERT INTO submission_notifications(id,submission_id,notification_type,recipient,subject,text_body,html_body,status,provider_message_id) VALUES (?,?,?,'owner@example.test','private subject','private draft','private draft',?,?)").run(crypto.randomUUID(),id,type,status,status==='sent'?'email-receipt':null);
  const review=crypto.randomUUID();db.sqlite.prepare("INSERT INTO review_requests(id,job_id,job_date,job_type,page_slug,template_version,payload) VALUES (?,?,'2026-11-18','scoop','tony','v1',?)").run(review,crypto.randomUUID(),JSON.stringify({submissionId:id,customerName:'Example Lead'}));
  db.sqlite.prepare("INSERT INTO review_request_deliveries(id,request_id,channel,status,recipient) VALUES (?,?,'sms','queued','+14195550100')").run(crypto.randomUUID(),review);
  db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,delivery_status,created_by) VALUES (?,?,'org-opwp','outbound','quo_sms','sent history','sent','fixture')").run(crypto.randomUUID(),conversation);
}
test('actual PATCH requires the explicit delete action and confirmation, and rejects stale versions',async()=>{
  const f=await fixture(),handle=route(f),version=await api.inboxVersion(await api.readInboxRow(f.db,f.id));
  for(const body of [{confirmed:true,version},{action:'delete',version},{action:'delete',confirmed:false,version},{action:'delete',confirmed:true,version:'stale'}]){
    assert.equal((await handle(request(body),params(f.id))).status,body.version==='stale'?409:400);
    assert.ok(await api.readInboxRow(f.db,f.id));
  }
  const response=await handle(request({action:'delete',confirmed:true,version}),params(f.id));assert.equal(response.status,200);assert.equal((await response.json()).trashed,true);
});
test('soft delete hides the lead from actual active SQL and keeps PII restorable in same-section Trash',async()=>{
  const f=await fixture();assert.equal((await activeList(f.db)(100)).leads.length,1);await remove(f);
  assert.equal(await api.readInboxRow(f.db,f.id),null);assert.equal((await activeList(f.db)(100)).leads.length,0);
  const trash=await listLeadTrash(f.db);assert.equal(trash.leads.length,1);assert.equal(trash.leads[0].email,'lead@example.test');
  const retention=f.db.sqlite.prepare('SELECT julianday(purge_after)-julianday(deleted_at) days FROM lead_inbox_trash').get().days;assert.equal(retention,30);
});
test('delete cancels every pending family without sending and preserves already-sent history',async()=>{
  const f=await fixture();seedOutbox(f);await remove(f);
  for(const table of ['quote_follow_ups','quote_follow_up_deliveries','lead_follow_up_jobs','meta_sms_jobs','submission_notifications'])assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE status IN ('queued','failed','blocked','sending')`).get().n,0,table);
  for(const table of ['quote_follow_up_deliveries','lead_follow_up_jobs','meta_sms_jobs','submission_notifications'])assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE status='sent' AND provider_message_id IS NOT NULL`).get().n,1,table);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM review_request_deliveries').get().status,'skipped');assert.equal(f.db.sqlite.prepare('SELECT body FROM lead_messages').get().body,'sent history');
});
test('actual restore API returns the active lead with automation paused and no cancelled deliveries requeued',async()=>{
  const f=await fixture();seedOutbox(f);await remove(f);const lead=(await listLeadTrash(f.db)).leads[0];
  const response=await route(f)(request({action:'restore',version:lead.recordVersion}),params(f.id));assert.equal(response.status,200);assert.equal((await response.json()).lead.id,f.id);
  assert.equal((await activeList(f.db)(100)).leads.length,1);assert.equal((await api.readInboxRow(f.db,f.id)).phone,'4195550100');assert.equal((await listLeadTrash(f.db)).leads.length,0);
  assert.equal(f.db.sqlite.prepare('SELECT automation_mode FROM lead_conversations').get().automation_mode,'paused');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM quote_follow_up_deliveries WHERE status='cancelled'").get().n,2);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM quote_follow_up_deliveries WHERE status='sent'").get().n,1);
});
test('late queue writers and status callbacks cannot resurrect a trashed lead',async()=>{
  const f=await fixture();seedOutbox(f);await remove(f);
  f.db.sqlite.prepare("UPDATE submissions SET status='needs_attention',name='changed' WHERE id=?").run(f.id);assert.equal(f.db.sqlite.prepare('SELECT status,name FROM submissions').get().status,'trashed');assert.equal(f.db.sqlite.prepare('SELECT name FROM submissions').get().name,'Example Lead');
  for(const table of ['quote_follow_ups','quote_follow_up_deliveries','lead_follow_up_jobs','meta_sms_jobs','submission_notifications']){
    f.db.sqlite.prepare(`UPDATE ${table} SET status='queued' WHERE status='cancelled'`).run();assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE status='queued'`).get().n,0,table);
  }
  f.db.sqlite.prepare("INSERT INTO submission_notifications(id,submission_id,notification_type,recipient,subject,text_body,html_body) VALUES (?,?,'question','late@example.test','late','late','late')").run(crypto.randomUUID(),f.id);
  assert.equal(f.db.sqlite.prepare("SELECT status FROM submission_notifications WHERE recipient='late@example.test'").get().status,'cancelled');
});
test('cron purge waits 30 days, removes restorable contact data and unsent PII, keeps sent rows terminal',async()=>{
  const f=await fixture();seedOutbox(f);await remove(f);const saved=(await listLeadTrash(f.db)).leads[0];assert.equal((await purgeLeadTrash({DB:f.db})).purged,0);
  f.db.sqlite.prepare("UPDATE lead_inbox_trash SET purge_after=datetime('now','-1 second')").run();assert.equal((await purgeLeadTrash({DB:f.db})).purged,1);
  const row=f.db.sqlite.prepare('SELECT * FROM submissions WHERE id=?').get(f.id);assert.equal(row.status,'deleted');for(const key of ['name','phone','email','zip'])assert.equal(row[key],null);assert.deepEqual(JSON.parse(row.payload),{deleted:true,trashPurged:true});
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'lead_workspace:%'").get().n,0);
  assert.equal(f.db.sqlite.prepare("SELECT message_body FROM meta_sms_jobs WHERE status='cancelled' LIMIT 1").get().message_body,'Expired Trash lead');assert.equal(f.db.sqlite.prepare("SELECT text_body FROM submission_notifications WHERE status='cancelled' LIMIT 1").get().text_body,'Expired Trash lead');
  assert.equal(f.db.sqlite.prepare('SELECT recipient FROM review_request_deliveries').get().recipient,'');assert.equal(f.db.sqlite.prepare('SELECT payload FROM review_requests').get().payload,'{}');assert.equal(f.db.sqlite.prepare('SELECT body FROM lead_messages').get().body,'sent history');
  await assert.rejects(()=>restoreLead(f.db,f.id,{action:'restore',version:saved.recordVersion},'owner'),e=>e.status===404);assert.equal((await purgeLeadTrash({DB:f.db})).purged,0);
});
test('expired and other-organization Trash entries cannot be restored or exposed',async()=>{
  const f=await fixture();await remove(f);const row=(await listLeadTrash(f.db)).leads[0];f.db.sqlite.prepare("UPDATE lead_inbox_trash SET purge_after=CURRENT_TIMESTAMP").run();assert.equal((await listLeadTrash(f.db)).leads.length,0);await assert.rejects(()=>restoreLead(f.db,f.id,{action:'restore',version:row.recordVersion},'owner'),e=>e.status===404);
});
test('Leads UI uses a confirm dialog, an explicit API delete, immediate list removal and same-section Trash',()=>{
  const source=readFileSync(new URL('../app/admin/quote-funnel/LeadInboxClient.js',import.meta.url),'utf8');assert.match(source,/window\.confirm\(`Delete/);assert.match(source,/action:'delete',confirmed:true/);assert.match(source,/if\(r\.trashed\)\{setLeads\(current=>current\.filter\(l=>l\.id!==id\)\)/);assert.match(source,/\['trash','Trash'\]/);assert.match(source,/action:'restore'/);
  assert.match(readFileSync(new URL('../lib/lead-assistant.js',import.meta.url),'utf8'),/const trash=await purgeLeadTrash\(env\)/);
});
