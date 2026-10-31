import { FieldError, operatingDate, parseMetadata } from "./field-policy.mjs";
import { recurringTasks } from "./field-recurring-services.mjs";
import {
  SERVICE_DEFAULTS,
  catalogRow,
  serviceTask,
} from "./field-service-catalog.mjs";
import { applyWorkdayEvent, workdaySummary } from "./field-workday-model.mjs";
export async function fieldDigest(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function ownedWorkdayShift(db, member, shiftId) {
  if (typeof shiftId !== "string" || shiftId.length > 100)
    throw new FieldError("Choose an assigned shift.");
  const row = await db
    .prepare(
      `SELECT s.*,p.status plan_status,p.source_fingerprint,p.technician_external_id,p.version plan_version FROM route_partner_field_shifts s JOIN route_partner_route_plans p ON p.id=s.route_plan_id WHERE s.id=? AND s.technician_member_id=? AND s.organization_id=? AND p.organization_id=?`,
    )
    .bind(shiftId, member.id, member.organizationId, member.organizationId)
    .first();
  if (
    !row ||
    !["finalized", "in_progress", "completed"].includes(row.plan_status) ||
    row.status === "cancelled"
  )
    throw new FieldError(
      "This released shift is not assigned to your account.",
      403,
    );
  return row;
}
export async function fieldCatalog(db, org) {
  const rows = await db
    .prepare(
      "SELECT * FROM field_service_catalog WHERE organization_id=? ORDER BY name LIMIT 60",
    )
    .bind(org)
    .all();
  return rows.results.map(catalogRow);
}
export async function createWorkday(db, member, shift, now = Date.now()) {
  if (shift.checked_in_at)
    throw new FieldError(
      "This shift started in the earlier pilot. Finish it there before using the unified app.",
      409,
    );
  const [catalog, locations, tasks, inventory, load] = await Promise.all([
    fieldCatalog(db, member.organizationId),
    db
      .prepare(
        "SELECT * FROM route_partner_locations WHERE route_plan_id=? AND organization_id=? ORDER BY sequence LIMIT 61",
      )
      .bind(shift.route_plan_id, member.organizationId)
      .all(),
    db
      .prepare(
        "SELECT * FROM route_partner_tasks WHERE route_plan_id=? AND organization_id=? ORDER BY created_at,id LIMIT 161",
      )
      .bind(shift.route_plan_id, member.organizationId)
      .all(),
    db
      .prepare(
        "SELECT i.*,p.name,p.color FROM route_partner_shift_inventory i JOIN dog_food_products p ON p.id=i.product_id WHERE i.shift_id=? ORDER BY p.name LIMIT 31",
      )
      .bind(shift.id)
      .all(),
    db
      .prepare(
        "SELECT payment_validation_status FROM route_partner_load_checks WHERE route_plan_id=?",
      )
      .bind(shift.route_plan_id)
      .first(),
  ]);
  if (
    locations.results.length > 60 ||
    tasks.results.length > 160 ||
    inventory.results.length > 30
  )
    throw new FieldError(
      "This route exceeds the safe workday limit. Ask the office to split it.",
    );
  const services = new Map(catalog.map((s) => [s.id, s])),
    items = inventory.results.map((r) => ({
      productId: r.product_id,
      name: r.name,
      color: r.color,
      required: r.required_quantity,
      loaded: 0,
      delivered: 0,
      returned: 0,
      damaged: 0,
      missing: 0,
    }));
  const mapped = [];
  for (const row of tasks.results) {
    const metadata = parseMetadata(row.metadata),
      serviceId =
        row.task_type === "dog_food"
          ? "food"
          : metadata.workday?.serviceId || "scoop";
    const service =
      services.get(serviceId) ||
      SERVICE_DEFAULTS.find((s) => s.id === serviceId);
    if (!service)
      throw new FieldError("A route service needs office configuration.");
    const deliveryItems =
      row.task_type === "dog_food"
        ? (
            await db
              .prepare(
                "SELECT oi.product_id,SUM(oi.quantity) quantity FROM dog_food_deliveries d JOIN dog_food_order_items oi ON oi.order_id=d.order_id WHERE d.id=? GROUP BY oi.product_id",
              )
              .bind(row.dog_food_delivery_id)
              .all()
          ).results.map((r) => ({
            productId: r.product_id,
            quantity: r.quantity,
          }))
        : [];
    const task = serviceTask(service, {
      id: row.id,
      quantity: metadata.workday?.quantity || 1,
      notes: row.office_notes || "",
      source: {
        provider: row.source_provider,
        jobId: row.external_task_id,
        customerId: row.customer_external_id,
        identity: metadata.field?.identity || null,
      },
      estimate: row.estimated_minutes,
      title: row.product_summary || service.name,
      deliveryItems,
    });
    if (["failed", "cancelled"].includes(row.status)) {
      task.status = row.status === "failed" ? "skipped" : "cancelled";
      task.reason = row.failure_reason || "Source disposition";
      task.completedAt = row.completed_at;
    } else if (["completed", "validation_pending"].includes(row.status)) {
      task.status = "completed";
      task.startedAt = row.started_at;
      task.completedAt = row.completed_at;
    } else if (row.status === "in_progress")
      throw new FieldError(
        "A service already started in another field workflow.",
        409,
      );
    mapped.push({
      ...task,
      locationId: row.location_id,
      field: metadata.field || {},
      placementNote: row.placement_note || "",
    });
  }
  const stops = locations.results.map((r) => {
    const assigned = mapped.filter((t) => t.locationId === r.id),
      context = assigned.find((t) => t.field?.identity)?.field || {},
      safe = String(context.dogSafetySource || "").toLowerCase(),
      knownSafe =
        ["safe", "secured", "1", "true", "yes", "no dogs"].includes(safe) ||
        context.dogCount === 0;
    return {
      id: r.id,
      address: r.address,
      name: r.customer_display_name || "Service location",
      latitude: r.latitude,
      longitude: r.longitude,
      travelMinutes: r.estimated_drive_minutes,
      hasGate: context.hasGate === false ? false : true,
      safety: knownSafe ? "clear" : "unknown",
      clearanceAt: null,
      gateCode: context.gateCode || "",
      communityCode: context.communityCode || "",
      instructions: context.sourceNote || "",
      dogCount: context.dogCount ?? null,
      phone: context.cellPhone || "",
      notificationPreference: context.notificationPreference || null,
      arrivedAt: null,
      completedAt: null,
      status: "pending",
      tasks: assigned,
    };
  });
  for (const stop of stops) {
    const identity = stop.tasks.find(
      (t) => t.source?.provider === "sweep_and_go" && t.source.identity,
    )?.source.identity;
    const recurring = await recurringTasks(
      db,
      member.organizationId,
      identity,
      shift.service_date,
      services,
      async (ruleId) => {
        const h = await fieldDigest(`${shift.id}:${ruleId}`);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
      },
    );
    stop.propertyKey = recurring.key;
    stop.tasks.push(
      ...recurring.tasks.filter(
        (t) =>
          !stop.tasks.some((existing) => existing.serviceId === t.serviceId),
      ),
    );
  }
  if (stops.flatMap((s) => s.tasks).length > 160)
    throw new FieldError(
      "Recurring add-ons exceed route capacity. Ask the office to split the workday.",
    );
  const createdAt = new Date(now).toISOString();
  return {
    schema: 1,
    id: shift.id,
    organizationId: member.organizationId,
    memberId: member.id,
    memberName: member.name || member.email,
    planId: shift.route_plan_id,
    sourceFingerprint: shift.source_fingerprint,
    employeeId: shift.technician_external_id,
    date: shift.service_date,
    planVersion: shift.plan_version,
    revision: 0,
    createdAt,
    lastEventAt: null,
    paymentStatus: load?.payment_validation_status || "pending",
    inventory: items,
    shift: {
      status: "ready",
      clockIn: null,
      clockOut: null,
      startMileage: null,
      endMileage: null,
      activeBreak: null,
      breaks: [],
      prechecks: {},
      wrapchecks: {},
      notes: "",
      endNotes: "",
    },
    stops,
    issues: [],
    notices: [],
    acceptedChanges: [],
  };
}
export async function getWorkday(
  db,
  member,
  { date = operatingDate(), shiftId = "" } = {},
) {
  const delta =
    (Date.parse(`${date}T12:00:00Z`) -
      Date.parse(`${operatingDate()}T12:00:00Z`)) /
    86400000;
  if (!Number.isInteger(delta) || delta < -30 || delta > 14)
    throw new FieldError("Choose a date within the available shift history.");
  const row = shiftId
    ? await ownedWorkdayShift(db, member, shiftId)
    : await db
        .prepare(
          `SELECT s.id FROM route_partner_field_shifts s JOIN route_partner_route_plans p ON p.id=s.route_plan_id WHERE s.organization_id=? AND s.technician_member_id=? AND s.service_date=? AND s.status<>'cancelled' AND p.status IN ('finalized','in_progress','completed') ORDER BY CASE WHEN s.status='in_progress' THEN 0 ELSE 1 END,s.created_at DESC LIMIT 1`,
        )
        .bind(member.organizationId, member.id, date)
        .first();
  if (!row) return { day: null, changes: [], messages: [], member };
  const shift = await ownedWorkdayShift(db, member, row.id),
    existing = await db
      .prepare(
        "SELECT * FROM field_workdays WHERE shift_id=? AND member_id=? AND organization_id=?",
      )
      .bind(shift.id, member.id, member.organizationId)
      .first();
  let day = existing
    ? JSON.parse(existing.state_json)
    : await createWorkday(db, member, shift);
  if (!existing) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO field_workdays(shift_id,organization_id,member_id,state_json) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM route_partner_field_shifts WHERE id=? AND technician_member_id=? AND checked_in_at IS NULL) ON CONFLICT(shift_id) DO NOTHING`,
        )
        .bind(
          shift.id,
          member.organizationId,
          member.id,
          JSON.stringify(day),
          shift.id,
          member.id,
        ),
      db
        .prepare(
          `INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,status,estimated_minutes,product_summary,office_notes,metadata)
      SELECT json_extract(t.value,'$.id'),json_extract(w.state_json,'$.planId'),json_extract(s.value,'$.id'),w.organization_id,'other','opwp','scheduled',json_extract(t.value,'$.estimatedMinutes'),json_extract(t.value,'$.title'),json_extract(t.value,'$.notes'),json_object('workday',json_object('serviceId',json_extract(t.value,'$.serviceId'),'quantity',json_extract(t.value,'$.quantity'),'recurringRuleId',json_extract(t.value,'$.recurringRuleId')))
      FROM field_workdays w,json_each(w.state_json,'$.stops') s,json_each(s.value,'$.tasks') t WHERE w.shift_id=? AND w.member_id=? AND json_extract(t.value,'$.recurringRuleId') IS NOT NULL ON CONFLICT(id) DO NOTHING`,
        )
        .bind(shift.id, member.id),
    ]);
    const saved = await db
      .prepare(
        "SELECT state_json FROM field_workdays WHERE shift_id=? AND member_id=?",
      )
      .bind(shift.id, member.id)
      .first();
    if (!saved)
      throw new FieldError("The shift changed while opening. Refresh.", 409);
    day = JSON.parse(saved.state_json);
  }
  const [changes, messages] = await Promise.all([
    db
      .prepare(
        "SELECT id,kind,payload,created_at FROM field_dispatch_changes WHERE shift_id=? AND status='pending' ORDER BY created_at,id LIMIT 40",
      )
      .bind(shift.id)
      .all(),
    db
      .prepare(
        "SELECT id,stop_id,kind,status,detail,created_at FROM field_workday_messages WHERE shift_id=? ORDER BY created_at DESC LIMIT 60",
      )
      .bind(shift.id)
      .all(),
  ]);
  return {
    day,
    changes: changes.results.map((c) => ({
      ...c,
      payload: JSON.parse(c.payload),
    })),
    messages: messages.results,
    member,
    sourceChanged: day.sourceFingerprint !== shift.source_fingerprint,
  };
}
async function receipt(db, event, member, hash) {
  const prior = await db
    .prepare(
      "SELECT body_hash,member_id,shift_id,expected_revision FROM field_workday_events WHERE id=?",
    )
    .bind(event.id)
    .first();
  if (!prior) return null;
  if (
    prior.member_id !== member.id ||
    prior.shift_id !== event.shiftId ||
    prior.body_hash !== hash
  )
    throw new FieldError(
      "An event identifier was reused with different content.",
      409,
    );
  return {
    accepted: true,
    duplicate: true,
    revision: prior.expected_revision + 1,
  };
}
export async function saveWorkdayEvent(
  db,
  member,
  event,
  now = Date.now(),
  { notificationsEnabled = false } = {},
) {
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    !/^[a-f0-9-]{36}$/i.test(event.id || "")
  )
    throw new FieldError("Provide a valid field event.");
  const shift = await ownedWorkdayShift(db, member, event.shiftId),
    hash = await fieldDigest(JSON.stringify(event)),
    prior = await receipt(db, event, member, hash);
  if (prior) return prior;
  const row = await db
    .prepare(
      "SELECT * FROM field_workdays WHERE shift_id=? AND member_id=? AND organization_id=?",
    )
    .bind(shift.id, member.id, member.organizationId)
    .first();
  if (!row)
    throw new FieldError("Open this assigned workday online first.", 409);
  const original = JSON.parse(row.state_json);
  if (original.sourceFingerprint !== shift.source_fingerprint)
    throw new FieldError(
      "Source dispatch changed. Office review is required; your device work is retained.",
      409,
    );
  let changes = [];
  if (event.type === "accept_changes") {
    if (
      !Array.isArray(event.body?.changeIds) ||
      event.body.changeIds.length > 40 ||
      new Set(event.body.changeIds).size !== event.body.changeIds.length
    )
      throw new FieldError("Review the pending office changes.");
    const result = await db
      .prepare(
        "SELECT id,kind,payload FROM field_dispatch_changes WHERE shift_id=? AND status='pending' ORDER BY created_at,id LIMIT 40",
      )
      .bind(shift.id)
      .all();
    changes = result.results
      .filter((c) => event.body.changeIds.includes(c.id))
      .map((c) => ({ ...c, payload: JSON.parse(c.payload) }));
  }
  if (["start_task", "complete_task"].includes(event.type)) {
    const pending = await db
      .prepare(
        "SELECT payload FROM field_dispatch_changes WHERE shift_id=? AND kind='safety' AND status='pending' LIMIT 40",
      )
      .bind(shift.id)
      .all();
    const stop = original.stops.find((s) =>
      s.tasks.some((t) => t.id === event.body?.taskId),
    );
    if (
      pending.results.some((c) => {
        const b = JSON.parse(c.payload);
        return b.stopId === stop?.id && b.safe === false;
      })
    )
      throw new FieldError(
        "The office reported unsafe access. Stop work and contact the office; record an exception if needed.",
        409,
      );
  }
  if (["confirm_load", "start_route"].includes(event.type)) {
    const payment = await db
      .prepare(
        "SELECT payment_validation_status FROM route_partner_load_checks WHERE route_plan_id=?",
      )
      .bind(shift.route_plan_id)
      .first();
    const unpaid = await db
      .prepare(
        "SELECT COUNT(*) n FROM route_partner_tasks t JOIN dog_food_deliveries d ON d.id=t.dog_food_delivery_id JOIN dog_food_orders o ON o.id=d.order_id WHERE t.route_plan_id=? AND t.task_type='dog_food' AND t.status<>'cancelled' AND (o.status NOT IN ('paid','scheduled','fulfilled') OR NOT EXISTS (SELECT 1 FROM dog_food_payments pay WHERE pay.order_id=o.id AND pay.status='captured'))",
      )
      .bind(shift.route_plan_id)
      .first();
    if (
      !payment ||
      !["passed", "not_required"].includes(payment.payment_validation_status) ||
      unpaid?.n
    )
      throw new FieldError(
        "Food payment requires office review before departure.",
        409,
      );
  }
  if (event.type === "add_photo") {
    const photo = await db
      .prepare(
        "SELECT purpose FROM field_workday_proofs WHERE id=? AND shift_id=? AND task_id=? AND member_id=? AND uploaded=1",
      )
      .bind(
        event.body?.photoId || "",
        shift.id,
        event.body?.taskId || "",
        member.id,
      )
      .first();
    if (!photo || photo.purpose !== event.body.purpose)
      throw new FieldError(
        "Upload the matching private proof before its event.",
        409,
      );
  }
  if (event.type === "complete_task") {
    const t = original.stops
      .flatMap((s) => s.tasks)
      .find((t) => t.id === event.body?.taskId);
    if (t?.serviceId === "food") {
      const paid = await db
        .prepare(
          "SELECT 1 paid FROM route_partner_tasks t JOIN dog_food_deliveries d ON d.id=t.dog_food_delivery_id JOIN dog_food_orders o ON o.id=d.order_id JOIN dog_food_payments pay ON pay.order_id=o.id AND pay.status='captured' WHERE t.id=? AND t.route_plan_id=? AND o.deleted_at IS NULL AND o.status NOT IN ('cancelled','refunded') LIMIT 1",
        )
        .bind(t.id, shift.route_plan_id)
        .first();
      if (!paid)
        throw new FieldError(
          "Payment changed before delivery. Retain the product and contact the office.",
          409,
        );
    }
  }
  const day = applyWorkdayEvent(original, event, {
      now,
      officeChanges: changes,
    }),
    statements = [
      db
        .prepare(
          "INSERT INTO field_workday_events(id,shift_id,member_id,expected_revision,body_hash,event_json,next_state) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          event.id,
          shift.id,
          member.id,
          event.expectedRevision,
          hash,
          JSON.stringify(event),
          JSON.stringify(day),
        ),
    ];
  const status = {
    ready: "pending_load",
    loading: "pending_load",
    loaded: "ready",
    on_route: "in_progress",
    wrapping: "in_progress",
    finished: "completed",
  }[day.shift.status];
  statements.push(
    db
      .prepare(
        "UPDATE route_partner_field_shifts SET status=?,checked_in_at=?,departed_at=?,completed_at=?,starting_mileage=?,ending_mileage=?,vehicle_type=?,clock_in_notes=?,technician_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(
        status,
        day.shift.clockIn,
        day.shift.departedAt || null,
        day.shift.clockOut,
        day.shift.startMileage,
        day.shift.endMileage,
        day.shift.vehicle || null,
        day.shift.notes,
        day.shift.endNotes,
        shift.id,
      ),
  );
  if (day.shift.departedAt)
    statements.push(
      db
        .prepare(
          "UPDATE route_partner_route_plans SET status=?,started_at=COALESCE(started_at,?),completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(
          day.shift.clockOut ? "completed" : "in_progress",
          day.shift.departedAt,
          day.shift.clockOut,
          day.planId,
        ),
    );
  const changedTask = day.stops
      .flatMap((s) => s.tasks)
      .find((t) => t.id === event.body?.taskId),
    changedStop = day.stops.find(
      (s) =>
        s.id === event.body?.stopId ||
        s.tasks.some((t) => t.id === event.body?.taskId),
    );
  if (changedStop)
    statements.push(
      db
        .prepare(
          "UPDATE route_partner_locations SET arrival_status=?,actual_arrived_at=?,actual_completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND route_plan_id=?",
        )
        .bind(
          changedStop.status === "finished"
            ? "completed"
            : changedStop.arrivedAt
              ? "arrived"
              : "pending",
          changedStop.arrivedAt,
          changedStop.completedAt,
          changedStop.id,
          day.planId,
        ),
    );
  if (changedTask) {
    const taskStatus =
      changedTask.status === "completed"
        ? changedTask.source?.provider === "sweep_and_go"
          ? "validation_pending"
          : "completed"
        : changedTask.status === "working"
          ? "in_progress"
          : changedTask.status === "skipped"
            ? "failed"
            : changedTask.status === "cancelled"
              ? "cancelled"
              : "scheduled";
    statements.push(
      db
        .prepare(
          "UPDATE route_partner_tasks SET status=?,started_at=?,completed_at=?,office_notes=?,failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND route_plan_id=?",
        )
        .bind(
          taskStatus,
          changedTask.startedAt,
          changedTask.completedAt,
          changedTask.notes,
          changedTask.reason || null,
          changedTask.id,
          day.planId,
        ),
    );
  }
  if (["confirm_load", "complete_task", "finish_day"].includes(event.type))
    for (const i of day.inventory)
      statements.push(
        db
          .prepare(
            "UPDATE route_partner_shift_inventory SET loaded_quantity=?,delivered_quantity=?,returned_quantity=?,damaged_quantity=?,missing_quantity=?,updated_at=CURRENT_TIMESTAMP WHERE shift_id=? AND product_id=?",
          )
          .bind(
            i.loaded,
            i.delivered,
            i.returned,
            i.damaged,
            i.missing,
            shift.id,
            i.productId,
          ),
      );
  if (event.type === "confirm_load")
    statements.push(
      db
        .prepare(
          "UPDATE route_partner_load_checks SET status='confirmed',confirmed_items=?,confirmed_at=?,confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE route_plan_id=?",
        )
        .bind(
          JSON.stringify(event.body.items),
          event.recordedAt,
          member.email,
          day.planId,
        ),
    );
  if (event.type === "start_break") {
    const b = day.shift.breaks.at(-1);
    statements.push(
      db
        .prepare(
          "INSERT INTO route_partner_field_breaks(id,shift_id,break_type,started_at,starting_mileage) VALUES (?,?,?,?,?)",
        )
        .bind(
          b.id,
          shift.id,
          b.paid ? "paid_break" : "lunch",
          b.startedAt,
          b.startMileage,
        ),
    );
  }
  if (event.type === "end_break") {
    const b = day.shift.breaks.at(-1);
    statements.push(
      db
        .prepare(
          "UPDATE route_partner_field_breaks SET ended_at=?,ending_mileage=? WHERE id=? AND shift_id=?",
        )
        .bind(b.endedAt, b.endMileage, b.id, shift.id),
    );
  }
  if (event.type === "complete_task" && changedTask?.serviceId === "food") {
    const proof = changedTask.photos.find((p) => p.purpose === "delivery");
    statements.push(
      db
        .prepare(
          "UPDATE dog_food_deliveries SET status='delivered',delivered_at=?,proof_photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT dog_food_delivery_id FROM route_partner_tasks WHERE id=? AND route_plan_id=?)",
        )
        .bind(
          event.recordedAt,
          `/api/field/photo/${proof.id}/`,
          changedTask.id,
          day.planId,
        ),
    );
  }
  if (event.type === "skip_task")
    statements.push(
      db
        .prepare(
          "INSERT INTO route_partner_change_requests(id,organization_id,route_plan_id,task_id,request_type,reason_code,details,status,inventory_disposition,requested_by) VALUES (?,?,?,?,'field_exception',?,?,'pending',?,?)",
        )
        .bind(
          event.id,
          member.organizationId,
          day.planId,
          changedTask.id,
          event.body.reason,
          JSON.stringify({
            notes: event.body.notes,
            recordedAt: event.recordedAt,
          }),
          changedTask.serviceId === "food"
            ? "return_to_vehicle"
            : "not_applicable",
          member.id,
        ),
    );
  for (const c of changes) {
    statements.push(
      db
        .prepare(
          "UPDATE field_dispatch_changes SET status='accepted',accepted_at=? WHERE id=? AND shift_id=? AND status='pending'",
        )
        .bind(event.recordedAt, c.id, shift.id),
    );
    if (c.kind === "add_service") {
      const t = c.payload.task;
      statements.push(
        db
          .prepare(
            "INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,status,estimated_minutes,product_summary,metadata) VALUES (?,?,?,?,'other','opwp','scheduled',?,?,?)",
          )
          .bind(
            t.id,
            day.planId,
            c.payload.stopId,
            member.organizationId,
            t.estimatedMinutes,
            t.title,
            JSON.stringify({
              workday: { serviceId: t.serviceId, quantity: t.quantity },
            }),
          ),
      );
    }
    if (c.kind === "add_visit") {
      const s = c.payload.stop,
        t = s.tasks[0];
      statements.push(
        db
          .prepare(
            "INSERT INTO route_partner_locations(id,route_plan_id,organization_id,location_key,sequence,address,latitude,longitude,customer_display_name,estimated_service_minutes) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            s.id,
            day.planId,
            member.organizationId,
            `reclean:${s.id}`,
            day.stops.findIndex((stop) => stop.id === s.id) + 1,
            s.address,
            s.latitude,
            s.longitude,
            s.name,
            t.estimatedMinutes,
          ),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,status,estimated_minutes,product_summary,metadata) VALUES (?,?,?,?,'other','opwp','scheduled',?,?,?)",
          )
          .bind(
            t.id,
            day.planId,
            s.id,
            member.organizationId,
            t.estimatedMinutes,
            t.title,
            JSON.stringify({
              workday: { serviceId: t.serviceId, quantity: t.quantity },
              recleanOf: s.recleanOf,
            }),
          ),
      );
    }
    if (c.kind === "reorder")
      c.payload.stopIds.forEach((id, i) =>
        statements.push(
          db
            .prepare(
              "UPDATE route_partner_locations SET sequence=? WHERE id=? AND route_plan_id=?",
            )
            .bind(i + 1, id, day.planId),
        ),
      );
  }
  if (day.shift.clockOut) {
    const manifest = {
      schema: "opwp.field-closeout.v2",
      destination: "sweep_and_go",
      organizationId: day.organizationId,
      shiftId: day.id,
      routePlanId: day.planId,
      serviceDate: day.date,
      employeeId: day.employeeId,
      sourceFingerprint: day.sourceFingerprint,
      technicianMemberId: member.id,
      timezone: "America/New_York",
      timestampFormat: "UTC",
      startNotes: day.shift.notes,
      endNotes: day.shift.endNotes,
      clockIn: day.shift.clockIn,
      clockOut: day.shift.clockOut,
      startingMileage: day.shift.startMileage,
      endingMileage: day.shift.endMileage,
      vehicleType: day.shift.vehicle,
      breaks: day.shift.breaks,
      totals: {
        ...workdaySummary(day),
        paidMinutes: Math.round(workdaySummary(day).paidSeconds / 60),
        unpaidMinutes: Math.round(workdaySummary(day).unpaidSeconds / 60),
      },
      jobs: day.stops.flatMap((s) =>
        s.tasks.map((t) => ({
          ...t,
          sourceProvider: t.source?.provider,
          sourceJobId: t.source?.jobId,
          source: t.source?.identity,
          endedAt: t.completedAt,
          officeNotes: t.notes,
          exceptionReason: t.reason,
          localTaskId: t.id,
          stopId: s.id,
          proofs: t.photos,
          outcome:
            t.status === "skipped" ? "exception_requires_mapping" : t.status,
        })),
      ),
      writeEnabled: false,
    };
    statements.push(
      db
        .prepare(
          "INSERT INTO route_partner_field_closeouts(id,organization_id,shift_id,status,reason,manifest) VALUES (?,?,?,'blocked',?,?) ON CONFLICT(shift_id) DO NOTHING",
        )
        .bind(
          crypto.randomUUID(),
          member.organizationId,
          shift.id,
          "SNG writes require a verified supported contract. No SNG upload has been performed.",
          JSON.stringify(manifest),
        ),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO route_partner_field_events(id,organization_id,shift_id,route_plan_id,location_id,task_id,event_type,actor_member_id,details,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        event.id,
        member.organizationId,
        shift.id,
        day.planId,
        changedStop?.id || null,
        changedTask?.id || null,
        event.type,
        member.id,
        JSON.stringify({ workday: true, body: event.body }),
        event.recordedAt,
      ),
  );
  const notice = day.notices.find((n) => n.id === event.id);
  if (notice) {
    const stop = day.stops.find((s) => s.id === notice.stopId),
      pref = stop.notificationPreference,
      recipient = normalizePhone(stop.phone),
      eligible =
        notificationsEnabled &&
        recipient &&
        pref?.channel === "sms" &&
        pref.events.includes(
          notice.kind === "on_way" ? "on_the_way" : "completed",
        ),
      content =
        notice.kind === "on_way"
          ? `Ohio Pet Waste Pros: Estimated arrival in ${notice.minutes} minutes. Please secure pets and ensure safe access. Reply STOP to opt out.`
          : notice.serviceId === "food"
            ? "Ohio Pet Waste Pros: Your food delivery is complete. Thank you! Reply STOP to opt out."
            : `Ohio Pet Waste Pros: Completed: ${stop.tasks
                .filter(
                  (t) => t.serviceId !== "food" && t.status === "completed",
                )
                .map((t) => t.title)
                .join(", ")
                .slice(
                  0,
                  300,
                )}.${stop.tasks.some((t) => t.status === "skipped") ? " Some work needs office follow-up." : ""} Thank you! Reply STOP to opt out.`;
    statements.push(
      db
        .prepare(
          "INSERT INTO field_workday_messages(id,organization_id,shift_id,stop_id,kind,recipient,content,expires_at,status,detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          event.id,
          member.organizationId,
          shift.id,
          stop.id,
          notice.kind,
          recipient,
          content,
          notice.expiresAt,
          eligible ? "queued" : "held",
          eligible
            ? "Awaiting configured sending transport."
            : !notificationsEnabled
              ? "Customer texting is disabled. Saved internally; no provider request."
              : "No verified SMS recipient and service preference. No provider request.",
        ),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const replay = await receipt(db, event, member, hash);
    if (replay) return replay;
    if (/FIELD_WORKDAY_CONFLICT|FIELD_OTHER_SHIFT_OPEN/.test(error.message))
      throw new FieldError(
        "Workday changed on another device or another shift is open. Reconcile saved work before continuing.",
        409,
      );
    throw error;
  }
  return { accepted: true, revision: day.revision };
}
export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{10}$/.test(digits)
    ? `+1${digits}`
    : /^1\d{10}$/.test(digits)
      ? `+${digits}`
      : "";
}
