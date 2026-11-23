// Local fixture acceptance for the Mark-reference Route OS review. This script
// cannot choose an origin, follow redirects, send a message or call a processor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const ORIGIN='http://localhost:8787';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const REPORT=path.join(ROOT,'tmp/mark-v2-http-report.json');
const previous=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT,'utf8')):null;
const ids=previous?.requestIds||Object.fromEntries(['customer','team','eta','assignment','duplicateAssignment','reorder'].map(key=>[key,randomUUID()]));
const report={origin:ORIGIN,startedAt:new Date().toISOString(),requestIds:ids,checks:[],pages:[],fixtureChanges:[],errors:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plan1=`local-field-plan-1-${date}`,plan2=`local-field-plan-2-${date}`;
function flush(){fs.mkdirSync(path.dirname(REPORT),{recursive:true});fs.writeFileSync(REPORT,`${JSON.stringify(report,null,2)}\n`);}
function passed(name,details={}){report.checks.push({name,passed:true,...details});flush();}
function connection(){
  const cookies=new Map(),requests=[];
  async function request(relative,{body=null,method=body===null?'GET':'POST',origin=ORIGIN,json=true,rawBody=null}={}){
    const url=new URL(relative,ORIGIN);assert.equal(url.origin,ORIGIN);assert.equal(url.hostname,'localhost');
    const headers=new Headers({Origin:origin});
    if(cookies.size)headers.set('Cookie',[...cookies].map(([key,value])=>`${key}=${value}`).join('; '));
    if(body!==null||rawBody!==null)headers.set('Content-Type','application/json');
    const response=await fetch(url,{method,headers,redirect:'manual',signal:AbortSignal.timeout(30000),...((body===null&&rawBody===null)?{}:{body:rawBody??JSON.stringify(body)})});
    for(const line of response.headers.getSetCookie()){const [pair]=line.split(';'),index=pair.indexOf('='),key=pair.slice(0,index),value=pair.slice(index+1);if(value)cookies.set(key,value);else cookies.delete(key);}
    const responseBody=json?await response.json():await response.text();
    requests.push({method,path:`${url.pathname}${url.search}`,status:response.status});
    return {status:response.status,headers:response.headers,body:responseBody};
  }
  return {request,requests};
}
const anonymous=connection(),admin=connection(),technician=connection();
let guarded=false;
async function healthGuard(){
  const result=await anonymous.request('/local-preview/health/');
  assert.equal(result.status,200);assert.equal(result.body.origin,ORIGIN);
  assert.equal(result.body.localOnly,true);assert.equal(result.body.processor,'fake');assert.equal(result.body.outboundFetch,'blocked');assert.equal(result.body.scheduledProcessors,'disabled');
  assert.equal(result.body.counts.crm_subscription_customers,25);assert.equal(result.body.counts.crm_billing_invoices,45);
  guarded=true;return result.body;
}
async function write(client,url,options){assert.equal(guarded,true,'The explicit fake local server must pass its health guard before any writes.');await healthGuard();return client.request(url,options);}
async function login(){
  const password=await write(admin,'/api/admin/session/',{body:{action:'password',username:'preview.admin@example.test',password:'LocalPreview!2026'}});
  assert.equal(password.status,202);assert.equal(password.body.step,'verify');
  for(let attempt=0;attempt<4;attempt++){
    let access=await anonymous.request('/api/local-preview/access/');assert.equal(access.status,200);
    if(access.body.validForSeconds<4){await pause((access.body.validForSeconds+1)*1000);access=await anonymous.request('/api/local-preview/access/');}
    assert.match(access.body.admin.code,/^\d{6}$/);
    const verification=await write(admin,'/api/admin/session/',{body:{action:'verify',code:access.body.admin.code,trustDevice:true}});
    if(verification.status===200){assert.equal(verification.body.step,'complete');return;}
    assert.match(verification.body.error||'',/invalid|already used/i);await pause((access.body.validForSeconds+1)*1000);
  }
  throw Error('A fresh local administrator MFA code was not available.');
}
async function ops(){const result=await admin.request('/api/local-preview/crm-view/');assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
async function billing(){const [year,month]=date.split('-').map(Number),next=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10),results=[];for(const period of [`${date.slice(0,7)}-01`,next]){const result=await admin.request(`/api/admin/crm/billing/?period=${period}&filter=all`);assert.equal(result.status,200);results.push(result.body);}return results;}
async function replay(body){const first=await write(admin,'/api/local-preview/crm-view/',{body});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.ok,true);const repeated=await write(admin,'/api/local-preview/crm-view/',{body});assert.equal(repeated.status,200,JSON.stringify(repeated.body));assert.deepEqual(repeated.body,first.body);return first.body;}

try{
  flush();
  let healthy=false;for(let attempt=0;attempt<35;attempt++){try{report.healthBefore=await healthGuard();healthy=true;break;}catch(error){if(attempt===34)throw error;await pause(1000);}}
  assert.equal(healthy,true);passed('Explicit localhost fake-only guard passed before writes');
  const baseDraft={action:'save_message_draft',requestId:ids.customer,audience:'customer',kind:'message',customerId:'local-customer-10',planId:plan2,text:'Please leave the covered side door accessible for today’s Blue Bag delivery.'};
  const anonPost=await write(anonymous,'/api/local-preview/crm-view/',{body:baseDraft});assert.equal(anonPost.status,401);
  const techLogin=await write(technician,'/api/field/session/',{body:{email:'tech2@example.test',pin:'135790'}});assert.equal(techLogin.status,200);
  const techPost=await write(technician,'/api/local-preview/crm-view/',{body:baseDraft});assert.equal(techPost.status,401);
  const techGet=await technician.request('/api/local-preview/crm-view/');assert.equal(techGet.status,401);
  passed('Anonymous and technician sessions cannot write or read office CRM records');
  await login();const session=await admin.request('/api/admin/session/');assert.equal(session.status,200);assert.equal(session.body.authenticated,true);assert.equal(session.body.identity,'preview.admin@example.test');
  passed('Normal administrator password and current MFA sign-in');
  const urls=['/admin/crm/',...['routes','planning','best-fit','schedule','exceptions','analytics','messages','eta','customers','techs','work-queue','dog-food','settings','reports'].map(screen=>`/admin/crm/${screen}/`),`/local-preview/on-the-way/?customerId=local-customer-10&planId=${plan2}&minutes=15`];
  for(const url of urls){const result=await admin.request(url,{json:false});const page={url:`${ORIGIN}${url}`,status:result.status,passed:result.status===200&&!/Application error:|a server-side exception|Internal Server Error/.test(result.body)};report.pages.push(page);assert.equal(page.passed,true,`Page ${url} failed with ${result.status}`);assert.equal(result.headers.get('x-local-preview'),'fake-data-only');}
  passed('All new office and branded customer page URLs return 200',{count:urls.length});
  const before=await ops(),readAgain=await ops();assert.deepEqual(readAgain,before);assert.equal(before.date,date);assert.equal(before.profiles.length,25);assert.equal(before.plans.length,2);assert.ok(Array.isArray(before.office.days));assert.ok(Array.isArray(before.office.changes));assert.ok(Array.isArray(before.messageDrafts));
  for(const released of before.office.released){assert.ok([plan1,plan2].includes(released.planId));assert.ok(['local-tech-1','local-tech-2'].includes(released.memberId));assert.equal(before.plans.find(plan=>plan.id===released.planId).assigned_member_id,released.memberId);}
  passed('Read-only local operations GET is stable and includes office and correlated released-shift data',{releasedEntries:before.office.released.length,preparedWorkdays:before.office.days.length});
  const billingBefore=await billing(),day2Before=before.office.days.find(day=>day.planId===plan2),day1Before=before.office.days.find(day=>day.planId===plan1);assert.ok(day2Before,'Route 2 must already have a prepared workday so assignment cannot prepare or alter it.');assert.ok(day1Before,'Route 1 must have its existing progressed workday.');
  const deniedOrigin=await write(admin,'/api/local-preview/crm-view/',{body:baseDraft,origin:'https://untrusted.invalid'});assert.equal(deniedOrigin.status,403);
  const oversized=await write(admin,'/api/local-preview/crm-view/',{method:'POST',rawBody:JSON.stringify({...baseDraft,text:'x'.repeat(13*1024)})});assert.equal(oversized.status,400);
  passed('Cross-origin and oversized local commands are rejected');
  const deliveryStop=before.stops.find(stop=>stop.location_key==='local-customer-10');assert.ok(deliveryStop);assert.equal(deliveryStop.route_plan_id,plan2);
  const drafts=[{...baseDraft,stopId:deliveryStop.id},{...baseDraft,requestId:ids.team,audience:'team',text:'Route team: Blue Bag delivery is scheduled at the covered side door. Review the stop notes before arrival.'},{...baseDraft,requestId:ids.eta,kind:'eta',stopId:deliveryStop.id,text:'Ohio Pet Waste Pros is on the way. Your technician expects to arrive in about 15 minutes. Please secure your dogs and leave the gate accessible.'}];
  for(const draft of drafts){const result=await replay(draft);assert.equal(result.draft.status,'draft');assert.equal(result.draft.customerId,'local-customer-10');assert.equal(result.draft.planId,plan2);report.fixtureChanges.push({kind:'local_message_draft',audience:draft.audience,type:draft.kind,id:result.draft.id});}
  const withDrafts=await ops();for(const draft of drafts)assert.equal(withDrafts.messageDrafts.filter(item=>item.id===draft.requestId).length,1);
  passed('Customer, team and ETA drafts persist locally and exact replays return identical receipts',{drafts:3});
  const assignment={action:'assign_stop',requestId:ids.assignment,customerId:'local-customer-13',planId:plan2,position:6,notes:'Local Mark UI acceptance: reviewed yard cleanup assignment for technician acceptance.'};
  const assigned=await replay(assignment);assert.equal(assigned.id,ids.assignment);assert.match(assigned.message,/technician review|acceptance/i);
  const afterAssignment=await ops(),pendingAssignment=afterAssignment.office.changes.filter(change=>change.kind==='add_visit'&&change.payload?.localCustomerId==='local-customer-13');assert.equal(pendingAssignment.length,1);assert.equal(pendingAssignment[0].status,'pending');assert.equal(pendingAssignment[0].shift_id,day2Before.id);assert.equal(pendingAssignment[0].payload.stop.tasks.length,1);assert.equal(pendingAssignment[0].payload.stop.tasks[0].serviceId,'scoop');assert.equal(pendingAssignment[0].payload.stop.safety,'unknown');
  const duplicate=await write(admin,'/api/local-preview/crm-view/',{body:{...assignment,requestId:ids.duplicateAssignment}});assert.equal(duplicate.status,409);
  assert.deepEqual(afterAssignment.office.days.find(day=>day.planId===plan2),day2Before);assert.deepEqual(afterAssignment.stops,before.stops);
  passed('One yard-only assignment is pending explicit technician review, replay is idempotent and a new duplicate is rejected');report.fixtureChanges.push({kind:'pending_yard_assignment',id:assigned.id,customerId:'local-customer-13',planId:plan2});
  const fresh=await ops(),day=fresh.office.days.find(day=>day.planId===plan1),accounted=task=>['completed','skipped','cancelled'].includes(task.status),locked=day.stops.map((stop,index)=>({stop,index})).filter(({stop})=>stop.arrivedAt||stop.tasks.some(accounted));assert.equal(day.stops.length,6);assert.ok(locked.some(({index})=>index===0));assert.ok(locked.some(({index})=>index===1));assert.ok(locked.every(({index})=>index<2),'Only the first two fixture stops may be progressed in this bounded check.');
  const stopIds=[day.stops[0].id,day.stops[1].id,...day.stops.slice(2).reverse().map(stop=>stop.id)],reason=`Local Mark UI acceptance ${ids.reorder}: reviewed remaining stops only.`,pendingReorders=fresh.office.changes.filter(change=>change.kind==='reorder'&&change.shift_id===day.id&&change.status==='pending');
  if(pendingReorders.length){assert.equal(pendingReorders.length,1);assert.equal(pendingReorders[0].payload.reason,reason,'Do not queue another reorder while an unrelated proposal awaits review.');assert.deepEqual(pendingReorders[0].payload.stopIds,stopIds);}else{const saved=await write(admin,'/api/admin/field-workdays/',{body:{action:'reorder',shiftId:day.id,stopIds,notes:reason}});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.ok,true);report.fixtureChanges.push({kind:'pending_reorder',id:saved.body.id,planId:plan1,lockedPositions:[1,2]});}
  const after=await ops(),proposal=after.office.changes.filter(change=>change.kind==='reorder'&&change.shift_id===day.id&&change.status==='pending');assert.equal(proposal.length,1);assert.deepEqual(proposal[0].payload.stopIds,stopIds);assert.deepEqual(after.office.days.find(item=>item.planId===plan1),day1Before);assert.deepEqual(after.office.days.find(item=>item.planId===plan2),day2Before);assert.deepEqual(after.stops,before.stops);assert.deepEqual(after.tasks,before.tasks);
  passed('One native reorder proposal preserves arrived/accounted positions and leaves both released field sequences unchanged',{lockedPositions:[1,2],remainingOrder:[6,5,4,3]});
  const billingAfter=await billing();assert.deepEqual(billingAfter,billingBefore);assert.deepEqual(after.office.messages,before.office.messages);report.healthAfter=await healthGuard();assert.deepEqual(report.healthAfter.counts,report.healthBefore.counts);report.fieldDayDigests={route1Before:digest(day1Before),route1After:digest(after.office.days.find(day=>day.planId===plan1)),route2Before:digest(day2Before),route2After:digest(after.office.days.find(day=>day.planId===plan2))};
  passed('Billing, payments, field day states, clocks, source route sequences and outbound message receipts remain unchanged');
}catch(error){report.errors.push({message:error.message,stack:error.stack});process.exitCode=1;}
report.finishedAt=new Date().toISOString();report.summary={pages:report.pages.length,pagePasses:report.pages.filter(page=>page.passed).length,checksPassed:report.checks.length,errors:report.errors.length};report.requests={admin:admin.requests,anonymous:anonymous.requests,technician:technician.requests};flush();
console.log(JSON.stringify({reportPath:REPORT,...report.summary,checks:report.checks,fixtureChanges:report.fixtureChanges,errors:report.errors},null,2));
