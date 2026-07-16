const base = process.env.FIELD_SMOKE_BASE || "http://127.0.0.1:8787";
const date = process.env.FIELD_SMOKE_DATE || "2026-07-15";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
}

const login = await json("/api/field/session/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "field.qa@opwp.local", pin: "246810" }),
});
check(login.response.status === 200 && login.body.ok, `Login failed: ${JSON.stringify(login.body)}`);
const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
check(cookie, "Login did not issue a field session cookie.");
const headers = { Cookie: cookie, "Content-Type": "application/json" };

async function day() {
  const result = await json(`/api/field/today/?date=${date}`, { headers: { Cookie: cookie } });
  check(result.response.status === 200 && result.body.day?.route, `Route load failed: ${JSON.stringify(result.body)}`);
  return result.body.day;
}

async function action(payload) {
  const current = await day();
  const result = await json("/api/field/action/", { method: "POST", headers, body: JSON.stringify({ ...payload, shiftId: current.shift.id, date }) });
  check(result.response.status === 200 && result.body.ok, `${payload.action} failed: ${JSON.stringify(result.body)}`);
  return result.body.day;
}

let current = await day();
check(current.shift.status === "pending_load", "Expected a pending load check.");
current = await action({ action: "confirm_load", startingMileage: 1000, items: current.route.load.items.map((item) => ({ productId: item.product_id, quantity: item.required_quantity })) });
check(current.shift.status === "ready", "Load confirmation did not ready the shift.");
current = await action({ action: "start_route" });
check(current.shift.status === "in_progress", "Route did not start.");
await action({ action: "arrive", locationId: "qa-location-1" });
await action({ action: "start_task", taskId: "qa-scoop-task" });
current = await action({ action: "complete_task", taskId: "qa-scoop-task" });
check(current.route.locations[0].tasks[0].status === "validation_pending", "Scoop completion was not queued for CRM validation.");
await action({ action: "on_the_way", taskId: "qa-food-task", leadMinutes: 15, recommendedLeadMinutes: 15 });
await action({ action: "arrive", locationId: "qa-location-2" });
await action({ action: "start_task", taskId: "qa-food-task" });

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const proof = await json("/api/field/photo/?taskId=qa-food-task", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "image/png", "Content-Length": String(png.byteLength) }, body: png });
check(proof.response.status === 201 && proof.body.ok, `Photo upload failed: ${JSON.stringify(proof.body)}`);
current = await action({ action: "complete_task", taskId: "qa-food-task", placementConfirmed: true });
check(current.route.totals.completed === current.route.totals.tasks, "Not every task reached a terminal state.");
current = await action({ action: "complete_route", endingMileage: 1012.4, items: current.route.load.items.map((item) => ({ productId: item.product_id, returned: 0 })) });
check(current.shift.status === "completed", "Route did not complete.");

const proofResponse = await fetch(`${base}${proof.body.proof.url}`, { headers: { Cookie: cookie } });
check(proofResponse.status === 200 && proofResponse.headers.get("content-type") === "image/png", "Private proof could not be retrieved.");

console.log(JSON.stringify({ ok: true, shiftStatus: current.shift.status, taskCount: current.route.totals.tasks, completedTasks: current.route.totals.completed, proofStorage: "verified", crmValidation: "pending" }));
