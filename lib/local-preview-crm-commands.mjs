// Fabricated loopback workspace only. The route boundary checks the environment,
// administrator session, request origin, body size and rate before calling here.
import { FieldError } from './field-policy.mjs';
import { SERVICE_DEFAULTS, serviceTask } from './field-service-catalog.mjs';
import { officeWorkdayCommand } from './field-workday-office.mjs';

const fail = (condition, message, status = 400) => { if (!condition) throw new FieldError(message, status); };
const text = (value, limit = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const keyFor = id => `local-preview:crm-command:${id}`;
export async function localCrmCommand(db, actor, body, date) {
  fail(body && typeof body === 'object' && !Array.isArray(body), 'Choose a local workspace action.');
  fail(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || ''), 'Provide a new request identifier.');
  fail(['assign_stop', 'save_message_draft'].includes(body.action), 'Choose a supported local workspace action.');
  const input = JSON.stringify(body), receiptKey = keyFor(body.requestId);
  const prior = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(receiptKey).first();
  if (prior) {
    const receipt = JSON.parse(prior.payload);
    fail(receipt.actor === actor && receipt.input === input, 'This request identifier was already used for another action.', 409);
    return receipt.result;
  }
  fail(/^local-customer-\d{2}$/.test(body.customerId || ''), 'Choose a fabricated local customer.');
  const row = await db.prepare('SELECT profile_json FROM local_preview_customers WHERE id=?').bind(body.customerId).first();
  fail(row, 'Local customer was not found.', 404);
  const customer = JSON.parse(row.profile_json);
  const now = new Date().toISOString();
  let result, statements = [];
  if (body.action === 'save_message_draft') {
    fail(['customer', 'team'].includes(body.audience) && ['message', 'eta'].includes(body.kind), 'Choose the message audience and kind.');
    fail(text(body.text), 'Write a message of 2,000 characters or fewer.');
    fail(!body.planId || /^local-field-plan-[12]-\d{4}-\d{2}-\d{2}$/.test(body.planId), 'Choose a local route.');
    if (body.planId) {
      const plan = await db.prepare('SELECT id FROM route_partner_route_plans WHERE id=? AND organization_id=? AND service_date=?').bind(body.planId, 'org-opwp', date).first();
      fail(plan, 'Choose a local route for today.');
    }
    if (body.stopId) {
      const stop = await db.prepare('SELECT id FROM route_partner_locations WHERE id=? AND route_plan_id=? AND organization_id=? AND location_key=?').bind(body.stopId, body.planId || '', 'org-opwp', customer.id).first();
      fail(stop, 'The stop does not belong to this customer and route.');
    }
    const draft = { id: body.requestId, audience: body.audience, kind: body.kind, customerId: customer.id, planId: body.planId || null, stopId: body.stopId || null, text: body.text.trim(), createdAt: now, status: 'draft' };
    statements.push(db.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)").bind(`local-preview:message:${draft.id}`, JSON.stringify(draft), now));
    result = { ok: true, draft, message: 'Draft saved in the local workspace. No message was sent.' };
  } else {
    fail(/^local-field-plan-[12]-\d{4}-\d{2}-\d{2}$/.test(body.planId || ''), 'Choose a fabricated local route.');
    fail(Number.isInteger(body.position) && body.position >= 0 && body.position < 60, 'Choose a valid proposed route position.');
    fail(text(body.notes), 'Explain the assignment in 2,000 characters or fewer.');
    fail(!['paused', 'cancelled'].includes(customer.scenario), 'Resume or create an active service agreement before assigning this customer.');
    fail(!customer.foodDelivery, 'Food assignments use the existing verified order and inventory workflow.');
    const existing = await db.prepare('SELECT l.id FROM route_partner_locations l JOIN route_partner_route_plans p ON p.id=l.route_plan_id WHERE p.organization_id=? AND p.service_date=? AND l.location_key=? LIMIT 1').bind('org-opwp', date, customer.id).first();
    fail(!existing, 'This customer already has a stop today.', 409);
    const pending = await db.prepare("SELECT c.id FROM field_dispatch_changes c JOIN route_partner_field_shifts s ON s.id=c.shift_id WHERE c.organization_id=? AND s.service_date=? AND c.kind='add_visit' AND c.status IN ('pending','accepted') AND json_extract(c.payload,'$.localCustomerId')=? LIMIT 1").bind('org-opwp', date, customer.id).first();
    fail(!pending, 'An assignment for this customer is already pending or accepted today.', 409);
    const assignmentKey=`local-preview:assignment:${date}:${customer.id}`;
    const previousAssignment=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(assignmentKey).first();
    if(previousAssignment){
      const previous=JSON.parse(previousAssignment.payload);
      const cancelled=await db.prepare("SELECT id FROM field_dispatch_changes WHERE id=? AND organization_id=? AND status='cancelled'").bind(previous.requestId,'org-opwp').first();
      fail(cancelled,'An assignment for this customer is already being saved. Refresh the route board.',409);
      statements.push(db.prepare('DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?').bind(assignmentKey,previousAssignment.payload));
    }
    const shift = await db.prepare("SELECT s.id FROM route_partner_field_shifts s JOIN route_partner_route_plans p ON p.id=s.route_plan_id WHERE p.id=? AND p.organization_id=? AND p.service_date=? AND p.status IN ('finalized','in_progress') AND s.status<>'cancelled'").bind(body.planId, 'org-opwp', date).first();
    fail(shift, 'Choose an available local route for today.');
    let workday = await db.prepare('SELECT state_json FROM field_workdays WHERE shift_id=? AND organization_id=?').bind(shift.id, 'org-opwp').first();
    if (!workday) {
      await officeWorkdayCommand(db, actor, { action: 'open_workday', shiftId: shift.id });
      workday = await db.prepare('SELECT state_json FROM field_workdays WHERE shift_id=? AND organization_id=?').bind(shift.id, 'org-opwp').first();
    }
    const day = JSON.parse(workday.state_json);
    fail(!day.shift.clockOut && ['ready', 'loading', 'loaded', 'on_route'].includes(day.shift.status), 'Choose a route that has not started wrap-up.');
    fail(day.stops.length < 60 && day.stops.flatMap(stop => stop.tasks).length < 160, 'This route has reached its service capacity.');
    const stopId = crypto.randomUUID();
    const task = serviceTask(SERVICE_DEFAULTS.find(service => service.id === 'scoop'), { id: crypto.randomUUID(), title: customer.frequency === 'one_time' ? 'One-time yard cleanup' : customer.frequency === 'every_other_week' ? 'Biweekly yard cleanup' : 'Weekly yard cleanup', notes: body.notes.trim(), source: { provider: 'opwp', jobId: null, customerId: customer.id } });
    const stop = { id: stopId, name: customer.name, address: `${customer.street}, ${customer.city}, OH ${customer.zip}`, latitude: customer.lat, longitude: customer.lng, travelMinutes: null, hasGate: true, safety: 'unknown', clearanceAt: null, gateCode: customer.gateCode || '', communityCode: '', instructions: `${customer.accessNotes} ${customer.persistentNotes} ${customer.safetyNotes}`, dogCount: customer.dogCount, phone: '', notificationPreference: null, arrivedAt: null, completedAt: null, status: 'pending', tasks: [task] };
    const payload = { stop, reason: body.notes.trim(), localCustomerId: customer.id, proposedPosition: body.position };
    // The unique per-customer receipt and dispatch change commit together. This
    // prevents two concurrent recommendation clicks from assigning twice.
    statements.push(db.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)").bind(assignmentKey, JSON.stringify({ requestId: body.requestId, planId: body.planId }), now));
    statements.push(db.prepare('INSERT INTO field_dispatch_changes(id,organization_id,shift_id,kind,payload,created_by) VALUES (?,?,?,?,?,?)').bind(body.requestId, 'org-opwp', day.id, 'add_visit', JSON.stringify(payload), actor));
    result = { ok: true, id: body.requestId, stopId, message: 'Assignment saved for technician review. The stop will be appended after acceptance; review its position before starting service.' };
  }
  statements.push(db.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)").bind(receiptKey, JSON.stringify({ actor, input, result }), now));
  try { await db.batch(statements); }
  catch(error){
    // A retry may race the first commit. Return its receipt only for the same
    // actor and exact request; a competing assignment remains a conflict.
    const committed=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(receiptKey).first();
    if(committed){const receipt=JSON.parse(committed.payload);fail(receipt.actor===actor&&receipt.input===input,'This request identifier was already used for another action.',409);return receipt.result;}
    if(body.action==='assign_stop'){
      const claimed=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(`local-preview:assignment:${date}:${customer.id}`).first();
      if(claimed)throw new FieldError('An assignment for this customer is already being saved. Refresh the route board.',409);
    }
    throw error;
  }
  return result;
}
