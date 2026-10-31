import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { dispatchSchedule, DISPATCH_AUTOMATION_KEY, readDispatchAutomation, saveDispatchSnapshot } from "../lib/dispatch-automation-state.mjs";

const source = fs.readFileSync(new URL("../lib/dispatch-automation.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const at = "2026-10-07T08:00:00Z";
function fixture({ rows = [{ id: 1, sourceStatus: "dispatched" }], ok = true, data, importError, review = false } = {}) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);");
  sql.exec(fs.readFileSync(new URL("../tmp/test-migrations/0011_system_sync_runs.sql", import.meta.url), "utf8"));
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) || null; },
    async run() { return sql.prepare(query).run(...args); },
  }; } }; } };
  const calls = [];
  const context = { crypto, Date, console: { error() {} }, dispatchSchedule, DISPATCH_AUTOMATION_KEY, readDispatchAutomation, saveDispatchSnapshot,
    sngRequest: async (path, options) => { calls.push({ path, options }); return { ok, data: data === undefined ? rows : data }; },
    normalizeSngDispatchJobs: jobs => jobs,
    importRoutePartnerDay: async input => { calls.push({ import: input.date }); if (importError) throw new Error(importError); return { planIds: ["plan-1"] }; },
    getRoutePartnerDay: async () => ({ plans: [{ id: "plan-1", sourceJobCount: 42, locationCount: 36, optimization: { status: review ? "needs_review" : "optimized", savedMinutes: 17 } }] }),
  };
  const run = runPrivateInNewContext(`${source}\nrunScheduledDispatchPreparation`, context);
  return { sql, db, calls, run: (time = at, env = {}) => run({ DB: db, DISPATCH_AUTOMATION_ENABLED: "true", ...env }, time) };
}

test("4 AM Eastern follows DST and the same service date; no late catchup", () => {
  for (const [instant, date] of [[at, "2026-10-07"], ["2026-11-01T09:00:00Z", "2026-11-01"], ["2027-03-14T08:00:00Z", "2027-03-14"], ["2026-12-31T09:20:00Z", "2026-12-31"]]) {
    assert.deepEqual(dispatchSchedule(instant), { due: true, date });
  }
  for (const instant of ["2026-10-07T07:00:00Z", "2026-10-07T09:00:00Z", "2026-10-07T08:01:00Z", "2026-11-01T08:00:00Z"]) assert.equal(dispatchSchedule(instant).due, false);
  assert.throws(() => dispatchSchedule("invalid"));
});

test("saved preparation runs once, keeps complete source, and never claims SNG was published", async () => {
  const h = fixture();
  const result = await h.run();
  assert.equal(result.status, "prepared"); assert.equal(result.publishing, "pending_browser");
  assert.equal(result.jobCount, 42); assert.equal(result.stopCount, 36);
  assert.equal((await h.run()).reason, "already_processed");
  assert.equal(h.calls.filter(c => c.path).length, 1);
  assert.equal(h.calls[0].options.searchParams.date, "2026-10-07");
  assert.equal(h.calls[0].options.method, undefined); // GET only
  const stored = h.sql.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").get("dispatch_source:org-opwp:2026-10-07");
  assert.equal(JSON.parse(stored.payload).sourceRows[0].id, 1);
  assert.equal((await readDispatchAutomation(h.db, "2026-10-07")).run.status, "prepared");
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM system_sync_runs").get().n, 1);
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'dispatch_lock:%'").get().n, 0);
  h.sql.close();
});

test("disabled, wrong-hour and manual-import locks prevent provider calls", async () => {
  const h = fixture();
  assert.equal((await h.run(at, { DISPATCH_AUTOMATION_ENABLED: "false" })).reason, "not_configured");
  assert.equal((await h.run("2026-10-07T09:00:00Z")).reason, "outside_dispatch_window");
  await saveDispatchSnapshot(h.db, "dispatch_lock:org-opwp:2026-10-07", "someone-else");
  assert.equal((await h.run()).reason, "dispatch_busy");
  assert.equal(h.calls.length, 0); h.sql.close();
});

test("failures and interrupted runs retry at most three times", async () => {
  const h = fixture({ ok: false });
  for (let i = 1; i <= 3; i++) { const result = await h.run(); assert.equal(result.status, "failed"); assert.equal(result.attempts, i); }
  assert.equal((await h.run()).reason, "already_processed");
  assert.equal(h.calls.length, 3); h.sql.close();
  const interrupted = fixture();
  await saveDispatchSnapshot(interrupted.db, DISPATCH_AUTOMATION_KEY("2026-10-07"), { status: "running", attempts: 2 });
  assert.equal((await interrupted.run()).attempts, 3); interrupted.sql.close();
});

test("started/completed SNG work and unvalidated routing are preserved for review", async () => {
  for (const sourceStatus of ["started", "completed"]) {
    const h = fixture({ rows: [{ id: 1, sourceStatus }] });
    assert.equal((await h.run()).status, "needs_review");
    assert.equal(h.calls.filter(c => c.import).length, 0); h.sql.close();
  }
  const h = fixture({ review: true });
  assert.equal((await h.run()).status, "needs_review");
  assert.equal((await h.run()).reason, "already_processed"); h.sql.close();
});

test("unknown payloads and missing job IDs fail closed, while genuine no-work days stop", async () => {
  for (const options of [{ data: {} }, { rows: [{ id: 0 }] }, { rows: [null] }, { rows: Array(401).fill({ id: 1 }) }]) {
    const h = fixture(options); assert.equal((await h.run()).status, "failed");
    assert.equal(h.calls.filter(c => c.import).length, 0); h.sql.close();
  }
  const h = fixture({ rows: [], importError: "No dispatched scoop jobs or scheduled dog-food deliveries were found for this date." });
  const result = await h.run(); assert.equal(result.status, "no_work"); assert.equal(result.publishing, "not_required");
  assert.equal((await h.run()).reason, "already_processed"); h.sql.close();
});

test("oversized source snapshot is rejected before plan changes", async () => {
  const h = fixture({ rows: [{ id: 1, extra: "x".repeat(1000001) }] });
  assert.equal((await h.run()).status, "failed");
  assert.equal(h.calls.filter(c => c.import).length, 0); h.sql.close();
});
