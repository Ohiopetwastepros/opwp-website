// Fictional training data only. No production identifiers or provider calls.
import { jobTimer } from './field-timer.mjs';
export const DEMO_VERSION = 1;
export const DEMO_MAX_EVENTS = 1500;
export const done = task => ['completed', 'skipped'].includes(task.status);
export class DemoError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const requireValue = (condition, message) => { if (!condition) throw new DemoError(message); };
const iso = ms => new Date(ms).toISOString();
const note = value => String(value || '').slice(0, 2000);
const odometer = value => { requireValue(value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 9999999, 'Enter a valid full odometer reading.'); return Number(value); };
export function createDemoDay(now = Date.now()) {
  const task = (id, minutes, extras = {}) => ({ id, type: 'scoop', title: 'Weekly yard cleanup', estimatedMinutes: minutes, status: 'pending', startedAt: null, completedAt: null, notes: '', photos: [], ...extras });
  return {
    schema: DEMO_VERSION, revision: 0, createdAt: iso(now), lastEventAt: iso(now), technician: 'Demo technician', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now),
    shift: { status: 'ready', clockIn: null, clockOut: null, startMileage: null, endMileage: null, vehicle: 'company', breaks: [], activeBreak: null, notes: '' },
    inventory: { required: 1, loaded: 0, delivered: 0, returned: 0, damaged: 0, missing: 0 },
    notifications: [],
    stops: [
      { id: 'demo-meadow', name: 'The Meadow family', address: '12 Demo Meadow Lane', area: 'Practice neighborhood · fictional address', status: 'pending', gate: 'Left side gate · latch lifts up', gateCode: '2468 (demo)', dogs: 'Bailey & Scout · 2 dogs', safety: 'Dogs stay inside during service. Check before entry.', instructions: 'Back yard and side run. Close the latch firmly.', tasks: [task('demo-quick', 1, { title: 'Quick timer test · yard cleanup', hint: 'One-minute allowance so you can see the timer turn red.' })] },
      { id: 'demo-willow', name: 'The Willow family', address: '28 Demo Willow Court', area: 'Practice neighborhood · fictional address', status: 'pending', gate: 'Right side gate', gateCode: '', dogs: 'Milo · 1 dog', safety: 'Dog may be loose. Do not enter unless it is safe.', instructions: 'Use this stop to try an unsafe-dog or locked-gate exception.', tasks: [task('demo-safety', 12)] },
      { id: 'demo-maple', name: 'The Maple family', address: '36 Demo Maple Drive', area: 'Practice neighborhood · fictional address', status: 'pending', gate: 'Open side access · no gate', gateCode: '', dogs: 'Ruby · 1 dog', safety: 'Check for the dog before entering.', instructions: 'Service both grass areas. Food goes by the covered side door.', tasks: [task('demo-combined', 10), task('demo-food', 4, { type: 'food', title: 'Extreme Dog Fuel · 1 bag', hint: '22/12 formula · 40 lb. Photo and placement confirmation required.' })] },
      { id: 'demo-oak', name: 'Oak Grove dog park', address: '50 Demo Oak Loop', area: 'Practice neighborhood · fictional address', status: 'pending', gate: 'Pedestrian entrance', gateCode: '1357 (demo)', dogs: 'Shared dog area', safety: 'Wait until the work area is clear.', instructions: 'Check the full fence line and waste station. Leave a note for the office.', tasks: [task('demo-park', 15, { title: 'Shared dog area cleanup' })] },
    ],
  };
}
export function demoSummary(day, now = Date.now()) {
  const tasks = day.stops.flatMap(s => s.tasks);
  const end = day.shift.clockOut ? Date.parse(day.shift.clockOut) : now;
  const shiftSeconds = day.shift.clockIn ? Math.max(0, (end - Date.parse(day.shift.clockIn)) / 1000) : 0;
  const unpaidSeconds = day.shift.breaks.filter(b => b.type === 'unpaid').reduce((sum, b) => sum + Math.max(0, ((b.endedAt ? Date.parse(b.endedAt) : end) - Date.parse(b.startedAt)) / 1000), 0);
  return { total: tasks.length, finished: tasks.filter(done).length, completed: tasks.filter(t => t.status === 'completed').length, skipped: tasks.filter(t => t.status === 'skipped').length, photos: tasks.reduce((sum,t) => sum + t.photos.length,0), paidSeconds: Math.max(0, shiftSeconds - unpaidSeconds), unpaidSeconds, serviceSeconds: tasks.reduce((sum,t) => sum + jobTimer(t.startedAt,t.completedAt,t.estimatedMinutes,now).elapsedSeconds,0), miles: day.shift.endMileage == null ? null : Math.round((day.shift.endMileage - day.shift.startMileage - day.shift.breaks.filter(b=>b.type==='unpaid').reduce((sum,b)=>sum+Math.max(0,(b.endMileage??b.startMileage)-b.startMileage),0))*100)/100 };
}
export function applyDemoEvent(original, event, { now = Date.now() } = {}) {
  requireValue(original?.schema === DEMO_VERSION, 'This demo needs an updated app. Your saved data is still on this phone.');
  requireValue(event && /^[a-f\d-]{36}$/i.test(event.id || ''), 'Invalid action identifier.');
  requireValue(event.sequence === original.revision + 1 && event.sequence <= DEMO_MAX_EVENTS, 'This action is out of order. Keep this tab open and retry sync.');
  const recorded = Date.parse(event.recordedAt);
  requireValue(Number.isFinite(recorded) && recorded <= now + 120000 && recorded >= Date.parse(original.lastEventAt) && recorded >= Date.parse(original.createdAt), 'The device clock changed. Correct the clock before continuing; saved work is retained.');
  const day = structuredClone(original), shift = day.shift, body = event.body || {};
  const tasks = day.stops.flatMap(s => s.tasks), task = tasks.find(t => t.id === body.taskId), stop = day.stops.find(s => s.id === body.stopId || s.tasks.some(t => t.id === body.taskId));
  const active = tasks.find(t => t.status === 'working');
  const mileage = () => { const value = odometer(body.mileage); const floor = Math.max(shift.startMileage || 0, ...shift.breaks.map(b => b.endMileage ?? b.startMileage)); requireValue(value >= floor, 'The odometer cannot go backwards.'); return value; };
  requireValue(shift.status !== 'finished', 'This demo day is already closed. Start a fresh demo to practice again.');
  if (!['clock_in','confirm_load','start_route','end_break'].includes(event.type)) requireValue(shift.status === 'on_route' && !shift.activeBreak, 'Start the route and end any break before recording work.');
  switch (event.type) {
    case 'clock_in': requireValue(!shift.clockIn && shift.status === 'ready', 'This shift is already clocked in.'); requireValue(['company','personal'].includes(body.vehicle), 'Choose a vehicle.'); shift.clockIn = event.recordedAt; shift.startMileage = odometer(body.mileage); shift.vehicle = body.vehicle; shift.notes = note(body.notes); shift.status = 'loading'; break;
    case 'confirm_load': requireValue(shift.status === 'loading', 'Clock in before loading.'); requireValue(Number.isInteger(body.quantity) && body.quantity >= day.inventory.required && body.quantity <= 10, 'Load the scheduled bag before departure.'); day.inventory.loaded = body.quantity; shift.status = 'loaded'; break;
    case 'start_route': requireValue(shift.status === 'loaded', 'Finish the departure check first.'); shift.status = 'on_route'; shift.departedAt = event.recordedAt; break;
    case 'on_way': requireValue(stop && stop.status === 'pending' && !active, 'Finish the current job before selecting the next stop.'); stop.status = 'on_way'; day.notifications.push({ id:event.id, stopId:stop.id, type:'on_way', at:event.recordedAt, simulated:true }); break;
    case 'arrive': requireValue(stop && ['pending','on_way'].includes(stop.status) && !active, 'This stop cannot be started now.'); stop.status = 'arrived'; stop.arrivedAt = event.recordedAt; break;
    case 'start_task': requireValue(task && !done(task) && task.status !== 'working' && !active && stop.status === 'arrived', 'Arrive at this stop and finish the active job first.'); requireValue(body.safe === true, 'Confirm safe access before starting.'); task.status = 'working'; task.startedAt = event.recordedAt; break;
    case 'save_note': requireValue(task && !done(task), 'Choose an unfinished job.'); task.notes = note(body.notes); break;
    case 'add_photo': requireValue(task && !done(task) && /^[a-f\d-]{36}$/i.test(body.photoId || ''), 'Choose an unfinished job for the photo.'); requireValue(task.photos.length < 4 && tasks.reduce((n,t)=>n+t.photos.length,0) < 12, 'This demo allows four photos per job and twelve per day.'); requireValue(!tasks.some(t=>t.photos.includes(body.photoId)), 'This photo is already recorded.'); task.photos.push(body.photoId); break;
    case 'complete_task': requireValue(task?.status === 'working', 'Start this job before completing it.'); requireValue(body.secured === true, task.type === 'food' ? 'Confirm the bag is in the requested place.' : 'Confirm the gate and property are secure.'); requireValue(task.type !== 'food' || task.photos.length > 0, 'Add a delivery photo first.'); task.status = 'completed'; task.completedAt = event.recordedAt; task.notes = note(body.notes); if(task.type === 'food') day.inventory.delivered += 1; day.notifications.push({ id:event.id,stopId:stop.id,type:'completion',at:event.recordedAt,simulated:true }); break;
    case 'skip_task': requireValue(task && !done(task) && (!active || active.id === task.id), 'Finish the active job before recording another exception.'); requireValue(['Locked gate','Unsafe dog','Weather','Customer request','Other'].includes(body.reason), 'Choose an exception reason.'); requireValue(body.reason !== 'Other' || note(body.notes).trim().length > 0, 'Add a note explaining this exception.'); task.status = 'skipped'; task.reason = body.reason; task.notes = note(body.notes); task.completedAt = event.recordedAt; break;
    case 'start_break': requireValue(!active && !shift.activeBreak && ['paid','unpaid'].includes(body.breakType), 'Finish the active job and choose a break type.'); shift.activeBreak = event.id; shift.breaks.push({ id:event.id,type:body.breakType,startedAt:event.recordedAt,endedAt:null,startMileage:mileage(),endMileage:null }); break;
    case 'end_break': { requireValue(shift.status === 'on_route' && shift.activeBreak, 'There is no active break.'); const current=shift.breaks.find(b=>b.id===shift.activeBreak); current.endMileage=mileage(); current.endedAt=event.recordedAt; shift.activeBreak=null; break; }
    case 'finish_day': requireValue(tasks.every(done) && !shift.activeBreak, 'Complete or skip every job and end the break before clocking out.'); shift.endMileage=mileage(); for(const name of ['returned','damaged','missing']) requireValue(Number.isInteger(body[name]) && body[name]>=0 && body[name]<=day.inventory.loaded, 'Account for every remaining bag.'); requireValue(body.returned+body.damaged+body.missing === day.inventory.loaded-day.inventory.delivered, 'Returned, damaged and missing bags must match the remaining inventory.'); Object.assign(day.inventory,{returned:body.returned,damaged:body.damaged,missing:body.missing}); shift.status='finished';shift.clockOut=event.recordedAt;shift.endNotes=note(body.notes);break;
    default: throw new DemoError('Unknown demo action.');
  }
  if(stop && stop.tasks.every(done)) { stop.status='finished';stop.completedAt=event.recordedAt; }
  day.revision=event.sequence;day.lastEventAt=event.recordedAt;
  return day;
}
