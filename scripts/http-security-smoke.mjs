import assert from "node:assert/strict";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const status = async (path, options = {}) => (await fetch(base + path, { redirect: "manual", ...options })).status;
const jsonPost = (body, headers = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

for (const path of ["/admin/", "/office/", "/field/"]) {
  const result = await status(path);
  assert.ok([302, 307, 308, 401].includes(result), path + " should be protected; got " + result);
}
for (const path of ["/api/admin/operations-audit/", "/api/field/today/", "/api/office/route-assignment/"]) {
  assert.equal(await status(path), 401, path + " should reject unauthenticated requests");
}
assert.equal(await status("/api/field/photo/not-a-proof/"), 401);
const growthMutation = await status("/api/admin/growth-desk/123e4567-e89b-12d3-a456-426614174000/", {
  method: "PATCH",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ action: "add_note", note: "unauthenticated security check" }),
});
assert.ok([401, 403].includes(growthMutation), `Growth Desk mutation should be protected; got ${growthMutation}`);
const sngMissing = await status("/api/sng-webhooks/", jsonPost({ event: "job:completed", data: {} }));
assert.ok([401, 503].includes(sngMissing));
const sngBad = await status("/api/sng-webhooks/", jsonPost({ event: "job:completed", data: {} }, { "x-sng-webhook-secret": "bad" }));
assert.ok([401, 503].includes(sngBad));
const sngCorrect = await status("/api/sng-webhooks/", jsonPost({ event: "job:completed", data: {} }, { "x-sng-webhook-secret": process.env.SNG_WEBHOOK_SECRET || "ci-sng-secret" }));
assert.ok([200, 503].includes(sngCorrect));
assert.ok([400, 401, 503].includes(await status("/api/stripe/webhook/", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }, body: "{}" })));
assert.ok([403, 429, 503].includes(await status("/api/lead/", jsonPost({ source: "question", name: "Test", email: "test@example.com", question: "Test", turnstileToken: "bad" }))));
console.log("HTTP security smoke checks passed.");
