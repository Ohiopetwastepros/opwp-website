// Screenshot staging only, on this PC's explicitly guarded fake preview.
// Each phase is requested on the command line. Importing this file does nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {PRECHECKS,WRAPCHECKS,workdaySummary} from '../lib/field-workday-model.mjs';

const ORIGIN='http://localhost:8787';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const REPORT=path.join(ROOT,'tmp/mark-v2-field-stage.json');
const PHOTO=path.join(ROOT,'tmp/local-preview-test-photo.jpg');
const PHASES=new Set(['prepare','gate','gate-proof','proof','food','donefood','wrap']);
const forbiddenKeys=new Set(['phone','cellPhone','homePhone','email','customerPhone','customerEmail','billing','billingZip','billingAddress','revenue','totalCents','bookRateCents','manualRateCents','paymentMethodId','profileId','last4','paymentStatus','balance','balanceCents','price','priceCents','monthlyPrice']);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const accounted=task=>['completed','skipped','cancelled'].includes(task.status);
const active=day=>day.stops.flatMap(stop=>stop.tasks).find(task=>task.status==='working');
function privacy(value,cursor=''){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){assert.ok(!forbiddenKeys.has(key),`Restricted technician key ${cursor}.${key}`);privacy(child,`${cursor}.${key}`);}
  assert.doesNotMatch(JSON.stringify(value),/@local-preview\.example\.test|\+1419555/);
}
function connection(){
  const cookies=new Map(),requests=[];
  async function request(relative,{method='GET',body=null,contentType='application/json',binary=false}={}){
    const url=new URL(relative,ORIGIN);assert.equal(url.origin,ORIGIN);assert.equal(url.hostname,'localhost');
    const headers=new Headers({Origin:ORIGIN});
    if(cookies.size)headers.set('Cookie',[...cookies].map(([key,value])=>`${key}=${value}`).join('; '));
    if(body!==null)headers.set('Content-Type',contentType);
    const response=await fetch(url,{method,headers,redirect:'error',signal:AbortSignal.timeout(20000),...(body===null?{}:{body:contentType==='application/json'?JSON.stringify(body):body})});
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),index=pair.indexOf('=');if(pair.slice(index+1))cookies.set(pair.slice(0,index),pair.slice(index+1));else cookies.delete(pair.slice(0,index));}
    const data=binary?new Uint8Array(await response.arrayBuffer()):await response.json();
    requests.push({method,path:url.pathname,status:response.status});
    return {status:response.status,headers:response.headers,data};
  }
  return {request,requests};
}
export async function stageLocalField(requestedPhase){
  assert.ok(PHASES.has(requestedPhase),'Choose prepare, gate, gate-proof, food, donefood or wrap explicitly.');
  const phase=requestedPhase==='proof'?'gate-proof':requestedPhase,client=connection(),anonymous=connection();
  const report=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):{origin:ORIGIN,startedAt:new Date().toISOString(),phases:[],events:[],proofs:{}};
  assert.equal(report.origin,ORIGIN);report.events||=[];report.proofs||={};report.phases||=[];const run={phase,startedAt:new Date().toISOString(),actions:[],checks:[]};let current;
  function flush(){fs.mkdirSync(path.dirname(REPORT),{recursive:true});fs.writeFileSync(REPORT,`${JSON.stringify(report,null,2)}\n`);}
  async function health(){const result=await anonymous.request('/local-preview/health/');assert.equal(result.status,200);assert.equal(result.data.origin,ORIGIN);assert.equal(result.data.localOnly,true);assert.equal(result.data.processor,'fake');assert.equal(result.data.outboundFetch,'blocked');assert.equal(result.data.scheduledProcessors,'disabled');assert.equal(result.data.counts.crm_subscription_customers,25);assert.equal(result.data.counts.route_partner_members,2);return result.data;}
  async function write(url,options){await health();const result=await client.request(url,options);privacy(result.data);return result;}
  async function refresh(){const result=await client.request('/api/field/workday/');assert.equal(result.status,200,JSON.stringify(result.data));privacy(result.data);assert.equal(result.data.customerTextsEnabled,false);assert.match(result.headers.get('cache-control'),/no-store/);assert.equal(result.data.day.memberId,'local-tech-2');assert.match(result.data.day.planId,/^local-field-plan-2-\d{4}-\d{2}-\d{2}$/);assert.equal(result.data.day.stops.length,6,'Do not accept the pending office assignment during screenshot staging.');current=result.data;return current;}
  async function event(type,body={}){
    assert.ok(!['accept_changes','clock_out','finish_day'].includes(type),'Screenshot staging cannot accept dispatch proposals or close the workday.');
    const saved={id:randomUUID(),shiftId:current.day.id,expectedRevision:current.day.revision,type,body,recordedAt:new Date().toISOString()};
    report.pendingEvent=saved;flush();const result=await write('/api/field/workday/',{method:'POST',body:saved});assert.equal(result.status,200,`${type}: ${JSON.stringify(result.data)}`);assert.equal(result.data.accepted,true);
    report.events.push({id:saved.id,type,revision:result.data.revision,recordedAt:saved.recordedAt});run.actions.push(type);delete report.pendingEvent;flush();await refresh();
  }
  function firstYard(){const stop=current.day.stops[0],task=stop.tasks.find(task=>task.serviceId==='scoop');assert.ok(task,'The first technician 2 stop needs its existing yard task.');return {stop,task};}
  function foodWork(){const stop=current.day.stops[3],task=stop.tasks.find(task=>task.serviceId==='food');assert.ok(task,'The fourth technician 2 stop needs its existing food task.');assert.equal(task.quantity,1);assert.match(task.title,/food|Blue Bag/i);return {stop,task};}
  function onlyActive(task){const working=active(current.day);assert.ok(!working||working.id===task.id,`Unexpected active service ${working?.id}; do not rewrite or complete it.`);}
  async function addProof(task,purpose){
    assert.equal(task.status,'working','Proof staging requires the expected active service.');onlyActive(task);
    const stop=current.day.stops.find(stop=>stop.tasks.some(item=>item.id===task.id)),startedAt=Date.parse(task.startedAt||stop?.arrivedAt);
    const existing=task.photos.find(photo=>photo.purpose===purpose&&Date.parse(photo.at)>=startedAt);if(existing){run.checks.push(`${purpose} proof already attached; no duplicate upload or event`);return existing.id;}
    assert.equal(fs.existsSync(PHOTO),true,'The existing local QA JPEG must be available.');const bytes=fs.readFileSync(PHOTO);assert.ok(bytes.length>0&&bytes.length<400*1024);assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);assert.equal(bytes[2],0xff);
    const proofKey=`${task.id}:${purpose}`;
    let proof=report.proofs[proofKey]||(report.proofs[purpose]?.taskId===task.id?report.proofs[purpose]:null);
    if(proof&&Date.parse(proof.capturedAt)<startedAt){report.proofs[`${proofKey}:${proof.id}`]=proof;proof=null;}
    if(proof){assert.equal(proof.taskId,task.id);assert.equal(proof.digest,digest(bytes),'The staged proof JPEG changed after its capture context was retained.');}else{proof={id:randomUUID(),taskId:task.id,purpose,capturedAt:new Date().toISOString(),digest:digest(bytes),byteLength:bytes.length};report.proofs[proofKey]=proof;flush();}
    const query=new URLSearchParams({id:proof.id,shiftId:current.day.id,taskId:task.id,purpose,capturedAt:proof.capturedAt});
    const uploaded=await write(`/api/field/workday/photo/?${query}`,{method:'PUT',body:bytes,contentType:'image/jpeg'});assert.ok([200,201].includes(uploaded.status),JSON.stringify(uploaded.data));assert.equal(uploaded.data.id,proof.id);proof.uploaded=true;flush();
    const readback=await client.request(`/api/field/workday/photo/?id=${proof.id}`,{binary:true});assert.equal(readback.status,200);assert.equal(readback.headers.get('content-type'),'image/jpeg');assert.equal(digest(readback.data),proof.digest);proof.verifiedPrivateReadback=true;flush();
    await event('add_photo',{taskId:task.id,photoId:proof.id,purpose});proof.attached=true;flush();run.checks.push(`${purpose} JPEG uploaded to private local R2 and matched on readback`);return proof.id;
  }
  try{
    report.healthBefore=await health();
    const login=await write('/api/field/session/',{method:'POST',body:{email:'tech2@example.test',pin:'135790'}});assert.equal(login.status,200,JSON.stringify(login.data));assert.equal(login.data.ok,true);await refresh();
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());assert.equal(current.day.date,today);if(report.date)assert.equal(report.date,today,'This staging report belongs to another service date.');report.date=today;report.shiftId=current.day.id;
    run.before={revision:current.day.revision,status:current.day.shift.status,clockIn:current.day.shift.clockIn,clockOut:current.day.shift.clockOut,activeTaskId:active(current.day)?.id||null,pendingOfficeChanges:current.changes.map(change=>change.id)};flush();
    if(report.pendingEvent){const pending=report.pendingEvent;assert.equal(pending.shiftId,current.day.id);assert.ok(!['accept_changes','clock_out','finish_day'].includes(pending.type),'Retained screenshot events cannot accept office changes or close the workday.');const replay=await write('/api/field/workday/',{method:'POST',body:pending});assert.equal(replay.status,200,`Retained event could not be reconciled: ${JSON.stringify(replay.data)}`);assert.equal(replay.data.accepted,true);report.events.push({id:pending.id,type:pending.type,revision:replay.data.revision,recordedAt:pending.recordedAt,reconciled:true});run.actions.push(`reconciled:${pending.type}`);delete report.pendingEvent;flush();await refresh();}
    assert.ok(!current.day.shift.clockOut,'Do not reopen or rewrite a completed field day.');assert.equal(current.day.shift.activeBreak,null,'End an unexpected active break in the app before staging.');
    if(phase==='prepare'){
      assert.ok(!active(current.day),'Do not prepare a route with an active service.');
      if(current.day.shift.status==='ready')await event('clock_in',{mileage:13000,vehicle:'company',notes:'Local Route OS screenshot QA with fixture mileage.'});
      if(current.day.shift.status==='loading'){for(const [key] of PRECHECKS)if(!current.day.shift.prechecks[key])await event('check_item',{key,checked:true});const items=current.day.inventory.map(item=>({productId:item.productId,quantity:item.required}));await event('confirm_load',{items});}
      if(current.day.shift.status==='loaded')await event('start_route');
      assert.equal(current.day.shift.status,'on_route');assert.ok(PRECHECKS.every(([key])=>current.day.shift.prechecks[key]));assert.ok(current.day.inventory.every(item=>item.loaded>=item.required));run.checks.push('Departure checks, scheduled product load and route start retained through native events');
    }else if(phase==='wrap'){
      assert.ok(['on_route','wrapping'].includes(current.day.shift.status),'The route must be started and not clocked out before wrap staging.');
      assert.equal(current.day.stops.flatMap(stop=>stop.tasks).length,10,'Use the original ten technician 2 services only.');
      assert.ok(current.day.stops.every(stop=>stop.safety==='clear'),'Every actual stop must already have confirmed clear safety; do not clear or skip a safety issue for screenshots.');
      assert.ok(current.day.issues.every(issue=>issue.response),'Resolve any real recorded issue before screenshot wrap staging.');
      assert.ok(current.day.stops.flatMap(stop=>stop.tasks).every(task=>['pending','working','completed'].includes(task.status)),'Skipped or cancelled services cannot be rewritten as completed.');
      report.wrapTaskIds||=[];
      const food=foodWork(),working=active(current.day);
      assert.ok(!working||working.id===food.task.id||report.wrapTaskIds.includes(working.id),'An unexpected service is active; do not complete it for screenshots.');
      if(working?.id===food.task.id){
        assert.ok(working.photos.some(photo=>photo.purpose==='delivery'&&Date.parse(photo.at)>=Date.parse(working.startedAt)),'The already staged food service needs its valid delivery proof.');
        await event('complete_task',{taskId:working.id,secured:true,units:working.quantity});
      }
      async function finishTask(taskId){
        let stop=current.day.stops.find(stop=>stop.tasks.some(task=>task.id===taskId)),task=stop?.tasks.find(task=>task.id===taskId);assert.ok(task);assert.equal(stop.safety,'clear');
        if(task.status==='completed')return;onlyActive(task);assert.ok(['pending','working'].includes(task.status));
        if(!report.wrapTaskIds.includes(task.id)){report.wrapTaskIds.push(task.id);flush();}
        if(!stop.arrivedAt)await event('arrive',{stopId:stop.id});
        if(task.status==='pending')await event('start_task',{taskId:task.id,safe:true});
        stop=current.day.stops.find(stop=>stop.tasks.some(task=>task.id===taskId));task=stop.tasks.find(task=>task.id===taskId);assert.equal(task.status,'working');
        const purpose=task.proofKind==='gate'&&stop.hasGate===false?'none':task.proofKind;
        if(['gate','service','delivery'].includes(purpose))await addProof(task,purpose);else assert.equal(purpose,'none','Unknown proof requirement cannot be bypassed.');
        task=current.day.stops.flatMap(stop=>stop.tasks).find(task=>task.id===taskId);await event('complete_task',{taskId:task.id,secured:true,units:task.quantity});
      }
      const resumed=active(current.day);if(resumed){assert.ok(report.wrapTaskIds.includes(resumed.id));await finishTask(resumed.id);}
      for(const taskId of current.day.stops.flatMap(stop=>stop.tasks).map(task=>task.id))await finishTask(taskId);
      const summary=workdaySummary(current.day);assert.equal(summary.completed,10);assert.equal(summary.accounted,10);assert.equal(summary.stopsFinished,6);assert.equal(summary.skipped,0);assert.equal(summary.unresolvedIssues,0);assert.ok(!active(current.day));
      if(current.day.shift.status==='on_route')await event('start_wrap');
      assert.equal(current.day.shift.status,'wrapping');for(const [key] of WRAPCHECKS)if(!current.day.shift.wrapchecks[key])await event('check_item',{key,checked:true});
      assert.equal(current.day.shift.clockOut,null);assert.equal(current.day.shift.endMileage,null);assert.ok(WRAPCHECKS.every(([key])=>current.day.shift.wrapchecks[key]));
      assert.ok(current.day.inventory.every(item=>item.delivered===item.required));
      run.nativeSummary=workdaySummary(current.day);run.inventoryDelivered=current.day.inventory.map(item=>({productId:item.productId,required:item.required,loaded:item.loaded,delivered:item.delivered}));
      run.checks.push('Six stops and ten services completed through native proof and quantity guards, with no skips');run.checks.push('Wrap checklist complete; clock-out and ending mileage remain unset for review');
    }else{
      assert.equal(current.day.shift.status,'on_route','Run the explicit prepare phase before staging service screens.');
      if(phase==='gate'){
        let {stop,task}=firstYard();onlyActive(task);assert.equal(accounted(task),false,'The first yard service was already accounted; do not rewrite it.');
        if(!stop.arrivedAt)await event('arrive',{stopId:stop.id});({stop,task}=firstYard());if(task.status==='pending')await event('start_task',{taskId:task.id,safe:true});assert.equal(firstYard().task.status,'working');run.checks.push('First yard service remains working for gate capture');
      }else if(phase==='gate-proof'){
        const {task}=firstYard();await addProof(task,'gate');assert.equal(firstYard().task.status,'working');run.checks.push('Gate proof attached while yard service remains working');
      }else if(phase==='food'){
        let yard=firstYard(),food=foodWork();const working=active(current.day);assert.ok(!working||[yard.task.id,food.task.id].includes(working.id),'An unrelated service is active.');
        if(yard.task.status==='working'){assert.ok(yard.task.photos.some(photo=>photo.purpose==='gate'),'Run gate-proof before completing the staged yard service.');await event('complete_task',{taskId:yard.task.id,secured:true,units:yard.task.quantity});}else assert.equal(yard.task.status,'completed','Complete only the already staged yard service before food staging.');
        food=foodWork();onlyActive(food.task);assert.equal(accounted(food.task),false,'The food task was already accounted; do not rewrite it.');if(!food.stop.arrivedAt)await event('arrive',{stopId:food.stop.id});food=foodWork();if(food.task.status==='pending')await event('start_task',{taskId:food.task.id,safe:true});food=foodWork();await addProof(food.task,'delivery');assert.equal(foodWork().task.status,'working');run.checks.push('Blue Bag delivery has private proof and remains working for completion capture');
      }else if(phase==='donefood'){
        const {task}=foodWork();if(task.status==='completed'){assert.ok(!active(current.day));run.checks.push('Food service already completed; no duplicate completion');}else{onlyActive(task);assert.equal(task.status,'working');assert.ok(task.photos.some(photo=>photo.purpose==='delivery'),'Food needs its existing staged delivery proof.');await event('complete_task',{taskId:task.id,secured:true,units:task.quantity});assert.equal(foodWork().task.status,'completed');run.checks.push('Native food proof, verified-order and loaded-inventory guards accepted one completion');}
      }
    }
    await refresh();assert.deepEqual(current.changes.map(change=>change.id),run.before.pendingOfficeChanges,'Pending office changes must remain unaccepted.');assert.equal(current.day.shift.clockOut,run.before.clockOut);privacy(current);report.healthAfter=await health();run.after={revision:current.day.revision,status:current.day.shift.status,clockIn:current.day.shift.clockIn,clockOut:current.day.shift.clockOut,activeTaskId:active(current.day)?.id||null,completedServices:current.day.stops.flatMap(stop=>stop.tasks).filter(task=>task.status==='completed').length,proofs:current.day.stops.flatMap(stop=>stop.tasks).flatMap(task=>task.photos).length,pendingOfficeChanges:current.changes.map(change=>change.id)};run.passed=true;
  }catch(error){run.passed=false;run.error={message:error.message,stack:error.stack};throw error;}finally{run.finishedAt=new Date().toISOString();run.requests=client.requests;report.phases.push(run);report.finishedAt=run.finishedAt;flush();}
  return {reportPath:REPORT,phase:run.phase,passed:run.passed,before:run.before,after:run.after,actions:run.actions,checks:run.checks};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const phase=process.argv[2];
  if(!PHASES.has(phase)){console.error('Choose a local screenshot phase: prepare | gate | gate-proof | food | donefood | wrap');process.exitCode=1;}
  else try{console.log(JSON.stringify(await stageLocalField(phase),null,2));}catch(error){console.error(JSON.stringify({passed:false,phase,error:error.message,reportPath:REPORT},null,2));process.exitCode=1;}
}
