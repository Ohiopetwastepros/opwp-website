import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {captureFunnelLead,queueFunnelInitialText} from '../lib/lead-funnel-intake.mjs';
import {funnelJobKey,FUNNEL_SETTINGS_KEY} from '../lib/lead-funnel-policy.mjs';
import {readFunnelPreview,approveFunnelInitialText,saveFunnelMode,funnelOverview} from '../lib/lead-funnel-admin.mjs';
import {getLeadFunnelHealth,recordLeadFeed} from '../lib/lead-funnel-health.mjs';
import {getInitialSmsHealth,recordInitialSmsHeartbeat} from '../lib/quote-sms-health.mjs';
import {createFunnelRouteToken,saveFunnelSignupAddress} from '../lib/lead-funnel-signup.mjs';
import {reconcileFunnelSignups} from '../lib/lead-funnel-conversion.mjs';
import {metaConsentEvidence} from '../lib/meta-lead-policy.mjs';

const now=Date.now();
async function lead({mode='approval',at=now}={}) {
  const db=leadTestDatabase(),env={DB:db,LEAD_FUNNEL_ENABLED:'true'};
  await saveFunnelMode(db,mode,'fixture-owner');
  const saved=await captureFunnelLead(db,{source:'website',now:at,body:{name:'Avery Example',phone:'4192620100',email:'avery@example.com',zip:'43551',follow_up_allowed:true,follow_up_consent:true,follow_up_consent_version:'quote_service_sms_v1',follow_up_consent_at:new Date(at).toISOString(),quote_context:{dogs:2,frequency:'once_a_week',yard_size:'tiny',last_cleaned:'one_month'}}});
  await queueFunnelInitialText(db,env,saved.id,{now:at});return {db,env,id:saved.id};
}
test('one-tap approval is version-bound, honors off and cannot approve missing consent',async()=>{
  const f=await lead(),preview=await readFunnelPreview(f.db,f.id);
  await approveFunnelInitialText(f.db,f.id,preview.version,'fixture-owner');
  assert.ok(JSON.parse(f.db.sqlite.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(funnelJobKey(f.id)).payload).approvedAt);
  await assert.rejects(()=>approveFunnelInitialText(f.db,f.id,preview.version,'fixture-owner'),/changed/);
  await saveFunnelMode(f.db,'off','fixture-owner');
  await assert.rejects(async()=>approveFunnelInitialText(f.db,f.id,(await readFunnelPreview(f.db,f.id)).version,'fixture-owner'),/turned off/);
  f.db.sqlite.prepare("UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.consent.valid',json('false')) WHERE snapshot_key=?").run(funnelJobKey(f.id));
  await assert.rejects(async()=>approveFunnelInitialText(f.db,f.id,(await readFunnelPreview(f.db,f.id)).version,'fixture-owner'),/consent/);
});

test('owner overview stays within D1 query limits as the lead inbox grows',async()=>{
  const f=await lead();
  for(let n=0;n<60;n++) {
    const id=crypto.randomUUID();
    f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,payload) VALUES (?,'partial_quote','website','follow_up_pending','{}')").run(id);
    f.db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload) VALUES (?,?)").run(funnelJobKey(id),JSON.stringify({version:1,status:'consent_required'}));
  }
  const prepare=f.db.prepare;let calls=0;f.db.prepare=sql=>{calls++;return prepare(sql);};
  const overview=await funnelOverview(f.db,f.env);assert.equal(overview.leads.length,61);assert.ok(calls<5);
});

test('quiet-hour and approval queues are visible without false overdue incidents',async()=>{
  const f=await lead();await recordInitialSmsHeartbeat(f.db,{status:'success',completedAt:new Date(now).toISOString()});
  f.db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET next_attempt_at=datetime('now','-20 minutes')").run();
  assert.equal((await getInitialSmsHealth(f.db,{now})).overdue,0);
  const health=await getLeadFunnelHealth(f.db,{}, {now});assert.equal(health.backlog,0);assert.equal(health.incidents.filter(i=>i.state==='decision').length,1);
  f.db.sqlite.prepare("UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.status','quiet_hours') WHERE snapshot_key=?").run(funnelJobKey(f.id));
  f.db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET next_attempt_at=datetime('now','+12 hours')").run();
  assert.equal((await getInitialSmsHealth(f.db,{now})).overdue,0);
});

test('health detects missing jobs, legacy backlog, email failure, feed failures and expected Facebook silence',async()=>{
  const f=await lead({mode:'auto'});
  f.db.sqlite.exec("UPDATE quote_follow_up_deliveries SET next_attempt_at=datetime('now','-20 minutes')");
  f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,payload,created_at) VALUES (?,'partial_quote','website','follow_up_pending',?,datetime('now','-5 minutes'))").run(crypto.randomUUID(),JSON.stringify({follow_up_consent:true}));
  f.db.sqlite.prepare("INSERT INTO submission_notifications(id,submission_id,notification_type,recipient,subject,text_body,html_body,status,error_message) VALUES (?,?,'partial_quote','owner@example.com','Fixture','Fixture','Fixture','failed','Resend rejected 403')").run(crypto.randomUUID(),f.id);
  await recordLeadFeed(f.db,'quo',{status:'failed',reason:'fixture'});
  let health=await getLeadFunnelHealth(f.db,{}, {now});assert.equal(health.backlog,1);assert.equal(health.emailFailures,1);assert.equal(health.missingJobs,1);
  assert.ok(health.incidents.some(i=>i.reason==='quo_webhook_processing_failed'));assert.ok(!health.incidents.some(i=>i.state==='meta_feed'));
  health=await getLeadFunnelHealth(f.db,{META_LEADS_EXPECTED:'true'},{now});assert.ok(health.incidents.some(i=>i.reason==='facebook_intake_quiet_check_meta_delivery'));
  await recordLeadFeed(f.db,'quo',{status:'success',lastProcessedAt:new Date(now).toISOString()});
  assert.ok(!(await getLeadFunnelHealth(f.db,{}, {now})).incidents.some(i=>i.reason==='quo_webhook_processing_failed'));
});

test('route capability expires, cannot read private records and changes only its own supplied address',async()=>{
  const f=await lead(),token=await createFunnelRouteToken(f.db,f.id,{now});
  const input={address:'123 Example Street',city:'Perrysburg',state:'OH',zip:'43551',follow_up_consent:false,gate_code:'never persist from this endpoint'};
  await assert.rejects(()=>saveFunnelSignupAddress(f.db,'0'.repeat(64),input,{now}),/expired/);
  const saved=await saveFunnelSignupAddress(f.db,token,input,{now});assert.equal(saved.leadId,f.id);assert.equal(saved.body.home_address,input.address);
  assert.equal(saved.body.follow_up_consent,true);assert.equal(saved.body.gate_code,undefined);
  await assert.rejects(()=>saveFunnelSignupAddress(f.db,token,input,{now:now+25*3600000}),/expired/);
  f.db.sqlite.prepare("UPDATE submissions SET status='converted' WHERE id=?").run(f.id);
  await assert.rejects(()=>saveFunnelSignupAddress(f.db,token,input,{now}),/no longer open/);
});

test('Facebook checkbox evidence must be retrieved, affirmative, uniquely mapped and approved for this Page',()=>{
  const lead={meta_form_id:'form',meta_page_id:'page',meta_created_time:new Date(now).toISOString(),original_form:{custom_disclaimer_responses:[{checkbox_key:'sms_box',is_checked:'1'}]}};
  const forms={form:{pageId:'page',consentCheckboxKey:'sms_box',version:'fixture-v1',disclosure:'Requested quote texts. Reply STOP.'}};
  assert.equal(metaConsentEvidence(lead,forms).valid,true);
  assert.equal(metaConsentEvidence({...lead,original_form:{}},forms).valid,false);
  assert.equal(metaConsentEvidence(lead,{form:{...forms.form,pageId:'other'}}).valid,false);
  assert.equal(metaConsentEvidence({...lead,original_form:{custom_disclaimer_responses:[{checkbox_key:'sms_box',is_checked:''}]}},forms).valid,false);
});

test('verified signup stops pending outreach without asserting payment or bypassing SNG',async()=>{
  const f=await lead({at:now-60000});
  f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,email,phone,payload,sng_synced,sng_sync_state,sng_entity_id) VALUES (?,'onboarding','website','synced','avery@example.com','+14192620100','{}',1,'succeeded','fixture-client')").run(crypto.randomUUID());
  const result=await reconcileFunnelSignups(f.db);assert.equal(result.matched,1);
  const state=JSON.parse(f.db.sqlite.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(funnelJobKey(f.id)).payload);
  assert.equal(state.status,'converted');assert.equal(state.paymentVerified,false);
  assert.equal(f.db.sqlite.prepare("SELECT status FROM quote_follow_up_deliveries").get().status,'cancelled');
  assert.notEqual(f.db.sqlite.prepare('SELECT stage FROM growth_leads').get().stage,'won');
});

const routing=await build({entryPoints:['lib/lead-funnel-routing.js'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'no-live-routing',setup(b){
  b.onResolve({filter:/^\.\/(?:airtable|route-intelligence)$/},()=>({path:'routing',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function ensureFreshAirtableCockpitSnapshot(){throw Error("Use fixture refresh");} export async function recommendOnboardingRoute(){throw Error("Use fixture recommendation");}'}));
}}]});
const {recommendFunnelDay}=await import('data:text/javascript;base64,'+Buffer.from(routing.outputFiles[0].text).toString('base64'));
test('signup and owner summary use the actual route engine options, reject stale data and omit private route members',async()=>{
  const db=leadTestDatabase(),body={home_address:'123 Example Street',city:'Perrysburg',zip:'43551',quote_context:{frequency:'once_a_week'}};
  let calls=0;
  const options={now,refresh:async(env,age,opts)=>{calls++;assert.equal(age,15);assert.equal(opts.refreshRouteHistory,false);},recommend:async(database,input,opts)=>{
    assert.equal(database,db);assert.equal(input.home_address,body.home_address);assert.deepEqual(opts,{allowGeographicFallback:true,closestRoadMatch:true});
    return {eligible:true,recommendedDay:'Tuesday',confidence:'high',sourceSnapshotAt:new Date(now).toISOString(),recommendationBasis:'nearest_road_match',nearestAddress:'private customer address'};
  }};
  const route=await recommendFunnelDay(db,{},body,options);assert.equal(route.day,'Tuesday');assert.equal(route.nearestAddress,undefined);assert.equal(calls,1);
  const stale=await recommendFunnelDay(db,{},body,{...options,now:now+16*60000});assert.equal(stale.day,undefined);assert.equal(stale.requiresReview,true);
});
