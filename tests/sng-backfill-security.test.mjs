import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/api/admin/sng-backfill/route.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");

function api({ authorized = true, blocked = false } = {}) {
  let backfilled = 0;
  const handler = runPrivateInNewContext(`${source}\nPOST`, {
    Response, URL, console,
    headers: async () => new Headers(),
    verifyAdminRequest: async () => ({ authorized, email: "admin@example.com" }),
    checkRateLimit: async () => ({ allowed: !blocked }),
    rateLimitResponse: () => Response.json({ error: "Rate limited" }, { status: 429 }),
    getRuntimeEnv: () => ({ DB: {}, AIRTABLE_API_KEY: "key", SNG_API_KEY: "key" }),
    listUnprocessedSngEvents: async () => [],
    processSngEvent: async () => ({ processed: true }),
    runSngDispatchBackfillBatch: async () => { backfilled += 1; return { complete: false }; },
  });
  return { handler, backfilled: () => backfilled };
}

const request = (origin = "https://example.com") => new Request("https://example.com/api/admin/sng-backfill", { method: "POST", headers: { origin } });

test("SNG dispatch backfill requires admin, same origin, and a rate-limit pass", async () => {
  for (const [settings, req, status] of [[{ authorized: false }, request(), 401], [{}, request("https://evil.test"), 403], [{ blocked: true }, request(), 429]]) {
    const app = api(settings);
    assert.equal((await app.handler(req)).status, status);
    assert.equal(app.backfilled(), 0);
  }
  const app = api();
  assert.equal((await app.handler(request())).status, 200);
  assert.equal(app.backfilled(), 1);
});
