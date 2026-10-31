// Disposable fake work only, always against an isolated local Worker.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PRECHECKS,WRAPCHECKS } from '../lib/field-demo-model.mjs';
const origin=process.argv[2]||'http://localhost:8791';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Local test only.');
const api=origin+'/api/field-demo/',protectedStatus=process.argv.includes('--standalone')?404:401;
async function client(){const start=await fetch(api,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({operation:'start'})});assert.equal(start.status,200,await start.clone().text());const session=(await start.json()).session,cookie=start.headers.get('set-cookie').split(';')[0];let sequence=0,last;
 const call=body=>fetch(api,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {session,cookie,call,async act(type,body={}){const event={id:crypto.randomUUID(),version:2,sequence:++sequence,type,body,recordedAt:new Date().toISOString()};last=event;const response=await call({operation:'event',sessionId:session.id,event});assert.equal(response.status,200,await response.clone().text());return response.json();},get last(){return last;},async get(){return (await (await fetch(api,{headers:{Cookie:cookie}})).json());}};
}
const a=await client();
for(const path of ['/api/field/today/','/api/admin/route-partner/'])assert.equal((await fetch(origin+path,{headers:{Cookie:a.cookie}})).status,protectedStatus);
assert.equal((await a.call({operation:'event',sessionId:'wrong',event:{}})).status,409);
await a.act('clock_in',{mileage:'9998',vehicle:'company'});const replay=await a.call({operation:'event',sessionId:a.session.id,event:a.last});assert.equal((await replay.json()).replayed,true);
for(const [key] of PRECHECKS)await a.act('check_item',{key,checked:true});await a.act('confirm_load',{quantity:1});await a.act('start_route');
const rejected=await a.act('on_way',{stopId:'demo-meadow',minutes:15,scenario:'failure'});assert.equal(rejected.receipt.status,'failed');assert.equal(rejected.receipt.report,true);
const photo=await sharp({create:{width:12,height:12,channels:3,background:'#173c3c'}}).jpeg().toBuffer();let privatePhoto;
async function proof(taskId,kind){const id=crypto.randomUUID();const url=`${api}?${new URLSearchParams({sessionId:a.session.id,id,taskId})}`;const upload=await fetch(url,{method:'PUT',headers:{Origin:origin,Cookie:a.cookie,'Content-Type':'image/jpeg'},body:photo});assert.equal(upload.status,200,await upload.clone().text());await a.act('add_photo',{taskId,photoId:id,kind});privatePhoto=id;}
for(const stop of a.session.day.stops){
 if(stop.id==='demo-willow'){await a.act('skip_task',{taskId:stop.tasks[0].id,reason:'Unsafe dog',confirm:true,notes:'Test dog outside'});continue;}
 await a.act('arrive',{stopId:stop.id});let gate=false;
 for(const t of stop.tasks){await a.act('start_task',{taskId:t.id,safe:!['food','haul'].includes(t.type)});if(stop.hasGate&&!gate){await proof(t.id,'gate');gate=true;}if(t.type==='food')await proof(t.id,'delivery');await a.act('complete_task',{taskId:t.id,secured:true,notes:'Local test service'});}
}
assert.equal((await fetch(`${api}?photo=${privatePhoto}`,{headers:{Cookie:a.cookie}})).status,200);const b=await client();assert.equal((await fetch(`${api}?photo=${privatePhoto}`,{headers:{Cookie:b.cookie}})).status,404);
await a.act('office_add',{kind:'reclean',sourceId:'demo-meadow',notes:'Check fence line on complaint return'});const state=(await a.get()).session.day,extra=state.stops.at(-1);assert.equal(extra.reclean,true);await a.act('skip_task',{taskId:extra.tasks[0].id,reason:'Customer request',confirm:true});
await a.act('start_break',{breakType:'unpaid',mileage:'0004'});await a.act('end_break',{mileage:'0005'});await a.act('start_wrap');
for(const stop of state.tomorrow.stops)await a.act('load_tomorrow',{stopId:stop.id,checked:true});for(const [key] of WRAPCHECKS)await a.act('check_item',{key,checked:true});await a.act('finish_day',{mileage:'0007',returned:0,damaged:0,missing:0});
const saved=await a.get();assert.equal(saved.session.day.shift.status,'finished');assert.equal(saved.session.day.shift.endMileage,10007);assert.equal(saved.session.day.stops.flatMap(s=>s.tasks).filter(t=>t.status==='completed').length,8);assert.equal(saved.session.day.revision,a.last.sequence);assert.equal(saved.receipts.find(n=>n.id===rejected.receipt.id).report,true);assert.equal(saved.session.day.notifications.every(n=>n.simulated),true);
console.log(JSON.stringify({ok:true,actions:saved.session.day.revision,checks:['departure gate','separate service timers','gate and delivery proof','private photos','skip confirmation','backend failed-text report','office reclean','four-digit rollover','timed wrap and tomorrow stock','idempotent replay','cross-session and live-route isolation']}));
