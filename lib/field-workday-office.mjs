import { FieldError } from "./field-policy.mjs";
import { fieldCatalog, getWorkday } from "./field-workday-store.mjs";
import { validateService, serviceTask } from "./field-service-catalog.mjs";
import { taskDone } from "./field-workday-model.mjs";
import {
  recurringPropertyKey,
  validateRecurring,
} from "./field-recurring-services.mjs";
import { workdayInsights } from "./field-workday-insights.mjs";
export async function officeWorkdays(db, date, org = "org-opwp") {
  const [days, catalog, changes, messages, recurring, released, history] =
    await Promise.all([
      db
        .prepare(
          "SELECT w.state_json,s.status shift_status,m.display_name FROM field_workdays w JOIN route_partner_field_shifts s ON s.id=w.shift_id JOIN route_partner_members m ON m.id=w.member_id WHERE w.organization_id=? AND s.service_date=? ORDER BY m.display_name LIMIT 20",
        )
        .bind(org, date)
        .all(),
      fieldCatalog(db, org),
      db
        .prepare(
          "SELECT c.* FROM field_dispatch_changes c JOIN route_partner_field_shifts s ON s.id=c.shift_id WHERE c.organization_id=? AND s.service_date=? ORDER BY c.created_at DESC LIMIT 100",
        )
        .bind(org, date)
        .all(),
      db
        .prepare(
          "SELECT n.* FROM field_workday_messages n JOIN route_partner_field_shifts s ON s.id=n.shift_id WHERE n.organization_id=? AND s.service_date=? ORDER BY n.created_at DESC LIMIT 100",
        )
        .bind(org, date)
        .all(),
      db
        .prepare(
          "SELECT * FROM field_property_services WHERE organization_id=? ORDER BY property_name,service_id LIMIT 2000",
        )
        .bind(org)
        .all(),
      db
        .prepare(
          "SELECT s.id,m.display_name,m.email FROM route_partner_field_shifts s JOIN route_partner_members m ON m.id=s.technician_member_id JOIN route_partner_route_plans p ON p.id=s.route_plan_id LEFT JOIN field_workdays w ON w.shift_id=s.id WHERE s.organization_id=? AND s.service_date=? AND s.checked_in_at IS NULL AND s.status<>'cancelled' AND p.status='finalized' AND w.shift_id IS NULL AND m.status='active' AND m.role='technician' ORDER BY m.display_name LIMIT 20",
        )
        .bind(org, date)
        .all(),
      db
        .prepare(
          "SELECT w.state_json FROM field_workdays w JOIN route_partner_field_shifts s ON s.id=w.shift_id WHERE w.organization_id=? AND s.service_date BETWEEN date(?,'-29 days') AND ? ORDER BY s.service_date DESC LIMIT 100",
        )
        .bind(org, date, date)
        .all(),
    ]);
  return {
    date,
    insights: workdayInsights(
      history.results.map((r) => JSON.parse(r.state_json)),
    ),
    released: released.results,
    recurring: recurring.results,
    days: days.results.map((r) => JSON.parse(r.state_json)),
    catalog,
    changes: changes.results.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload),
    })),
    messages: messages.results,
    capabilities: {
      sngWrites: false,
      sngReads: true,
      notificationSending:
        "Requires configured provider and verified current recipient preferences",
    },
  };
}
export async function officeWorkdayCommand(db, actor, body, org = "org-opwp") {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new FieldError("Choose an office operation.");
  if (body.action === "open_workday") {
    const member = await db
      .prepare(
        "SELECT m.id,m.organization_id organizationId,m.display_name name,m.email FROM route_partner_members m JOIN route_partner_field_shifts s ON s.technician_member_id=m.id WHERE s.id=? AND s.organization_id=? AND m.organization_id=? AND m.status='active' AND m.role='technician'",
      )
      .bind(typeof body.shiftId === "string" ? body.shiftId : "", org, org)
      .first();
    if (!member)
      throw new FieldError("Choose an assigned active technician shift.", 404);
    await getWorkday(db, member, { shiftId: body.shiftId });
    await db
      .prepare(
        "INSERT INTO route_partner_plan_events(id,organization_id,event_type,actor_email,details) VALUES (?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        org,
        "field_workday_prepared",
        actor,
        JSON.stringify({ shiftId: body.shiftId }),
      )
      .run();
    return {
      message:
        "Released workday prepared. Review services and access before the technician starts.",
    };
  }
  if (body.action === "save_service") {
    const service = validateService(body.service),
      count = await db
        .prepare(
          "SELECT COUNT(*) n FROM field_service_catalog WHERE organization_id=?",
        )
        .bind(org)
        .first(),
      existing = await db
        .prepare(
          "SELECT id FROM field_service_catalog WHERE organization_id=? AND id=?",
        )
        .bind(org, service.id)
        .first();
    if (!existing && count.n >= 60)
      throw new FieldError("Service catalog limit reached.");
    await db
      .prepare(
        `INSERT INTO field_service_catalog(organization_id,id,name,unit_label,minutes_per_unit,timed,entry_required,proof_kind,active,instructions) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET name=excluded.name,unit_label=excluded.unit_label,minutes_per_unit=excluded.minutes_per_unit,timed=excluded.timed,entry_required=excluded.entry_required,proof_kind=excluded.proof_kind,active=excluded.active,instructions=excluded.instructions,updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(
        org,
        service.id,
        service.name,
        service.unitLabel,
        service.minutesPerUnit,
        Number(service.timed),
        Number(service.entryRequired),
        service.proofKind,
        Number(service.active),
        service.instructions,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO route_partner_plan_events(id,organization_id,event_type,actor_email,details) VALUES (?,?,?, ?,?)",
      )
      .bind(
        crypto.randomUUID(),
        org,
        "field_service_configured",
        actor,
        JSON.stringify(service),
      )
      .run();
    return {
      message:
        "Service saved. Existing assigned tasks retain their reviewed rules.",
    };
  }
  const row = await db
    .prepare(
      `SELECT w.state_json FROM field_workdays w JOIN route_partner_field_shifts s ON s.id=w.shift_id JOIN route_partner_route_plans p ON p.id=s.route_plan_id WHERE w.shift_id=? AND w.organization_id=? AND s.status<>'cancelled' AND p.status IN ('finalized','in_progress','completed')`,
    )
    .bind(typeof body.shiftId === "string" ? body.shiftId : "", org)
    .first();
  if (!row) throw new FieldError("Choose an available OPWP workday.", 404);
  const day = JSON.parse(row.state_json),
    stop = day.stops.find((s) => s.id === body.stopId),
    note = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!note || note.length > 2000)
    throw new FieldError(
      "Explain this office change in 2,000 characters or fewer.",
    );
  if (body.action === "cancel_change") {
    const pending = await db
      .prepare(
        "SELECT id,kind FROM field_dispatch_changes WHERE id=? AND shift_id=? AND organization_id=? AND status='pending'",
      )
      .bind(String(body.changeId || ""), day.id, org)
      .first();
    if (!pending || body.verified !== true)
      throw new FieldError("Verify the situation and choose a pending change.");
    await db.batch([
      db
        .prepare(
          "UPDATE field_dispatch_changes SET status='cancelled' WHERE id=? AND shift_id=? AND status='pending'",
        )
        .bind(pending.id, day.id),
      db
        .prepare(
          "INSERT INTO route_partner_plan_events(id,organization_id,event_type,actor_email,details) VALUES (?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          org,
          "field_change_cancelled",
          actor,
          JSON.stringify({
            shiftId: day.id,
            changeId: pending.id,
            kind: pending.kind,
            reason: note,
            verified: true,
          }),
        ),
    ]);
    return {
      message:
        "Pending change cancelled with an office verification record. Retained device actions can retry against the current workday.",
    };
  }
  if (body.action === "save_recurring") {
    const key = recurringPropertyKey(
      stop?.tasks.find(
        (t) => t.source?.provider === "sweep_and_go" && t.source.identity,
      )?.source.identity,
    );
    if (!key)
      throw new FieldError(
        "This property needs a stable imported SNG property identity before recurring services can be assigned.",
      );
    const service = (await fieldCatalog(db, org)).find(
      (s) => s.id === body.serviceId && s.active && s.id !== "food",
    );
    if (!service)
      throw new FieldError(
        "Choose an active add-on. Food uses its separate paid subscription workflow.",
      );
    const rule = validateRecurring(body, day.date),
      id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO field_property_services(id,organization_id,property_key,property_name,service_id,quantity,every_weeks,weekdays,start_date,active,instructions,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,property_key,service_id) DO UPDATE SET quantity=excluded.quantity,every_weeks=excluded.every_weeks,weekdays=excluded.weekdays,start_date=excluded.start_date,active=excluded.active,instructions=excluded.instructions,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP",
        )
        .bind(
          id,
          org,
          key,
          stop.name,
          service.id,
          rule.quantity,
          rule.everyWeeks,
          JSON.stringify(rule.weekdays),
          rule.startDate,
          Number(rule.active),
          note,
          actor,
        ),
      db
        .prepare(
          "INSERT INTO route_partner_plan_events(id,organization_id,event_type,actor_email,details) VALUES (?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          org,
          "field_recurring_service_configured",
          actor,
          JSON.stringify({
            propertyKey: key,
            serviceId: service.id,
            ...rule,
            instructions: note,
            billingReviewed: true,
          }),
        ),
    ]);
    return {
      message:
        "Recurring service saved for newly opened workdays on matching imported property visits. Existing workdays and billing remain unchanged; schedule separate visits through dispatch.",
    };
  }
  if (day.shift.clockOut && body.action !== "response")
    throw new FieldError(
      "This workday is closed. Schedule new work on a released route.",
    );
  if (
    ["add_service", "reclean", "reorder"].includes(body.action) &&
    !["ready", "loading", "loaded", "on_route"].includes(day.shift.status)
  )
    throw new FieldError(
      "Wrap-up has started. Schedule new work on another released route.",
    );
  let kind, payload;
  if (body.action === "add_service" || body.action === "reclean") {
    if (
      !stop ||
      !Number.isInteger(body.quantity) ||
      body.quantity < 1 ||
      body.quantity > 50
    )
      throw new FieldError("Choose a property and service quantity.");
    const catalog = await fieldCatalog(db, org),
      service = catalog.find((s) => s.id === body.serviceId && s.active);
    if (!service || service.id === "food")
      throw new FieldError(
        "Choose an active add-on service. Food must use the verified order/payment workflow.",
      );
    const task = serviceTask(service, {
      id: crypto.randomUUID(),
      quantity: body.quantity,
      notes: note,
      source: { provider: "opwp", jobId: null, customerId: null },
    });
    if (body.action === "add_service") {
      if (stop.tasks.every(taskDone))
        throw new FieldError(
          "Use a separate reclean visit for a finished property.",
        );
      kind = "add_service";
      payload = { stopId: stop.id, task, reason: note };
    } else {
      kind = "add_visit";
      payload = {
        stop: {
          ...structuredClone(stop),
          id: crypto.randomUUID(),
          status: "pending",
          arrivedAt: null,
          completedAt: null,
          clearanceAt: null,
          safety: stop.safety === "clear" ? "clear" : "unknown",
          recleanOf: stop.id,
          tasks: [{ ...task, title: `Return visit: ${task.title}` }],
          travelMinutes: null,
          instructions: note,
        },
        reason: note,
      };
    }
  } else if (body.action === "safety") {
    if (!stop || typeof body.safe !== "boolean")
      throw new FieldError("Choose the property and confirmed safety state.");
    kind = "safety";
    if (body.hasGate !== undefined && typeof body.hasGate !== "boolean")
      throw new FieldError("Choose a verified gate state.");
    payload = {
      stopId: stop.id,
      safe: body.safe,
      reason: note,
      ...(typeof body.hasGate === "boolean" ? { hasGate: body.hasGate } : {}),
    };
  } else if (body.action === "response") {
    if (!day.issues.some((i) => i.id === body.issueId))
      throw new FieldError("Choose an issue from this workday.");
    kind = "response";
    payload = { issueId: body.issueId, text: note };
  } else if (body.action === "reorder") {
    if (
      !Array.isArray(body.stopIds) ||
      body.stopIds.length !== day.stops.length ||
      new Set(body.stopIds).size !== day.stops.length ||
      body.stopIds.some((id) => !day.stops.some((s) => s.id === id))
    )
      throw new FieldError("Provide every stop exactly once.");
    day.stops.forEach((s, i) => {
      if ((s.arrivedAt || s.tasks.some(taskDone)) && body.stopIds[i] !== s.id)
        throw new FieldError("Arrived or accounted stops are locked.");
    });
    kind = "reorder";
    payload = { stopIds: body.stopIds, reason: note };
  } else throw new FieldError("Unsupported office operation.");
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO field_dispatch_changes(id,organization_id,shift_id,kind,payload,created_by) VALUES (?,?,?,?,?,?)",
    )
    .bind(id, org, day.id, kind, JSON.stringify(payload), actor)
    .run();
  return {
    id,
    message:
      "Change saved for explicit technician review. Source-system schedule and billing were not changed.",
  };
}
