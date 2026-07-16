import { OPWP_ORGANIZATION_ID } from "./route-partner";

const TERMINAL_TASKS = new Set(["completed", "failed", "cancelled", "validation_pending"]);
const LEAD_OPTIONS = new Set([10, 15, 25, 30, 45, 60]);

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventStatement(db, { auth, shiftId, planId, locationId = null, taskId = null, type, body = {} }) {
  return db.prepare(
    `INSERT INTO route_partner_field_events
      (id,organization_id,shift_id,route_plan_id,location_id,task_id,event_type,actor_member_id,latitude,longitude,details)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), auth.member.organizationId, shiftId, planId, locationId, taskId, type, auth.member.id,
    numberOrNull(body.latitude), numberOrNull(body.longitude), JSON.stringify(body.details || {}));
}

async function planForRelease(db, planId, organizationId) {
  return db.prepare(
    `SELECT p.*,COALESCE(p.assigned_member_id,m.id) AS resolved_member_id
     FROM route_partner_route_plans p
     LEFT JOIN route_partner_members m ON m.organization_id=p.organization_id AND m.external_employee_id=p.technician_external_id
       AND m.role='technician' AND m.status='active'
     WHERE p.id=? AND p.organization_id=? LIMIT 1`
  ).bind(planId, organizationId).first();
}

export async function prepareFieldRelease(db, planId, assignedMemberId = null, organizationId = OPWP_ORGANIZATION_ID) {
  if (assignedMemberId) await db.prepare("UPDATE route_partner_route_plans SET assigned_member_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(assignedMemberId, planId, organizationId).run();
  const plan = await planForRelease(db, planId, organizationId);
  if (!plan) throw new Error("The route plan was not found.");
  const memberId = assignedMemberId || plan.resolved_member_id;
  if (!memberId) return { assigned: false, reason: "No technician account matches this route." };

  let shift = await db.prepare("SELECT id,status FROM route_partner_field_shifts WHERE route_plan_id=?").bind(planId).first();
  if (!shift) {
    shift = { id: crypto.randomUUID(), status: "pending_load" };
    await db.prepare(
      `INSERT INTO route_partner_field_shifts (id,organization_id,route_plan_id,technician_member_id,service_date)
       VALUES (?,?,?,?,?)`
    ).bind(shift.id, organizationId, planId, memberId, plan.service_date).run();
  } else {
    await db.prepare("UPDATE route_partner_field_shifts SET technician_member_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(memberId, shift.id).run();
  }

  const requirements = await db.prepare(
    `SELECT p.id AS product_id,p.sku,p.formula_code,p.color,p.bag_weight_lb,p.name,SUM(oi.quantity) AS quantity
     FROM route_partner_tasks t
     JOIN dog_food_deliveries d ON d.id=t.dog_food_delivery_id
     JOIN dog_food_order_items oi ON oi.order_id=d.order_id
     JOIN dog_food_products p ON p.id=oi.product_id
     WHERE t.route_plan_id=? AND t.task_type='dog_food' AND t.status NOT IN ('cancelled')
     GROUP BY p.id,p.sku,p.formula_code,p.color,p.bag_weight_lb,p.name ORDER BY p.formula_code,p.bag_weight_lb`
  ).bind(planId).all();
  const statements = [];
  for (const item of requirements.results || []) statements.push(db.prepare(
    `INSERT INTO route_partner_shift_inventory (id,shift_id,product_id,required_quantity)
     VALUES (?,?,?,?) ON CONFLICT(shift_id,product_id) DO UPDATE SET required_quantity=excluded.required_quantity,updated_at=CURRENT_TIMESTAMP`
  ).bind(crypto.randomUUID(), shift.id, item.product_id, Number(item.quantity) || 0));

  const payment = await db.prepare(
    `SELECT COUNT(*) AS failures FROM route_partner_tasks t JOIN dog_food_deliveries d ON d.id=t.dog_food_delivery_id
     JOIN dog_food_orders o ON o.id=d.order_id WHERE t.route_plan_id=? AND t.task_type='dog_food' AND o.status NOT IN ('paid','scheduled','fulfilled')`
  ).bind(planId).first();
  const paymentStatus = Number(payment?.failures || 0) ? "failed" : requirements.results?.length ? "passed" : "not_required";
  const requiredItems = (requirements.results || []).map((item) => ({ productId: item.product_id, sku: item.sku, formula: item.formula_code, color: item.color, weightLb: item.bag_weight_lb, name: item.name, quantity: Number(item.quantity) || 0 }));
  statements.push(db.prepare(
    `INSERT INTO route_partner_load_checks (id,organization_id,route_plan_id,technician_member_id,status,required_items,payment_validation_status)
     VALUES (?,?,?,?, 'pending',?,?) ON CONFLICT(route_plan_id) DO UPDATE SET technician_member_id=excluded.technician_member_id,
       required_items=excluded.required_items,payment_validation_status=excluded.payment_validation_status,updated_at=CURRENT_TIMESTAMP`
  ).bind(crypto.randomUUID(), organizationId, planId, memberId, JSON.stringify(requiredItems), paymentStatus));
  statements.push(db.prepare("UPDATE route_partner_route_plans SET assigned_member_id=?,released_to_field_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(memberId, planId));
  if (statements.length) await db.batch(statements);
  return { assigned: true, shiftId: shift.id, memberId, paymentStatus, requiredItems };
}

async function loadPlan(db, planId) {
  const [locationRows, taskRows] = await Promise.all([
    db.prepare(`SELECT id,sequence,address,customer_display_name,arrival_status,estimated_service_minutes,estimated_drive_minutes,
      actual_arrived_at,actual_completed_at,latitude,longitude FROM route_partner_locations WHERE route_plan_id=? ORDER BY sequence`).bind(planId).all(),
    db.prepare(`SELECT t.id,t.location_id,t.task_type,t.status,t.customer_display_name,t.estimated_minutes,t.placement_note,t.product_summary,
      t.crm_completion_status,t.completed_at,t.failure_reason,t.dog_food_delivery_id,
      (SELECT COUNT(*) FROM route_partner_field_proofs p WHERE p.task_id=t.id) AS proof_count
      FROM route_partner_tasks t WHERE t.route_plan_id=? ORDER BY t.location_id,t.task_type`).bind(planId).all(),
  ]);
  const tasks = new Map();
  for (const task of taskRows.results || []) {
    if (!tasks.has(task.location_id)) tasks.set(task.location_id, []);
    tasks.get(task.location_id).push({ id: task.id, type: task.task_type, status: task.status, customerName: task.customer_display_name, estimatedMinutes: Number(task.estimated_minutes) || 0, placementNote: task.placement_note, productSummary: task.product_summary, crmCompletionStatus: task.crm_completion_status, completedAt: task.completed_at, failureReason: task.failure_reason, deliveryId: task.dog_food_delivery_id, proofCount: Number(task.proof_count) || 0 });
  }
  return (locationRows.results || []).map((location) => ({ id: location.id, sequence: location.sequence, address: location.address, customerName: location.customer_display_name || "Service location", status: location.arrival_status, estimatedMinutes: Number(location.estimated_service_minutes) || 0, estimatedDriveMinutes: numberOrNull(location.estimated_drive_minutes), arrivedAt: location.actual_arrived_at, completedAt: location.actual_completed_at, latitude: numberOrNull(location.latitude), longitude: numberOrNull(location.longitude), tasks: tasks.get(location.id) || [] }));
}

export async function getFieldToday(db, auth, date) {
  const shift = await db.prepare(
    `SELECT s.*,p.technician_name,p.source_route_id,p.version,p.status AS plan_status,p.source_job_count,p.food_task_count,p.location_count,
      lc.status AS load_status,lc.payment_validation_status,lc.confirmed_at
     FROM route_partner_field_shifts s JOIN route_partner_route_plans p ON p.id=s.route_plan_id
     LEFT JOIN route_partner_load_checks lc ON lc.route_plan_id=p.id
     WHERE s.technician_member_id=? AND s.organization_id=? AND s.service_date=? AND s.status<>'cancelled'
     ORDER BY CASE s.status WHEN 'in_progress' THEN 0 WHEN 'ready' THEN 1 WHEN 'pending_load' THEN 2 ELSE 3 END LIMIT 1`
  ).bind(auth.member.id, auth.member.organizationId, date).first();
  if (!shift) return { date, member: auth.member, shift: null, route: null };
  const [locations, inventoryResult, activeBreak, exceptions] = await Promise.all([
    loadPlan(db, shift.route_plan_id),
    db.prepare(`SELECT i.product_id,i.required_quantity,i.loaded_quantity,i.delivered_quantity,i.returned_quantity,i.damaged_quantity,
      p.sku,p.formula_code,p.color,p.name,p.bag_weight_lb FROM route_partner_shift_inventory i JOIN dog_food_products p ON p.id=i.product_id WHERE i.shift_id=? ORDER BY p.formula_code,p.bag_weight_lb`).bind(shift.id).all(),
    db.prepare("SELECT id,break_type,started_at FROM route_partner_field_breaks WHERE shift_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1").bind(shift.id).first(),
    db.prepare("SELECT id,task_id,request_type,reason_code,status,inventory_disposition,created_at FROM route_partner_change_requests WHERE route_plan_id=? AND status='pending' ORDER BY created_at DESC").bind(shift.route_plan_id).all(),
  ]);
  const allTasks = locations.flatMap((location) => location.tasks);
  return {
    date,
    member: auth.member,
    shift: { id: shift.id, status: shift.status, startingMileage: shift.starting_mileage, endingMileage: shift.ending_mileage, checkedInAt: shift.checked_in_at, departedAt: shift.departed_at, completedAt: shift.completed_at, activeBreak: activeBreak || null },
    route: { id: shift.route_plan_id, technicianName: shift.technician_name, routeId: shift.source_route_id, version: shift.version, status: shift.plan_status, sourceJobCount: shift.source_job_count, foodTaskCount: shift.food_task_count, locationCount: shift.location_count, load: { status: shift.load_status || "pending", paymentStatus: shift.payment_validation_status || "pending", confirmedAt: shift.confirmed_at, items: inventoryResult.results || [] }, locations, totals: { tasks: allTasks.length, completed: allTasks.filter((task) => TERMINAL_TASKS.has(task.status)).length, stopsCompleted: locations.filter((location) => location.status === "completed").length }, exceptions: exceptions.results || [] },
  };
}

async function ownedContext(db, auth, body) {
  const row = await db.prepare(
    `SELECT s.id AS shift_id,s.status AS shift_status,s.route_plan_id,s.technician_member_id,p.status AS plan_status
     FROM route_partner_field_shifts s JOIN route_partner_route_plans p ON p.id=s.route_plan_id
     WHERE s.id=? AND s.technician_member_id=? AND s.organization_id=? LIMIT 1`
  ).bind(String(body.shiftId || ""), auth.member.id, auth.member.organizationId).first();
  if (!row) throw new Error("This shift is not assigned to your account.");
  return row;
}

async function ownedTask(db, auth, body) {
  const context = await ownedContext(db, auth, body);
  const task = await db.prepare(
    `SELECT t.*,l.sequence,l.arrival_status FROM route_partner_tasks t JOIN route_partner_locations l ON l.id=t.location_id
     WHERE t.id=? AND t.route_plan_id=? LIMIT 1`
  ).bind(String(body.taskId || ""), context.route_plan_id).first();
  if (!task) throw new Error("The field task was not found.");
  return { context, task };
}

export async function applyFieldAction(db, auth, body) {
  const action = String(body?.action || "");
  if (action === "confirm_load") {
    const context = await ownedContext(db, auth, body);
    if (!Array.isArray(body.items) || body.items.length > 30) throw new Error("Confirm each required load item.");
    const required = await db.prepare("SELECT product_id,required_quantity FROM route_partner_shift_inventory WHERE shift_id=?").bind(context.shift_id).all();
    const supplied = new Map(body.items.map((item) => [String(item.productId), Math.max(0, Math.floor(Number(item.quantity) || 0))]));
    if ((required.results || []).some((item) => (supplied.get(String(item.product_id)) || 0) < Number(item.required_quantity))) throw new Error("The loaded quantities must cover every scheduled delivery.");
    const load = await db.prepare("SELECT payment_validation_status FROM route_partner_load_checks WHERE route_plan_id=?").bind(context.route_plan_id).first();
    if (load?.payment_validation_status === "failed") throw new Error("A dog-food payment needs management attention before departure.");
    const statements = (required.results || []).map((item) => db.prepare("UPDATE route_partner_shift_inventory SET loaded_quantity=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE shift_id=? AND product_id=?").bind(supplied.get(String(item.product_id)) || 0, context.shift_id, item.product_id));
    statements.push(db.prepare("UPDATE route_partner_load_checks SET status='confirmed',confirmed_items=?,confirmed_at=CURRENT_TIMESTAMP,confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE route_plan_id=?").bind(JSON.stringify(body.items), auth.member.email, context.route_plan_id));
    statements.push(db.prepare("UPDATE route_partner_field_shifts SET status='ready',starting_mileage=?,checked_in_at=COALESCE(checked_in_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(numberOrNull(body.startingMileage), context.shift_id));
    statements.push(eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, type: "load_confirmed", body }));
    await db.batch(statements);
    return { message: "Load confirmed. Your route is ready to start." };
  }

  if (action === "start_route") {
    const context = await ownedContext(db, auth, body);
    if (context.shift_status !== "ready") throw new Error("Complete the departure check before starting the route.");
    await db.batch([
      db.prepare("UPDATE route_partner_field_shifts SET status='in_progress',departed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.shift_id),
      db.prepare("UPDATE route_partner_route_plans SET status='in_progress',started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.route_plan_id),
      eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, type: "route_started", body }),
    ]);
    return { message: "Route started." };
  }

  if (action === "arrive") {
    const context = await ownedContext(db, auth, body);
    if (context.shift_status !== "in_progress") throw new Error("Start the route before arriving at a stop.");
    const location = await db.prepare("SELECT id FROM route_partner_locations WHERE id=? AND route_plan_id=?").bind(String(body.locationId || ""), context.route_plan_id).first();
    if (!location) throw new Error("The route stop was not found.");
    await db.batch([
      db.prepare("UPDATE route_partner_locations SET arrival_status='arrived',actual_arrived_at=COALESCE(actual_arrived_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(location.id),
      eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, locationId: location.id, type: "location_arrived", body }),
    ]);
    return { message: "Arrival recorded." };
  }

  if (action === "start_task") {
    const { context, task } = await ownedTask(db, auth, body);
    if (context.shift_status !== "in_progress") throw new Error("Start the route before beginning a task.");
    await db.batch([
      db.prepare("UPDATE route_partner_tasks SET status='in_progress',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('scheduled','ready')").bind(task.id),
      eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, locationId: task.location_id, taskId: task.id, type: "task_started", body }),
    ]);
    return { message: "Task started." };
  }

  if (action === "on_the_way") {
    const { context, task } = await ownedTask(db, auth, body);
    if (task.task_type !== "dog_food") throw new Error("On-the-way notices are only sent for food deliveries.");
    const lead = Number(body.leadMinutes);
    if (!LEAD_OPTIONS.has(lead)) throw new Error("Select a valid notice time.");
    await db.batch([
      db.prepare(`INSERT INTO route_partner_notification_outbox
        (id,organization_id,route_plan_id,task_id,notification_type,recommended_lead_minutes,selected_lead_minutes,message)
        VALUES (?,?,?,?, 'on_the_way',?,?,?)`).bind(crypto.randomUUID(), auth.member.organizationId, context.route_plan_id, task.id, Number(body.recommendedLeadMinutes) || null, lead, String(body.message || "Your Extreme Dog Fuel delivery is on the way.").slice(0, 500)),
      eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, locationId: task.location_id, taskId: task.id, type: "on_the_way_queued", body: { ...body, details: { leadMinutes: lead } } }),
    ]);
    return { message: `The ${lead}-minute dog-food notice is queued.` };
  }

  if (action === "complete_task") {
    const { context, task } = await ownedTask(db, auth, body);
    if (task.task_type === "dog_food") {
      const proof = await db.prepare("SELECT id FROM route_partner_field_proofs WHERE task_id=? ORDER BY created_at DESC LIMIT 1").bind(task.id).first();
      if (!proof) throw new Error("Add a delivery photo before completing this stop.");
      if (!body.placementConfirmed) throw new Error("Confirm the bag was placed in the requested location.");
    }
    const status = task.task_type === "scoop" ? "validation_pending" : "completed";
    const statements = [
      db.prepare("UPDATE route_partner_tasks SET status=?,completed_at=CURRENT_TIMESTAMP,completion_latitude=?,completion_longitude=?,crm_completion_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, numberOrNull(body.latitude), numberOrNull(body.longitude), task.task_type === "scoop" ? "pending" : "not_required", task.id),
      eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, locationId: task.location_id, taskId: task.id, type: "task_completed", body }),
    ];
    if (task.task_type === "dog_food") {
      const proof = await db.prepare("SELECT id FROM route_partner_field_proofs WHERE task_id=? ORDER BY created_at DESC LIMIT 1").bind(task.id).first();
      statements.push(db.prepare("UPDATE dog_food_deliveries SET status='delivered',delivered_at=CURRENT_TIMESTAMP,proof_photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(`/api/field/photo/${proof.id}/`, task.dog_food_delivery_id));
      const delivered = await db.prepare("SELECT oi.product_id,SUM(oi.quantity) AS quantity FROM dog_food_deliveries d JOIN dog_food_order_items oi ON oi.order_id=d.order_id WHERE d.id=? GROUP BY oi.product_id").bind(task.dog_food_delivery_id).all();
      for (const item of delivered.results || []) statements.push(db.prepare("UPDATE route_partner_shift_inventory SET delivered_quantity=delivered_quantity+?,updated_at=CURRENT_TIMESTAMP WHERE shift_id=? AND product_id=?").bind(Number(item.quantity) || 0, context.shift_id, item.product_id));
    }
    statements.push(db.prepare(`UPDATE route_partner_locations SET arrival_status='completed',actual_completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND NOT EXISTS (SELECT 1 FROM route_partner_tasks WHERE location_id=? AND status NOT IN ('completed','failed','cancelled','validation_pending'))`).bind(task.location_id, task.location_id));
    await db.batch(statements);
    return { message: task.task_type === "dog_food" ? "Delivery completed and inventory updated." : "Scooping completion recorded; CRM validation is pending." };
  }

  if (action === "fail_task") {
    const { context, task } = await ownedTask(db, auth, body);
    const reason = String(body.reason || "").slice(0, 120);
    if (!reason) throw new Error("Select a reason for the exception.");
    const disposition = task.task_type === "dog_food" ? String(body.inventoryDisposition || "") : "not_applicable";
    if (task.task_type === "dog_food" && !["return_to_vehicle", "return_to_warehouse", "damaged", "missing"].includes(disposition)) throw new Error("Confirm what should happen to the undelivered food.");
    const requestId = crypto.randomUUID();
    const statements = [
      db.prepare("UPDATE route_partner_tasks SET status='failed',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reason, task.id),
      db.prepare(`INSERT INTO route_partner_change_requests
        (id,organization_id,route_plan_id,task_id,request_type,reason_code,details,status,inventory_disposition,requested_by)
       VALUES (?,?,?,?, 'field_exception',?,?, 'pending',?,?)`).bind(requestId, auth.member.organizationId, context.route_plan_id, task.id, reason, JSON.stringify({ notes: String(body.notes || "").slice(0, 500) }), disposition, auth.member.email),
      eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, locationId: task.location_id, taskId: task.id, type: "task_exception", body }),
      db.prepare(`UPDATE route_partner_locations SET arrival_status='completed',actual_completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND NOT EXISTS (SELECT 1 FROM route_partner_tasks WHERE location_id=? AND status NOT IN ('completed','failed','cancelled','validation_pending'))`).bind(task.location_id, task.location_id),
    ];
    if (task.task_type === "dog_food") statements.push(db.prepare("UPDATE dog_food_deliveries SET status='failed',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reason, task.dog_food_delivery_id));
    await db.batch(statements);
    return { message: "Exception sent to management for review." };
  }

  if (action === "start_break" || action === "end_break") {
    const context = await ownedContext(db, auth, body);
    if (action === "start_break") {
      const active = await db.prepare("SELECT id FROM route_partner_field_breaks WHERE shift_id=? AND ended_at IS NULL").bind(context.shift_id).first();
      if (active) throw new Error("A break is already active.");
      const type = ["paid_break", "lunch", "drive", "other"].includes(body.breakType) ? body.breakType : "paid_break";
      await db.batch([db.prepare("INSERT INTO route_partner_field_breaks (id,shift_id,break_type,notes) VALUES (?,?,?,?)").bind(crypto.randomUUID(), context.shift_id, type, String(body.notes || "").slice(0, 250) || null), eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, type: "break_started", body: { ...body, details: { breakType: type } } })]);
      return { message: "Break started." };
    }
    const active = await db.prepare("SELECT id,break_type FROM route_partner_field_breaks WHERE shift_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1").bind(context.shift_id).first();
    if (!active) throw new Error("There is no active break.");
    await db.batch([db.prepare("UPDATE route_partner_field_breaks SET ended_at=CURRENT_TIMESTAMP WHERE id=?").bind(active.id), eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, type: "break_ended", body: { ...body, details: { breakType: active.break_type } } })]);
    return { message: "Break ended." };
  }

  if (action === "complete_route") {
    const context = await ownedContext(db, auth, body);
    const remaining = await db.prepare("SELECT COUNT(*) AS total FROM route_partner_tasks WHERE route_plan_id=? AND status NOT IN ('completed','failed','cancelled','validation_pending')").bind(context.route_plan_id).first();
    if (Number(remaining?.total || 0)) throw new Error("Complete or report every remaining task before ending the route.");
    const inventory = await db.prepare("SELECT product_id,loaded_quantity,delivered_quantity FROM route_partner_shift_inventory WHERE shift_id=?").bind(context.shift_id).all();
    const returned = new Map((Array.isArray(body.items) ? body.items : []).map((item) => [String(item.productId), Math.max(0, Math.floor(Number(item.returned) || 0))]));
    const statements = (inventory.results || []).map((item) => db.prepare("UPDATE route_partner_shift_inventory SET returned_quantity=?,updated_at=CURRENT_TIMESTAMP WHERE shift_id=? AND product_id=?").bind(returned.get(String(item.product_id)) ?? Math.max(0, Number(item.loaded_quantity) - Number(item.delivered_quantity)), context.shift_id, item.product_id));
    statements.push(db.prepare("UPDATE route_partner_field_shifts SET status='completed',ending_mileage=?,completed_at=CURRENT_TIMESTAMP,technician_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(numberOrNull(body.endingMileage), String(body.notes || "").slice(0, 1000) || null, context.shift_id));
    statements.push(db.prepare("UPDATE route_partner_route_plans SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(context.route_plan_id));
    statements.push(eventStatement(db, { auth, shiftId: context.shift_id, planId: context.route_plan_id, type: "route_completed", body }));
    await db.batch(statements);
    return { message: "Route completed. Inventory and mileage are ready for management review." };
  }

  throw new Error("The requested field action is not supported.");
}
