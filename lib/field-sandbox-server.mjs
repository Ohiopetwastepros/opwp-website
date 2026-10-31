import { FieldError, operatingDate, imageMatches } from './field-policy.mjs';
import { applyWorkdayEvent, taskDone, workdaySummary } from './field-workday-model.mjs';
import { SERVICE_DEFAULTS, serviceTask, validateService } from './field-service-catalog.mjs';
import { validateRecurring, recurringDue } from './field-recurring-services.mjs';
import { workdayInsights } from './field-workday-insights.mjs';
import { fieldQuota } from './field-quota.mjs';
import { readBoundedBytes, readBoundedProviderJson } from './bounded-body.mjs';

export const SANDBOX_COOKIE='opwp_field_sandbox', SANDBOX_TTL=7*86400;
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const requireValue=(ok,message,status=400)=>{if(!ok)throw new FieldError(message,status);};
export async function sandboxHash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');}
export function createSandboxState(id, now=Date.now(), previous=null){
 const catalog=previous?.catalog||SERVICE_DEFAULTS.map(s=>({...s,active:true,instructions:'Fictional training service. No customer billing.'}));
 const task=(serviceId,options={})=>serviceTask(catalog.find(s=>s.id===serviceId)||SERVICE_DEFAULTS.find(s=>s.id===serviceId),{id:crypto.randomUUID(),...options});
 const stop=(key,name,tasks,extra={})=>({id:crypto.randomUUID(),propertyKey:key,name:`TEST - ${name}`,address:'Fictional training property - do not navigate',latitude:null,longitude:null,travelMinutes:5,hasGate:true,safety:'clear',clearanceAt:null,gateCode:'TRAINING',communityCode:'',instructions:'Training only. Use sample proof; do not visit this address.',dogCount:0,phone:'',notificationPreference:null,arrivedAt:null,completedAt:null,status:'pending',tasks,...extra});
 const date=operatingDate(new Date(now));
 const stops=[
  stop('sample-maple','Maple yard',[task('scoop',{estimate:1}),task('sanitize')]),
  stop('sample-litter','Litter service',[task('litter',{quantity:3}),task('haul')],{hasGate:false}),
  stop('sample-food','Food delivery',[task('food',{deliveryItems:[{productId:'training-pink',quantity:1},{productId:'training-green',quantity:1}]})],{hasGate:false}),
  stop('sample-safety','Access review',[task('scoop'),task('deodorize')],{safety:'unknown',dogCount:null,instructions:'Office must confirm safe access. Test an issue and office response, or clearance before starting.'}),
 ];
 const recurring=structuredClone(previous?.recurring||[]);
 for(const s of stops)for(const rule of recurring){const service=catalog.find(c=>c.id===rule.service_id&&c.active&&c.id!=='food');if(rule.property_key===s.propertyKey&&rule.active&&service&&recurringDue(rule,date)&&!s.tasks.some(t=>t.serviceId===service.id))s.tasks.push(task(service.id,{quantity:rule.quantity,notes:rule.instructions}));}
 const createdAt=new Date(now).toISOString();
 return {catalog,recurring,changes:[],messages:[],day:{schema:1,id,organizationId:'sandbox',memberId:id,memberName:'Training technician',planId:id,sourceFingerprint:'fictional-training',employeeId:null,date,planVersion:1,revision:0,createdAt,lastEventAt:null,paymentStatus:'passed',inventory:[{productId:'training-pink',name:'TEST Pink food bag',color:'pink',required:1,loaded:0,delivered:0,returned:0,damaged:0,missing:0},{productId:'training-green',name:'TEST Green food bag',color:'green',required:1,loaded:0,delivered:0,returned:0,damaged:0,missing:0}],shift:{status:'ready',clockIn:null,clockOut:null,startMileage:null,endMileage:null,activeBreak:null,breaks:[],prechecks:{},wrapchecks:{},notes:'',endNotes:''},stops,issues:[],notices:[],acceptedChanges:[]}};
}
export async function sandboxSession(db,headers,now=Date.now()){
 const token=(headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(SANDBOX_COOKIE+'='))?.slice(SANDBOX_COOKIE.length+1);
 if(!/^[a-f0-9]{64}$/.test(token||''))return null;
 return db.prepare('SELECT * FROM field_sandbox_sessions WHERE token_hash=? AND expires_at>?').bind(await sandboxHash(token),now).first();
}
export async function startSandboxSession(db,now=Date.now(),previous=null){
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),state=createSandboxState(id,now,previous);
 await db.prepare('DELETE FROM field_sandbox_sessions WHERE id IN (SELECT id FROM field_sandbox_sessions WHERE expires_at<? LIMIT 30)').bind(now).run();
 await db.prepare('INSERT INTO field_sandbox_sessions(id,token_hash,state_json,created_at,expires_at) VALUES (?,?,?,?,?)').bind(id,await sandboxHash(token),JSON.stringify(state),now,now+SANDBOX_TTL*1000).run();
 return {id,token,state,expiresAt:now+SANDBOX_TTL*1000};
}
const member=row=>({id:row.id,organizationId:'sandbox',name:'Training technician',email:'training@example.invalid'});
export function sandboxWorkday(row,date){const state=JSON.parse(row.state_json);return {ok:true,member:member(row),day:date&&date!==state.day.date?null:state.day,changes:state.changes.filter(c=>c.status==='pending'),messages:state.messages,sourceChanged:false,customerTextsEnabled:false,offlineUntil:new Date(Math.min(row.expires_at,Date.now()+24*3600000)).toISOString()};}
export async function saveSandboxEvent(db,row,event,now=Date.now()){
 requireValue(event&&uuid(event.id),'Choose a valid training action.');
 const hash=await sandboxHash(JSON.stringify(event));
 const prior=await db.prepare('SELECT body_hash FROM field_sandbox_events WHERE session_id=? AND id=?').bind(row.id,event.id).first();
 if(prior){requireValue(prior.body_hash===hash,'Action identifier reused with different content.',409);return {ok:true,accepted:true,revision:event.expectedRevision+1,replayed:true};}
 const state=JSON.parse(row.state_json),pending=state.changes.filter(c=>c.status==='pending');
 if(['start_task','complete_task'].includes(event.type)){
  const stop=state.day.stops.find(s=>s.tasks.some(t=>t.id===event.body?.taskId));
  requireValue(!pending.some(c=>c.kind==='safety'&&c.payload.stopId===stop?.id&&!c.payload.safe),'Accept the office safety change before continuing.',409);
 }
 if(event.type==='add_photo'){
  const b=event.body||{},photo=await db.prepare('SELECT id FROM field_sandbox_photos WHERE session_id=? AND id=? AND task_id=? AND purpose=? AND captured_at=?').bind(row.id,b.photoId||'',b.taskId||'',b.purpose||'',event.recordedAt||'').first();
  requireValue(photo,'Upload the matching training proof before its action.',409);
 }
 if(event.type==='accept_changes')requireValue(Array.isArray(event.body?.changeIds)&&pending.every(c=>event.body.changeIds.includes(c.id)),'Review the current pending office changes.',409);
 state.day=applyWorkdayEvent(state.day,event,{now,officeChanges:pending});
 if(event.type==='accept_changes')for(const c of pending)c.status='accepted';
 if(['on_way','complete_task','skip_task','issue','unsafe'].includes(event.type))state.messages.push({id:event.id,shift_id:row.id,status:'held',kind:event.type,created_at:new Date(now).toISOString(),detail:'TRAINING ONLY - no real message sent.'});
 state.messages=state.messages.slice(-100);
 requireValue(new TextEncoder().encode(JSON.stringify(state)).byteLength<=1024*1024,'Training record limit reached. Export and restart this test.');
 try{await db.prepare('INSERT INTO field_sandbox_events(session_id,id,expected_version,body_hash,event_json,result_json,received_at) VALUES (?,?,?,?,?,?,?)').bind(row.id,event.id,row.version,hash,JSON.stringify(event),JSON.stringify(state),now).run();}
 catch{const replay=await db.prepare('SELECT body_hash FROM field_sandbox_events WHERE session_id=? AND id=?').bind(row.id,event.id).first();if(replay?.body_hash===hash)return {ok:true,accepted:true,revision:event.expectedRevision+1,replayed:true};throw new FieldError('Training day changed. Refresh and retry; device work is retained.',409);}
 return {ok:true,accepted:true,revision:state.day.revision};
}
export function sandboxOfficeCommand(original,body,now=Date.now()){
 requireValue(body&&typeof body==='object'&&!Array.isArray(body),'Choose an office operation.');
 const state=structuredClone(original),day=state.day;
 if(body.action==='save_service'){
  const service=validateService(body.service),i=state.catalog.findIndex(s=>s.id===service.id);
  requireValue(i>=0||state.catalog.length<60,'Training catalog limit reached.');
  if(i>=0)state.catalog[i]=service;else state.catalog.push(service);
  return {state,message:'Training service saved. Assigned tasks retain their reviewed rules.'};
 }
 requireValue(body.shiftId===day.id,'Choose your own training workday.',404);
 const stop=day.stops.find(s=>s.id===body.stopId),note=typeof body.notes==='string'?body.notes.trim():'';
 requireValue(note&&note.length<=2000,'Explain this change in 2,000 characters or fewer.');
 if(body.action==='cancel_change'){
  const change=state.changes.find(c=>c.id===body.changeId&&c.status==='pending');
  requireValue(change&&body.verified===true,'Verify the situation and choose a pending change.');change.status='cancelled';change.cancelReason=note;
 }else if(body.action==='save_recurring'){
  const service=state.catalog.find(s=>s.id===body.serviceId&&s.active&&s.id!=='food');requireValue(stop&&service,'Choose a training property and an active add-on.');
  const rule=validateRecurring(body,day.date),row={id:crypto.randomUUID(),property_key:stop.propertyKey,property_name:stop.name,service_id:service.id,quantity:rule.quantity,every_weeks:rule.everyWeeks,weekdays:JSON.stringify(rule.weekdays),start_date:rule.startDate,active:Number(rule.active),instructions:note};
  const i=state.recurring.findIndex(r=>r.property_key===row.property_key&&r.service_id===row.service_id);requireValue(i>=0||state.recurring.length<100,'Training recurring limit reached.');if(i>=0)state.recurring[i]=row;else state.recurring.push(row);
  return {state,message:'Training recurring service saved. Use Restart route (keep setup) to test matching assignments. No billing occurs.'};
 }else{
  requireValue(!day.shift.clockOut||body.action==='response','This training day is closed. Restart to schedule more work.');
  if(['add_service','reclean','reorder'].includes(body.action))requireValue(['ready','loading','loaded','on_route'].includes(day.shift.status),'Wrap-up has started. Restart to schedule more work.');
  requireValue(state.changes.filter(c=>c.status==='pending').length<40&&state.changes.length<200,'Training change limit reached.');
  let kind,payload;
  if(['add_service','reclean'].includes(body.action)){
   const service=state.catalog.find(s=>s.id===body.serviceId&&s.active&&s.id!=='food');requireValue(stop&&service,'Choose a training property and an active add-on.');
   requireValue(day.stops.length+state.changes.filter(c=>c.status==='pending'&&c.kind==='add_visit').length<60&&day.stops.flatMap(s=>s.tasks).length+state.changes.filter(c=>c.status==='pending'&&['add_service','add_visit'].includes(c.kind)).length<160,'Training route capacity reached.');
   const task=serviceTask(service,{id:crypto.randomUUID(),quantity:body.quantity,notes:note,source:{provider:'training'}});
   if(body.action==='add_service'){requireValue(!stop.tasks.every(taskDone),'Use a return visit for a finished property.');kind='add_service';payload={stopId:stop.id,task,reason:note};}
   else{kind='add_visit';payload={stop:{...structuredClone(stop),id:crypto.randomUUID(),status:'pending',arrivedAt:null,completedAt:null,clearanceAt:null,safety:stop.safety==='clear'?'clear':'unknown',recleanOf:stop.id,tasks:[{...task,title:'Return visit: '+task.title}],travelMinutes:null,instructions:note},reason:note};}
  }else if(body.action==='safety'){
   requireValue(stop&&typeof body.safe==='boolean'&&(body.hasGate===undefined||typeof body.hasGate==='boolean'),'Choose verified access and gate status.');kind='safety';payload={stopId:stop.id,safe:body.safe,reason:note,...(typeof body.hasGate==='boolean'?{hasGate:body.hasGate}:{})};
  }else if(body.action==='response'){
   requireValue(day.issues.some(i=>i.id===body.issueId),'Choose an issue from this workday.');kind='response';payload={issueId:body.issueId,text:note};
  }else if(body.action==='reorder'){
   requireValue(Array.isArray(body.stopIds)&&body.stopIds.length===day.stops.length&&new Set(body.stopIds).size===day.stops.length&&body.stopIds.every(id=>day.stops.some(s=>s.id===id)),'Provide every stop exactly once.');
   day.stops.forEach((s,i)=>requireValue(!(s.arrivedAt||s.tasks.some(taskDone))||body.stopIds[i]===s.id,'Arrived and accounted stops are locked.'));kind='reorder';payload={stopIds:body.stopIds,reason:note};
  }else throw new FieldError('Unsupported training office operation.');
  state.changes.push({id:crypto.randomUUID(),shift_id:day.id,kind,payload,status:'pending',created_by:'training-office',created_at:new Date(now).toISOString()});
 }
 return {state,message:'Training office change saved. Refresh the technician app and accept pending changes.'};
}
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});
const cookie=(token,secure,age)=>`${SANDBOX_COOKIE}=${token}; Path=/api/field-sandbox; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
export async function handleSandboxRequest(request,env){
 // Fail closed BEFORE querying any storage on the production deployment.
 if(env?.FIELD_SANDBOX_ONLY!=='true')return json({ok:false,error:'Not found.'},404);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/field-sandbox\//,'').replace(/\/$/,''),write=request.method!=='GET';
 if(write&&(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))return json({ok:false,error:'Cross-site request blocked.'},403);
 try{
  const db=env.DB;requireValue(db,'Training storage unavailable.',503);
  const ip=await sandboxHash(request.headers.get('cf-connecting-ip')||'local');
  requireValue(await fieldQuota(db,ip,'unified_sandbox_requests',240),'Training request limit reached. Retry shortly.',429);
  const row=await sandboxSession(db,request.headers);
  if(path==='session'&&request.method==='GET')return json({ok:true,authenticated:Boolean(row),member:row?member(row):null});
  if(path==='session'&&request.method==='POST'){
   const body=await readBoundedProviderJson(request,2048);requireValue(body?.operation==='start'||body?.operation==='reset','Choose start or reset.');
   requireValue(body.operation!=='reset'||row,'Start your training session first.',401);
   requireValue(await fieldQuota(db,ip,'unified_sandbox_start',12,3600)&&await fieldQuota(db,'all','unified_sandbox_daily',200,86400),'Training session limit reached.',429);
   const session=await startSandboxSession(db,Date.now(),body.keepSetup===true&&row?JSON.parse(row.state_json):null);
   return json({ok:true,id:session.id},200,{'Set-Cookie':cookie(session.token,url.protocol==='https:',SANDBOX_TTL)});
  }
  requireValue(row,'Start a training day. Your saved device work is retained.',401);
  if(path==='session'&&request.method==='DELETE'){
   await db.prepare('UPDATE field_sandbox_sessions SET expires_at=? WHERE id=?').bind(Date.now(),row.id).run();return json({ok:true},200,{'Set-Cookie':cookie('',url.protocol==='https:',0)});
  }
  requireValue(await fieldQuota(db,row.id,'unified_sandbox_session',240),'Training session request limit reached.',429);
  const state=JSON.parse(row.state_json);
  if(path==='workday'&&request.method==='GET')return json(sandboxWorkday(row,url.searchParams.get('date')));
  if(path==='workday'&&request.method==='POST')return json(await saveSandboxEvent(db,row,await readBoundedProviderJson(request,12000)));
  if(path==='office'&&request.method==='GET'){
   const match=!url.searchParams.get('date')||url.searchParams.get('date')===state.day.date;
   return json({ok:true,days:match?[state.day]:[],catalog:state.catalog,recurring:state.recurring,changes:match?state.changes:[],messages:match?state.messages:[],released:[],insights:workdayInsights(match?[state.day]:[])});
  }
  if(path==='office'&&request.method==='POST'){
   const result=sandboxOfficeCommand(state,await readBoundedProviderJson(request,16000));
   const changed=await db.prepare('UPDATE field_sandbox_sessions SET state_json=?,version=version+1 WHERE id=? AND version=? RETURNING id').bind(JSON.stringify(result.state),row.id,row.version).first();requireValue(changed,'Training day changed. Refresh the office view and retry.',409);
   return json({ok:true,message:result.message});
  }
  if(path==='record'&&request.method==='GET')return json({ok:true,trainingOnly:true,noCustomerMessagesOrBilling:true,summary:workdaySummary(state.day),...state});
  if(path==='workday/photo'&&request.method==='GET'){
   const photo=await db.prepare('SELECT body FROM field_sandbox_photos WHERE session_id=? AND id=?').bind(row.id,(url.searchParams.get('id')||'').slice(0,40)).first();requireValue(photo,'Training photo not found.',404);
   return new Response(photo.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(path==='workday/photo'&&request.method==='PUT'){
   const id=url.searchParams.get('id'),taskId=url.searchParams.get('taskId'),purpose=url.searchParams.get('purpose'),capturedAt=url.searchParams.get('capturedAt'),task=state.day.stops.flatMap(s=>s.tasks).find(t=>t.id===taskId);
   requireValue(url.searchParams.get('shiftId')===state.day.id&&uuid(id)&&task&&['gate','service','delivery','observation'].includes(purpose),'Choose your training task and proof purpose.');
   const stop=state.day.stops.find(s=>s.tasks.some(t=>t.id===taskId));
   requireValue(Number.isFinite(Date.parse(capturedAt))&&Date.parse(capturedAt)>=Date.parse(task.startedAt||stop.arrivedAt)&&Date.parse(capturedAt)<=Date.now()+120000,'Training proof needs its original capture time.');
   const bytes=await readBoundedBytes(request,400*1024);requireValue(request.headers.get('content-type')==='image/jpeg'&&imageMatches(bytes,'image/jpeg'),'Choose a valid JPEG training image.');
   const hash=await sandboxHash(bytes),prior=await db.prepare('SELECT * FROM field_sandbox_photos WHERE session_id=? AND id=?').bind(row.id,id).first();
   if(prior){requireValue(prior.content_hash===hash&&prior.task_id===taskId&&prior.purpose===purpose&&prior.captured_at===capturedAt,'Training photo identifier conflict.',409);return json({ok:true,id});}
   requireValue(task.status==='working'&&!state.day.shift.clockOut,'Start the training service before adding proof.',409);
   const count=await db.prepare('SELECT COUNT(*) n FROM field_sandbox_photos WHERE session_id=?').bind(row.id).first();requireValue(count.n<24,'Training photo limit reached. Restart after exporting the record.');
   await db.prepare('INSERT INTO field_sandbox_photos(session_id,id,task_id,purpose,captured_at,content_hash,body) VALUES (?,?,?,?,?,?,?)').bind(row.id,id,taskId,purpose,capturedAt,hash,bytes.buffer).run();return json({ok:true,id});
  }
  return json({ok:false,error:'Not found.'},404);
 }catch(error){if(error instanceof FieldError)return json({ok:false,error:error.message},error.status);if(error instanceof RangeError)return json({ok:false,error:'Training request is too large.'},413);if(error instanceof SyntaxError)return json({ok:false,error:'Invalid training request.'},400);console.error(JSON.stringify({event:'field_sandbox_failed',type:error?.name||'Error'}));return json({ok:false,error:'Training sync is unavailable. Device work is retained.'},503);}
}
