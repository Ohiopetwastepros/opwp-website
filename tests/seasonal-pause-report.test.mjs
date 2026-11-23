import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { buildSeasonalPauseReport, getSeasonalPauseReport } from "../lib/seasonal-pause-report.mjs";

const now = new Date("2026-11-23T18:00:00Z");
const client = overrides => ({ sng_client_id: "client-example", client_name: "Example Client", seasonal_pattern: "winter", pause_start_date: "2026-11-01", pause_end_date: "2027-01-29", planned_restart_date: "2027-03-01", next_action_date: "2027-01-29", pause_reason: "Seasonal - winter", pause_count: 1, is_paused: 1, airtable_sync_status: "synced", airtable_synced_at: "2026-11-23T16:00:00Z", updated_at: "2026-11-23T16:00:00Z", ...overrides });
const pause = overrides => ({ id: "event-example", sng_client_id: "client-example", sng_subscription_id: "subscription-example", event_type: "paused", event_at: "2026-11-01T14:00:00Z", pause_start_date: "2026-11-01", planned_restart_date: "2027-03-01", period_key: "period-example", ...overrides });

test("reports captured patterns, unique pause periods, cancellations and planned restarts without counting resumes", () => {
  const report = buildSeasonalPauseReport([
    client({}), client({ sng_client_id: "client-other", client_name: "Another Example", seasonal_pattern: "unknown", is_paused: 0 }),
  ], [
    pause({}), pause({ id: "redelivery", source: "subscription_sync", event_at: "2026-11-02T14:00:00Z" }),
    pause({ id: "addon-pause", sng_subscription_id: "subscription-addon", period_key: "addon-period" }),
    pause({ id: "resume", event_type: "unpaused", period_key: "different-key", pause_start_date: "2026-11-03" }),
    pause({ id: "unresolved-resume", event_type: "unpaused", period_key: "unresolved-period", pause_start_date: null, event_at: "2024-11-03T14:00:00Z" }),
    pause({ id: "canceled", sng_client_id: "client-other", period_key: "cancel-period", event_type: "canceled_seasonal", pause_start_date: "2025-12-01", planned_restart_date: "2026-03-01" }),
  ], { now });
  assert.deepEqual(report.years, [2025, 2026]);
  assert.equal(report.totals.documentedPeriods, 2);
  assert.equal(report.countsByPattern.winter, 1);
  assert.equal(report.countsByPattern.unknown, 1);
  assert.equal(report.currentPausers.length, 1);
  assert.equal(report.monthlyCounts.find(row => row.month === "2026-11").pauseStarts, 1);
  assert.equal(report.monthlyCounts.find(row => row.month === "2026-03").plannedRestarts, 1);
  assert.equal(report.seasonCounts.find(row => row.year === 2025 && row.season === "winter").pauseStarts, 1);
  assert.equal(report.seasonCounts.find(row => row.year === 2026 && row.season === "spring").plannedRestarts, 1);
});

test("business years, undated pause timestamps and 90-day windows follow Eastern business dates", () => {
  const report = buildSeasonalPauseReport([], [pause({ pause_start_date: null, event_at: "2027-01-01T02:00:00Z", planned_restart_date: null })], { now: new Date("2027-01-01T02:30:00Z") });
  assert.equal(report.businessDate, "2026-12-31");
  assert.equal(report.timeZone, "America/New_York");
  assert.deepEqual(report.years, [2026]);
  assert.equal(report.monthlyCounts.find(row => row.month === "2026-12").pauseStarts, 1);
  assert.equal(report.window.through, "2027-03-31");
  assert.equal(report.monthlyCounts.length, 12);
});

test("human restart dates are counted for the mirrored pause window without rewriting earlier history", () => {
  const report = buildSeasonalPauseReport([client({ pause_start_date: "2026-01-01", planned_restart_date: "2026-03-15" })], [
    pause({ id: "latest", pause_start_date: "2026-01-01", event_at: "2026-01-01T14:00:00Z", planned_restart_date: null }),
    pause({ id: "old", period_key: "old-period", pause_start_date: "2025-01-01", event_at: "2025-01-01T14:00:00Z", planned_restart_date: "2025-02-01" }),
  ], { now });
  assert.equal(report.monthlyCounts.find(row => row.month === "2026-03").plannedRestarts, 1);
  assert.equal(report.monthlyCounts.find(row => row.month === "2025-02").plannedRestarts, 1);
  assert.equal(report.monthlyCounts.find(row => row.month === "2025-03").plannedRestarts, 0);
});

test("future pauses appear as scheduled actions, re-pause comes before March, and upcoming dates are bounded and sorted", () => {
  const report = buildSeasonalPauseReport([
    client({}),
    client({ sng_client_id: "client-future", client_name: "Scheduled Example", pause_start_date: "2026-12-01", pause_end_date: "2027-02-28", planned_restart_date: "2027-03-01", next_action_date: "2027-02-28" }),
    client({ sng_client_id: "client-soon", client_name: "Restart Example", planned_restart_date: "2026-12-05", next_action_date: "2026-12-05", pause_end_date: "2026-12-05" }),
    client({ sng_client_id: "client-past", planned_restart_date: "2026-11-22", next_action_date: "2026-11-22", is_paused: 0 }),
  ], [], { now });
  assert.equal(report.currentPausers.length, 2);
  assert.deepEqual(report.upcomingRestarts.map(row => row.date), ["2026-12-05"]);
  assert.deepEqual(report.upcomingActions.map(row => [row.date, row.action]), [["2026-12-01", "scheduled_pause"], ["2026-12-05", "follow_up"], ["2027-01-29", "re_pause"]]);
  assert.equal(report.upcomingActions[2].plannedRestartDate, "2027-03-01");
});

test("sync lag remains visible when Airtable is unavailable and report summaries omit contact and payload data", () => {
  const report = buildSeasonalPauseReport([
    client({ email: "private@example.test", phone: "555-0100", raw_payload: "private", airtable_sync_status: "failed", airtable_synced_at: null, updated_at: "2026-11-21T12:00:00Z" }),
    client({ sng_client_id: "client-unmatched", airtable_sync_status: "unmatched", updated_at: "2026-11-22T12:00:00Z" }),
    client({ sng_client_id: "client-pending", airtable_sync_status: "pending", airtable_synced_at: null }),
  ], [], { now });
  assert.equal(report.airtableSync.failed, 1);
  assert.equal(report.airtableSync.unmatched, 1);
  assert.equal(report.airtableSync.pending, 1);
  assert.equal(report.airtableSync.oldestPendingAt, "2026-11-21T12:00:00Z");
  assert.ok(!JSON.stringify(report).includes("private@example.test"));
  assert.ok(!JSON.stringify(report).includes("555-0100"));
});

test("D1 report reads both ledgers without calling a provider or mutating storage", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema-proposals/0070_seasonal_pauses.sql", import.meta.url), "utf8"));
  sqlite.exec(`INSERT INTO seasonal_pause_clients (sng_client_id,client_name,seasonal_pattern,pause_start_date,pause_end_date,planned_restart_date,pause_reason,pause_count,next_action_date,is_paused,airtable_sync_status,updated_at)
    VALUES ('client-example','Example Client','winter','2026-11-01','2027-01-29','2027-03-01','Seasonal - winter',1,'2027-01-29',1,'failed','2026-11-23T12:00:00Z');
    INSERT INTO seasonal_pause_events (id,sng_client_id,sng_subscription_id,subscription_key,subscription_descriptor,subscription_kind,event_type,event_at,pause_start_date,planned_restart_date,period_key,raw_payload,source)
    VALUES ('event-example','client-example','subscription-example','subscription-example','example-descriptor','residential','paused','2026-11-01T14:00:00Z','2026-11-01','2027-03-01','period-example','{}','webhook');`);
  const db = { prepare(sql) { assert.match(sql, /^SELECT/); return { all: async () => ({ results: sqlite.prepare(sql).all() }) }; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("A report must not call a provider."); };
  try {
    const report = await getSeasonalPauseReport(db, { now });
    assert.equal(report.totals.documentedPeriods, 1);
    assert.equal(report.currentPausers[0].name, "Example Client");
    assert.equal(report.airtableSync.failed, 1);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

const source = path => readFileSync(new URL(path, import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
function apiFixture({ office = false, admin = false, organizationId = "org-opwp", fail = false, db = {} } = {}) {
  let reads = 0;
  const handler = vm.runInNewContext(source("../app/api/office/seasonal-pauses/route.js") + "\nGET", {
    Response, headers: async () => new Headers(), getDb: () => db,
    verifyOfficeRequest: async () => ({ authorized: office, member: { organizationId } }),
    verifyAdminRequest: async () => ({ authorized: admin }),
    getSeasonalPauseReport: async () => { reads++; if (fail) throw new Error("SQLITE private storage details"); return { currentPausers: [] }; },
  });
  return { handler, reads: () => reads };
}

test("report authentication happens before report reads and rejects other organization office sessions", async () => {
  for (const settings of [{}, { office: true, organizationId: "org-other" }]) {
    const fixture = apiFixture(settings);
    const response = await fixture.handler();
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(fixture.reads(), 0);
  }
  for (const settings of [{ office: true }, { admin: true }]) {
    const fixture = apiFixture(settings);
    const response = await fixture.handler();
    assert.equal(response.status, 200);
    assert.equal(fixture.reads(), 1);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("vary"), "Cookie");
  }
});

test("storage errors stay private and missing DB does not trigger report reads", async () => {
  const failed = await apiFixture({ admin: true, fail: true }).handler();
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("SQLITE"));
  const missing = apiFixture({ admin: true, db: null });
  assert.equal((await missing.handler()).status, 503);
  assert.equal(missing.reads(), 0);
});

function middlewareFixture({ office = false, admin = false, organizationId = "org-opwp" } = {}) {
  return vm.runInNewContext(source("../middleware.js") + "\nmiddleware", {
    Headers, URL, Uint8Array, crypto, btoa,
    NextResponse: { next: () => new Response(null), json: Response.json, redirect: (url, options) => new Response(null, { status: 307, headers: { ...options?.headers, location: String(url) } }) },
    getDb: () => ({}), verifyOfficeRequest: async () => ({ authorized: office, member: { organizationId } }),
    verifyAdminRequest: async () => ({ authorized: admin }), verifyFieldRequest: async () => ({ authorized: false }),
  });
}
const request = path => ({ url: `https://example.test${path}`, nextUrl: new URL(`https://example.test${path}`), method: "GET", headers: new Headers() });

test("middleware allows existing OPWP office and admin sessions only for exact report paths", async () => {
  for (const settings of [{ admin: true }, { office: true }]) {
    const middleware = middlewareFixture(settings);
    for (const path of ["/office/seasonal-pauses/", "/api/office/seasonal-pauses/"]) {
      const response = await middleware(request(path));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
    }
  }
  const admin = middlewareFixture({ admin: true });
  for (const path of ["/api/office/route-assignment/", "/api/office/seasonal-pauses/extra"]) assert.equal((await admin(request(path))).status, 401);
  for (const settings of [{}, { office: true, organizationId: "org-other" }]) {
    assert.equal((await middlewareFixture(settings)(request("/api/office/seasonal-pauses/"))).status, 401);
  }
});
