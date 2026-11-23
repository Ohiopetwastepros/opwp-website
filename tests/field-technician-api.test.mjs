import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { FieldError } from "../lib/field-policy.mjs";
import { readBoundedProviderJson } from "../lib/bounded-body.mjs";
import * as view from "../lib/field-technician-view.mjs";

const phone = "6145550199", email = "private-customer@example.invalid";
const secret = { phone, cellPhone: phone, homePhone: phone, email, price: 9599, balance: 8462, paymentHistory: [{ amount: 12345 }], planRevenue: 7654, routeRevenue: 6543, providerSecret: "PRIVATE-PROVIDER-VALUE" };
const note = `Gate code 1234; Call (614) 555-0199 or ${email}; balance is $95.99`;
const member = { id: "tech", organizationId: "org", name: "Technician Example", ...secret, externalEmployeeId: "PRIVATE-EMPLOYEE-ID" };
const proofId = "12345678-1234-1234-1234-123456789abc";
function task() {
  return { id: "task", serviceId: "litter", title: "Litter service", quantity: 2, unitLabel: "box", timed: true, entryRequired: true, proofKind: "service", instructions: note, estimatedMinutes: 12, estimateSource: "configured allowance", status: "pending", startedAt: null, completedAt: null, notes: note, photos: [{ id: proofId, purpose: "service", at: "2026-11-20T15:00:00Z", ...secret }], deliveryItems: [{ productId: "blue", quantity: 1, ...secret }], field: { identity: { customerId: "PRIVATE-CUSTOMER-ID", ...secret }, ...secret }, source: { provider: "sng", customerId: "PRIVATE-CUSTOMER-ID", ...secret }, ...secret };
}
function stop() {
  return { id: "stop", address: "123 Test Lane", name: "Test property", latitude: 40.1, longitude: -83.1, travelMinutes: 7, hasGate: true, safety: "clear", clearanceAt: null, gateCode: "1234", communityCode: "5678", instructions: note, dogCount: 2, arrivedAt: null, completedAt: null, status: "pending", tasks: [task()], propertyKey: "PRIVATE-PROPERTY-ID", notificationPreference: { ...secret }, ...secret };
}
function day() {
  return { schema: 1, id: "shift", organizationId: "org", memberId: "tech", memberName: member.name, planId: "plan", sourceFingerprint: "PRIVATE-FINGERPRINT", employeeId: "PRIVATE-EMPLOYEE-ID", date: "2026-11-20", planVersion: 1, revision: 4, createdAt: "2026-11-20T12:00:00Z", lastEventAt: null, paymentStatus: "passed", inventory: [{ productId: "blue", name: "Blue food", color: "blue", required: 1, loaded: 1, delivered: 0, returned: 0, damaged: 0, missing: 0, ...secret }], shift: { status: "on_route", clockIn: "2026-11-20T12:00:00Z", clockOut: null, startMileage: 123456, endMileage: null, activeBreak: null, breaks: [{ id: "break", kind: "paid", paid: true, startedAt: "2026-11-20T13:00:00Z", endedAt: "2026-11-20T13:15:00Z", startMileage: 123460, endMileage: 123460, ...secret }], prechecks: { tools: true, ...secret }, wrapchecks: { disposal: true, ...secret }, notes: note, endNotes: note, ...secret }, stops: [stop()], issues: [{ id: "issue", taskId: "task", stopId: "stop", reason: "Access", notes: note, response: note, ...secret }], notices: [{ id: "notice", stopId: "stop", kind: "on_way", minutes: 15, ...secret }], acceptedChanges: ["prior-change"], ...secret };
}
function result() {
  return { day: day(), member, changes: [
    { id: "add-task", kind: "add_service", payload: { stopId: "stop", task: task(), reason: note, ...secret }, ...secret },
    { id: "return-visit", kind: "add_visit", payload: { stop: stop(), reason: note, ...secret }, ...secret },
    { id: "order", kind: "reorder", payload: { stopIds: ["stop"], reason: note, ...secret }, ...secret },
    { id: "safety", kind: "safety", payload: { stopId: "stop", safe: false, hasGate: true, reason: note, ...secret }, ...secret },
    { id: "reply", kind: "response", payload: { stopId: "stop", customerReply: true, text: note, ...secret }, ...secret },
    { id: "response", kind: "response", payload: { issueId: "issue", text: note, ...secret }, ...secret },
    { id: "private-new-change", kind: "billing_changed", payload: secret },
  ], messages: [{ id: "message", stop_id: "stop", kind: "completed", status: "held", detail: note, ...secret }], sourceChanged: true, ...secret };
}
function legacyDay() {
  return { date: "2026-11-20", member, shift: { id: "shift", status: "in_progress", vehicleType: "company", startingMileage: 123456, checkedInAt: "2026-11-20T12:00:00Z", totals: { elapsedMinutes: 60, paidMinutes: 45, unpaidMinutes: 15, workMiles: 10, ...secret }, breaks: [{ break_type: "paid_break", started_at: "2026-11-20T13:00:00Z", ...secret }], closeout: { id: "close", status: "blocked", reason: note, ...secret }, ...secret }, route: { id: "plan", version: 1, status: "in_progress", locationCount: 1, sourceJobCount: 1, foodTaskCount: 0, routeId: "PRIVATE-EXTERNAL-ROUTE", load: { status: "confirmed", paymentStatus: "passed", items: [{ product_id: "blue", required_quantity: 1, loaded_quantity: 1, delivered_quantity: 0, returned_quantity: 0, damaged_quantity: 0, missing_quantity: 0, name: "Blue food", ...secret }], ...secret }, locations: [{ id: "stop", sequence: 1, address: "123 Test Lane", customerName: "Test property", status: "pending", latitude: 40.1, longitude: -83.1, estimatedMinutes: 10, tasks: [{ id: "task", type: "scoop", status: "scheduled", field: { identity: { type: "regular", customerId: "PRIVATE-CUSTOMER-ID", ...secret }, gateCode: "1234", communityCode: "5678", dogCount: 2, frequency: "weekly", dogSafetySource: "secured", sourceNote: note, additionalServiceCount: 2, ...secret }, officeNotes: note, productSummary: "Yard cleanup", proofCount: 1, ...secret }], ...secret }], totals: { tasks: 1, completed: 0, stopsCompleted: 0, ...secret }, exceptions: [{ id: "exception", task_id: "task", reason_code: note, ...secret }], ...secret }, ...secret };
}
function assertPrivate(value) {
  const serialized = JSON.stringify(value);
  for (const privateValue of [phone, email, "PRIVATE-PROVIDER-VALUE", "PRIVATE-CUSTOMER-ID", "PRIVATE-EMPLOYEE-ID", "PRIVATE-PROPERTY-ID", "PRIVATE-FINGERPRINT", "9599", "8462", "$95.99"])
    assert.ok(!serialized.includes(privateValue), `private value leaked: ${privateValue}`);
  function walk(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      assert.ok(!/^(?:phone|cellPhone|homePhone|email|price|balance|paymentHistory|paymentStatus|planRevenue|routeRevenue|providerSecret|source|notificationPreference|propertyKey)$/i.test(key), `private key leaked: ${key}`);
      walk(child);
    }
  }
  walk(value);
}
function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/^\uFEFF/, "")
    .replace(/^import\s[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
}
function loadRoute(path, dependencies, exports) {
  return vm.runInNewContext(`${source(path)}\n({${exports.join(",")}})`, { Response, Request, URL, crypto, console: { log() {}, error() {} }, ...view, ...dependencies });
}
const request = (path, method = "GET", body) => new Request(`https://example.test${path}`, { method, ...(method !== "GET" ? { headers: { Origin: "https://example.test", "Content-Type": "application/json" }, body: JSON.stringify(body || {}) } : {}) });
const auth = { authorized: true, member, expiresAt: "2026-11-21T12:00:00Z" };
const workdayHttp = loadRoute("../lib/field-workday-http.js", { FieldError }, ["workdayError", "workdayJson"]);

test("technician projections exclude rich nested data without modifying authoritative office state", () => {
  const rich = result(), original = structuredClone(rich), projected = view.technicianWorkdayResult(rich);
  assertPrivate(projected);
  assert.deepEqual(rich, original);
  assert.equal(rich.day.stops[0].phone, phone);
  assert.equal(rich.day.stops[0].tasks[0].source.customerId, "PRIVATE-CUSTOMER-ID");
  assert.equal(projected.day.departureReady, true);
  assert.equal(projected.day.stops[0].gateCode, "1234");
  assert.equal(projected.day.stops[0].tasks[0].quantity, 2);
  assert.equal(projected.day.shift.startMileage, 123456);
  assert.equal(projected.changes.length, 6);
  assert.equal(projected.changes[3].payload.safe, false);
  assert.equal(projected.changes[4].payload.customerReply, true);
  assert.equal(projected.messages[0].status, "held");
  assert.deepEqual(view.technicianWorkdayResult(projected), projected);
  assert.deepEqual(Object.keys(projected.member).sort(), ["id", "name", "organizationId"]);
  assert.equal(view.technicianMember({ id: "tech", name: email }).name, "Technician");
  assert.deepEqual(Object.keys(projected.changes[0]).sort(), ["created_at", "id", "kind", "payload"]);
  assert.equal(view.technicianWorkday({ ...rich.day, paymentStatus: "failed" }).departureReady, false);
  assert.equal(view.technicianWorkday({ ...rich.day, paymentStatus: "unknown", departureReady: true }).departureReady, false);
});

test("display text removes recognizable contacts and financial clauses while keeping access information", () => {
  const clean = view.technicianText(note);
  assert.ok(clean.includes("Gate code 1234"));
  assert.ok(!clean.includes(email));
  assert.ok(!clean.includes("555"));
  assert.ok(!clean.includes("95.99"));
  for (const value of ["+1 614.555.0199", "614-555-0199 ext 123", "+44 20 7946 0958", "Payment received 95 dollars", "Route revenue 1250", "Credit promised 40", "Card ending 1234"]) {
    const scrubbed = view.technicianText(value);
    assert.ok(scrubbed.includes("[office"));
    assert.notEqual(scrubbed, value);
  }
  assert.equal(view.technicianText("Gate 1234, community 5678. Service 2 boxes, 12 minutes. Odometer 123456."), "Gate 1234, community 5678. Service 2 boxes, 12 minutes. Odometer 123456.");
  assert.equal(view.technicianText("Gate latch damaged; dog remains outside.\nUse side gate."), "Gate latch damaged; dog remains outside.\nUse side gate.");
  assert.equal(view.technicianText({ email }), "");
});

test("typed transport slots reject contact and financial prose rather than bypassing text projection", () => {
  const value = day();
  value.id = email;
  value.planId = phone;
  value.lastEventAt = "Customer owes $95.99";
  value.stops[0].tasks[0].status = email;
  value.stops[0].tasks[0].photos[0].id = phone;
  value.acceptedChanges = [email, phone, "safe-change"];
  const projected = view.technicianWorkday(value);
  assertPrivate(projected);
  assert.equal(projected.id, "");
  assert.equal(projected.planId, "");
  assert.deepEqual(projected.acceptedChanges, ["safe-change"]);
  assert.equal(projected.stops[0].gateCode, "1234");
  const numericTailId = "00000000-0000-4000-8000-123456789012";
  assert.equal(view.technicianMember({ id: numericTailId }).id, numericTailId);
  assert.equal(view.technicianWorkday({ ...day(), id: numericTailId }).id, numericTailId);
  assert.equal(view.technicianTask({ ...task(), photos: [{ id: numericTailId }] }).photos[0].id, numericTailId);
  assert.equal(view.technicianHistory([{ checked_in_at: "2026-11-20 12:00:00" }])[0].checked_in_at, "2026-11-20 12:00:00");
});

test("legacy pending commands preserve safe retry bytes and hold scrubbed content across reloads", () => {
  const original = { action: "fail_task", taskId: "task", reason: "Unsafe animal", inventoryDisposition: "not_applicable", notes: "Gate latch damaged; dog remains outside.\nUse  side gate.", latitude: 40.1, longitude: -83.1, shiftId: "shift", date: "2026-11-20", requestId: proofId };
  const saved = JSON.stringify(original), restored = view.technicianLegacyPending(original);
  assert.equal(restored.privacyHeld, false);
  assert.equal(JSON.stringify(restored.command), saved);
  const restricted = { ...original, notes: note, unknownCustomerData: secret };
  const held = view.technicianLegacyPending(restricted);
  assert.equal(held.privacyHeld, true);
  assertPrivate(held.command);
  assert.equal(held.command.requestId, proofId);
  assert.equal(view.technicianLegacyPending(held).privacyHeld, true);
  const firstWrite = view.technicianLegacyCommand(restricted);
  assert.equal(view.technicianLegacyPending(firstWrite).privacyHeld, false);
  assertPrivate(firstWrite);
  assert.equal(view.technicianLegacyPending({ action: "unknown_action", requestId: proofId }).privacyHeld, true);
});

test("legacy storage boot migrates active, inactive and malformed actions within its own namespace", () => {
  const safe = JSON.stringify({ action: "arrive", locationId: "stop", shiftId: "shift", date: "2026-11-20", requestId: proofId }, null, 2);
  const values = new Map([
    ["opwp-field-command:active", safe],
    ["opwp-field-command:inactive", JSON.stringify({ action: "fail_task", taskId: "task", notes: note, requestId: proofId, ...secret })],
    ["opwp-field-command:broken", `{ invalid JSON ${email} ${phone}`],
    ["other-app:command", `unrelated ${email}`],
  ]);
  const storage = { get length() { return values.size; }, key(index) { return [...values.keys()][index]; }, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
  const migration = view.migrateTechnicianLegacyStorage(storage);
  assert.equal(values.get("opwp-field-command:active"), safe);
  assert.equal(values.get("other-app:command"), `unrelated ${email}`);
  assert.deepEqual(migration.heldKeys, ["opwp-field-command:inactive", "opwp-field-command:broken"]);
  assert.deepEqual(migration.malformedKeys, ["opwp-field-command:broken"]);
  for (const key of migration.heldKeys) {
    const saved = JSON.parse(values.get(key));
    assert.equal(saved.privacyHeld, true);
    assertPrivate(saved.command);
    assert.equal(view.technicianLegacyPending(saved).privacyHeld, true);
  }
  assert.equal(JSON.parse(values.get("opwp-field-command:inactive")).command.requestId, proofId);
  assert.deepEqual(JSON.parse(values.get("opwp-field-command:broken")).command, {});
  view.migrateTechnicianLegacyStorage(storage);
  assert.equal(values.get("opwp-field-command:active"), safe);
  assert.equal(JSON.parse(values.get("opwp-field-command:broken")).privacyHeld, true);
});

test("workday GET executes the technician projection for state, dispatch updates and message detail", async () => {
  const rich = result();
  const route = loadRoute("../app/api/field/workday/route.js", {
    ...workdayHttp, workdayContext: async () => ({ db: {}, auth }), getWorkday: async () => rich,
    operatingDate: () => "2026-11-20", offlineAccessUntil: () => "2026-11-20T23:00:00Z", fieldMessagesConfigured: () => false, getRuntimeEnv: () => ({}),
  }, ["GET"]);
  const response = await route.GET(request("/api/field/workday/?date=2026-11-20")), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assertPrivate(body);
  assert.equal(body.day.revision, 4);
  assert.equal(body.changes[1].payload.stop.tasks[0].quantity, 2);
  assert.equal(body.customerTextsEnabled, false);
  assert.equal(rich.day.stops[0].phone, phone);
});

test("workday success and duplicate replay expose only a receipt and retain submitted event content", async () => {
  for (const duplicate of [false, true]) {
    let captured;
    const event = { id: proofId, shiftId: "shift", expectedRevision: 4, type: "save_note", recordedAt: "2026-11-20T15:00:00Z", body: { taskId: "task", notes: "Gate latched" } };
    const route = loadRoute("../app/api/field/workday/route.js", {
      ...workdayHttp, workdayContext: async () => ({ db: {}, auth }), readBoundedProviderJson,
      saveWorkdayEvent: async (_db, _member, value) => { captured = value; return { accepted: true, revision: 5, duplicate, ...secret }; },
      getRuntimeEnv: () => ({}), fieldMessagesConfigured: () => false,
    }, ["POST"]);
    const body = await (await route.POST(request("/api/field/workday/", "POST", event))).json();
    assert.deepEqual(body, { ok: true, accepted: true, revision: 5, ...(duplicate ? { duplicate: true } : {}) });
    assert.deepEqual(captured, event);
  }
});

test("legacy today and action refresh project nested metadata and immutable replay results", async () => {
  const rich = legacyDay();
  const common = { getDb: () => ({}), verifyFieldRequest: async () => auth, getFieldToday: async () => rich, validDispatchDate: () => true, applyFieldAction() {} };
  const today = loadRoute("../app/api/field/today/route.js", common, ["GET"]);
  const body = await (await today.GET(request("/api/field/today/?date=2026-11-20"))).json();
  assertPrivate(body);
  assert.equal(body.day.route.load.departureReady, true);
  assert.equal(body.day.route.locations[0].tasks[0].field.gateCode, "1234");
  assert.deepEqual(Object.keys(body.day.route.locations[0].tasks[0].field).sort(), ["additionalServiceCount", "communityCode", "dogCount", "dogSafetySource", "frequency", "gateCode", "identity", "sourceNote"]);
  const action = loadRoute("../app/api/field/action/route.js", {
    ...common, FieldError, fieldQuota: async () => true, checkRateLimit: async () => ({ allowed: true }), readBoundedProviderJson,
    executeFieldCommand: async () => ({ message: `Gate secured; payment $95.99`, ...secret }),
  }, ["POST"]);
  const response = await action.POST(request("/api/field/action/", "POST", { date: "2026-11-20", shiftId: "shift" }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assertPrivate(result);
  assert.deepEqual(Object.keys(result).sort(), ["day", "message", "ok"]);
  assert.equal(rich.route.locations[0].tasks[0].field.email, email);
});

test("history and both session responses allowlist identity and operational fields", async () => {
  const history = loadRoute("../app/api/field/history/route.js", { getDb: () => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: "shift", service_date: "2026-11-20", location_count: 2, ...secret }] }) }) }) }), verifyFieldRequest: async () => auth }, ["GET"]);
  const historyBody = await (await history.GET(request("/api/field/history/"))).json();
  assertPrivate(historyBody);
  assert.equal(historyBody.shifts[0].location_count, 2);
  const NextResponse = { json(value, init) { const response = Response.json(value, init); response.cookies = { set() {} }; return response; } };
  const session = loadRoute("../app/api/field/session/route.js", {
    NextResponse, getDb: () => ({}), verifyFieldRequest: async () => auth, checkRateLimit: async () => ({ allowed: true }), fieldAuthConfigured: () => true,
    readBoundedProviderJson, authenticateFieldMember: async () => auth, createFieldSession: async () => "opaque-cookie", fieldSessionCookie: () => ({ name: "session", value: "opaque-cookie" }),
  }, ["GET", "POST"]);
  for (const response of [await session.GET(request("/api/field/session/")), await session.POST(request("/api/field/session/", "POST", { email: "technician@example.invalid", pin: "123456" }))]) {
    const result = await response.json();
    assertPrivate(result);
    assert.deepEqual(result.member, { id: "tech", organizationId: "org", name: "Technician Example" });
  }
});

test("proof upload receipts never expose rich proof rows, storage keys or provider data", async () => {
  const now = new Date().toISOString();
  const richDay = day(); richDay.createdAt = now; richDay.date = "2026-11-20";
  const row = { id: proofId, uploaded: 1, member_id: "tech", shift_id: "shift", task_id: "task", digest: "digest", purpose: "service", captured_at: now, object_key: "PRIVATE-PROOF-KEY", ...secret };
  const db = { prepare(sql) { return { bind() { return { first: async () => sql.includes("state_json") ? { state_json: JSON.stringify(richDay) } : row }; } }; } };
  const photo = loadRoute("../app/api/field/workday/photo/route.js", { ...workdayHttp, FieldError, workdayContext: async () => ({ db, auth }), ownedWorkdayShift: async () => ({ id: "shift" }), operatingDate: () => "2026-11-20", getRuntimeEnv: () => ({ FIELD_PROOFS: {} }), readBoundedBytes: async () => Uint8Array.from([255, 216, 255]), imageMatches: () => true, fieldDigest: async () => "digest" }, ["PUT"]);
  const response = await photo.PUT(new Request(`https://example.test/api/field/workday/photo/?${new URLSearchParams({ id: proofId, shiftId: "shift", taskId: "task", purpose: "service", capturedAt: now })}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: Uint8Array.from([255, 216, 255]) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: proofId });

  const legacyDb = { prepare(sql) { return { bind() { return { first: async () => sql.includes("COUNT(*)") ? { count: 0, ...secret } : { id: "task", route_plan_id: "plan", ...secret } }; } }; } };
  const legacy = loadRoute("../app/api/field/photo/route.js", { getDb: () => legacyDb, verifyFieldRequest: async () => auth, checkRateLimit: async () => ({ allowed: true }), fieldQuota: async () => true, readBoundedBytes: async () => Uint8Array.from([255, 216, 255]), imageMatches: () => true, getRuntimeEnv: () => ({ FIELD_PROOFS: { put: async () => {}, delete: async () => {} } }), coordinates: () => ({ latitude: null, longitude: null }) }, ["PUT"]);
  const legacyResponse = await legacy.PUT(new Request("https://example.test/api/field/photo/?taskId=task", { method: "PUT", headers: { Origin: "https://example.test", "Content-Type": "image/jpeg" }, body: Uint8Array.from([255, 216, 255]) }));
  assert.equal(legacyResponse.status, 201);
  const legacyBody = await legacyResponse.json();
  assert.deepEqual(Object.keys(legacyBody.proof).sort(), ["id", "url"]);
  assertPrivate(legacyBody);
});

test("expected field errors redact contacts and financial text on both API families", async () => {
  const problem = new FieldError(note, 409);
  const unified = await workdayHttp.workdayError(problem).json();
  assertPrivate(unified);
  assert.ok(unified.error.includes("Gate code 1234"));
  const legacy = loadRoute("../app/api/field/action/route.js", { getDb: () => ({}), verifyFieldRequest: async () => auth, fieldQuota: async () => true, checkRateLimit: async () => ({ allowed: true }), readBoundedProviderJson, FieldError, applyFieldAction() {}, executeFieldCommand: async () => { throw problem; } }, ["POST"]);
  const response = await legacy.POST(request("/api/field/action/", "POST", {}));
  assert.equal(response.status, 409);
  assertPrivate(await response.json());
});

test("pilot SSR projects before React serialization and has no customer contact controls", () => {
  const page = fs.readFileSync(new URL("../app/field/pilot/page.js", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../app/field/FieldClient.js", import.meta.url), "utf8");
  assert.match(page, /initialDay=\{technicianLegacyDay\(initialDay\)\}/);
  assert.doesNotMatch(client, /Customer contact|field\.(?:cellPhone|homePhone|email)|tel:/);
  assert.match(client, /route\.load\.departureReady/);
});
