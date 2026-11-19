import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runPrivateInNewContext } from "./helpers/private-vm.mjs";
import { protectJsonRequest } from "./helpers/google-review-guard.mjs";

const source = fs.readFileSync(new URL("../app/api/admin/review-requests/route.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function runtime({ authorized = true, limited = false } = {}) {
  const writes = [];
  let reads = 0;
  const handlers = runPrivateInNewContext(`${source}\n({ GET, PATCH })`, {
    Response, URL, Object, Number, String,
    headers: async () => new Headers(),
    verifyAdminRequest: async () => ({ authorized, email: "owner@example.test" }),
    getRuntimeEnv: () => ({ DB: {}, REVIEW_REQUESTS_ENABLED: "false" }),
    protectJsonRequest: (request, options) => protectJsonRequest(request, options, limited),
    setReviewDoNotContact: async (_env, change) => { writes.push(change); },
    getReviewRequestAdminData: async () => {
      reads++;
      return { enabled: false, enabledAt: null,
        rows: [{ id: "r1", customer_key: "sng:123", customer_name: "Example Person", job_date: "2026-11-18", tech: "Tony", channel: "sms", status: "queued", reason: "quiet_hours", phone_last4: "0100", phone: "+12025550100", email: "private@example.test", payload: "private-provider-payload" }],
        contacts: [{ customer_key: "sng:123", customer_name: "Example Person", do_not_contact: 1, phone: "+12025550100" }],
      };
    },
  });
  return { ...handlers, writes, reads: () => reads };
}

function request(body = { customerKey: "sng:123", blocked: true }, origin = "https://example.test", extraHeaders = {}) {
  return new Request("https://example.test/api/admin/review-requests/", {
    method: "PATCH", headers: { ...(origin ? { origin } : {}), "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body),
  });
}

test("review-request preference writes require authentication, same origin and bounded validated input", async () => {
  const cases = [
    [{ authorized: false }, request(), 401],
    [{}, request(undefined, null), 403],
    [{}, request(undefined, "https://foreign.test"), 403],
    [{}, request(undefined, undefined, { "sec-fetch-site": "cross-site" }), 403],
    [{ limited: true }, request(), 429],
    [{}, request({ customerKey: "x".repeat(2000), blocked: true }), 413],
    [{}, request({ customerKey: "../../secrets", blocked: true }), 400],
    [{}, request({ customerKey: "sng:123", blocked: "false" }), 400],
    [{}, request({ customerKey: "sng:123", blocked: false, enabled: true }), 400],
  ];
  for (const [options, req, status] of cases) {
    const current = runtime(options);
    assert.equal((await current.PATCH(req)).status, status);
    assert.equal(current.writes.length, 0);
    assert.equal(current.reads(), 0);
  }
});

test("review-request admin read masks contact data and has no enable or sending action", async () => {
  const denied = runtime({ authorized: false });
  assert.equal((await denied.GET()).status, 401);
  assert.equal(denied.reads(), 0);
  const current = runtime();
  const response = await current.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(data.enabled, false);
  assert.equal(data.rows[0].phone_last4, "0100");
  assert.equal(data.contacts[0].do_not_contact, true);
  assert.doesNotMatch(JSON.stringify(data), /\+12025550100|private@example|private-provider/);
  assert.equal(current.writes.length, 0);
});

test("review-request manual do-not-contact can be set and cleared without enabling the feature", async () => {
  for (const blocked of [true, false]) {
    const current = runtime();
    const response = await current.PATCH(request({ customerKey: "phone:" + "a".repeat(64), blocked }));
    assert.equal(response.status, 200);
    assert.equal(current.writes.length, 1);
    assert.equal(current.writes[0].blocked, blocked);
    assert.equal(current.writes[0].actor, "owner@example.test");
    assert.equal((await response.json()).enabled, false);
  }
});
