import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/api/admin/route-profitability/route.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
function handler({ authorized = true, allowed = true, configured = true } = {}) {
  let calls = 0;
  const context = {
    Response, URL,
    verifyAdminRequest: async () => ({ authorized, email: "test-admin" }),
    checkRateLimit: async () => ({ allowed: allowed && configured, unavailable: !configured }),
    rateLimitResponse: (rate) => Response.json({}, { status: rate.unavailable ? 503 : 429 }),
    getRouteProfitabilityData: async () => { calls++; return { history: null, costs: null }; },
    refreshQuickBooksRouteCosts: async () => { calls++; },
    refreshAirtableRouteProfitability: async () => { calls++; },
    refreshCleanupBilling: async () => { calls++; },
  };
  const api = runPrivateInNewContext(`${source}\n({GET, POST})`, context);
  return { ...api, calls: () => calls };
}
const request = (options = {}) => new Request("https://example.com/api/admin/route-profitability/", { method: "POST", headers: { origin: "https://example.com" }, ...options });

test("route profitability rejects unauthenticated, wrong-role and expired auth before data access", async () => {
  for (const method of ["GET", "POST"]) {
    const api = handler({ authorized: false });
    const result = await api[method](request({ method }));
    assert.equal(result.status, 401);
    assert.equal(api.calls(), 0);
    assert.match(result.headers.get("Cache-Control"), /no-store/);
  }
});
test("cross-site, absent-origin and body-bearing refreshes cannot reach providers", async () => {
  for (const options of [{ headers: { origin: "https://evil.test" } }, { headers: {} }, { body: '{"month":"DROP TABLE"}' }]) {
    const api = handler();
    const result = await api.POST(request(options));
    assert.ok([400,403].includes(result.status));
    assert.equal(api.calls(), 0);
  }
});
test("provider access fails closed without abuse controls and respects the quota", async () => {
  for (const settings of [{ configured: false }, { allowed: false }]) {
    const api = handler(settings);
    const result = await api.POST(request());
    assert.ok([429,503].includes(result.status));
    assert.equal(api.calls(), 0);
  }
});
test("authorized same-origin refresh calls only the bounded loaders and returns private data", async () => {
  const api = handler();
  const response = await api.POST(request());
  assert.equal(response.status, 200);
  assert.equal(api.calls(), 4);
  assert.match(response.headers.get("Cache-Control"), /private/);
  assert.equal((await response.json()).ok, true);
});

test("an empty Workers-style stream is accepted while streamed content is rejected", async () => {
  const api = handler();
  const empty = new ReadableStream({ start(controller) { controller.close(); } });
  assert.equal((await api.POST(request({ body: empty, duplex: "half" }))).status, 200);
});
