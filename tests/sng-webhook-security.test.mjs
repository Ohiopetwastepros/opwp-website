import assert from "node:assert/strict";
import test from "node:test";
import { authenticateSngWebhook, constantTimeSecretMatch, validateSngWebhookBody } from "../lib/sng-webhook-security.mjs";

const request = (url = "https://ohiopetwastepros.com/api/sng-webhooks", headers = {}) => new Request(url, { method: "POST", headers });

test("missing webhook secret is rejected", () => {
  const result = authenticateSngWebhook(request(), { SNG_WEBHOOK_SECRET: "expected" }, "production");
  assert.equal(result.authorized, false);
  assert.equal(result.verified, false);
});

test("incorrect webhook secret is rejected", () => {
  assert.equal(authenticateSngWebhook(request(undefined, { "x-sng-webhook-secret": "wrong" }), { SNG_WEBHOOK_SECRET: "expected" }, "production").authorized, false);
});

test("correct webhook secret is accepted with constant-time digest comparison", () => {
  assert.equal(constantTimeSecretMatch("expected", "expected"), true);
  assert.equal(constantTimeSecretMatch("expected", "wrong"), false);
  const result = authenticateSngWebhook(request(undefined, { "x-webhook-secret": "expected" }), { SNG_WEBHOOK_SECRET: "expected" }, "production");
  assert.equal(result.authorized, true);
  assert.equal(result.verified, true);
});

test("local smoke bypass is restricted", () => {
  const env = { ADMIN_DEV_BYPASS: "true" };
  assert.equal(authenticateSngWebhook(request("http://localhost/api/sng-webhooks", { "x-opwp-local-smoke": "true" }), env, "development").authorized, true);
  assert.equal(authenticateSngWebhook(request("https://ohiopetwastepros.com/api/sng-webhooks", { "x-opwp-local-smoke": "true" }), env, "development").authorized, false);
  assert.equal(authenticateSngWebhook(request("http://localhost/api/sng-webhooks", { "x-opwp-local-smoke": "true" }), env, "production").authorized, false);
});

test("unverified financial events cannot reach financial mutation processing", () => {
  const result = authenticateSngWebhook(request(undefined, { "x-sng-webhook-secret": "wrong" }), { SNG_WEBHOOK_SECRET: "expected" }, "production");
  assert.equal(result.authorized, false);
  assert.equal(result.verified, false);
});

test("webhook payload validation rejects malformed bodies", () => {
  assert.equal(validateSngWebhookBody([]).ok, false);
  assert.equal(validateSngWebhookBody({ event: "invoice:finalized", data: "bad" }).ok, false);
  assert.deepEqual(validateSngWebhookBody({ event: "invoice:finalized", data: { invoice_id: 1 } }), { ok: true, eventType: "invoice:finalized" });
});
