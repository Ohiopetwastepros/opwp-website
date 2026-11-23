import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {captureFunnelLead,queueFunnelInitialText,LEAD_DEDUPE_HOURS} from '../lib/lead-funnel-intake.mjs';
import {buildFunnelInitialText,funnelJobKey,FUNNEL_SETTINGS_KEY,nextFunnelSendAt,funnelDigest} from '../lib/lead-funnel-policy.mjs';
import {runInitialQuoteSms} from '../lib/quote-initial-sms.mjs';
import {storeMetaLead,recordQuoDelivery} from '../lib/meta-lead-workflow.mjs';
import {reconcileInitialSms} from '../lib/lead-sms-reconciliation.mjs';

const now=Date.parse('2026-11-16T16:00:00Z');
const body=(overrides={})=>({name:'Casey Example',email:'casey@example.com',phone:'4192620100',zip:'43551',follow_up_allowed:true,follow_up_consent:true,
  follow_up_consent_version:'quote_service_sms_v1',follow_up_consent_at:new Date(now).toISOString(),quote_context:{dogs:2,frequency:'once_a_week',yard_size:'tiny',last_cleaned:'one_month',quote_monthly:1},...overrides});
function snapshot(db,key,value){db.sqlite.prepare('INSERT OR REPLACE INTO airtable_cockpit_snapshots(snapshot_key,payload) VALUES (?,?)').run(key,JSON.stringify(value));}
function environment(db){return {DB:db,LEAD_FUNNEL_ENABLED:'true',QUOTE_INITIAL_SMS_ENABLED:'true',SMS_PROVIDER:'quo',QUO_API_KEY:'mock',QUO_FROM_NUMBER:'+14192622371'};}
async function website(db,env,form=body(),at=now){const lead=await captureFunnelLead(db,{source:'website',body:form,funnelId:crypto.randomUUID(),now:at});await queueFunnelInitialText(db,env,lead.id,{now:at});return lead;}
function provider(){const calls=[];return {calls,fetcher:async(url,options={})=>{
  calls.push({url,options});
  if(options.method==='POST')return Response.json({data:{id:'AC-'+calls.length,status:'queued'}},{status:202});
  if(url.endsWith('/phone-numbers'))return Response.json({data:[{number:'+14192622371',id:'PNmock'}]});
  return Response.json({data:[]});
}};}
const job=(db,id)=>JSON.parse(db.sqlite.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(funnelJobKey(id)).payload);
const delivery=(db,id)=>db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries WHERE submission_id=? AND channel='customer_sms'").get(id);

test('website intake merges normalized phone or email in a sliding 24-hour window and retains original evidence',async()=>{
  const db=leadTestDatabase(),env=environment(db);
  const first=await website(db,env);
  const second=await website(db,env,body({phone:'+1 (419) 262-0100',email:' CASEY@EXAMPLE.COM ',name:'Casey Updated'}));
  assert.equal(second.id,first.id);assert.equal(second.created,false);
  const third=await website(db,env,body({phone:'4192620101',email:'CASEY@example.com'}));assert.equal(third.id,first.id);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM submissions').get().n,1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'lead_intake:%'").get().n,3);
  const next=await website(db,env,body(),now+(LEAD_DEDUPE_HOURS+1)*3600000);assert.notEqual(next.id,first.id);
});

test('simultaneous forms create one canonical lead and one durable initial text',async()=>{
  const db=leadTestDatabase(),env=environment(db);snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});
  const results=await Promise.all([website(db,env),website(db,env,body({phone:'+14192620100'}))]);assert.equal(results[0].id,results[1].id);
  const p=provider();await Promise.all([runInitialQuoteSms(env,{fetcher:p.fetcher,now}),runInitialQuoteSms(env,{fetcher:p.fetcher,now})]);
  assert.equal(p.calls.filter(c=>c.options.method==='POST').length,1);
  assert.equal(delivery(db,results[0].id).status,'sent');
  assert.equal(db.sqlite.prepare('SELECT status FROM quote_follow_ups').get().status,'sent');
  assert.equal(db.sqlite.prepare("SELECT delivery_status FROM lead_messages WHERE direction='outbound'").get().delivery_status,'sent');
});

test('customer opener recalculates price and asks for missing details with plain punctuation',()=>{
  const text=buildFunnelInitialText(body());assert.match(text,/Hello, this is Craig.*Thank you for reaching out for a quote/);
  assert.match(text,/\$100\.00 per month/);assert.doesNotMatch(text,/\$1\.00|[\u2013\u2014]/);assert.match(text,/service address/);
  assert.doesNotMatch(buildFunnelInitialText(body({quote_context:{dogs:2,frequency:'once_a_week'}})),/per month/);
});

test('quiet hours schedule 08:00 Eastern and survive both DST changes',async()=>{
  assert.equal(nextFunnelSendAt(Date.parse('2026-11-16T01:00:00Z')),'2026-11-16T13:00:00.000Z');
  assert.equal(nextFunnelSendAt(Date.parse('2026-03-08T05:30:00Z')),'2026-03-08T12:00:00.000Z');
  assert.equal(nextFunnelSendAt(Date.parse('2026-11-01T04:30:00Z')),'2026-11-01T13:00:00.000Z');
  const db=leadTestDatabase(),env=environment(db),night=Date.parse('2026-11-16T04:14:00Z');snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});
  const lead=await website(db,env,body({follow_up_consent_at:new Date(night).toISOString()}),night),p=provider();await runInitialQuoteSms(env,{now:night,fetcher:p.fetcher});assert.equal(p.calls.length,0);
  await runInitialQuoteSms(env,{now:Date.parse('2026-11-16T13:00:00Z'),fetcher:p.fetcher});assert.equal(delivery(db,lead.id).status,'sent');
});

test('approval mode is independent of legacy assistant switches and never sends without exact approval',async()=>{
  const db=leadTestDatabase(),env=environment(db),lead=await website(db,env),p=provider();
  await runInitialQuoteSms(env,{now,fetcher:p.fetcher});assert.equal(p.calls.length,0);assert.equal(job(db,lead.id).status,'approval_required');
  const payload=db.sqlite.prepare('SELECT payload FROM submissions WHERE id=?').get(lead.id).payload;
  snapshot(db,funnelJobKey(lead.id),{...job(db,lead.id),approvedAt:new Date(now).toISOString(),approvedPayloadHash:await funnelDigest(payload),approvedMessageHash:'previous-copy'});
  await runInitialQuoteSms(env,{now,fetcher:p.fetcher});assert.equal(p.calls.length,0);assert.equal(job(db,lead.id).status,'approval_required');
  snapshot(db,funnelJobKey(lead.id),{...job(db,lead.id),approvedAt:new Date(now).toISOString(),approvedPayloadHash:await funnelDigest(payload),approvedMessageHash:await funnelDigest(buildFunnelInitialText(JSON.parse(payload)))});
  await runInitialQuoteSms(env,{now,fetcher:p.fetcher});assert.equal(delivery(db,lead.id).status,'sent');
});

test('opt-outs, channel preference and phone edits suppress without contacting Quo',async()=>{
  for(const overrides of [{sms_opt_out:true},{preferred_channel:'email'},{follow_up_consent_at:new Date(now-72*3600000).toISOString()},{}]){
    const db=leadTestDatabase(),env=environment(db);snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});
    const lead=await website(db,env,body(overrides));if(!Object.keys(overrides).length)db.sqlite.prepare('UPDATE submissions SET phone=? WHERE id=?').run('4192620101',lead.id);
    const p=provider();await runInitialQuoteSms(env,{now,fetcher:p.fetcher});assert.equal(p.calls.length,0);assert.equal(delivery(db,lead.id).status,'cancelled');
  }
});

test('Facebook and website submissions share a record; Meta still needs approved form consent and release',async()=>{
  const db=leadTestDatabase(),env=environment(db);snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});
  const form={pageId:'page-test',consentField:'sms_consent',disclosure:'Automated requested quote texts. Reply STOP.',version:'fixture-v1'};
  env.META_APPROVED_SMS_FORMS=JSON.stringify({'form-test':form});env.META_AUTOMATION_ENABLED='true';env.META_AUTOMATION_APPROVAL_ID='release-test';
  const fields=[['full_name','Casey Example'],['phone_number','+14192620100'],['email','casey@example.com'],['contact_preference','Text'],['sms_consent','Yes']].map(([name,value])=>({name,values:[value]}));
  const data={id:'lead-test',form_id:'form-test',created_time:new Date(now).toISOString(),field_data:fields};
  const lead=await storeMetaLead(db,env,data,{leadId:'lead-test',formId:'form-test',pageId:'page-test'},{now});
  const p=provider();await runInitialQuoteSms(env,{fetcher:p.fetcher,now});assert.equal(p.calls.length,0);assert.equal(job(db,lead.id).status,'meta_release_or_consent_required');
  db.sqlite.prepare("INSERT INTO meta_automation_releases(id,organization_id,policy_version,approved_by,approved_at,evidence) VALUES ('release-test','org-opwp','lead-funnel-initial-v1','fixture-owner',CURRENT_TIMESTAMP,'fixture-provider-tests')").run();
  env.META_APPROVED_SMS_FORMS=JSON.stringify({'form-test':{...form,disclosure:'Changed disclosure requiring a new form'}});
  await runInitialQuoteSms(env,{fetcher:p.fetcher,now});assert.equal(p.calls.length,0);
  env.META_APPROVED_SMS_FORMS=JSON.stringify({'form-test':form});
  await runInitialQuoteSms(env,{fetcher:p.fetcher,now});assert.equal(delivery(db,lead.id).status,'sent');
  const again=await website(db,env,body(),Date.now());assert.equal(again.id,lead.id);assert.equal(db.sqlite.prepare('SELECT source FROM submissions').get().source,'facebook');
  await storeMetaLead(db,env,data,{leadId:'lead-test',formId:'form-test',pageId:'page-test'});assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM submissions').get().n,1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM meta_sms_jobs WHERE status='queued'").get().n,0);
});

test('preflight failure and explicit rate limiting retry; ambiguous send never replays',async()=>{
  const db=leadTestDatabase(),env=environment(db);snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});
  const lead=await website(db,env),p=provider();
  await runInitialQuoteSms(env,{now,fetcher:async()=>{throw Error('read unavailable');}});assert.equal(delivery(db,lead.id).attempt_count,1);
  await runInitialQuoteSms(env,{now:Date.now()+120000,fetcher:async(url,options)=>options?.method==='POST'?new Response('',{status:429}):p.fetcher(url,options)});
  assert.equal(delivery(db,lead.id).error_message,'quo_rate_limited');
  await runInitialQuoteSms(env,{now:Date.now()+240000,fetcher:p.fetcher});assert.equal(delivery(db,lead.id).status,'sent');
  const other=leadTestDatabase(),otherEnv=environment(other);snapshot(other,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});const next=await website(other,otherEnv);let posts=0;
  const broken=async(url,options)=>{if(options?.method==='POST'){posts++;throw Error('timeout');}return p.fetcher(url,options);};
  await runInitialQuoteSms(otherEnv,{now,fetcher:broken});await runInitialQuoteSms(otherEnv,{now,fetcher:broken});assert.equal(posts,1);assert.equal(delivery(other,next.id).attempt_count,5);
});

test('delivery polling and out-of-order signed receipt application reconcile without another send',async()=>{
  const db=leadTestDatabase(),env=environment(db);snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});const lead=await website(db,env),p=provider();
  await runInitialQuoteSms(env,{now,fetcher:p.fetcher});const id=delivery(db,lead.id).provider_message_id;
  const result=await reconcileInitialSms(env,{now,fetcher:async(url,options)=>{assert.equal(options.method,undefined);return Response.json({data:{id,status:'delivered'}});}});
  assert.equal(result.checked,1);assert.equal(db.sqlite.prepare('SELECT delivery_status FROM lead_messages').get().delivery_status,'delivered');
  await recordQuoDelivery(db,{type:'message.failed',data:{object:{id,direction:'outgoing'}}});assert.equal(db.sqlite.prepare('SELECT delivery_status FROM lead_messages').get().delivery_status,'delivered');
  assert.equal(job(db,lead.id).status,'delivered');await runInitialQuoteSms(env,{now,fetcher:p.fetcher});assert.equal(p.calls.filter(c=>c.options.method==='POST').length,1);
});

test('merging into a legacy queue creates a visible review hold without adopting or replaying that delivery',async()=>{
  const db=leadTestDatabase(),env=environment(db);snapshot(db,FUNNEL_SETTINGS_KEY,{initialTextMode:'auto'});const lead=await website(db,env);
  db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET id=? WHERE submission_id=?").run(crypto.randomUUID(),lead.id);
  const queued=await queueFunnelInitialText(db,env,lead.id,{now});assert.equal(queued.status,'legacy_delivery_review');
  const p=provider();await runInitialQuoteSms(env,{now,fetcher:p.fetcher});assert.equal(p.calls.length,0);assert.equal(delivery(db,lead.id).status,'queued');
});
