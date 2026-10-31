import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/system-health.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const now = Date.parse('2026-10-08T23:06:00Z');
class Clock extends Date { static now(){return now;} }
async function health(options={}) {
  const queries=[];
  const plan=options.plan===null?{}:{id:'plan',status:'complete',created_at:'2026-10-08 23:05:00',source_snapshot_at:'2026-10-08T23:00:00Z',...options.plan};
  const snapshot=options.snapshot===null?{}:{status:'success',captured_at:'2026-10-08T23:00:00Z',...options.snapshot};
  const runs=options.runs||[{sync_name:'active_route_book',status:'success',completed_at:'2026-10-08 23:05:00'}];
  const db={prepare(sql){queries.push(sql);return {bind(){return this;},async first(){
    if(sql.includes('airtable_cockpit_snapshots'))return snapshot;
    if(sql.includes('route_subscription_plans')) {if(options.planQueryFails)throw Error('storage error');return plan;}
    if(sql.includes('submission_notifications'))return {sent:1,failed:7};
    return {};
  },async all(){if(options.runQueryFails)throw Error('history unavailable');return {results:runs};}};}};
  const config={integrations:Object.fromEntries(['sweepAndGo','airtable','stripe','quickBooks','geoapify','fieldProofs'].map(key=>[key,{configured:true,webhookConfigured:true,provider:'r2'}]))};
  const fn=runPrivateInNewContext(source+'\ngetSystemHealth;',{applicationConfig:()=>config,getDb:()=>db,notificationProvider:()=>({configured:true,name:'quo'}),submissionEmailProviderStatus:()=>({configured:true,name:'resend'}),Date:Clock});
  const result=await fn();
  return {queries,row:name=>result.rows.find(row=>row.name===name)};
}
test('fresh complete road data and a successful refresh are green',async()=>{
  const h=await health();assert.equal(h.row('Route book refresh').tone,'green');assert.equal(h.row('Geoapify').tone,'green');assert.equal(h.row('Airtable').tone,'green');
});
test('a partial saved plan cannot be hidden by a successful sync or configured provider',async()=>{
  const h=await health({plan:{status:'partial'}});assert.equal(h.row('Route book refresh').tone,'yellow');assert.equal(h.row('Geoapify').tone,'yellow');assert.match(h.row('Route book refresh').details,/Latest plan: partial/);
});
test('a partial assignment audit is yellow even when road matrices completed',async()=>{
  const h=await health({runs:[{sync_name:'active_route_book',status:'partial',completed_at:'2026-10-08 23:05:00'},{sync_name:'subscriptions_daily',status:'partial'}]});
  assert.equal(h.row('Route book refresh').tone,'yellow');assert.equal(h.row('Subscription refresh').tone,'yellow');assert.equal(h.row('Geoapify').tone,'green');
});
test('failed runs and unreadable plan or run history cannot show green',async()=>{
  for(const options of [{runs:[{sync_name:'active_route_book',status:'failed',completed_at:'2026-10-08 23:05:00'}]},{planQueryFails:true},{runQueryFails:true}]) {
    const h=await health(options);assert.equal(h.row('Route book refresh').tone,'red');
  }
});
test('missing, stale and future-dated plans warn rather than suggesting healthy routing',async()=>{
  for(const plan of [null,{created_at:'2026-10-07 23:00:00'},{created_at:'2026-10-09 23:00:00'},{source_snapshot_at:'2026-10-07T22:00:00Z'}]) {
    const h=await health({plan});assert.equal(h.row('Route book refresh').tone,'yellow');assert.equal(h.row('Geoapify').tone,'yellow');
  }
});
test('a stopped route cron is visible even with an earlier complete plan',async()=>{
  const h=await health({runs:[{sync_name:'active_route_book',status:'success',completed_at:'2026-10-08 22:30:00'}]});assert.equal(h.row('Route book refresh').tone,'yellow');assert.match(h.row('Route book refresh').details,/Refresh age: stale/);
});
test('Airtable health targets the business snapshot and exposes missing or stale data',async()=>{
  for(const snapshot of [null,{captured_at:'2026-10-08T21:00:00Z'},{captured_at:'bad-date'},{captured_at:'2026-10-09T23:00:00Z'},{status:'partial'}]) {
    const h=await health({snapshot});assert.equal(h.row('Airtable').tone,'yellow');assert.ok(h.queries.some(sql=>sql.includes("snapshot_key='business_cockpit'")));
  }
});
test('latest run selection is per job and cannot lose a daily run behind busy jobs',async()=>{
  const h=await health();const sql=h.queries.find(sql=>sql.includes('system_sync_runs'));
  assert.match(sql,/newer\.sync_name=s\.sync_name/);assert.match(sql,/LIMIT 1/);assert.doesNotMatch(sql,/LIMIT 50/);
});
test('submission emails disclose their actual scope and provider acceptance limitation',async()=>{
  const h=await health();const row=h.row('Owner submission emails');assert.match(row.details,/accepted by provider 1/);assert.match(row.details,/route-plan failure alerts are not part of this queue/);assert.match(row.details,/does not confirm inbox delivery/);
});
