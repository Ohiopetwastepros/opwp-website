import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { classifyChurnEligibility } from "../lib/churn-eligibility.js";
import { canonicalChurnReason, churnReviewStatus } from "../lib/churn.js";

const checked = { businessLine: "scooping", serviceEvidenceAvailable: true, invoiceEvidenceAvailable: true };
test("backing out without service or a finalized invoice closes automatically", () => {
  const result = classifyChurnEligibility(checked);
  assert.equal(result.status, "Never Started");
  assert.equal(result.isChurn, false);
  assert.equal(result.reviewStatus, "Complete");
});

test("service counts before billing; unpaid invoices alone stay in review", () => {
  assert.equal(classifyChurnEligibility({ ...checked, completedServiceBefore: true }).isChurn, true);
  assert.equal(classifyChurnEligibility({ ...checked, paidInvoiceBefore: true, invoiceBefore: true }).isChurn, true);
  const unpaid = classifyChurnEligibility({ ...checked, invoiceBefore: true });
  assert.equal(unpaid.isChurn, false);
  assert.equal(unpaid.status, "Needs Validation");
});

test("missing evidence cannot automatically close a review, and other business lines retain their rules", () => {
  for (const input of [{}, { serviceEvidenceAvailable: true }, { invoiceEvidenceAvailable: true }]) {
    assert.equal(classifyChurnEligibility({ businessLine: "scooping", ...input }).status, "Needs Validation");
  }
  assert.equal(classifyChurnEligibility({ ...checked, businessLine: "dog_food" }).status, "Needs Validation");
  assert.equal(classifyChurnEligibility({ ...checked, businessLine: "addon" }).status, "Excluded");
  assert.equal(classifyChurnEligibility({ ...checked, replacementSubscriptionId: "replacement" }).status, "Plan Change");
});

const dbSource = readFileSync(new URL("../lib/db.js", import.meta.url), "utf8");
const invoiceFunction = dbSource.slice(dbSource.indexOf("export async function getChurnInvoiceEvidence"), dbSource.indexOf("export async function updateSubscriptionCancellationLostMrr")).replace("export ", "");
test("invoice lookup distinguishes no invoice, unpaid, paid, future, and another customer's invoice", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE sng_invoices (invoice_id TEXT, client_ref TEXT, sng_user_id TEXT, client_name TEXT, invoice_created_at TEXT, created_at TEXT, paid TEXT, remaining REAL, total REAL, category TEXT)");
  const db = { prepare: (sql) => ({ bind: (...values) => ({ first: async () => sqlite.prepare(sql).get(...values) }) }) };
  const lookup = runPrivateInNewContext(`${invoiceFunction}\ngetChurnInvoiceEvidence`, { getDb: () => db, lifecycleTimestamp: (value) => value });
  const input = { businessLine: "scooping", body: { data: { client: "customer-1", client_name: "Example", canceled_at: "2026-09-22T12:00:00Z" } } };
  const insert = sqlite.prepare("INSERT INTO sng_invoices VALUES (?,?,'',?,?,'2026-09-22',?,?,?,'scooping')");
  try {
    assert.equal((await lookup(input)).invoiceBefore, false);
    insert.run("other", "customer-2", "Other", "2026-09-01", "true", 0, 100);
    insert.run("future", "customer-1", "Example", "2026-09-23", "true", 0, 100);
    assert.equal((await lookup(input)).invoiceBefore, false);
    insert.run("unpaid", "customer-1", "Example", "2026-09-01", "false", 100, 100);
    let result = await lookup(input);
    assert.equal(result.invoiceBefore, true);
    assert.equal(result.paidInvoiceBefore, false);
    insert.run("zero", "customer-1", "Example", "2026-09-01", "true", 0, 0);
    insert.run("missing-balance", "customer-1", "Example", "2026-09-01", "false", 0, 100);
    assert.equal((await lookup(input)).paidInvoiceBefore, false);
    insert.run("paid", "customer-1", "Example", "2026-09-02", "true", 0, 100);
    assert.equal((await lookup(input)).paidInvoiceBefore, true);
    const injection = { ...input, body: { data: { ...input.body.data, client: "' OR 1=1 --", client_name: "' OR 1=1 --" } } };
    assert.equal((await lookup(injection)).invoiceBefore, false);
    assert.equal((await lookup({ body: {}, businessLine: "scooping" })).invoiceEvidenceAvailable, false);
  } finally { sqlite.close(); }
});

test("missing database and missing service identity do not masquerade as empty history", async () => {
  const lookup = runPrivateInNewContext(`${invoiceFunction}\ngetChurnInvoiceEvidence`, { getDb: () => null });
  assert.equal((await lookup({})).invoiceEvidenceAvailable, false);
  const source = readFileSync(new URL("../lib/airtable.js", import.meta.url), "utf8");
  const serviceFunction = source.slice(source.indexOf("export async function getSngChurnServiceEvidence"), source.indexOf("export async function updateSngChurnLifecycle")).replace("export ", "");
  for (const env of [{}, { AIRTABLE_API_KEY: "test" }]) {
    const service = runPrivateInNewContext(`${serviceFunction}\ngetSngChurnServiceEvidence`, { runtimeEnv: () => env });
    assert.equal((await service({})).serviceEvidenceAvailable, false);
  }
});

const processorSource = readFileSync(new URL("../lib/sng-event-processor.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
test("cancellation processing persists Never Started, zero lost MRR and inactive lifecycle; outages are retried", async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const processEvent = runPrivateInNewContext(`${processorSource}\nprocessSngEvent`, {
      console: { error: () => {} }, classifyChurnEligibility, canonicalChurnReason, churnReviewStatus,
      classifySngSubscriptionPlan: () => "scooping",
      findRecentReplacementSubscription: async () => null,
      getSngChurnServiceEvidence: async () => {
        if (fail) throw new Error("Airtable unavailable");
        return { serviceEvidenceAvailable: true, completedServiceBefore: false };
      },
      getChurnInvoiceEvidence: async () => ({ invoiceEvidenceAvailable: true, invoiceBefore: false, paidInvoiceBefore: false }),
      recordSubscriptionCancellation: async (value) => calls.push(["ledger", value]),
      upsertSngSubscriptionCanceled: async (_body, value) => { calls.push(["airtable", value]); return { lostMrr: 0 }; },
      updateSubscriptionCancellationLostMrr: async (id, value) => calls.push(["mrr", id, value]),
      updateSngCustomerLifecycle: async (_body, value) => calls.push(["lifecycle", value]),
      markSngEventProcessed: async (...args) => calls.push(["processed", ...args]),
    });
    const result = await processEvent({ id: "event", eventType: "client:subscription_canceled", body: { data: { subscription_id: "sub", termination_reason: "Other" } } });
    if (fail) {
      assert.equal(result.processed, false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][2], "needs_attention");
    } else {
      assert.equal(result.processed, true);
      for (const destination of ["ledger", "airtable"]) {
        const value = calls.find(([name]) => name === destination)[1];
        assert.equal(value.isCustomerChurn, false);
        assert.equal(value.eligibilityStatus, "Never Started");
        assert.equal(value.reviewStatus, "Complete");
      }
      assert.equal(calls.find(([name]) => name === "mrr")[2], 0);
      assert.equal(calls.find(([name]) => name === "lifecycle")[1].status, "Inactive");
    }
  }
});
