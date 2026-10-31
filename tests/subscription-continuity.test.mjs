import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import vm from "node:vm";
import { continuityReplacement, continuityProposal, sameLifecycleCustomer, lifecycleTime } from "../lib/subscription-continuity.mjs";
import { reconcileSubscriptionContinuity } from "../lib/subscription-continuity-worker.mjs";

const canceled = { subscription_id: "old", client_ref: "rcl_same", client_name: "Jane Client", client_email: "jane@example.test", canceled_at: "2026-09-22T12:00:00Z", plan: "1d-bW", reason_category: "No reason provided" };
const created = { subscription_id: "new", client: "rcl_same", client_name: "Jane Client", subscription_name: "1d-bW", created_at: "2026-09-22T12:00:02Z" };
const active = { client: "rcl_same", first_name: "Jane", last_name: "Client", email: "jane@example.test", address: "New address", cleanup_frequency: "Bi weekly" };

test("address changes and replacement chains preserve continuity in either arrival order", () => {
  assert.equal(continuityReplacement(canceled, created), true);
  assert.equal(continuityReplacement({ ...canceled, reason_category: "Moved" }, created), true);
  assert.equal(continuityReplacement(canceled, { ...created, created_at: "2026-09-22T11:59:50Z" }), true);
  assert.equal(continuityProposal(canceled, [created, { ...created, subscription_id: "newest", created_at: "2026-09-22T12:01:00Z" }], [active], []).replacementId, "newest");
});
test("shared names, conflicting IDs, add-ons, stale events, and true later returns cannot erase churn", () => {
  assert.equal(sameLifecycleCustomer(canceled, { ...created, client: "rcl_other", client_email: canceled.client_email }), false);
  assert.equal(sameLifecycleCustomer({ client_name: "Jane Client" }, { client_name: "Jane Client" }), false);
  for (const row of [{ ...created, subscription_id: "old" }, { ...created, client: "rcl_other" }, { ...created, subscription_name: "Haul Away" }, { ...created, created_at: "2026-09-25T12:00:00Z" }, { ...created, created_at: null }]) assert.equal(continuityReplacement(canceled, row), false);
  assert.equal(continuityReplacement({ ...canceled, reason_category: "Dissatisfied" }, created), false);
  assert.equal(continuityProposal(canceled, [created], [], []), null);
  assert.equal(continuityProposal(canceled, [created], [active, active], []), null);
});
test("missing creation webhooks use corroborated live billing without fabricating IDs", () => {
  const billing = { status: "active", client_name: "Jane Client", client_email: "jane@example.test", service_plan: "1d-bW", start_date: "2026-09-22" };
  assert.equal(continuityProposal(canceled, [], [active], [billing]).replacementId, null);
  for (const rows of [[{ ...billing, client_email: "another@example.test" }], [{ ...billing, start_date: "2026-09-25" }], [billing, billing], [{ ...billing, status: "canceled" }]]) assert.equal(continuityProposal(canceled, [], [active], rows), null);
});

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE sng_events(id TEXT,payload TEXT,event_type TEXT,received_at TEXT);
    CREATE TABLE subscription_cancellations(subscription_id TEXT PRIMARY KEY,source_event_id TEXT,business_line TEXT,client_ref TEXT,client_name TEXT,canceled_at TEXT,plan TEXT,reason_category TEXT,eligibility_status TEXT,eligibility_evidence TEXT,review_status TEXT,is_customer_churn INTEGER,lost_mrr REAL,reactivated_at TEXT,replacement_subscription_id TEXT,updated_at TEXT);
    CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);`);
  const db = { prepare(sql) { const statement = sqlite.prepare(sql); let values = []; return { bind(...next) { values = next; return this; }, async all() { return { results: statement.all(...values) }; }, async first() { return statement.get(...values) || null; }, async run() { return { meta: statement.run(...values) }; } }; } };
  sqlite.prepare("INSERT INTO subscription_cancellations(subscription_id,business_line,client_ref,client_name,canceled_at,plan,reason_category,eligibility_status,review_status,is_customer_churn,lost_mrr,reactivated_at) VALUES (?,'scooping',?,?,?,?,?,'Confirmed','Complete',1,55,'2026-09-22')").run(canceled.subscription_id, canceled.client_ref, canceled.client_name, canceled.canceled_at, canceled.plan, canceled.reason_category);
  sqlite.prepare("INSERT INTO sng_events VALUES ('event-new',?,'client:subscription_created','2026-09-23')").run(JSON.stringify({ data: created, created: Date.parse(created.created_at) / 1000 }));
  const churn = { id: "recChurn", fields: { "Event ID": "SNG-SUB-old", "Is Churn": true, "Lost MRR ($)": 55 } };
  const customer = { id: "recCustomer", fields: { "Client Name": "Jane Client", "SNG Client ID": "rcl_same", Status: "Inactive" } };
  sqlite.prepare("INSERT INTO airtable_cockpit_snapshots VALUES ('business_cockpit',?,'success','2026-09-23','2026-09-23')").run(JSON.stringify({ opwp: { churn: [churn], customers: [customer] } }));
  const writes = [];
  const options = { fetchSubscriptions: async () => [], listRecords: async table => table === "tblyhWKl99rwpiIRI" ? [churn] : [customer], patch: async (table, record, fields) => { if (!Object.entries(fields).every(([k,v]) => record.fields[k] === v)) writes.push(table); record.fields = { ...record.fields, ...fields }; return record; } };
  return { sqlite, db, env: { DB: db, AIRTABLE_API_KEY: "fixture", SNG_API_KEY: "fixture" }, options, writes, churn, customer };
}

test("hourly repair verifies both stores, removes false reactivation/MRR, refreshes cached rows, and is idempotent", async () => {
  const f = fixture();
  const result = await reconcileSubscriptionContinuity(f.env, [active], f.options);
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].before.lostMrr, 55);
  const saved = f.sqlite.prepare("SELECT * FROM subscription_cancellations").get();
  assert.equal(saved.is_customer_churn, 0); assert.equal(saved.lost_mrr, 0); assert.equal(saved.reactivated_at, null);
  assert.equal(f.customer.fields.Status, "Active"); assert.equal(f.customer.fields.Address, "New address");
  const cached = JSON.parse(f.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").get().payload);
  assert.equal(cached.opwp.churn[0].fields["Is Churn"], false);
  await reconcileSubscriptionContinuity(f.env, [active], f.options);
  assert.equal(f.writes.length, 2);
  f.sqlite.close();
});
test("partial external failure stays retryable and next pass completes the correction", async () => {
  const f = fixture(); const patch = f.options.patch;
  await assert.rejects(reconcileSubscriptionContinuity(f.env, [active], { ...f.options, patch: async (...args) => { if (args[0] !== "tblyhWKl99rwpiIRI") throw Error("provider unavailable"); return patch(...args); } }));
  assert.equal(f.sqlite.prepare("SELECT is_customer_churn FROM subscription_cancellations").get().is_customer_churn, 1);
  const audit = JSON.parse(f.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='subscription_continuity_v1'").get().payload);
  assert.equal(audit.ownerActionRequired, false); assert.equal(audit.state, "retrying");
  await reconcileSubscriptionContinuity(f.env, [active], f.options);
  assert.equal(f.sqlite.prepare("SELECT is_customer_churn FROM subscription_cancellations").get().is_customer_churn, 0);
  f.sqlite.close();
});
test("ambiguous Airtable identity asks a concrete question and cannot mutate another customer", async () => {
  const f = fixture();
  const result = await reconcileSubscriptionContinuity(f.env, [active], { ...f.options, listRecords: async table => table === "tblyhWKl99rwpiIRI" ? [f.churn] : [f.customer, f.customer] });
  assert.equal(result.pending[0].ownerActionRequired, true);
  assert.equal(f.writes.length, 0);
  f.sqlite.close();
});
test("failed readback never closes the ledger", async () => {
  const f = fixture();
  await assert.rejects(reconcileSubscriptionContinuity(f.env, [active], { ...f.options, patch: async (_table, record) => record }), /verification/);
  assert.equal(f.sqlite.prepare("SELECT is_customer_churn FROM subscription_cancellations").get().is_customer_churn, 1);
  f.sqlite.close();
});
test("Airtable omitting cleared fields still verifies the correction", async () => {
  const f = fixture();
  const result = await reconcileSubscriptionContinuity(f.env, [active], { ...f.options, patch: async (_table, record, fields) => {
    record.fields = { ...record.fields, ...fields };
    for (const [key,value] of Object.entries(record.fields)) if (value === "" || value === null || value === false) delete record.fields[key];
    return record;
  } });
  assert.equal(result.resolved.length, 1);
  assert.equal(f.sqlite.prepare("SELECT is_customer_churn FROM subscription_cancellations").get().is_customer_churn, 0);
  f.sqlite.close();
});
test("webhook creation after cancellation immediately removes gross churn and lost MRR", async () => {
  const f = fixture();
  const source = fs.readFileSync(new URL("../lib/db.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function reconcileSubscriptionCreated("), source.indexOf("export async function getSubscriptionCancellationMetrics(")).replace("export ", "");
  const reconcile = runPrivateInNewContext(body + "\nreconcileSubscriptionCreated", { getDb: () => f.db, continuityReplacement, sameLifecycleCustomer, lifecycleTime, lifecycleTimestamp: value => new Date(lifecycleTime(value)).toISOString() });
  const result = await reconcile({ body: { created: Date.parse(created.created_at) / 1000, data: created }, businessLine: "scooping" });
  assert.equal(result.isReplacement, true);
  const saved = f.sqlite.prepare("SELECT * FROM subscription_cancellations").get();
  assert.equal(saved.is_customer_churn, 0); assert.equal(saved.lost_mrr, 0); assert.equal(saved.reactivated_at, null);
  f.sqlite.close();
});
test("delayed webhook replay uses event time and creation-first lookup avoids a false cancellation", async () => {
  const f = fixture();
  const source = fs.readFileSync(new URL("../lib/db.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function findRecentReplacementSubscription("), source.indexOf("export async function reconcileSubscriptionCreated(")).replace("export ", "");
  const find = runPrivateInNewContext(body + "\nfindRecentReplacementSubscription", { getDb: () => f.db, continuityReplacement, sameLifecycleCustomer, lifecycleTime, lifecycleTimestamp: value => new Date(lifecycleTime(value)).toISOString() });
  const result = await find({ body: { created: Date.parse(canceled.canceled_at) / 1000, data: { ...canceled, client: canceled.client_ref, subscription_name: canceled.plan } }, businessLine: "scooping", classifyPlan: () => "scooping" });
  assert.equal(result.subscriptionId, "new");
  f.sqlite.close();
});
