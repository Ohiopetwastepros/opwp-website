import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleSandboxRequest, startSandboxSession, sandboxSession, saveSandboxEvent, sandboxOfficeCommand, createSandboxState, SANDBOX_COOKIE } from '../lib/field-sandbox-server.mjs';
import { PRECHECKS, WRAPCHECKS } from '../lib/field-workday-model.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of ['tmp/test-migrations/0028_api_rate_limits.sql','field-demo-runtime/demo-migrations/0003_unified_sandbox.sql'])sql.exec(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 const db={prepare:q=>({bind:(...values)=>{const args=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return {first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>sql.prepare(q).run(...args)};}})};
 let cookie='',clock=Date.now();
 const f={sql,db,env:{DB:db,FIELD_SANDBOX_ONLY:'true'},async request(path,method='GET',body=null,{origin=true,raw=false}={}){const headers=new Headers({cookie,'cf-connecting-ip':'test'});if(origin)headers.set('origin','https://training.example');if(body!==null)headers.set('content-type',raw?'image/jpeg':'application/json');return handleSandboxRequest(new Request('https://training.example/api/field-sandbox/'+path+'/',{method,headers,body:body===null?null:raw?body:JSON.stringify(body)}),f.env);},async init(){const r=await f.request('session','POST',{operation:'start'});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];return f.row();},async row(){return sandboxSession(db,new Headers({cookie}));},async state(){return JSON.parse((await f.row()).state_json);},async action(type,body={}){const row=await f.row(),state=JSON.parse(row.state_json);clock=Math.max(clock+1,Date.now());const event={id:crypto.randomUUID(),shiftId:row.id,expectedRevision:state.day.revision,recordedAt:new Date(clock).toISOString(),type,body};const receipt=await saveSandboxEvent(db,row,event,clock);assert.equal(receipt.accepted,true);return event;},async office(body){const r=await f.request('office','POST',body);const result=await r.json();assert.equal(r.status,200,result.error);return result;},async accept(){const state=await f.state();return f.action('accept_changes',{changeIds:state.changes.filter(c=>c.status==='pending').map(c=>c.id)});},async start(){await f.action('clock_in',{mileage:100,vehicle:'company'});for(const [key] of PRECHECKS)await f.action('check_item',{key,checked:true});await f.action('confirm_load',{items:(await f.state()).day.inventory.map(i=>({productId:i.productId,quantity:i.required}))});await f.action('start_route');},async proof(taskId,purpose){const row=await f.row(),id=crypto.randomUUID(),capturedAt=new Date(++clock).toISOString();sql.prepare('INSERT INTO field_sandbox_photos(session_id,id,task_id,purpose,captured_at,content_hash,body) VALUES (?,?,?,?,?,?,?)').run(row.id,id,taskId,purpose,capturedAt,'test',new Uint8Array([255,216,255,217]));const state=await f.state();await saveSandboxEvent(db,await f.row(),{id:crypto.randomUUID(),shiftId:row.id,expectedRevision:state.day.revision,type:'add_photo',recordedAt:capturedAt,body:{taskId,photoId:id,purpose}},clock);return id;}};
 return f;
}
test('sandbox is disabled before accessing production storage and requires same-origin writes',async()=>{
 const req=new Request('https://training.example/api/field-sandbox/session/',{method:'POST',body:'{}'});
 let touched=false;const db={prepare(){touched=true;throw Error('production touched');}};
 assert.equal((await handleSandboxRequest(req,{DB:db})).status,404);assert.equal(touched,false);
 const f=fixture();assert.equal((await f.request('session','POST',{operation:'start'},{origin:false})).status,403);assert.equal((await f.request('workday')).status,401);
});
test('start, expiry, origin, request limits, and reset preserve isolated session ownership',async()=>{
 const f=fixture(),first=await f.init(),state=await f.state();assert.equal(state.day.stops.length,4);assert.equal(state.day.stops.flatMap(s=>s.tasks).find(t=>t.serviceId==='litter').quantity,3);assert.equal(state.day.organizationId,'sandbox');assert.ok(state.day.stops.every(s=>!s.phone&&s.name.startsWith('TEST')));
 const other=await startSandboxSession(f.db);assert.equal(await sandboxSession(f.db,new Headers({cookie:SANDBOX_COOKIE+'='+first.token})),null);
 assert.notEqual(other.id,first.id);const malicious={action:'safety',shiftId:other.id,stopId:other.state.day.stops[0].id,notes:'Wrong session',safe:true};assert.equal((await f.request('office','POST',malicious)).status,404);
 assert.equal((await f.request('session','POST',{operation:'reset',padding:'x'.repeat(2100)})).status,413);
 const reset=await f.request('session','POST',{operation:'reset'});assert.equal(reset.status,200);assert.notEqual((await reset.json()).id,first.id);
 f.sql.prepare('UPDATE field_sandbox_sessions SET expires_at=0 WHERE id=?').run(first.id);assert.equal((await f.request('workday')).status,401);
 const g=fixture();for(let i=0;i<12;i++)assert.equal((await g.request('session','POST',{operation:'start'})).status,200);assert.equal((await g.request('session','POST',{operation:'start'})).status,429);
});
test('office additions and safe clearance require current technician acceptance, catalog rules remain immutable',async()=>{
 const f=fixture();await f.init();const state=await f.state(),day=state.day,stop=day.stops[0];
 await f.office({action:'add_service',shiftId:day.id,stopId:stop.id,serviceId:'litter',quantity:2,notes:'Training add-on'});
 assert.equal((await f.state()).day.stops[0].tasks.length,2);
 const bad={id:crypto.randomUUID(),shiftId:day.id,expectedRevision:0,type:'accept_changes',recordedAt:new Date().toISOString(),body:{changeIds:[crypto.randomUUID()]}};
 await assert.rejects(saveSandboxEvent(f.db,await f.row(),bad),/current pending/);
 await f.accept();assert.equal((await f.state()).day.stops[0].tasks[2].quantity,2);
 await f.office({action:'save_service',service:{...state.catalog.find(s=>s.id==='litter'),minutesPerUnit:9}});assert.equal((await f.state()).day.stops[0].tasks[2].estimatedMinutes,12);
 assert.equal((await f.request('office','POST',{action:'add_service',shiftId:day.id,stopId:stop.id,serviceId:'food',quantity:1,notes:'Must not create unpaid delivery'})).status,400);
 const unsafe=day.stops[3];await f.start();await f.action('arrive',{stopId:unsafe.id});await assert.rejects(f.action('start_task',{taskId:unsafe.tasks[0].id,safe:true}),/clearance/);
 await f.office({action:'safety',shiftId:day.id,stopId:unsafe.id,safe:true,hasGate:true,notes:'Training safe access verified'});await f.accept();await f.action('start_task',{taskId:unsafe.tasks[0].id,safe:true});
 await f.office({action:'safety',shiftId:day.id,stopId:unsafe.id,safe:false,notes:'Training unsafe access report'});await assert.rejects(f.action('complete_task',{taskId:unsafe.tasks[0].id,secured:true,units:1}),/safety change/);
});
test('atomic event receipts reject concurrent office overwrites and changed replay bodies',async()=>{
 const f=fixture();await f.init();const row=await f.row(),state=await f.state(),event={id:crypto.randomUUID(),shiftId:row.id,expectedRevision:0,type:'clock_in',recordedAt:new Date().toISOString(),body:{mileage:100,vehicle:'company'}};
 await f.office({action:'save_service',service:{...state.catalog[0],minutesPerUnit:11}});
 await assert.rejects(saveSandboxEvent(f.db,row,event),/changed/);assert.equal((await f.state()).day.revision,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM field_sandbox_events').get().n,0);
 const current=await f.row();await saveSandboxEvent(f.db,current,event);const replay=await saveSandboxEvent(f.db,await f.row(),event);assert.equal(replay.accepted,true);assert.equal(replay.replayed,true);assert.equal(replay.revision,1);
 await assert.rejects(saveSandboxEvent(f.db,await f.row(),{...event,body:{...event.body,mileage:101}}),/different content/);
});
test('proof requires owned matching task, purpose and capture timestamp, with a storage cap',async()=>{
 const f=fixture();await f.init();await f.start();let state=await f.state();const stop=state.day.stops[0],task=stop.tasks[0];await f.action('arrive',{stopId:stop.id});await f.action('start_task',{taskId:task.id,safe:true});
 await assert.rejects(f.action('complete_task',{taskId:task.id,secured:true,units:1}),/photo/);
 const other=await startSandboxSession(f.db),id=crypto.randomUUID(),at=new Date().toISOString();f.sql.prepare('INSERT INTO field_sandbox_photos VALUES (?,?,?,?,?,?,?)').run(other.id,id,task.id,'gate',at,'x',new Uint8Array([255,216,255,217]));
 await assert.rejects(f.action('add_photo',{taskId:task.id,photoId:id,purpose:'gate'}),/matching/);
 const own=await f.proof(task.id,'gate');
 const ownRow=await f.row(),stored=f.sql.prepare('SELECT * FROM field_sandbox_photos WHERE session_id=? AND id=?').get(ownRow.id,own);
 const wrongPurpose={id:crypto.randomUUID(),shiftId:ownRow.id,expectedRevision:(await f.state()).day.revision,type:'add_photo',recordedAt:stored.captured_at,body:{taskId:task.id,photoId:own,purpose:'service'}};
 await assert.rejects(saveSandboxEvent(f.db,ownRow,wrongPurpose,Date.parse(stored.captured_at)),/matching/);
 const row=await f.row();const read=await handleSandboxRequest(new Request('https://training.example/api/field-sandbox/workday/photo/?id='+id,{headers:{cookie:SANDBOX_COOKIE+'='+other.token}}),f.env);assert.equal(read.status,200);
 const foreign=await handleSandboxRequest(new Request('https://training.example/api/field-sandbox/workday/photo/?id='+own,{headers:{cookie:SANDBOX_COOKIE+'='+other.token}}),f.env);assert.equal(foreign.status,404);
 for(let i=1;i<24;i++)f.sql.prepare('INSERT INTO field_sandbox_photos VALUES (?,?,?,?,?,?,?)').run(row.id,crypto.randomUUID(),task.id,'observation',at,'x',new Uint8Array([255,216,255,217]));
 assert.throws(()=>f.sql.prepare('INSERT INTO field_sandbox_photos VALUES (?,?,?,?,?,?,?)').run(row.id,crypto.randomUUID(),task.id,'observation',at,'x',new Uint8Array([255,216,255,217])),/PHOTO_LIMIT/);
 await f.action('complete_task',{taskId:task.id,secured:true,units:1});
});
test('HTTP photo upload enforces session ownership, JPEG bytes, size and replay content',async()=>{
 const f=fixture(),s=await startSandboxSession(f.db),cookie=SANDBOX_COOKIE+'='+s.token;let row=await sandboxSession(f.db,new Headers({cookie}));
 let day=JSON.parse(row.state_json).day,clock=Date.now();
 async function act(type,body={}){row=await sandboxSession(f.db,new Headers({cookie}));day=JSON.parse(row.state_json).day;await saveSandboxEvent(f.db,row,{id:crypto.randomUUID(),shiftId:row.id,expectedRevision:day.revision,type,body,recordedAt:new Date(++clock).toISOString()},clock);}
 await act('clock_in',{mileage:1,vehicle:'company'});for(const [key] of PRECHECKS)await act('check_item',{key,checked:true});await act('confirm_load',{items:day.inventory.map(i=>({productId:i.productId,quantity:1}))});await act('start_route');const stop=day.stops[0],task=stop.tasks[0];await act('arrive',{stopId:stop.id});await act('start_task',{taskId:task.id,safe:true});
 const query=new URLSearchParams({id:crypto.randomUUID(),shiftId:row.id,taskId:task.id,purpose:'gate',capturedAt:new Date(++clock).toISOString()});
 const put=(bytes,params=query,token=cookie)=>handleSandboxRequest(new Request('https://training.example/api/field-sandbox/workday/photo/?'+params,{method:'PUT',headers:{cookie:token,origin:'https://training.example','content-type':'image/jpeg'},body:bytes}),f.env);
 assert.equal((await put(new Uint8Array([1,2,3]))).status,400);assert.equal((await put(new Uint8Array(409601))).status,413);
 const jpeg=new Uint8Array([255,216,255,217]);assert.equal((await put(jpeg)).status,200);assert.equal((await put(jpeg)).status,200);assert.equal((await put(new Uint8Array([255,216,255,0]))).status,409);
 const other=await startSandboxSession(f.db);assert.equal((await put(jpeg,query,SANDBOX_COOKIE+'='+other.token)).status,400);
 const wrongTime=new URLSearchParams(query);wrongTime.set('capturedAt','1990-01-01T00:00:00Z');assert.equal((await put(jpeg,wrongTime)).status,400);
 const read=await handleSandboxRequest(new Request('https://training.example/api/field-sandbox/workday/photo/?id='+query.get('id'),{headers:{cookie}}),f.env);assert.equal(read.status,200);assert.equal(read.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await read.arrayBuffer()),jpeg);
});
test('full fictional route supports breaks, proof, office clearance, food inventory and closeout without providers',async()=>{
 const f=fixture();await f.init();await f.start();await f.action('start_break',{breakType:'unpaid',mileage:100});await f.action('end_break',{mileage:101});let state=await f.state();
 await f.office({action:'safety',shiftId:state.day.id,stopId:state.day.stops[3].id,safe:true,hasGate:true,notes:'Training verified safe'});await f.accept();
 for(const stop of (await f.state()).day.stops){await f.action('arrive',{stopId:stop.id});for(const task of stop.tasks){await f.action('start_task',{taskId:task.id,safe:true});if(task.proofKind!=='none'&&(task.proofKind!=='gate'||stop.hasGate))await f.proof(task.id,task.proofKind);await f.action('complete_task',{taskId:task.id,secured:true,units:task.quantity,notes:'Training complete'});}}
 await f.action('start_wrap');for(const [key] of WRAPCHECKS)await f.action('check_item',{key,checked:true});await f.action('finish_day',{mileage:120,items:(await f.state()).day.inventory.map(i=>({productId:i.productId,returned:0,damaged:0,missing:0})),notes:'Training closeout'});
 const record=await (await f.request('record')).json();assert.equal(record.day.shift.status,'finished');assert.equal(record.summary.completed,7);assert.equal(record.summary.workMiles,19);assert.ok(record.day.inventory.every(i=>i.delivered===1));assert.ok(record.messages.every(m=>m.status==='held'));assert.equal(record.noCustomerMessagesOrBilling,true);
});
test('recurring setup applies only on restarted matching days and clear reset restores defaults',()=>{
 const id=crypto.randomUUID(),state=createSandboxState(id),day=state.day;const result=sandboxOfficeCommand(state,{action:'save_recurring',shiftId:id,stopId:day.stops[0].id,serviceId:'litter',quantity:4,everyWeeks:1,weekdays:[new Date(day.date+'T12:00:00Z').getUTCDay()],startDate:day.date,active:true,billingReviewed:true,notes:'Training authorized arrangement'});
 assert.equal(result.state.day.stops[0].tasks.length,2);const restart=createSandboxState(crypto.randomUUID(),Date.now(),result.state);assert.equal(restart.day.stops[0].tasks[2].quantity,4);assert.equal(createSandboxState(crypto.randomUUID()).day.stops[0].tasks.length,2);
});
