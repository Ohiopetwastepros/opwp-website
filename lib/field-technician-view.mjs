// Technician transport and device views are deliberately separate from the rich
// server state used by the office, notifications, identity checks and closeouts.
// New server properties stay private until explicitly included here.
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const boolean = (value) => value === true;
const string = (value) => {
  if (typeof value !== "string") return "";
  // IDs, statuses and timestamps are transport tokens, never free-form notes.
  if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return value;
  return /^[A-Za-z0-9_.:+-]{0,200}$/.test(value) && technicianText(value) === value ? value : "";
};
const nullableText = (value) => value == null ? null : technicianText(value);
const nullableString = (value) => value == null ? null : string(value);

// This is a conservative display filter, not a general natural-language privacy
// classifier. Structured contact and financial fields are excluded separately.
export function technicianText(value) {
  const text = (typeof value === "string" ? value : "")
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi, "[office contact]")
    .replace(/(?<!\w)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?(?!\w)/gi, "[office contact]")
    .replace(/\+\d(?:[ ().-]*\d){7,14}(?!\d)/g, "[office contact]")
    .replace(/\b\d{10,15}\b|\b\d{3}[-.]\d{4}\b/g, "[office contact]");
  return text.split(/((?<=[.!?])\s+|[\r\n;]+)/).map((clause, index) =>
    index % 2 === 0 && /[$£€]|\b(?:USD|dollars?|cents?|prices?|pricing|balances?|payments?|invoices?|billing|revenue|profits?|refunds?|credits?|charges?|charged|owed?|owes|salary|salaries|wages?|commissions?|card\s+(?:number|ending)|account\s+(?:number|ending))\b/i.test(clause)
      ? "[office review]" : clause,
  ).join("");
}

export function technicianMember(value) {
  if (!value) return null;
  const name = technicianText(value.name);
  return { id: string(value.id), organizationId: string(value.organizationId), name: name && !name.includes("[office ") ? name : "Technician" };
}

const quantityItem = (value) => ({ productId: string(value?.productId), quantity: number(value?.quantity) });
const proof = (value) => ({ id: string(value?.id), purpose: string(value?.purpose), at: nullableString(value?.at) });
const inventory = (value) => ({
  productId: string(value?.productId), name: technicianText(value?.name), color: technicianText(value?.color),
  required: number(value?.required), loaded: number(value?.loaded), delivered: number(value?.delivered),
  returned: number(value?.returned), damaged: number(value?.damaged), missing: number(value?.missing),
});
const workdayBreak = (value) => ({
  id: string(value?.id), kind: string(value?.kind), paid: boolean(value?.paid),
  startedAt: nullableString(value?.startedAt), endedAt: nullableString(value?.endedAt),
  startMileage: number(value?.startMileage), endMileage: number(value?.endMileage),
});
const issue = (value) => ({
  id: string(value?.id), taskId: nullableString(value?.taskId), stopId: nullableString(value?.stopId),
  reason: technicianText(value?.reason), notes: technicianText(value?.notes), at: nullableString(value?.at),
  response: nullableText(value?.response), responseId: nullableString(value?.responseId), acknowledgedAt: nullableString(value?.acknowledgedAt),
});
const notice = (value) => ({
  id: string(value?.id), stopId: string(value?.stopId), kind: string(value?.kind),
  at: nullableString(value?.at), expiresAt: nullableString(value?.expiresAt), minutes: number(value?.minutes), serviceId: nullableString(value?.serviceId),
});

export function technicianTask(value) {
  if (!value) return null;
  return {
    id: string(value.id), serviceId: string(value.serviceId), title: technicianText(value.title),
    quantity: number(value.quantity), unitLabel: technicianText(value.unitLabel), timed: boolean(value.timed),
    entryRequired: boolean(value.entryRequired), proofKind: string(value.proofKind), instructions: technicianText(value.instructions),
    estimatedMinutes: number(value.estimatedMinutes), estimateSource: technicianText(value.estimateSource), status: string(value.status),
    startedAt: nullableString(value.startedAt), completedAt: nullableString(value.completedAt), notes: technicianText(value.notes),
    photos: list(value.photos).map(proof), deliveryItems: list(value.deliveryItems).map(quantityItem),
    locationId: nullableString(value.locationId), placementNote: technicianText(value.placementNote),
    reason: nullableText(value.reason), recurringRuleId: nullableString(value.recurringRuleId),
  };
}

export function technicianStop(value) {
  if (!value) return null;
  return {
    id: string(value.id), address: technicianText(value.address), name: technicianText(value.name),
    latitude: number(value.latitude), longitude: number(value.longitude), travelMinutes: number(value.travelMinutes),
    hasGate: value.hasGate === false ? false : true, safety: string(value.safety), clearanceAt: nullableString(value.clearanceAt),
    gateCode: technicianText(value.gateCode), communityCode: technicianText(value.communityCode), instructions: technicianText(value.instructions),
    dogCount: number(value.dogCount), arrivedAt: nullableString(value.arrivedAt), completedAt: nullableString(value.completedAt),
    status: string(value.status), tasks: list(value.tasks).map(technicianTask), recleanOf: nullableString(value.recleanOf),
  };
}

function checklist(value, keys) {
  const result = {};
  for (const key of keys) if (typeof value?.[key] === "boolean") result[key] = value[key];
  return result;
}

export function technicianWorkday(value) {
  if (!value) return null;
  const shift = record(value.shift);
  const memberName = technicianText(value.memberName);
  return {
    schema: number(value.schema), id: string(value.id), organizationId: string(value.organizationId), memberId: string(value.memberId),
    memberName: memberName && !memberName.includes("[office ") ? memberName : "Technician", planId: string(value.planId), date: string(value.date),
    planVersion: number(value.planVersion), revision: number(value.revision), createdAt: string(value.createdAt), lastEventAt: nullableString(value.lastEventAt),
    departureReady: Object.hasOwn(value, "paymentStatus") ? ["passed", "not_required"].includes(value.paymentStatus) : value.departureReady === true,
    inventory: list(value.inventory).map(inventory),
    shift: {
      status: string(shift.status), clockIn: nullableString(shift.clockIn), clockOut: nullableString(shift.clockOut),
      startMileage: number(shift.startMileage), endMileage: number(shift.endMileage), activeBreak: nullableString(shift.activeBreak),
      breaks: list(shift.breaks).map(workdayBreak), prechecks: checklist(shift.prechecks, ["tools", "bags", "sanitizer", "ppe", "truck"]),
      wrapchecks: checklist(shift.wrapchecks, ["disposal", "clean", "supplies", "vehicle"]), notes: technicianText(shift.notes),
      endNotes: technicianText(shift.endNotes), vehicle: nullableString(shift.vehicle), departedAt: nullableString(shift.departedAt), wrapStartedAt: nullableString(shift.wrapStartedAt),
    },
    stops: list(value.stops).map(technicianStop), issues: list(value.issues).map(issue), notices: list(value.notices).map(notice),
    acceptedChanges: list(value.acceptedChanges).map(string).filter(Boolean),
  };
}

export function technicianChange(value) {
  const body = record(value?.payload);
  let payload;
  switch (value?.kind) {
    case "add_service": payload = { stopId: string(body.stopId), task: technicianTask(body.task), reason: technicianText(body.reason) }; break;
    case "add_visit": payload = { stop: technicianStop(body.stop), reason: technicianText(body.reason) }; break;
    case "reorder": payload = { stopIds: list(body.stopIds).map(string).filter(Boolean), reason: technicianText(body.reason) }; break;
    case "safety": payload = { stopId: string(body.stopId), safe: body.safe === true, reason: technicianText(body.reason), ...(typeof body.hasGate === "boolean" ? { hasGate: body.hasGate } : {}) }; break;
    case "response": payload = { stopId: nullableString(body.stopId), issueId: nullableString(body.issueId), text: technicianText(body.text), reason: technicianText(body.reason), customerReply: body.customerReply === true }; break;
    default: return null;
  }
  return { id: string(value.id), kind: string(value.kind), payload, created_at: nullableString(value.created_at) };
}

const message = (value) => ({
  id: string(value?.id), stop_id: nullableString(value?.stop_id), kind: string(value?.kind), status: string(value?.status),
  detail: technicianText(value?.detail), created_at: nullableString(value?.created_at),
});

export function technicianWorkdayResult(value) {
  return {
    day: technicianWorkday(value?.day), changes: list(value?.changes).map(technicianChange).filter(Boolean),
    messages: list(value?.messages).map(message), member: technicianMember(value?.member), sourceChanged: value?.sourceChanged === true,
  };
}

export function technicianReceipt(value) {
  return { accepted: value?.accepted === true, revision: number(value?.revision), ...(value?.duplicate === true ? { duplicate: true } : {}), ...(value?.replayed === true ? { replayed: true } : {}) };
}

const legacyBreak = (value) => ({
  id: nullableString(value?.id), break_type: string(value?.break_type), started_at: nullableString(value?.started_at), ended_at: nullableString(value?.ended_at),
  starting_mileage: number(value?.starting_mileage), ending_mileage: number(value?.ending_mileage),
});
function legacyField(value) {
  if (!value) return null;
  return {
    identity: { type: technicianText(value.identity?.type) }, frequency: technicianText(value.frequency),
    gateCode: technicianText(value.gateCode), communityCode: technicianText(value.communityCode), dogCount: number(value.dogCount),
    dogSafetySource: technicianText(value.dogSafetySource), sourceNote: technicianText(value.sourceNote), additionalServiceCount: number(value.additionalServiceCount),
  };
}
const legacyTask = (value) => ({
  id: string(value?.id), startedAt: nullableString(value?.startedAt), officeNotes: technicianText(value?.officeNotes), field: legacyField(value?.field),
  type: string(value?.type), status: string(value?.status), customerName: technicianText(value?.customerName), estimatedMinutes: number(value?.estimatedMinutes),
  placementNote: technicianText(value?.placementNote), productSummary: technicianText(value?.productSummary), crmCompletionStatus: string(value?.crmCompletionStatus),
  completedAt: nullableString(value?.completedAt), failureReason: technicianText(value?.failureReason), proofCount: number(value?.proofCount), noticeQueued: value?.noticeQueued === true,
});
const legacyInventory = (value) => ({
  product_id: string(value?.product_id), required_quantity: number(value?.required_quantity), loaded_quantity: number(value?.loaded_quantity),
  delivered_quantity: number(value?.delivered_quantity), returned_quantity: number(value?.returned_quantity), damaged_quantity: number(value?.damaged_quantity), missing_quantity: number(value?.missing_quantity),
  sku: technicianText(value?.sku), formula_code: technicianText(value?.formula_code), color: technicianText(value?.color), name: technicianText(value?.name), bag_weight_lb: number(value?.bag_weight_lb),
});

export function technicianLegacyDay(value) {
  if (!value) return null;
  const shift = value.shift, route = value.route, load = record(route?.load);
  return {
    date: string(value.date), member: technicianMember(value.member), ...(value.loadError ? { loadError: technicianText(value.loadError) } : {}),
    shift: shift ? {
      id: string(shift.id), vehicleType: string(shift.vehicleType), status: string(shift.status),
      startingMileage: number(shift.startingMileage), endingMileage: number(shift.endingMileage), checkedInAt: nullableString(shift.checkedInAt),
      departedAt: nullableString(shift.departedAt), completedAt: nullableString(shift.completedAt), breaks: list(shift.breaks).map(legacyBreak),
      activeBreak: shift.activeBreak ? legacyBreak(shift.activeBreak) : null,
      totals: { elapsedMinutes: number(shift.totals?.elapsedMinutes), unpaidMinutes: number(shift.totals?.unpaidMinutes), paidMinutes: number(shift.totals?.paidMinutes), workMiles: number(shift.totals?.workMiles) },
      closeout: shift.closeout ? { id: string(shift.closeout.id), status: string(shift.closeout.status), reason: technicianText(shift.closeout.reason), created_at: nullableString(shift.closeout.created_at) } : null,
    } : null,
    route: route ? {
      id: string(route.id), technicianName: technicianText(route.technicianName), version: number(route.version), status: string(route.status),
      sourceJobCount: number(route.sourceJobCount), foodTaskCount: number(route.foodTaskCount), locationCount: number(route.locationCount),
      load: { status: string(load.status), departureReady: Object.hasOwn(load, "paymentStatus") ? ["passed", "not_required"].includes(load.paymentStatus) : load.departureReady === true, confirmedAt: nullableString(load.confirmedAt), items: list(load.items).map(legacyInventory) },
      locations: list(route.locations).map((location) => ({
        id: string(location?.id), sequence: number(location?.sequence), address: technicianText(location?.address), customerName: technicianText(location?.customerName),
        status: string(location?.status), estimatedMinutes: number(location?.estimatedMinutes), estimatedDriveMinutes: number(location?.estimatedDriveMinutes),
        arrivedAt: nullableString(location?.arrivedAt), completedAt: nullableString(location?.completedAt), latitude: number(location?.latitude), longitude: number(location?.longitude), tasks: list(location?.tasks).map(legacyTask),
      })),
      totals: { tasks: number(route.totals?.tasks), completed: number(route.totals?.completed), stopsCompleted: number(route.totals?.stopsCompleted) },
      exceptions: list(route.exceptions).map((exception) => ({ id: string(exception?.id), task_id: string(exception?.task_id), request_type: string(exception?.request_type), reason_code: technicianText(exception?.reason_code), status: string(exception?.status), inventory_disposition: string(exception?.inventory_disposition), created_at: nullableString(exception?.created_at) })),
    } : null,
  };
}

export function technicianFieldActionResult(value) {
  return { message: technicianText(value?.message) };
}

export function technicianHistory(value) {
  return list(value).map((shift) => ({ id: string(shift?.id), service_date: string(shift?.service_date), status: string(shift?.status), checked_in_at: nullableString(shift?.checked_in_at), completed_at: nullableString(shift?.completed_at), location_count: number(shift?.location_count), sync_status: nullableString(shift?.sync_status) }));
}

const commandToken = (value) => string(value) === value && value.length > 0;
const commandText = (value) => typeof value === "string" ? technicianText(value) : undefined;
const commandNumber = (value) => typeof value === "number" && Number.isFinite(value);
const commandReading = (value) => commandNumber(value) || typeof value === "string" && /^\d{1,7}(?:\.\d+)?$/.test(value);
const commandBoolean = (value) => typeof value === "boolean";
const legacyCommandRules = {
  clock_in: { startingMileage: commandReading, vehicleType: commandToken, notes: commandText },
  confirm_load: { items: [{ productId: commandToken, quantity: commandNumber }] },
  start_route: {},
  arrive: { locationId: commandToken },
  start_task: { taskId: commandToken, safeToEnter: commandBoolean },
  on_the_way: { taskId: commandToken, leadMinutes: commandNumber, recommendedLeadMinutes: commandNumber, message: commandText },
  complete_task: { taskId: commandToken, notes: commandText, gateSecured: commandBoolean, placementConfirmed: commandBoolean },
  fail_task: { taskId: commandToken, reason: commandText, inventoryDisposition: commandToken, notes: commandText },
  start_break: { breakType: commandToken, mileage: commandReading, notes: commandText },
  end_break: { breakType: commandToken, mileage: commandReading, notes: commandText },
  complete_route: { endingMileage: commandReading, notes: commandText, items: [{ productId: commandToken, returned: commandNumber, damaged: commandNumber, missing: commandNumber }] },
};
function commandFields(value, rules) {
  const result = {};
  for (const key of Object.keys(record(value))) {
    if (!Object.hasOwn(rules, key)) continue;
    const rule = rules[key];
    if (Array.isArray(rule)) {
      if (Array.isArray(value[key])) result[key] = value[key].map((item) => commandFields(item, rule[0]));
    } else if (rule === commandText) {
      const text = commandText(value[key]);
      if (text !== undefined) result[key] = text;
    } else if (rule(value[key])) result[key] = value[key];
  }
  return result;
}
export function technicianLegacyCommand(value) {
  return commandFields(value, {
    action: commandToken, requestId: commandToken, shiftId: commandToken, date: commandToken,
    latitude: commandNumber, longitude: commandNumber,
    ...(legacyCommandRules[value?.action] || {}),
  });
}
export function technicianLegacyPending(value) {
  const original = value?.privacyHeld === true ? value.command : value;
  const command = technicianLegacyCommand(original);
  return {
    command,
    // Never replay changed content with an existing receipt ID. The old request
    // may have committed even when the phone never received its acknowledgement.
    privacyHeld: value?.privacyHeld === true || !Object.hasOwn(legacyCommandRules, original?.action) || JSON.stringify(command) !== JSON.stringify(original),
  };
}

export function migrateTechnicianLegacyStorage(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (typeof key === "string" && key.startsWith("opwp-field-command:")) keys.push(key);
  }
  const heldKeys = [], malformedKeys = [];
  for (const key of keys) {
    const raw = storage.getItem(key);
    let pending;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid saved action");
      pending = technicianLegacyPending(parsed);
    } catch {
      // Corrupt content cannot be safely displayed or replayed. Keep a visible
      // reconciliation marker in its original account slot, without raw bytes.
      pending = { command: {}, privacyHeld: true };
      malformedKeys.push(key);
    }
    if (pending.privacyHeld) {
      storage.setItem(key, JSON.stringify({ command: pending.command, privacyHeld: true }));
      heldKeys.push(key);
    }
    // Clean stored bytes are intentionally untouched, including JSON whitespace
    // and property order, so existing idempotency receipts remain usable.
  }
  return { heldKeys, malformedKeys };
}
