import { parseMetadata, shiftTotals } from './field-policy.mjs';

export const SNG_WRITE_BLOCKER = 'SNG write API and notification/billing behavior have not been verified. Nothing has been uploaded.';

// Internal interchange format, NOT an invented SNG request contract.
// Captured atomically with clock-out and retained even if a provider is unavailable.
export async function buildFieldCloseout(db, context, auth, endingMileage, notes, closedAt) {
  const shift = await db.prepare('SELECT * FROM route_partner_field_shifts WHERE id=?').bind(context.shift_id).first();
  const plan = await db.prepare('SELECT * FROM route_partner_route_plans WHERE id=?').bind(context.route_plan_id).first();
  const tasks = await db.prepare("SELECT id,external_task_id,customer_external_id,status,started_at,completed_at,failure_reason,office_notes,metadata FROM route_partner_tasks WHERE route_plan_id=? AND task_type='scoop' ORDER BY id").bind(context.route_plan_id).all();
  const breaks = await db.prepare('SELECT break_type,started_at,ended_at,starting_mileage,ending_mileage,notes FROM route_partner_field_breaks WHERE shift_id=? ORDER BY started_at').bind(context.shift_id).all();
  const proofs = await db.prepare('SELECT p.id,p.task_id,p.content_type,p.byte_size FROM route_partner_field_proofs p JOIN route_partner_tasks t ON t.id=p.task_id WHERE t.route_plan_id=? ORDER BY p.created_at').bind(context.route_plan_id).all();
  const events = await db.prepare('SELECT task_id,location_id,event_type,latitude,longitude,details,occurred_at FROM route_partner_field_events WHERE shift_id=? ORDER BY occurred_at LIMIT 2000').bind(context.shift_id).all();
  const closedShift = { ...shift, completed_at: closedAt, ending_mileage: endingMileage };
  return {
    schema: 'opwp.field-closeout.v1', destination: 'sweep_and_go', organizationId: auth.member.organizationId,
    shiftId: shift.id, routePlanId: plan.id, serviceDate: shift.service_date,
    sourceFingerprint: plan.source_fingerprint, employeeId: plan.technician_external_id,
    technicianMemberId: auth.member.id, timezone: 'America/New_York', timestampFormat: 'UTC',
    clockIn: shift.checked_in_at, clockOut: closedAt, vehicleType: shift.vehicle_type,
    startingMileage: shift.starting_mileage, endingMileage, startNotes: shift.clock_in_notes, endNotes: notes,
    breaks: breaks.results || [], totals: shiftTotals(closedShift, breaks.results || []),
    events: events.results || [],
    jobs: (tasks.results || []).map(task => ({
      localTaskId: task.id, source: parseMetadata(task.metadata).field?.identity || null,
      sourceJobId: task.external_task_id, sourceCustomerId: task.customer_external_id,
      outcome: task.status === 'failed' ? 'exception_requires_mapping' : task.status === 'cancelled' ? 'cancelled' : 'completed',
      startedAt: task.started_at, endedAt: task.completed_at,
      officeNotes: task.office_notes, exceptionReason: task.failure_reason,
      proofs: (proofs.results || []).filter(proof => proof.task_id === task.id),
    })),
    notificationPolicy: 'match_verified_sng_preferences',
    billingPolicy: 'require_verified_sng_job_and_skip_reason_contract',
    writeEnabled: false,
  };
}
