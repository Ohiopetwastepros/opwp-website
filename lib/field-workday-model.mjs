import { FieldError, operatingDate } from "./field-policy.mjs";
export const PRECHECKS = [
  ["tools", "Scooper, rake and bucket"],
  ["bags", "Waste bags and litter supplies"],
  ["sanitizer", "Sanitizer and service products"],
  ["ppe", "Gloves, water and hand sanitizer"],
  ["truck", "Vehicle checked and load secured"],
];
export const WRAPCHECKS = [
  ["disposal", "Waste disposed of correctly"],
  ["clean", "Tools cleaned and sanitized"],
  ["supplies", "Supplies restocked"],
  ["vehicle", "Vehicle clean and secured"],
];
export const BREAK_TYPES = [
  { id: "paid", name: "Paid break", paid: true },
  { id: "unpaid", name: "Unpaid lunch / personal", paid: false },
];
export const ETA_OPTIONS = [10, 15, 25, 30, 45, 60];
export const taskDone = (t) =>
  ["completed", "skipped", "cancelled"].includes(t.status);
const requireValue = (ok, message, status = 400) => {
  if (!ok) throw new FieldError(message, status);
};
const text = (v, max = 2000) => {
  requireValue(
    typeof v === "string" && v.length <= max,
    "Text exceeds the allowed length.",
  );
  return v;
};
const mileage = (v) => {
  requireValue(
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9999999,
    "Enter a valid full odometer reading.",
  );
  return v;
};
export function activeService(day) {
  return day.stops.flatMap((s) => s.tasks).find((t) => t.status === "working");
}
export function workdaySummary(day, now = Date.now()) {
  const end = day.shift.clockOut ? Date.parse(day.shift.clockOut) : now,
    start = Date.parse(day.shift.clockIn);
  const elapsed = Number.isFinite(start)
    ? Math.max(0, (end - start) / 1000)
    : 0;
  const unpaid = day.shift.breaks
    .filter((b) => !b.paid)
    .reduce(
      (n, b) =>
        n +
        Math.max(
          0,
          (Math.min(end, Date.parse(b.endedAt || new Date(end).toISOString())) -
            Date.parse(b.startedAt)) /
            1000,
        ),
      0,
    );
  const personalMiles = day.shift.breaks
    .filter((b) => !b.paid && b.endMileage != null)
    .reduce((n, b) => n + Math.max(0, b.endMileage - b.startMileage), 0);
  const tasks = day.stops.flatMap((s) => s.tasks);
  return {
    services: tasks.length,
    completed: tasks.filter((t) => t.status === "completed").length,
    skipped: tasks.filter((t) => t.status === "skipped").length,
    accounted: tasks.filter(taskDone).length,
    stops: day.stops.length,
    stopsFinished: day.stops.filter((s) => s.tasks.every(taskDone)).length,
    paidSeconds: Math.max(0, elapsed - unpaid),
    unpaidSeconds: unpaid,
    workMiles:
      day.shift.endMileage == null
        ? null
        : Math.max(
            0,
            day.shift.endMileage - day.shift.startMileage - personalMiles,
          ),
    unresolvedIssues: day.issues.filter((i) => !i.response).length,
  };
}
export function routeGaps(day) {
  const stops = day.stops
    .filter((s) => s.arrivedAt)
    .sort((a, b) => Date.parse(a.arrivedAt) - Date.parse(b.arrivedAt));
  return stops.map((s, i) => {
    const previous = stops[i - 1],
      start = Date.parse(previous?.completedAt || day.shift.departedAt),
      end = Date.parse(s.arrivedAt);
    if (!Number.isFinite(start) || end < start)
      return { stopId: s.id, minutes: null, expected: s.travelMinutes };
    const breaks = day.shift.breaks.reduce(
      (n, b) =>
        n +
        Math.max(
          0,
          Math.min(end, Date.parse(b.endedAt || s.arrivedAt)) -
            Math.max(start, Date.parse(b.startedAt)),
        ) /
          60000,
      0,
    );
    return {
      stopId: s.id,
      minutes: Math.max(0, (end - start) / 60000 - breaks),
      expected: s.travelMinutes,
    };
  });
}
export function applyWorkdayEvent(
  original,
  event,
  { now = Date.now(), officeChanges = [] } = {},
) {
  requireValue(
    original?.schema === 1,
    "This workday needs a supported app version.",
  );
  requireValue(
    event &&
      /^[a-f0-9-]{36}$/i.test(event.id || "") &&
      event.shiftId === original.id,
    "Choose this assigned workday.",
  );
  requireValue(
    event.expectedRevision === original.revision,
    "This workday changed. Your saved work needs reconciliation.",
    409,
  );
  const at = Date.parse(event.recordedAt);
  requireValue(
    typeof event.recordedAt === "string" &&
      Number.isFinite(at) &&
      at <= now + 120000 &&
      at >= Date.parse(original.createdAt) - 120000,
    "Check the device clock; original timestamps are required.",
  );
  requireValue(
    !original.lastEventAt || at >= Date.parse(original.lastEventAt),
    "The device clock moved backwards. Your work is retained for review.",
  );
  const body = event.body || {};
  requireValue(
    typeof body === "object" && !Array.isArray(body),
    "Provide a bounded field action.",
  );
  const day = structuredClone(original),
    shift = day.shift,
    tasks = day.stops.flatMap((s) => s.tasks),
    active = activeService(day),
    task = tasks.find((t) => t.id === body.taskId),
    stop = day.stops.find(
      (s) => s.id === body.stopId || s.tasks.some((t) => t.id === body.taskId),
    );
  const serviceDate = operatingDate(new Date(at));
  const closing = [
    "end_break",
    "start_wrap",
    "finish_day",
    "clock_out",
    "save_note",
    "acknowledge",
    "accept_changes",
  ];
  requireValue(
    serviceDate === day.date ||
      (serviceDate > day.date &&
        shift.clockIn &&
        !shift.clockOut &&
        closing.includes(event.type)),
    "Work must be recorded on the assigned service date.",
  );
  requireValue(
    !shift.clockOut ||
      event.type === "acknowledge" ||
      (event.type === "accept_changes" &&
        officeChanges.every((c) => c.kind === "response")),
    "This workday is already clocked out.",
  );
  if (
    shift.activeBreak &&
    !["end_break", "save_note", "acknowledge"].includes(event.type)
  )
    throw new FieldError("End your break before recording work.");
  if (
    [
      "arrive",
      "start_task",
      "complete_task",
      "skip_task",
      "add_photo",
      "on_way",
    ].includes(event.type)
  )
    requireValue(
      shift.status === "on_route",
      "Complete departure checks and start the route first.",
    );
  function reading() {
    const value = mileage(body.mileage);
    const last = shift.breaks.at(-1);
    const prior = Math.max(
      shift.startMileage || 0,
      last?.endMileage || last?.startMileage || 0,
    );
    requireValue(value >= prior, "Odometer cannot move backwards.");
    if (value - prior > 300)
      requireValue(
        body.confirmMileage === true,
        "Confirm the unusually large mileage change.",
      );
    return value;
  }
  switch (event.type) {
    case "clock_in":
      requireValue(
        shift.status === "ready" && !shift.clockIn,
        "This shift has already started.",
      );
      requireValue(
        ["personal", "company"].includes(body.vehicle),
        "Choose a vehicle.",
      );
      Object.assign(shift, {
        clockIn: event.recordedAt,
        startMileage: mileage(body.mileage),
        vehicle: body.vehicle,
        notes: text(body.notes || ""),
        status: "loading",
      });
      break;
    case "check_item": {
      const list =
        shift.status === "loading"
          ? PRECHECKS
          : shift.status === "wrapping"
            ? WRAPCHECKS
            : null;
      requireValue(
        list?.some(([id]) => id === body.key) &&
          typeof body.checked === "boolean",
        "This checklist is not available.",
      );
      shift[shift.status === "loading" ? "prechecks" : "wrapchecks"][body.key] =
        body.checked;
      break;
    }
    case "confirm_load": {
      requireValue(
        shift.status === "loading" &&
          PRECHECKS.every(([id]) => shift.prechecks[id]),
        "Complete every departure check.",
      );
      requireValue(
        ["passed", "not_required"].includes(day.paymentStatus),
        "Food payment requires office review.",
      );
      requireValue(
        Array.isArray(body.items) && body.items.length === day.inventory.length,
        "Count every product loaded.",
      );
      const counts = new Map(body.items.map((i) => [i.productId, i.quantity]));
      requireValue(
        counts.size === day.inventory.length,
        "Count each product once.",
      );
      for (const item of day.inventory) {
        const n = counts.get(item.productId);
        requireValue(
          Number.isInteger(n) && n >= item.required && n <= 200,
          "Loaded quantities must cover scheduled deliveries.",
        );
        item.loaded = n;
      }
      shift.status = "loaded";
      break;
    }
    case "start_route":
      requireValue(
        shift.status === "loaded",
        "Complete the load check before departing.",
      );
      requireValue(
        ["passed", "not_required"].includes(day.paymentStatus),
        "Food payment requires office review.",
      );
      shift.status = "on_route";
      shift.departedAt = event.recordedAt;
      break;
    case "on_way":
      requireValue(
        stop &&
          !active &&
          !stop.tasks.every(taskDone) &&
          ETA_OPTIONS.includes(body.minutes),
        "Choose an unfinished stop and arrival window.",
      );
      day.notices.push({
        id: event.id,
        stopId: stop.id,
        kind: "on_way",
        at: event.recordedAt,
        expiresAt: new Date(at + body.minutes * 60000).toISOString(),
        minutes: body.minutes,
      });
      break;
    case "arrive":
      requireValue(
        stop && !active && !stop.tasks.every(taskDone),
        "Finish the active service before arriving elsewhere.",
      );
      if (!stop.arrivedAt) {
        stop.arrivedAt = event.recordedAt;
        stop.status = "arrived";
      }
      break;
    case "start_task":
      requireValue(
        task &&
          !taskDone(task) &&
          task.status === "pending" &&
          !active &&
          stop.arrivedAt,
        "Arrive and finish the active service first.",
      );
      if (task.entryRequired) {
        requireValue(body.safe === true, "Confirm safe access.");
        requireValue(
          stop.safety !== "unsafe",
          "Unsafe access requires office clearance.",
        );
        if (stop.safety !== "clear")
          requireValue(
            stop.clearanceAt &&
              at - Date.parse(stop.clearanceAt) <= 30 * 60000 &&
              at >= Date.parse(stop.clearanceAt),
            "Office clearance is missing or expired.",
          );
      }
      task.status = "working";
      task.startedAt = task.timed ? event.recordedAt : null;
      break;
    case "save_note":
      requireValue(task && !taskDone(task), "Choose an unfinished service.");
      task.notes = text(body.notes);
      break;
    case "add_photo":
      requireValue(
        task &&
          !taskDone(task) &&
          /^[a-f0-9-]{36}$/i.test(body.photoId || "") &&
          ["gate", "service", "delivery", "observation"].includes(body.purpose),
        "Choose a valid photo and unfinished service.",
      );
      requireValue(
        !tasks.some((t) => t.photos.some((p) => p.id === body.photoId)) &&
          task.photos.length < 8,
        "Photo already saved or limit reached.",
      );
      requireValue(
        body.purpose !== "delivery" || task.serviceId === "food",
        "Delivery proof belongs to food delivery.",
      );
      task.photos.push({
        id: body.photoId,
        purpose: body.purpose,
        at: event.recordedAt,
      });
      break;
    case "complete_task":
      requireValue(
        task?.status === "working",
        "Start this service before completion.",
      );
      requireValue(
        body.secured === true,
        "Confirm the property or delivery is secured.",
      );
      if (task.proofKind === "gate" && stop.hasGate !== false)
        requireValue(
          stop.tasks.some((t) =>
            t.photos.some(
              (p) =>
                p.purpose === "gate" &&
                Date.parse(p.at) >=
                  Date.parse(task.startedAt || stop.arrivedAt),
            ),
          ),
          "Add a latched-gate photo first.",
        );
      if (["service", "delivery"].includes(task.proofKind))
        requireValue(
          task.photos.some(
            (p) =>
              p.purpose === task.proofKind &&
              Date.parse(p.at) >= Date.parse(task.startedAt || stop.arrivedAt),
          ),
          "Add the required service or delivery proof.",
        );
      requireValue(
        body.units === task.quantity,
        "Confirm every assigned unit was serviced.",
      );
      task.status = "completed";
      task.completedAt = event.recordedAt;
      task.notes = text(body.notes || task.notes);
      for (const d of task.deliveryItems) {
        const item = day.inventory.find((i) => i.productId === d.productId);
        requireValue(
          item && item.delivered + d.quantity <= item.loaded,
          "Delivery exceeds the loaded inventory.",
        );
        item.delivered += d.quantity;
      }
      if (
        task.serviceId === "food" ||
        stop.tasks.filter((t) => t.serviceId !== "food").every(taskDone)
      )
        day.notices.push({
          id: event.id,
          stopId: stop.id,
          kind: "completed",
          at: event.recordedAt,
          expiresAt: new Date(at + 3600000).toISOString(),
          serviceId: task.serviceId,
        });
      break;
    case "skip_task":
      requireValue(
        task &&
          !taskDone(task) &&
          (!active || active.id === task.id) &&
          body.confirm === true,
        "Confirm this unfinished service should be skipped.",
      );
      requireValue(
        [
          "Locked gate",
          "Unsafe animal",
          "Weather",
          "Customer request",
          "Equipment",
          "Other",
        ].includes(body.reason),
        "Choose an exception reason.",
      );
      requireValue(
        text(body.notes || "").trim(),
        "Explain this exception for the office.",
      );
      Object.assign(task, {
        status: "skipped",
        completedAt: event.recordedAt,
        notes: body.notes,
        reason: body.reason,
      });
      if (body.reason === "Unsafe animal") {
        stop.safety = "unsafe";
        stop.clearanceAt = null;
      }
      day.issues.push({
        id: event.id,
        taskId: task.id,
        stopId: stop.id,
        reason: body.reason,
        notes: body.notes,
        at: event.recordedAt,
        response: null,
      });
      break;
    case "start_break": {
      const policy = BREAK_TYPES.find((b) => b.id === body.breakType);
      requireValue(
        shift.status === "on_route" && !active && !shift.activeBreak && policy,
        "Finish active work and choose a break.",
      );
      shift.breaks.push({
        id: event.id,
        kind: policy.id,
        paid: policy.paid,
        startedAt: event.recordedAt,
        endedAt: null,
        startMileage: reading(),
        endMileage: null,
      });
      shift.activeBreak = event.id;
      break;
    }
    case "end_break": {
      requireValue(shift.activeBreak, "No active break.");
      const b = shift.breaks.find((b) => b.id === shift.activeBreak);
      b.endMileage = reading();
      b.endedAt = event.recordedAt;
      shift.activeBreak = null;
      break;
    }
    case "start_wrap":
      requireValue(
        shift.status === "on_route" && !active && tasks.every(taskDone),
        "Account for every service before wrap-up.",
      );
      shift.status = "wrapping";
      shift.wrapStartedAt = event.recordedAt;
      break;
    case "finish_day":
      requireValue(
        shift.status === "wrapping" &&
          WRAPCHECKS.every(([id]) => shift.wrapchecks[id]),
        "Complete the wrap-up checklist.",
      );
      requireValue(
        Array.isArray(body.items) && body.items.length === day.inventory.length,
        "Account for remaining products.",
      );
      for (const item of day.inventory) {
        const matches = body.items.filter(
          (i) => i.productId === item.productId,
        );
        requireValue(matches.length === 1, "Count each product once.");
        const c = matches[0];
        requireValue(
          ["returned", "damaged", "missing"].every(
            (k) => Number.isInteger(c[k]) && c[k] >= 0 && c[k] <= 200,
          ) &&
            c.returned + c.damaged + c.missing === item.loaded - item.delivered,
          "Returned, damaged and missing quantities must account for the load.",
        );
        Object.assign(item, {
          returned: c.returned,
          damaged: c.damaged,
          missing: c.missing,
        });
      }
      Object.assign(shift, {
        endMileage: reading(),
        clockOut: event.recordedAt,
        endNotes: text(body.notes || ""),
        status: "finished",
      });
      break;
    case "clock_out":
      requireValue(
        shift.clockIn && !active,
        "Finish or report active work before clock-out.",
      );
      requireValue(
        text(body.notes || "").trim(),
        "Explain the early clock-out for office follow-up.",
      );
      Object.assign(shift, {
        endMileage: reading(),
        clockOut: event.recordedAt,
        endNotes: body.notes,
        status: "finished",
      });
      day.issues.push({
        id: event.id,
        reason: "Incomplete closeout",
        notes: body.notes,
        at: event.recordedAt,
        response: null,
      });
      break;
    case "accept_changes":
      requireValue(
        !active &&
          !shift.activeBreak &&
          Array.isArray(body.changeIds) &&
          body.changeIds.length > 0 &&
          officeChanges.length === body.changeIds.length,
        "Review office changes between services while connected.",
      );
      for (const change of officeChanges) {
        const b = change.payload,
          s = day.stops.find((s) => s.id === b.stopId);
        if (["add_service", "add_visit", "reorder"].includes(change.kind))
          requireValue(
            ["ready", "loading", "loaded", "on_route"].includes(shift.status),
            "The route is closed to new work after wrap-up starts.",
          );
        if (change.kind === "add_service") {
          requireValue(
            s &&
              !s.tasks.every(taskDone) &&
              day.stops.flatMap((s) => s.tasks).length < 160,
            "This property is already finished or route capacity was reached.",
          );
          s.tasks.push(b.task);
        } else if (change.kind === "add_visit") {
          requireValue(
            day.stops.length < 60 &&
              day.stops.flatMap((s) => s.tasks).length + b.stop.tasks.length <=
                160 &&
              !day.stops.some((s) => s.id === b.stop.id),
            "Route visit capacity was reached.",
          );
          day.stops.push(b.stop);
        } else if (change.kind === "reorder") {
          requireValue(
            b.stopIds.length === day.stops.length &&
              new Set(b.stopIds).size === day.stops.length,
            "Review the complete stop order.",
          );
          const next = b.stopIds.map((id) =>
            day.stops.find((s) => s.id === id),
          );
          requireValue(next.every(Boolean), "Unknown stop in route change.");
          day.stops.forEach((s, i) => {
            if (s.arrivedAt || s.tasks.some(taskDone))
              requireValue(
                next[i].id === s.id,
                "An office change would move a locked stop.",
              );
          });
          day.stops = next;
        } else if (change.kind === "safety") {
          requireValue(
            s && typeof b.safe === "boolean",
            "Choose the property safety state.",
          );
          s.safety = b.safe ? "confirmed" : "unsafe";
          s.clearanceAt = b.safe ? event.recordedAt : null;
          if (typeof b.hasGate === "boolean") s.hasGate = b.hasGate;
        } else if (change.kind === "response") {
          if (b.customerReply) {
            day.issues.push({
              id: change.id,
              stopId: b.stopId,
              reason: "Customer reply",
              notes: b.text,
              at: event.recordedAt,
              response: null,
            });
          } else {
            const issue = day.issues.find((i) => i.id === b.issueId);
            requireValue(
              issue,
              "The office response no longer matches this day.",
            );
            issue.response = b.text;
            issue.responseId = change.id;
          }
        }
        day.acceptedChanges.push(change.id);
      }
      break;
    case "acknowledge": {
      const issue = day.issues.find((i) => i.id === body.issueId);
      requireValue(issue?.response, "Choose an office response.");
      issue.acknowledgedAt = event.recordedAt;
      break;
    }
    default:
      throw new FieldError("Unsupported workday action.");
  }
  if (stop && stop.tasks.every(taskDone)) {
    stop.status = "finished";
    stop.completedAt = event.recordedAt;
  }
  day.revision++;
  day.lastEventAt = event.recordedAt;
  requireValue(
    day.revision <= 4000,
    "Workday event limit reached; contact the office.",
  );
  return day;
}
