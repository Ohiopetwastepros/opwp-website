import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { applyDemoEvent,createDemoDay,demoSummary,DemoError,PRECHECKS,WRAPCHECKS } from '../lib/field-demo-model.mjs';
import { startDemoSession,saveDemoEvent,demoSession,DEMO_COOKIE,demoHash } from '../lib/field-demo-server.mjs';
import { jobTimer,clockText } from '../lib/field-timer.mjs';
import { readBoundedBytes,readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { imageMatches } from '../lib/field-policy.mjs';
const base=Date.parse('2026-10-06T12:00:00Z');
function workday(){let day=createDemoDay(base),time=base;const events=[];return {get day(){return day;},get events(){return events;},action(type,body={},seconds=1){time+=seconds*1000;const event={id:crypto.randomUUID(),sequence:day.revision+1,recordedAt:new Date(time).toISOString(),type,body};day=applyDemoEvent(day,event,{now:time});events.push(event);return event;},start(){this.action('clock_in',{mileage:100,vehicle:'company'});for(const [key] of PRECHECKS)this.action('check_item',{key,checked:true});this.action('confirm_load',{quantity:1});this.action('start_route');},wrap(){this.action('start_wrap');for(const stop of this.day.tomorrow.stops)this.action('load_tomorrow',{stopId:stop.id,checked:true});for(const [key] of WRAPCHECKS)this.action('check_item',{key,checked:true});}};}
function database(){const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0047_field_mobile_demo.sql',import.meta.url),'utf8'));sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0048_field_demo_photo_limit.sql',import.meta.url),'utf8'));const db={prepare(query){return {bind(...values){const args=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return {async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);}};}};}};return {sql,db};}
test('timer crosses the exact allowance and catches up after suspension and reload',()=>{
  const started=new Date(base).toISOString();assert.equal(jobTimer(started,null,1,base+60000).over,false);
  const later=jobTimer(started,null,1,base+125000);assert.equal(later.over,true);assert.equal(later.overtimeSeconds,65);assert.equal(clockText(later.elapsedSeconds),'2:05');
  assert.equal(jobTimer(started,new Date(base+95000).toISOString(),1,base+900000).elapsedSeconds,95);assert.equal(jobTimer(null,null,0).over,false);
});
test('demo workday supports ordered offline replay with original job times and paid/unpaid breaks',()=>{
  const work=workday();work.start();work.action('arrive',{stopId:'demo-meadow'});work.action('add_photo',{taskId:'demo-quick',photoId:crypto.randomUUID(),kind:'gate'});work.action('start_task',{taskId:'demo-quick',safe:true});work.action('save_note',{taskId:'demo-quick',notes:'Latch repaired'},15);work.action('complete_task',{taskId:'demo-quick',secured:true,notes:'Latch repaired'},90);
  work.action('start_break',{breakType:'unpaid',mileage:101});work.action('end_break',{mileage:103},600);work.action('start_break',{breakType:'paid',mileage:103});work.action('end_break',{mileage:103},300);
  for(const task of work.day.stops.flatMap(s=>s.tasks).filter(t=>t.status==='pending'))work.action('skip_task',{taskId:task.id,reason:'Weather',confirm:true,notes:'Training exception'});
  work.wrap();work.action('finish_day',{mileage:110,returned:1,damaged:0,missing:0,notes:'Demo finished'});
  let replay=createDemoDay(base);for(const event of work.events)replay=applyDemoEvent(replay,event,{now:base+86400000});assert.deepEqual(replay,work.day);
  const summary=demoSummary(replay);assert.equal(summary.unpaidSeconds,600);assert.equal(summary.serviceSeconds,105);assert.equal(summary.miles,8);assert.equal(summary.completed,1);assert.equal(summary.skipped,8);assert.equal(replay.shift.status,'finished');assert.equal(replay.notifications.every(n=>n.simulated),true);
});
test('safety, task ownership, active break and delivery photo gates are enforced',()=>{
  const work=workday();assert.throws(()=>work.action('start_route'),/departure/);work.start();assert.throws(()=>work.action('start_task',{taskId:'demo-quick',safe:true}),/Arrive/);work.action('arrive',{stopId:'demo-meadow'});
  assert.throws(()=>work.action('start_task',{taskId:'demo-quick'}),/safe access/);work.action('add_photo',{taskId:'demo-quick',photoId:crypto.randomUUID(),kind:'gate'});work.action('start_task',{taskId:'demo-quick',safe:true});assert.throws(()=>work.action('start_break',{breakType:'paid',mileage:101}),/active job/);assert.throws(()=>work.action('complete_task',{taskId:'demo-quick'}),/secure/);work.action('complete_task',{taskId:'demo-quick',secured:true});
  work.action('start_break',{breakType:'paid',mileage:101});assert.throws(()=>work.action('arrive',{stopId:'demo-maple'}),/break/);work.action('end_break',{mileage:101});work.action('arrive',{stopId:'demo-maple'});work.action('start_task',{taskId:'demo-food',safe:true});assert.throws(()=>work.action('complete_task',{taskId:'demo-food',secured:true}),/photo/);work.action('add_photo',{taskId:'demo-food',photoId:crypto.randomUUID(),kind:'delivery'});work.action('complete_task',{taskId:'demo-food',secured:true});assert.equal(work.day.inventory.delivered,1);assert.throws(()=>work.action('save_note',{taskId:'production-job',notes:'x'}),/unfinished/);
});
test('clock skew, malformed IDs and stale sequences fail without mutating the saved day',()=>{
  const day=createDemoDay(base),event={id:crypto.randomUUID(),sequence:1,type:'clock_in',body:{mileage:0,vehicle:'personal'},recordedAt:new Date(base+1000).toISOString()};
  assert.throws(()=>applyDemoEvent(day,{...event,sequence:2},{now:base}),/out of order/);assert.throws(()=>applyDemoEvent(day,{...event,recordedAt:new Date(base+180000).toISOString()},{now:base}),/device clock/);assert.throws(()=>applyDemoEvent(day,{...event,recordedAt:new Date(base-1000).toISOString()},{now:base}),/device clock/);assert.throws(()=>applyDemoEvent(day,{...event,id:'x'},{now:base}),/identifier/);assert.equal(day.revision,0);assert.equal(day.shift.clockIn,null);
});
test('end-of-day inventory accounts for returned, damaged and missing bags',()=>{
  const work=workday();work.start();for(const task of work.day.stops.flatMap(s=>s.tasks))work.action('skip_task',{taskId:task.id,reason:'Weather',confirm:true});
  work.wrap();assert.throws(()=>work.action('finish_day',{mileage:105,returned:0,damaged:0,missing:0}),/remaining inventory/);assert.throws(()=>work.action('finish_day',{mileage:99,returned:1,damaged:0,missing:0}),/backwards|500 miles/);work.action('finish_day',{mileage:105,returned:0,damaged:0,missing:1});assert.equal(work.day.inventory.missing,1);
});
test('real SQLite receipts prevent duplicates and preserve state on races or changed payloads',async()=>{
  const f=database(),session=await startDemoSession(f.db,base),work=workday(),event=work.action('clock_in',{mileage:100,vehicle:'company'}),row=()=>f.sql.prepare('SELECT * FROM field_demo_sessions WHERE id=?').get(session.id);
  const results=await Promise.all([saveDemoEvent(f.db,row(),event,base+1000),saveDemoEvent(f.db,row(),event,base+1000)]);assert.equal(results.length,2);assert.equal(row().revision,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM field_demo_events').get().n,1);
  await assert.rejects(saveDemoEvent(f.db,row(),{...event,body:{...event.body,mileage:200}},base+1000),/identifier/);assert.equal(JSON.parse(row().state_json).shift.startMileage,100);
  const next=work.action('check_item',{key:'tools',checked:true});await saveDemoEvent(f.db,row(),next,base+2000);await assert.rejects(saveDemoEvent(f.db,row(),{...next,id:crypto.randomUUID()},base+2000),/order/);f.sql.close();
});
test('demo sessions are opaque, expire and cannot share photos or events',async()=>{
  const f=database(),one=await startDemoSession(f.db,base),two=await startDemoSession(f.db,base),headers=new Headers({cookie:`${DEMO_COOKIE}=${one.token}`});
  assert.equal((await demoSession(f.db,headers,base+1)).id,one.id);assert.equal(await demoSession(f.db,new Headers({cookie:`${DEMO_COOKIE}=bad`}),base),null);assert.equal(await demoSession(f.db,headers,base+8*86400000),null);assert.notEqual(one.token,two.token);
  const work=workday();work.start();for(const event of work.events)await saveDemoEvent(f.db,f.sql.prepare('SELECT * FROM field_demo_sessions WHERE id=?').get(one.id),event,base+5000);
  const photoEvent=work.action('add_photo',{taskId:'demo-quick',photoId:crypto.randomUUID(),kind:'gate'});f.sql.prepare('INSERT INTO field_demo_photos VALUES (?,?,?,?,?)').run(two.id,photoEvent.body.photoId,'demo-quick','hash',new Uint8Array([255,216,255]));await assert.rejects(saveDemoEvent(f.db,f.sql.prepare('SELECT * FROM field_demo_sessions WHERE id=?').get(one.id),photoEvent,base+5000),/photo must/);assert.equal(f.sql.prepare('SELECT revision FROM field_demo_sessions WHERE id=?').get(one.id).revision,9);f.sql.close();
});
test('demo photo cap is atomic and expiry cleanup removes only expired demo records',async()=>{
  const f=database(),one=await startDemoSession(f.db,base);for(let n=0;n<24;n++)f.sql.prepare('INSERT INTO field_demo_photos VALUES (?,?,?,?,?)').run(one.id,crypto.randomUUID(),'demo-quick','hash',new Uint8Array([255,216,255]));assert.throws(()=>f.sql.prepare('INSERT INTO field_demo_photos VALUES (?,?,?,?,?)').run(one.id,crypto.randomUUID(),'demo-quick','hash',new Uint8Array()),/DEMO_PHOTO_LIMIT/);
  await startDemoSession(f.db,base+8*86400000);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM field_demo_photos').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM field_demo_sessions').get().n,1);f.sql.close();
});
function apiFixture({session=null}={}){let writes=0,queries=0;const source=fs.readFileSync(new URL('../app/api/field-demo/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');const db={prepare(){queries++;return {bind(){return {first:async()=>null,run:async()=>{writes++;}};}};}};const api=runPrivateInNewContext(source+'\n({POST,PUT,GET})',{NextResponse:{json:Response.json},Response,URL,console,crypto,DemoError,RangeError,SyntaxError,getDb:()=>db,fieldQuota:async()=>true,readBoundedBytes,readBoundedProviderJson,imageMatches,demoHash,demoSession:async()=>session,startDemoSession:async()=>{writes++;return {};},saveDemoEvent:async()=>{writes++;return {};}});return {api,get writes(){return writes;},get queries(){return queries;}};}
const req=(body,origin='https://example.test')=>new Request('https://example.test/api/field-demo/',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('demo API blocks cross-site, oversized, unauthenticated and cross-session writes',async()=>{
  const f=apiFixture();for(const origin of ['', 'https://evil.test'])assert.equal((await f.api.POST(req({operation:'start'},origin))).status,403);assert.equal((await f.api.POST(req({operation:'event'}))).status,401);assert.equal((await f.api.POST(req({operation:'start',junk:'x'.repeat(13000)}))).status,413);assert.equal(f.writes,0);
  const other=apiFixture({session:{id:'one'}});assert.equal((await other.api.POST(req({operation:'event',sessionId:'two'}))).status,409);assert.equal(other.writes,0);
});
test('demo upload requires a session before reading or storing bytes',async()=>{
  const f=apiFixture(),request=new Request('https://example.test/api/field-demo/?id=x',{method:'PUT',headers:{origin:'https://example.test','Content-Type':'image/jpeg'},body:new Uint8Array([255,216,255])});assert.equal((await f.api.PUT(request)).status,401);assert.equal(f.queries,0);assert.equal(f.writes,0);
});
test('service worker cache allowlist excludes live routes, APIs and external origins',()=>{
  const source=fs.readFileSync(new URL('../public/field-demo/sw.js',import.meta.url),'utf8');const allowed=runPrivateInNewContext(source+'\nallowed',{self:{location:{origin:'https://example.test'},addEventListener(){}},URL});
  for(const path of ['/field/','/admin/','/api/field/','/api/field-demo/','/field/login/','/field-demo/other'])assert.equal(allowed(new URL(path,'https://example.test')),false);
  assert.equal(allowed(new URL('https://other.test/field-demo/')),false);assert.equal(allowed(new URL('https://example.test/field-demo/')),true);assert.equal(allowed(new URL('https://example.test/_next/static/chunk.js')),true);
});
