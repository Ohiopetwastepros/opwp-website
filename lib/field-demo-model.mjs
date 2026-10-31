// This reducer is shared by the phone and the isolated test backend. No live IDs.
import { createDemoDay as legacyDay, applyDemoEvent as legacyEvent } from './field-demo-legacy.mjs';
import { jobTimer } from './field-timer.mjs';
export const DEMO_VERSION = 2, DEMO_MAX_EVENTS = 1500;
export const ETA_OPTIONS = [10,15,25,30,45,60];
export const PRECHECKS = [['tools','Scooper, rake and bucket'],['bags','Enough waste bags for today'],['sprayer','Pump sprayer filled with equipment sanitizer'],['ppe','Gloves, hand sanitizer and drinking water'],['truck','Truck checked; load secured'],['food','Today’s food loaded and checked by bag color']];
export const WRAPCHECKS = [['waste','Waste disposed of correctly'],['clean','Tools sanitized; sprayer ready'],['restock','Bags and scooping supplies restocked'],['truck','Truck checked, clean and secured'],['food','Tomorrow’s food loaded by bag color']];
export const done = task => ['completed','skipped'].includes(task.status);
export class DemoError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const requireValue=(condition,message)=>{if(!condition)throw new DemoError(message);};
const note=value=>String(value||'').slice(0,2000);
const iso=ms=>new Date(ms).toISOString();
export const fourDigits=value=>String(Number(value||0)%10000).padStart(4,'0');
const odometer=value=>{requireValue(/^\d{1,4}$/.test(String(value??'')),'Enter only the last four odometer digits.');return Number(value);};
const task=(id,type,title,minutes)=>({id,type,title,estimatedMinutes:minutes,status:'pending',startedAt:null,completedAt:null,notes:'',photos:[],photoKinds:{}});
export function upgradeDemoDay(original){
  const day=structuredClone(original);
  if(day.schema===2)return day;
  day.schema=2;day.alerts=[];day.officeChanges=[];day.photoKinds={};
  day.shift.prechecks=day.shift.departedAt?Object.fromEntries(PRECHECKS.map(([id])=>[id,true])):{};
  day.shift.wrapchecks={};day.shift.wrapStartedAt=null;day.shift.wrapMinutes=10;
  const offset=Math.floor((day.shift.startMileage||0)/10000)*10000;
  for(const key of ['startMileage','endMileage'])if(day.shift[key]!=null)day.shift[key]-=offset;
  for(const b of day.shift.breaks)for(const key of ['startMileage','endMileage'])if(b[key]!=null)b[key]-=offset;
  day.inventory.color='Pink';day.inventory.image='/field-demo/pink-bag.webp';
  day.tomorrow={date:new Date(Date.parse(`${day.date}T12:00:00Z`)+86400000).toISOString().slice(0,10),stops:[{id:'tomorrow-elm',name:'The Elm family',address:'8 Demo Elm Lane',services:'Yard cleanup + food delivery',food:{color:'Green',quantity:2,image:'/field-demo/green-bag.webp'},placement:'Covered front porch, to the left of the door.'},{id:'tomorrow-birch',name:'The Birch family',address:'14 Demo Birch Court',services:'Food delivery',food:{color:'Blue',quantity:1,image:'/field-demo/blue-bag.webp'},placement:'Beside the garage pedestrian door.'}],loaded:{}};
  for(const [i,s] of day.stops.entries()){
    s.hasGate=s.id!=='demo-maple';s.garbage=i===0?'Gray bin beside the garage':i===2?'Black bin at the driveway fence':'Waste station near the entrance';
    s.placement='Covered side door, away from the door swing.';s.referencePhoto='/field-demo/placement.svg';
    s.travel={miles:[2.1,1.4,2.8,3.2][i]??2,minutes:[6,4,7,8][i]??5,source:'Fictional test estimate'};
    for(const t of s.tasks){t.photoKinds??={};if(t.type==='food'){t.title='Pink bag · 1 bag';t.hint='Place at the covered side door. Take a delivery photo.';t.color='Pink';t.image='/field-demo/pink-bag.webp';}}
  }
  return day;
}
export function createDemoDay(now=Date.now()){
  const day=upgradeDemoDay(legacyDay(now));
  day.stops[2].tasks.splice(1,0,task('demo-sanitize','sanitize','Yard sanitization',5),task('demo-deodorize','deodorize','Yard deodorization',4),task('demo-haul','haul','Waste haul-away',0));
  day.stops[3].tasks.push(task('demo-litter','litter','Litter box service',6));
  return day;
}
export function mileageCheck(day,value,now=Date.now()){
  const last=day.shift.breaks.at(-1),previous=last?.endMileage??last?.startMileage??day.shift.startMileage??0;
  const digits=odometer(value),delta=(digits-previous%10000+10000)%10000;
  const at=last?.endedAt||last?.startedAt||day.shift.clockIn;
  const minutes=Math.max(0,(now-Date.parse(at||iso(now)))/60000),limit=Math.min(100,Math.max(15,minutes*1.5+5));
  return {previous,delta,value:previous+delta,suspicious:delta>limit,invalid:delta>500};
}
export function demoGaps(day,now=Date.now()){
  return day.stops.filter(s=>s.arrivedAt).map(s=>{
    const arrived=Date.parse(s.arrivedAt),prior=day.stops.filter(p=>p.id!==s.id&&p.completedAt&&Date.parse(p.completedAt)<=arrived).sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt))[0];
    const start=Date.parse(prior?.completedAt||day.shift.departedAt),raw=Math.max(0,(arrived-start)/60000);
    const breaks=day.shift.breaks.reduce((sum,b)=>sum+Math.max(0,(Math.min(arrived,Date.parse(b.endedAt||iso(now)))-Math.max(start,Date.parse(b.startedAt)))/60000),0);
    const actual=Math.max(0,raw-breaks),expected=s.travel?.minutes??null;
    return {id:s.id,name:s.name,from:prior?.name||'Departure',actual,breaks,expected,miles:s.travel?.miles??null,variance:expected==null?null:actual-expected,flagged:expected!=null&&(actual>expected+5||expected>=3&&actual<expected*.4)};
  });
}
export function demoSummary(day,now=Date.now()){
  const tasks=day.stops.flatMap(s=>s.tasks),end=Date.parse(day.shift.clockOut||iso(now));
  const shiftSeconds=day.shift.clockIn?Math.max(0,(end-Date.parse(day.shift.clockIn))/1000):0;
  const unpaidSeconds=day.shift.breaks.filter(b=>b.type==='unpaid').reduce((n,b)=>n+Math.max(0,(Date.parse(b.endedAt||iso(end))-Date.parse(b.startedAt))/1000),0);
  return {total:tasks.length,finished:tasks.filter(done).length,completed:tasks.filter(t=>t.status==='completed').length,skipped:tasks.filter(t=>t.status==='skipped').length,photos:tasks.reduce((n,t)=>n+t.photos.length,0),paidSeconds:Math.max(0,shiftSeconds-unpaidSeconds),unpaidSeconds,serviceSeconds:tasks.filter(t=>t.type!=='haul').reduce((n,t)=>n+jobTimer(t.startedAt,t.completedAt,t.estimatedMinutes,now).elapsedSeconds,0),miles:day.shift.endMileage==null?null:day.shift.endMileage-day.shift.startMileage-day.shift.breaks.filter(b=>b.type==='unpaid').reduce((n,b)=>n+Math.max(0,(b.endMileage??b.startMileage)-b.startMileage),0)};
}
export function applyDemoEvent(original,event,{now=Date.now()}={}){
  // Old offline queues keep the exact rules they were recorded with. The first v2
  // action upgrades the saved day without deleting timestamps, notes or proof.
  if(original?.schema===1&&event?.version!==2){try{return legacyEvent(original,event,{now});}catch(e){throw new DemoError(e.message,e.status);}}
  requireValue([1,2].includes(original?.schema),'This saved day needs an updated app.');
  requireValue(event&&/^[a-f\d-]{36}$/i.test(event.id||''),'Invalid action identifier.');
  requireValue(event.sequence===original.revision+1&&event.sequence<=DEMO_MAX_EVENTS,'This action is out of order. Keep this tab open and retry sync.');
  const recorded=Date.parse(event.recordedAt);
  requireValue(Number.isFinite(recorded)&&recorded<=now+120000&&recorded>=Date.parse(original.lastEventAt)&&recorded>=Date.parse(original.createdAt),'The device clock changed. Correct the clock before continuing; saved work is retained.');
  const day=upgradeDemoDay(original),shift=day.shift,body=event.body||{},tasks=day.stops.flatMap(s=>s.tasks),t=tasks.find(t=>t.id===body.taskId),stop=day.stops.find(s=>s.id===body.stopId||s.tasks.some(t=>t.id===body.taskId)),active=tasks.find(t=>t.status==='working');
  const mileage=()=>{const check=mileageCheck(day,body.mileage,recorded);requireValue(!check.invalid,'This reading looks backwards or more than 500 miles away. Recheck the last four digits.');requireValue(!check.suspicious||String(body.confirmMileage)===fourDigits(body.mileage),`Mileage needs reconfirmation: ${check.delta} miles since ${fourDigits(check.previous)}. Re-enter the same four digits after checking the vehicle.`);if(check.suspicious)day.alerts.push({id:event.id,type:'mileage',at:event.recordedAt,text:`Reconfirmed ${check.delta} miles since previous reading.`,resolved:false});return check.value;};
  requireValue(shift.status!=='finished'||event.type==='resolve_alert','This demo day is already closed. Start a fresh demo to practice again.');
  const special=['clock_in','confirm_load','check_item','load_tomorrow','start_route','end_break','finish_day','office_add','resolve_alert'];
  if(!special.includes(event.type))requireValue(shift.status==='on_route'&&!shift.activeBreak,'Start the route and end any break before recording work.');
  switch(event.type){
    case 'clock_in': requireValue(!shift.clockIn&&shift.status==='ready','This shift is already clocked in.');requireValue(['company','personal'].includes(body.vehicle),'Choose a vehicle.');Object.assign(shift,{clockIn:event.recordedAt,startMileage:odometer(body.mileage),vehicle:body.vehicle,notes:note(body.notes),status:'loading'});break;
    case 'check_item': {const list=shift.status==='loading'?PRECHECKS:shift.status==='wrapping'?WRAPCHECKS:null;requireValue(list?.some(([id])=>id===body.key)&&typeof body.checked==='boolean','This checklist is not available now.');if(shift.status==='wrapping'&&body.key==='food'&&body.checked)requireValue(day.tomorrow.stops.every(s=>!s.food||day.tomorrow.loaded[s.id]),'Confirm each tomorrow delivery is loaded first.');shift[shift.status==='loading'?'prechecks':'wrapchecks'][body.key]=body.checked;break;}
    case 'confirm_load': requireValue(shift.status==='loading','Clock in before loading.');requireValue(PRECHECKS.every(([id])=>shift.prechecks[id]),'Finish every departure precheck first.');requireValue(Number.isInteger(body.quantity)&&body.quantity>=day.inventory.required&&body.quantity<=10,'Load the scheduled bag before departure.');day.inventory.loaded=body.quantity;shift.status='loaded';break;
    case 'load_tomorrow': requireValue(shift.status==='wrapping','Start wrap-up before loading tomorrow’s truck.');requireValue(day.tomorrow.stops.some(s=>s.id===body.stopId)&&typeof body.checked==='boolean','Choose a tomorrow delivery.');day.tomorrow.loaded[body.stopId]=body.checked;if(!body.checked)shift.wrapchecks.food=false;break;
    case 'start_route': requireValue(shift.status==='loaded','Finish the departure check first.');shift.status='on_route';shift.departedAt=event.recordedAt;break;
    case 'on_way': requireValue(stop&&['pending','on_way'].includes(stop.status)&&!active,'Finish the current job before selecting the next stop.');requireValue(ETA_OPTIONS.includes(body.minutes),'Choose an arrival time frame.');requireValue(['success','failure','no_receipt'].includes(body.scenario),'Choose a demo notification outcome.');stop.status='on_way';day.notifications.push({id:event.id,stopId:stop.id,type:'on_way',minutes:body.minutes,scenario:body.scenario,at:event.recordedAt,simulated:true});break;
    case 'arrive': requireValue(stop&&['pending','on_way'].includes(stop.status)&&!active,'This stop cannot be started now.');stop.status='arrived';stop.arrivedAt=event.recordedAt;break;
    case 'start_task': requireValue(t&&!done(t)&&t.status!=='working'&&!active&&stop.status==='arrived','Arrive at this stop and finish the active job first.');requireValue(t.type==='food'||t.type==='haul'||body.safe===true,'Confirm safe access before starting.');t.status='working';t.startedAt=t.type==='haul'?null:event.recordedAt;break;
    case 'save_note': requireValue(t&&!done(t),'Choose an unfinished job.');t.notes=note(body.notes);break;
    case 'add_photo': {requireValue(t&&!done(t)&&/^[a-f\d-]{36}$/i.test(body.photoId||''),'Choose an unfinished job for the photo.');const count=stop.tasks.reduce((n,t)=>n+t.photos.length,0);requireValue(count<3&&tasks.reduce((n,t)=>n+t.photos.length,0)<24,'Maximum three photos per stop and 24 per demo day.');requireValue(['gate','observation','delivery'].includes(body.kind),'Choose what this photo shows.');requireValue(body.kind!=='delivery'||t.type==='food','Delivery proof belongs to the food delivery job.');const kinds=stop.tasks.flatMap(t=>t.photos.map(id=>t.photoKinds[id])).concat(body.kind);const needed=Number(stop.hasGate&&stop.tasks.some(t=>!done(t)&&!['food','haul'].includes(t.type))&&!kinds.includes('gate'))+Number(stop.tasks.some(t=>!done(t)&&t.type==='food')&&!kinds.includes('delivery'));requireValue(3-count-1>=needed,'Keep a photo slot for the required gate or delivery proof.');requireValue(!tasks.some(t=>t.photos.includes(body.photoId)),'This photo is already recorded.');t.photos.push(body.photoId);t.photoKinds[body.photoId]=body.kind;break;}
    case 'complete_task': requireValue(t?.status==='working','Start this job before completing it.');requireValue(body.secured===true,t.type==='food'?'Confirm the bag is in the requested place.':'Confirm the gate and property are secure.');requireValue(t.type!=='food'||t.photos.some(id=>t.photoKinds[id]==='delivery'),'Add a delivery photo first.');requireValue(['food','haul'].includes(t.type)||!stop.hasGate||stop.tasks.some(t=>t.photos.some(id=>t.photoKinds[id]==='gate')),'Add a photo showing the gate latched shut.');t.status='completed';t.completedAt=event.recordedAt;t.notes=note(body.notes);if(t.type==='food')day.inventory.delivered++;if(t.type==='food'||stop.tasks.filter(item=>item.type!=='food').every(done))day.notifications.push({id:event.id,stopId:stop.id,type:'completion',scenario:'success',at:event.recordedAt,simulated:true,photoIds:t.type==='food'?t.photos.filter(id=>t.photoKinds[id]==='delivery'):[]});break;
    case 'skip_task': requireValue(t&&!done(t)&&(!active||active.id===t.id),'Finish the active job before recording another exception.');requireValue(body.confirm===true,'Confirm this job should be skipped.');requireValue(['Locked gate','Unsafe dog','Weather','Customer request','Other'].includes(body.reason),'Choose a skip reason.');requireValue(body.reason!=='Other'||note(body.notes).trim(),'Add a note explaining this exception.');Object.assign(t,{status:'skipped',reason:body.reason,notes:note(body.notes),completedAt:event.recordedAt});day.alerts.push({id:event.id,type:'skip',stopId:stop.id,at:event.recordedAt,text:`${stop.name}: ${t.title} skipped — ${body.reason}`,resolved:false});break;
    case 'start_break': requireValue(!active&&!shift.activeBreak&&['paid','unpaid'].includes(body.breakType),'Finish the active job and choose a break type.');shift.breaks.push({id:event.id,type:body.breakType,startedAt:event.recordedAt,endedAt:null,startMileage:mileage(),endMileage:null});shift.activeBreak=event.id;break;
    case 'end_break': {requireValue(shift.status==='on_route'&&shift.activeBreak,'There is no active break.');const b=shift.breaks.find(b=>b.id===shift.activeBreak);b.endMileage=mileage();b.endedAt=event.recordedAt;shift.activeBreak=null;break;}
    case 'start_wrap': requireValue(tasks.every(done)&&!active,'Complete or skip every job before wrap-up.');shift.status='wrapping';shift.wrapStartedAt=event.recordedAt;break;
    case 'finish_day': requireValue(shift.status==='wrapping'&&tasks.every(done)&&!shift.activeBreak,'Start wrap-up after every job and break is finished.');requireValue(WRAPCHECKS.every(([id])=>shift.wrapchecks[id]),'Finish every wrap-up check before closing your shift.');shift.endMileage=mileage();for(const name of ['returned','damaged','missing'])requireValue(Number.isInteger(body[name])&&body[name]>=0&&body[name]<=day.inventory.loaded,'Account for every remaining bag.');requireValue(body.returned+body.damaged+body.missing===day.inventory.loaded-day.inventory.delivered,'Returned, damaged and missing bags must match the remaining inventory.');Object.assign(day.inventory,{returned:body.returned,damaged:body.damaged,missing:body.missing});Object.assign(shift,{status:'finished',clockOut:event.recordedAt,endNotes:note(body.notes)});break;
    case 'office_add': {requireValue(['ready','loading','loaded','on_route'].includes(shift.status)&&day.stops.length<8,'Stops can only be added before wrap-up; this demo supports eight stops.');requireValue(['new','reclean'].includes(body.kind)&&note(body.notes).trim(),'Choose a stop type and enter the office instructions.');const source=body.kind==='reclean'?day.stops.find(s=>s.id===body.sourceId):null;requireValue(body.kind!=='reclean'||source,'Choose the account that needs a reclean.');const id=`demo-extra-${event.id}`;const added=source?structuredClone(source):{name:'The Cedar family',address:'62 Demo Cedar Way',area:'Fictional added stop',gate:'Left side gate',gateCode:'',dogs:'Dog stays indoors',safety:'Check before entering',hasGate:true,garbage:'Gray bin by garage',instructions:'New office request',placement:'Front porch'};Object.assign(added,{id,status:'pending',arrivedAt:null,completedAt:null,instructions:note(body.notes),travel:{miles:2.2,minutes:6,source:'Fictional test estimate'},reclean:body.kind==='reclean',tasks:[task(`${id}-job`,'scoop',body.kind==='reclean'?'Reclean · return visit':'Added yard cleanup',10)]});day.stops.push(added);day.officeChanges.push({id:event.id,at:event.recordedAt,stopId:id,kind:body.kind,notes:note(body.notes)});break;}
    case 'resolve_alert': {requireValue(note(body.notes).trim(),'Record the office follow-up before resolving.');const alert=day.alerts.find(a=>a.id===body.alertId)||day.notifications.find(n=>n.id===body.alertId);requireValue(alert,'Choose an existing office report.');alert.resolved=true;alert.followUp=note(body.notes);alert.resolvedAt=event.recordedAt;break;}
    default: throw new DemoError('Unknown demo action.');
  }
  if(stop&&stop.status!=='finished'&&stop.tasks.every(done)){stop.status='finished';stop.completedAt=event.recordedAt;}
  day.revision=event.sequence;day.lastEventAt=event.recordedAt;return day;
}
