import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as store from '../lib/crm-billing-store.mjs';
import { createSubscription, amendSubscription, advanceSubscription, acknowledgeSubscriptionNotice, promiseSubscriptionCredit } from '../lib/crm-subscriptions.mjs';
import { FakePaymentsProvider } from '../lib/fake-payments-provider.mjs';
import { createFakeQboGateway } from '../lib/crm-billing-qbo.mjs';
import { buildMonthlyInvoice } from '../lib/crm-billing.mjs';

const actor = 'owner@example.test';
const context = (at = '2027-03-01T15:00:00Z') => ({ actor, at });
const book = () => ({ id: 'fixture', version: 1, effectiveDate: '2026-01-01', currency: 'USD', zones: [{ id: 'zone', label: 'Fixture zone', zips: ['43601'] }],
  plans: [{ id: 'yard', label: 'Weekly yard service', rates: [{ frequency: 'once_a_week', dogCount: 2, zoneId: 'zone', baseCents: 9500, extraDogsCents: 1000 }] }],
  yardTiers: [{ id: 'large', label: 'Large yard', upchargeCents: 1500 }], addons: [] });
const selection = { planId: 'yard', frequency: 'once_a_week', dogCount: 2, zip: '43601', yardTierId: 'large', addons: [] };
const chargeInput = value => ({ requestId: crypto.randomUUID(), expectedRevision: value.revision, reason: 'Owner collected approved fixture invoice' });
const providerConnection = (processor, overrides = {}) => Object.fromEntries(['hostedTokenizerConfig', 'createProfile', 'getProfile', 'charge', 'inquire', 'void', 'refund', 'pollAch'].map(name => [name, overrides[name] || processor[name].bind(processor)]));
const qboMapping = () => ({ reviewed: true, realmId: 'fixture-realm', customerMappings: { customer: { customerId: 'qbo-customer' } },
  itemIds: { base_plan: 'item-service', extra_dogs: 'item-dogs', yard_size: 'item-yard', addon: 'item-addon', manual_adjustment: 'item-service' },
  discountAccountId: 'account-discounts', undepositedFundsAccountId: 'account-undeposited', bankAccountId: 'account-bank', feeExpenseAccountId: 'account-fees', feePayableAccountId: 'account-fees-payable', refundItemId: 'item-refund' });
const saveSettings = (f, settings) => store.saveBillingSettings(f.db, { requestId: crypto.randomUUID(), expectedRevision: 0, settings, reason: 'Owner reviewed UAT billing settings' }, context());
async function fixture({ methodType = 'card', creditCents = 0, outcomes = [] } = {}) {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0070_crm_subscriptions.sql', '0071_crm_billing_uat.sql']) sql.exec(fs.readFileSync(new URL(`../schema-proposals/${file}`, import.meta.url), 'utf8'));
  const db = {
    failAfter: null, beforeBatch: null,
    prepare(query) { return { bind(...args) { return {
      query, args,
      async first() { return sql.prepare(query).get(...args) || null; },
      async all() { return { results: sql.prepare(query).all(...args) }; },
      async run() { return sql.prepare(query).run(...args); },
    }; } }; },
    async batch(statements) {
      if (db.beforeBatch) { const run = db.beforeBatch; db.beforeBatch = null; run(); }
      sql.exec('BEGIN');
      try {
        const result = statements.map((statement, index) => {
          if (db.failAfter === index) { db.failAfter = null; throw new Error('Injected local billing transaction failure'); }
          return { results: sql.prepare(statement.query).all(...statement.args) };
        }); sql.exec('COMMIT'); return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  sql.prepare('INSERT INTO crm_subscription_customers VALUES(?,?,?,?,?,?,?,?)').run('customer', 'org-opwp', 'Sample Customer', 1, actor, 'Fabricated billing fixture', context().at, context().at);
  sql.prepare('INSERT INTO crm_subscription_books VALUES(?,?,?,?,?,?)').run('org-opwp', 1, JSON.stringify(book()), actor, 'Fabricated price book', context().at);
  let subscription = createSubscription({ id: 'sub', customerId: 'customer', startDate: '2027-01-01', selection }, book(), context('2027-01-01T15:00:00Z'));
  if (creditCents) subscription = promiseSubscriptionCredit(subscription, { expectedRevision: subscription.revision, amountCents: creditCents, reason: 'Verified promised credit' }, context());
  sql.prepare('INSERT INTO crm_subscriptions VALUES(?,?,?,?,?,?)').run(subscription.id, 'org-opwp', subscription.customerId, subscription.revision, JSON.stringify(subscription), context().at);
  const provider = new FakePaymentsProvider({ outcomes });
  const method = await provider.createProfile({ token: '9000000000000001', processorCustomerId: 'fixture-customer', methodType, billingZip: '43601', consent: true, isDefault: true });
  sql.prepare('INSERT INTO crm_billing_methods VALUES(?,?,?,?,?,?,?,?)').run('method', 'customer', 'org-opwp', 1, 1, JSON.stringify(method), context().at, context().at);
  const count = table => sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const invoice = id => JSON.parse(sql.prepare('SELECT state_json FROM crm_billing_invoices WHERE id=?').get(id).state_json);
  const sub = () => JSON.parse(sql.prepare('SELECT state_json FROM crm_subscriptions WHERE id=?').get('sub').state_json);
  const monthly = async (extra = {}) => store.generateMonthlyBillingDrafts(db, { periodStart: '2027-03-01', reason: 'Owner prepared monthly review', ...extra }, context());
  const command = (value, action, extra = {}, ctx = context()) => store.runBillingCommand(db, { requestId: crypto.randomUUID(), invoiceId: value.id, expectedRevision: value.revision, action, reason: 'Owner reviewed billing fixture', ...extra }, ctx);
  return { sql, db, provider, method, invoice, sub, count, monthly, command };
}

test('monthly generation creates a draft once per customer-period and never calls the payment provider', async () => {
  const f = await fixture(), first = await f.monthly(), replay = await f.monthly();
  assert.equal(first.generated.length, 1); assert.equal(replay.generated.length, 1); assert.equal(replay.duplicateCount, 1);
  assert.equal(first.generated[0].id, replay.generated[0].id); assert.equal(first.generated[0].status, 'draft');
  assert.equal(f.count('crm_billing_invoices'), 1); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 0);
  assert.equal(f.count('crm_billing_audit'), 1); assert.equal(f.count('crm_billing_attempts'), 0);
});

test('both first-period settings keep initial cleanup and subscription on exactly one retry-safe invoice', async () => {
  for (const firstPeriodMode of ['prorated', 'full']) {
    const f = await fixture(), input = { customerId: 'customer', startDate: '2027-03-16', initialCleanupCents: 5000, firstPeriodMode, includeNextFullMonth: true, reason: 'New client consolidated review' };
    const first = await store.createNewClientBillingInvoice(f.db, input, context('2027-03-16T15:00:00Z'));
    const replay = await store.createNewClientBillingInvoice(f.db, input, context('2027-03-16T15:00:00Z'));
    assert.equal(f.count('crm_billing_invoices'), 1); assert.equal(first.invoice.id, replay.invoice.id); assert.equal(replay.duplicate, true);
    assert.equal(first.invoice.lineItems.filter(line => line.kind === 'initial_cleanup').length, 1);
    assert.equal(first.invoice.totalCents, firstPeriodMode === 'prorated' ? 23194 : 29000);
    assert.equal(first.invoice.lineItems.reduce((sum, line) => sum + line.totalCents, 0), first.invoice.totalCents);
  }
});

test('new-client coverage including next full month blocks a separate monthly invoice under another type', async () => {
  const f = await fixture();
  const created = await store.createNewClientBillingInvoice(f.db, { customerId: 'customer', startDate: '2027-03-16', initialCleanupCents: 5000, includeNextFullMonth: true, reason: 'Reviewed conversion' }, context('2027-03-16T15:00:00Z'));
  const batch = await f.monthly({ periodStart: '2027-04-01' });
  assert.equal(batch.generated.length, 0); assert.equal(f.count('crm_billing_invoices'), 1);
  assert.deepEqual(f.invoice(created.invoice.id).coverage.map(row => [row.startDate, row.endDate]), [['2027-03-16', '2027-04-01'], ['2027-04-01', '2027-05-01']]);
});

test('promised credit is reserved across draft periods but not consumed before payment', async () => {
  const f = await fixture({ creditCents: 2500 }), march = await f.monthly(), april = await f.monthly({ periodStart: '2027-04-01' });
  assert.equal(march.generated[0].totalCents, 9500); assert.equal(april.generated[0].totalCents, 12000);
  assert.equal(f.sub().credits[0].remainingCents, 2500); assert.equal(f.sub().credits[0].applications.length, 0);
  const rows = f.sql.prepare('SELECT status,amount_cents FROM crm_billing_credit_reservations').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'reserved'); assert.equal(rows[0].amount_cents, 2500);
});

test('failed invoice persistence rolls back invoice, coverage, credit reservation and audit together', async () => {
  const f = await fixture({ creditCents: 2500 }); f.db.failAfter = 2;
  await assert.rejects(f.monthly(), /Injected local billing/);
  for (const table of ['crm_billing_invoices', 'crm_billing_coverage', 'crm_billing_credit_reservations', 'crm_billing_audit', 'crm_billing_write_guards']) assert.equal(f.count(table), 0);
  assert.equal(f.sub().credits[0].remainingCents, 2500);
  const retried = await f.monthly(); assert.equal(retried.generated.length, 1); assert.equal(f.count('crm_billing_invoices'), 1);
});

test('workspace retains review filters and contains safe saved-method metadata only', async () => {
  const f = await fixture({ methodType: 'ach' }); await f.monthly();
  const all = await store.readBillingWorkspace(f.db, { period: '2027-03-01', filter: 'all' });
  assert.equal(all.invoices.length, 1); assert.equal(all.invoices[0].availableMethodId, 'method'); assert.equal(all.invoices[0].missingPaymentMethod, false);
  assert.equal((await store.readBillingWorkspace(f.db, { filter: 'ach' })).invoices.length, 1);
  assert.equal((await store.readBillingWorkspace(f.db, { filter: 'card' })).invoices.length, 0);
  assert.ok(!/"(?:token|pan|cvv|routing|bankAccount|accountNumber)"\s*:/.test(JSON.stringify(all)));
});

test('approval command replays exactly once and rejects changed bodies or stale invoice revisions', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0];
  const input = { requestId: crypto.randomUUID(), invoiceId: draft.id, expectedRevision: draft.revision, action: 'approve', reason: 'Owner approved reviewed draft' };
  const approved = await store.runBillingCommand(f.db, input, context());
  const replay = await store.runBillingCommand(f.db, input, context());
  assert.equal(approved.invoice.status, 'approved'); assert.equal(replay.duplicate, true);
  assert.equal(f.invoice(draft.id).revision, approved.invoice.revision); assert.equal(f.count('crm_billing_commands'), 1);
  assert.equal(f.count('crm_billing_qbo_outbox'), 1); assert.equal(f.count('crm_billing_attempts'), 0);
  await assert.rejects(store.runBillingCommand(f.db, { ...input, reason: 'Changed request content' }, context()), /reused/);
  await assert.rejects(f.command(draft, 'approve'), /changed/);
});

test('holding revokes approval and prevents an atomic approve-all batch from partly approving', async () => {
  const f = await fixture(), march = (await f.monthly()).generated[0], april = (await f.monthly({ periodStart: '2027-04-01' })).generated[0];
  const approved = (await f.command(march, 'approve')).invoice;
  const held = (await f.command(approved, 'hold')).invoice;
  assert.equal(held.status, 'draft'); assert.equal(held.approvedAt, null); assert.equal(held.held, true);
  assert.equal(f.count('crm_billing_qbo_outbox'), 0);
  await assert.rejects(store.runBillingCommand(f.db, { requestId: crypto.randomUUID(), action: 'approve_batch', invoiceIds: [april.id, held.id], expectedRevisions: { [april.id]: april.revision, [held.id]: held.revision }, reason: 'Batch office review' }, context()), /unheld/);
  assert.equal(f.invoice(april.id).status, 'draft'); assert.equal(f.invoice(april.id).revision, april.revision);
});

test('invoice revision comparison and mutation are atomic across a concurrent office change', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0];
  f.db.beforeBatch = () => {
    const changed = { ...draft, revision: draft.revision + 1, held: true, holdReason: 'Concurrent office hold' };
    f.sql.prepare('UPDATE crm_billing_invoices SET revision=?,state_json=? WHERE id=?').run(changed.revision, JSON.stringify(changed), draft.id);
  };
  await assert.rejects(f.command(draft, 'approve'), /changed/);
  assert.equal(f.invoice(draft.id).held, true); assert.equal(f.invoice(draft.id).status, 'draft');
  assert.equal(f.count('crm_billing_commands'), 0); assert.equal(f.count('crm_billing_write_guards'), 0);
});

test('void releases draft credit reservations while preserving canonical promised credit', async () => {
  const f = await fixture({ creditCents: 2500 }), draft = (await f.monthly()).generated[0];
  await f.command(draft, 'void');
  assert.equal(f.sub().credits[0].remainingCents, 2500);
  assert.equal(f.sql.prepare('SELECT status FROM crm_billing_credit_reservations').get().status, 'released');
  assert.ok(f.sql.prepare('SELECT released_at FROM crm_billing_coverage').get().released_at);
  assert.equal((await f.monthly({ periodStart: '2027-04-01' })).generated[0].totalCents, 9500);
});

test('hosted profile registration persists allowed metadata and audits defaults without retaining token input', async () => {
  const f = await fixture();
  const result = await store.createHostedBillingMethod(f.db, { customerId: 'customer', token: '9000000000000002', methodType: 'ach', billingZip: '43601', consent: true, isDefault: true }, context(), { provider: f.provider });
  assert.equal(result.method.methodType, 'ach');
  const methods = f.sql.prepare('SELECT is_default,method_json FROM crm_billing_methods').all();
  assert.equal(methods.length, 2); assert.equal(methods.filter(row => row.is_default).length, 1);
  const persisted = JSON.stringify(f.sql.prepare('SELECT * FROM crm_billing_audit').all()) + JSON.stringify(methods);
  assert.ok(!persisted.includes('9000000000000002')); assert.ok(!/"(?:token|pan|cvv|accountNumber|routingNumber)"\s*:/.test(persisted));
  assert.equal(f.count('crm_billing_audit'), 3);
});

test('persistent collection requires approval and its first-day schedule before making any processor call', async () => {
  const f = await fixture(), draft = (await f.monthly({ periodStart: '2027-04-01' })).generated[0];
  await assert.rejects(store.chargeBillingInvoice(f.db, draft.id, chargeInput(draft), context(), { provider: f.provider }), /approval/);
  const approved = (await f.command(draft, 'approve')).invoice;
  await assert.rejects(store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider }), /not due/);
  assert.equal(f.count('crm_billing_attempts'), 0); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 0);
});

test('approved card collection durably claims exactly one attempt and consumes reserved credit once after Paid', async () => {
  const f = await fixture({ creditCents: 2500 }), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  assert.equal(f.sub().credits[0].remainingCents, 2500);
  const input = chargeInput(approved), paid = (await store.chargeBillingInvoice(f.db, approved.id, input, context(), { provider: f.provider })).invoice;
  assert.equal(paid.status, 'paid'); assert.equal(paid.totalCents, 9500);
  assert.equal(f.provider.calls.find(call => call.operation === 'charge').amountCents, paid.lineItems.reduce((n, row) => n + row.totalCents, 0));
  const replay = await store.chargeBillingInvoice(f.db, approved.id, input, context(), { provider: f.provider });
  assert.equal(replay.invoice.status, 'paid'); assert.equal(replay.duplicate, true);
  assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1); assert.equal(f.count('crm_billing_attempts'), 1);
  assert.equal(f.sql.prepare('SELECT idempotency_key FROM crm_billing_attempts').get().idempotency_key, `${paid.id}:1`);
  assert.equal(f.sub().credits[0].remainingCents, 0); assert.equal(f.sub().credits[0].applications.length, 1);
  assert.equal(f.sql.prepare('SELECT status FROM crm_billing_credit_reservations').get().status, 'applied');
  assert.equal(f.count('crm_billing_qbo_outbox'), 2);
  await assert.rejects(store.chargeBillingInvoice(f.db, paid.id, chargeInput(paid), context(), { provider: f.provider }), /approval|subscription changed/);
});

test('transport loss after processor charge stays blocked until a fresh connection inquires on the same durable order', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const connection = providerConnection(f.provider, { charge: async input => { await f.provider.charge(input); throw new Error('Simulated lost response after processor accepted charge'); } });
  const uncertain = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: connection })).invoice;
  assert.equal(uncertain.status, 'charging'); assert.equal(uncertain.reconciliationRequired, true);
  await assert.rejects(f.command(uncertain, 'retry'), /failed/);
  await assert.rejects(store.chargeBillingInvoice(f.db, uncertain.id, chargeInput(uncertain), context(), { provider: providerConnection(f.provider) }), /approval/);
  const found = (await store.reconcileBillingInvoice(f.db, uncertain.id, { expectedRevision: uncertain.revision }, context(), { provider: providerConnection(f.provider) })).invoice;
  assert.equal(found.status, 'paid'); assert.equal(found.attempts.length, 1); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1);
  const durable = f.sql.prepare('SELECT provider_order_id,status FROM crm_billing_attempts').get();
  assert.equal(durable.status, 'paid'); assert.equal(f.provider.calls.find(call => call.operation === 'inquire').orderId, durable.provider_order_id);
});

test('database failure after a successful processor call preserves its durable claim for inquiry without a second charge', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const input = chargeInput(approved), connection = providerConnection(f.provider, { charge: async args => { const result = await f.provider.charge(args); f.db.failAfter = 0; return result; } });
  await assert.rejects(store.chargeBillingInvoice(f.db, approved.id, input, context(), { provider: connection }), /Injected local billing/);
  const claimed = f.invoice(approved.id); assert.equal(claimed.status, 'charging'); assert.equal(f.count('crm_billing_attempts'), 1);
  assert.equal((await store.chargeBillingInvoice(f.db, approved.id, input, context(), { provider: providerConnection(f.provider) })).invoice.status, 'charging');
  const paid = (await store.reconcileBillingInvoice(f.db, claimed.id, {}, context(), { provider: providerConnection(f.provider) })).invoice;
  assert.equal(paid.status, 'paid'); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1);
});

test('a subscription changed after drafting requires a refreshed draft and renewed review before collection', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], current = f.sub();
  const changed = amendSubscription(current, { expectedRevision: current.revision, effectiveDate: '2027-03-01', rateSource: 'manual', manualRateCents: 11000, manualReason: 'Reviewed rate amendment', reason: 'Owner changed the agreement rate' }, book(), context());
  f.sql.prepare('UPDATE crm_subscriptions SET revision=?,state_json=? WHERE id=?').run(changed.revision, JSON.stringify(changed), changed.id);
  await assert.rejects(f.command(draft, 'approve'), /subscription changed/);
  assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 0);
  const refreshed = (await f.command(draft, 'refresh')).invoice;
  assert.equal(refreshed.status, 'draft'); assert.equal(refreshed.totalCents, 11000); assert.equal(refreshed.sourceRevisions.find(row => row.subscriptionId === 'sub').revision, changed.revision);
  assert.equal((await f.command(refreshed, 'approve')).invoice.status, 'approved');
});

test('advancing derived subscription billing-period metadata on the first does not invalidate its evening draft', async () => {
  const f = await fixture();
  const persist = value => f.sql.prepare('UPDATE crm_subscriptions SET revision=?,state_json=? WHERE id=?').run(value.revision, JSON.stringify(value), value.id);
  const original = f.sub();
  const february = amendSubscription(original, { expectedRevision: original.revision, effectiveDate: '2027-03-01', rateSource: 'manual', manualRateCents: 11000, manualReason: 'Reviewed future rate', reason: 'Scheduled March rate' }, book(), context('2027-02-28T23:00:00Z'));
  february.billingPeriodStart = '2027-02-01'; february.billingPeriodEnd = '2027-03-01';
  february.invoices.push({ id: 'legacy-period-fixture', periodStart: '2027-03-01', periodEnd: '2027-04-01' }); persist(february);
  const draft = (await store.generateMonthlyBillingDrafts(f.db, { periodStart: '2027-03-01', reason: 'Evening monthly draft preparation' }, context('2027-02-28T23:00:00Z'))).generated[0];
  const advanced = advanceSubscription(f.sub(), context('2027-03-01T14:00:00Z'));
  const march = acknowledgeSubscriptionNotice(advanced, { expectedRevision: advanced.revision, versionId: advanced.versions.at(-1).id, customerNotified: true, reason: 'Office recorded prior notice delivery' }, context('2027-03-01T14:01:00Z')); persist(march);
  assert.ok(march.revision > february.revision); assert.equal(march.billingPeriodStart, '2027-03-01');
  const approved = (await f.command(draft, 'approve')).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  assert.equal(paid.status, 'paid'); assert.equal(paid.totalCents, 11000); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1);
});

test('definitive card failure remains Failed, consumes no promised credit, and a reviewed retry records the next attempt', async () => {
  const f = await fixture({ creditCents: 2500, outcomes: [{ status: 'failed', processorCode: '05', retryable: true }] });
  const draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const failed = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  assert.equal(failed.status, 'failed'); assert.equal(failed.paidAt, undefined); assert.equal(f.sub().credits[0].remainingCents, 2500);
  assert.equal(failed.attempts[0].processorCode, '05'); assert.equal(f.count('crm_billing_qbo_outbox'), 1);
  const retry = (await f.command(failed, 'retry', { chargeNow: true })).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, retry.id, chargeInput(retry), context(), { provider: f.provider })).invoice;
  assert.equal(paid.status, 'paid'); assert.deepEqual(paid.attempts.map(row => row.idempotencyKey), [`${paid.id}:1`, `${paid.id}:2`]);
  assert.equal(f.sub().credits[0].applications.length, 1); assert.equal(f.count('crm_billing_attempts'), 2);
});

test('ACH stays Pending without consuming credit until authenticated settlement and late return preserves Paid history', async () => {
  const f = await fixture({ methodType: 'ach', creditCents: 2500 }), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const pending = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  assert.equal(pending.status, 'pending'); assert.equal(f.sub().credits[0].remainingCents, 2500); assert.equal(f.count('crm_billing_qbo_outbox'), 1);
  f.provider.settleAch(pending.attempts[0].transactionId);
  const settled = (await store.reconcileBillingInvoice(f.db, pending.id, {}, context('2027-03-03T15:00:00Z'), { provider: f.provider })).invoice;
  assert.equal(settled.status, 'paid'); assert.equal(f.sub().credits[0].remainingCents, 0); assert.equal(f.count('crm_billing_qbo_outbox'), 2);
  f.provider.settleAch(settled.transactionId, { achReturnCode: 'R10' });
  const returned = (await store.reconcileBillingInvoice(f.db, settled.id, {}, context('2027-03-04T15:00:00Z'), { provider: f.provider })).invoice;
  assert.equal(returned.status, 'paid'); assert.equal(returned.totalCents, settled.totalCents); assert.equal(returned.refundedCents, settled.totalCents);
  assert.equal(returned.refunds[0].kind, 'ach_return'); assert.equal(returned.returnAction, 'new_authorization_or_method_required');
  await store.reconcileBillingInvoice(f.db, settled.id, {}, context('2027-03-04T15:00:00Z'), { provider: f.provider });
  assert.equal(f.invoice(settled.id).refunds.length, 1); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1);
});

test('fully credited invoices become Paid only after approval and never call the processor', async () => {
  const f = await fixture({ creditCents: 15000 }), draft = (await f.monthly()).generated[0]; assert.equal(draft.totalCents, 0);
  const approved = (await f.command(draft, 'approve')).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  assert.equal(paid.status, 'paid'); assert.equal(paid.settlementSource, 'credits'); assert.equal(f.sub().credits[0].remainingCents, 3000);
  assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 0); assert.equal(f.count('crm_billing_attempts'), 0);
});

test('webhook hints cannot create invoices or trust a supplied payment status and replay settles ACH once through inquiry', async () => {
  const f = await fixture({ methodType: 'ach' });
  await assert.rejects(store.recordBillingWebhookHint(f.db, { eventId: 'orphan', orderId: 'missing-order' }, context(), { provider: f.provider }), /durable charge/);
  assert.equal(f.count('crm_billing_invoices'), 0);
  const draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const pending = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  const claim = f.sql.prepare('SELECT provider_order_id FROM crm_billing_attempts').get();
  const hint = { eventId: 'ach-settlement-event', invoiceId: pending.id, orderId: claim.provider_order_id, transactionId: pending.attempts[0].transactionId };
  await assert.rejects(store.recordBillingWebhookHint(f.db, { ...hint, status: 'paid' }, context(), { provider: f.provider }), /safe UAT relay/);
  assert.equal(f.invoice(pending.id).status, 'pending');
  f.provider.settleAch(hint.transactionId);
  assert.equal((await store.recordBillingWebhookHint(f.db, hint, context(), { provider: f.provider })).invoice.status, 'paid');
  assert.equal((await store.recordBillingWebhookHint(f.db, hint, context(), { provider: f.provider })).duplicate, true);
  await assert.rejects(store.recordBillingWebhookHint(f.db, { ...hint, orderId: 'changed-order' }, context(), { provider: f.provider }), /reused/);
  assert.equal(f.count('crm_billing_webhook_hints'), 1); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1);
  assert.equal(f.provider.calls.filter(call => call.operation === 'inquire').length, 2);
  assert.equal(f.count('crm_billing_qbo_outbox'), 2); assert.equal(f.invoice(pending.id).attempts.length, 1);
});

test('partial refunds record unique immutable reversals, replay once and cap the remaining paid balance', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  let paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  const input = { ...chargeInput(paid), amountCents: 2500 };
  paid = (await store.refundBillingInvoice(f.db, paid.id, input, context(), { provider: f.provider })).invoice;
  const replay = await store.refundBillingInvoice(f.db, paid.id, input, context(), { provider: f.provider });
  assert.equal(replay.duplicate, true); assert.equal(replay.invoice.refundedCents, 2500);
  paid = (await store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), amountCents: 3500 }, context(), { provider: f.provider })).invoice;
  assert.equal(paid.status, 'paid'); assert.equal(paid.totalCents, 12000); assert.equal(paid.refundedCents, 6000); assert.equal(paid.refunds.length, 2);
  assert.notEqual(paid.refunds[0].transactionId, paid.refunds[1].transactionId);
  await assert.rejects(store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), amountCents: 6001 }, context(), { provider: f.provider }), /remaining/);
  assert.equal(f.provider.calls.filter(call => call.operation === 'refund').length, 2); assert.equal(f.count('crm_billing_adjustments'), 2);
});

test('an uncertain processor refund blocks a second adjustment until its original order is reconciled', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  const connection = providerConnection(f.provider, { refund: async input => { await f.provider.refund(input); throw new Error('Lost refund response'); } });
  const uncertain = await store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), amountCents: 2500 }, context(), { provider: connection });
  assert.equal(uncertain.adjustment.status, 'unknown'); assert.equal(uncertain.invoice.refundedCents, 0);
  await assert.rejects(store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), amountCents: 1000 }, context(), { provider: f.provider }), /reconciliation/);
  const resolved = await store.reconcileBillingAdjustment(f.db, { adjustmentId: uncertain.adjustment.id, reason: 'Reconciled original processor refund' }, context(), { provider: providerConnection(f.provider) });
  assert.equal(resolved.adjustment.status, 'confirmed'); assert.equal(resolved.invoice.refundedCents, 2500);
  assert.equal(f.provider.calls.filter(call => call.operation === 'refund').length, 1); assert.equal(f.count('crm_billing_adjustments'), 1);
});

test('a credit already itemized on a draft permits refunding the entire actual collected amount', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0];
  const credited = (await f.command(draft, 'credit', { amountCents: 2000 })).invoice;
  const approved = (await f.command(credited, 'approve')).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  assert.equal(paid.totalCents, 10000);
  const refunded = (await store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), amountCents: 10000 }, context(), { provider: f.provider })).invoice;
  assert.equal(refunded.refundedCents, 10000); assert.equal(f.provider.calls.find(call => call.operation === 'refund').amountCents, 10000);
});

test('concurrent distinct refund requests can claim only one processor adjustment for the same paid revision', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  const requestIds = ['aaaaaaaa-aaaa-4aaa-1234-123456789012', 'bbbbbbbb-bbbb-4bbb-1234-123456789012'];
  const results = await Promise.allSettled(requestIds.map(requestId => store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), requestId, amountCents: 7000 }, context(), { provider: f.provider })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, JSON.stringify(results.map(result => ({ status: result.status, reason: result.reason?.message })))); assert.equal(f.provider.calls.filter(call => call.operation === 'refund').length, 1);
  assert.equal(f.invoice(paid.id).refundedCents, 7000); assert.equal(f.count('crm_billing_adjustments'), 1);
});

test('a paid-invoice credit is blocked while an earlier processor refund remains uncertain', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  const paid = (await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider })).invoice;
  const connection = providerConnection(f.provider, { refund: async () => { throw new Error('Refund transport uncertain'); } });
  await store.refundBillingInvoice(f.db, paid.id, { ...chargeInput(paid), amountCents: 7000 }, context(), { provider: connection });
  await assert.rejects(f.command(paid, 'credit', { amountCents: 6000 }), { status: 409 });
  assert.equal(f.invoice(paid.id).credits.length, 0); assert.equal(f.invoice(paid.id).refundedCents, 0);
});

test('QBO invoice/payment outbox replays a lost fixture response with stable IDs and preserves gross amounts', async () => {
  const f = await fixture(), mapping = qboMapping(); await saveSettings(f, { qboMapping: mapping });
  const draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  await store.chargeBillingInvoice(f.db, approved.id, chargeInput(approved), context(), { provider: f.provider });
  const gateway = createFakeQboGateway({ failures: ['lost_response'] });
  const first = await store.syncBillingQbo(f.db, { reason: 'Fixture accounting retry test' }, context(), { gateway });
  assert.ok(first.jobs.some(job => job.status === 'unsynced'));
  await store.syncBillingQbo(f.db, { force: true, reason: 'Retry accepted fixture operations' }, context('2027-03-01T15:10:00Z'), { gateway });
  const rows = f.sql.prepare('SELECT kind,status,qbo_id FROM crm_billing_qbo_outbox').all();
  assert.ok(rows.every(row => row.status === 'synced' && row.qbo_id));
  const invoiceCalls = gateway.calls.filter(call => call.entity === 'Invoice');
  assert.equal(invoiceCalls.length, 2); assert.equal(invoiceCalls[0].requestId, invoiceCalls[1].requestId);
  const payment = gateway.calls.find(call => call.entity === 'Payment'); assert.equal(payment.expectedTotalCents, 12000); assert.equal(payment.payload.TotalAmt, 120);
  assert.equal(payment.payload.ProcessPayment, false); assert.equal(payment.payload.DepositToAccountRef.value, 'account-undeposited');
  const count = gateway.calls.length; await store.syncBillingQbo(f.db, {}, context(), { gateway }); assert.equal(gateway.calls.length, count);
});

test('QBO sync requires an explicit CRM customer mapping and queues gross deposits and monthly fees separately', async () => {
  const f = await fixture(), mapping = { ...qboMapping(), customerId: 'unsafe-global-customer', customerMappings: {} };
  await saveSettings(f, { qboMapping: mapping });
  const draft = (await f.monthly()).generated[0]; await f.command(draft, 'approve');
  const gateway = createFakeQboGateway(); const blocked = await store.syncBillingQbo(f.db, {}, context(), { gateway });
  assert.equal(blocked.jobs[0].status, 'unsynced'); assert.equal(gateway.calls.length, 0);
  const sources = [
    { kind: 'deposit', source: { id: 'gross-march-deposit', depositDate: '2027-03-02', grossCents: 12000, payments: [{ qboPaymentId: 'fixture-payment', amountCents: 12000 }] } },
    { kind: 'fee', source: { id: 'march-processor-fees', periodStart: '2027-03-01', periodEnd: '2027-04-01', postedDate: '2027-04-05', amountCents: 365 } },
  ];
  for (const source of sources) {
    const input = { requestId: crypto.randomUUID(), ...source, reason: 'Reviewed gross accounting fixture' };
    const queued = await store.queueBillingAccounting(f.db, input, context());
    assert.equal((await store.queueBillingAccounting(f.db, input, context())).duplicate, true);
    await store.syncBillingQbo(f.db, { jobId: queued.jobId }, context(), { gateway });
  }
  const deposit = gateway.calls.find(call => call.entity === 'Deposit'), fee = gateway.calls.find(call => call.entity === 'Purchase');
  assert.equal(deposit.expectedTotalCents, 12000); assert.equal(deposit.payload.Line[0].Amount, 120);
  assert.equal(fee.expectedTotalCents, 365); assert.equal(fee.payload.Line[0].Amount, 3.65); assert.equal(fee.payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, 'account-fees');
  assert.equal(f.count('crm_billing_qbo_outbox'), 3);
});

test('accounting sources are immutable and a QBO payment cannot be reserved in two gross deposits', async () => {
  const f = await fixture(); await saveSettings(f, { qboMapping: qboMapping() });
  const source = { id: 'gross-deposit', depositDate: '2027-03-02', grossCents: 12000, payments: [{ qboPaymentId: 'gross-payment', amountCents: 12000 }] };
  const queue = (item, extra = {}) => store.queueBillingAccounting(f.db, { requestId: crypto.randomUUID(), kind: 'deposit', source: item, reason: 'Reviewed gross deposit source', ...extra }, context());
  await queue(source); await queue(source);
  await assert.rejects(queue({ ...source, depositDate: '2027-03-03' }), /different content/);
  await assert.rejects(queue({ ...source, id: 'different-deposit' }));
  assert.equal(f.count('crm_billing_deposit_links'), 1); assert.equal(f.count('crm_billing_qbo_outbox'), 1);
});

test('monthly fee statements use one recognition mode and settlement waits for its synced accrual', async () => {
  const f = await fixture(); await saveSettings(f, { qboMapping: qboMapping() });
  const source = { id: 'march-fee-statement', periodStart: '2027-03-01', periodEnd: '2027-04-01', postedDate: '2027-04-05', amountCents: 365 };
  const queue = kind => store.queueBillingAccounting(f.db, { requestId: crypto.randomUUID(), kind, source, reason: 'Reviewed monthly processor fee statement' }, context());
  await queue('fee_accrual'); await assert.rejects(queue('fee_settlement'), /accrual/); await assert.rejects(queue('fee'));
  const gateway = createFakeQboGateway(); await store.syncBillingQbo(f.db, { jobId: `fee_accrual:${source.id}` }, context(), { gateway });
  for (const changed of [{ amountCents: 366 }, { periodStart: '2027-02-01' }, { periodEnd: '2027-05-01' }]) {
    await assert.rejects(store.queueBillingAccounting(f.db, { requestId: crypto.randomUUID(), kind: 'fee_settlement', source: { ...source, ...changed }, reason: 'Attempted inconsistent fee settlement' }, context()), /accrual|statement|match/i);
  }
  const queued = await queue('fee_settlement'); await store.syncBillingQbo(f.db, { jobId: queued.jobId }, context(), { gateway });
  assert.equal(gateway.calls.length, 2); assert.equal(gateway.calls[0].entity, 'JournalEntry');
  assert.equal(gateway.calls[1].payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, 'account-fees-payable');
  assert.equal(f.count('crm_billing_fee_statements'), 1);
});

test('voiding an approved invoice removes its unattempted QBO invoice job before it can become final', async () => {
  const f = await fixture(), draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice;
  await f.command(approved, 'void'); assert.equal(f.count('crm_billing_qbo_outbox'), 0);
});

test('an in-flight QBO claim blocks financial edits, credits and refresh even before its first attempt returns', async () => {
  const f = await fixture(); await saveSettings(f, { qboMapping: qboMapping() });
  const draft = (await f.monthly()).generated[0], approved = (await f.command(draft, 'approve')).invoice, fakeGateway = createFakeQboGateway();
  let release, entered; const started = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const gateway = { fixtureOnly: true, submit: async item => { entered(); await barrier; return fakeGateway.submit(item); } };
  const syncing = store.syncBillingQbo(f.db, {}, context(), { gateway }); await started;
  try {
    assert.equal(f.sql.prepare('SELECT status FROM crm_billing_qbo_outbox').get().status, 'syncing');
    await assert.rejects(f.command(approved, 'edit', { lineItems: approved.lineItems }), /accounting|synchronization/i);
    await assert.rejects(f.command(approved, 'credit', { amountCents: 1000 }), /accounting|synchronization/i);
    await assert.rejects(f.command(approved, 'refresh'), /accounting|synchronization/i);
  } finally { release(); await syncing; }
  assert.equal(f.invoice(approved.id).revision, approved.revision); assert.equal(fakeGateway.calls.length, 1);
});

test('scheduler defaults off and enabled UAT creates evening drafts without charging until first-day approval', async () => {
  const f = await fixture(), flags = { DB: f.db, ROUTE_OS_BILLING_ENABLED: 'true', CRM_PAYMENTS_ENV: 'uat', APP_ENV: 'preview' };
  assert.equal((await store.processCrmBilling({ DB: f.db }, { provider: f.provider })).status, 'disabled');
  assert.equal((await store.processCrmBilling({ ...flags, APP_ENV: 'production' }, { provider: f.provider })).status, 'disabled');
  const before = await store.processCrmBilling(flags, { now: Date.parse('2027-02-28T22:59:00Z'), provider: f.provider }); assert.equal(before.generated, null);
  const evening = await store.processCrmBilling(flags, { now: Date.parse('2027-02-28T23:00:00Z'), provider: f.provider });
  assert.equal(evening.generated.generated.length, 1); assert.equal(evening.charged, 0);
  const first = await store.processCrmBilling(flags, { now: Date.parse('2027-03-01T14:00:00Z'), provider: f.provider }); assert.equal(first.charged, 0);
  const draft = evening.generated.generated[0]; await f.command(draft, 'approve', {}, context('2027-03-01T14:05:00Z'));
  const approved = await store.processCrmBilling(flags, { now: Date.parse('2027-03-01T14:06:00Z'), provider: f.provider });
  assert.equal(approved.charged, 1); assert.equal(f.provider.calls.filter(call => call.operation === 'charge').length, 1);
});

test('the bounded collection runner persists a cursor through more than one page and skips paid card history', async () => {
  const f = await fixture(), flags = { DB: f.db, ROUTE_OS_BILLING_ENABLED: 'true', CRM_PAYMENTS_ENV: 'uat', APP_ENV: 'preview' };
  const template = buildMonthlyInvoice([f.sub()], { id: 'template', customerId: 'customer', periodStart: '2027-03-01' }, context());
  const insert = f.sql.prepare('INSERT INTO crm_billing_invoices(id,organization_id,customer_id,invoice_key,invoice_type,period_start,period_end,revision,status,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const seed = (id, status) => {
    const value = { ...structuredClone(template), id, idempotencyKey: `fixture:${id}`, status, approvedAt: context().at, approvedBy: actor,
      subscriptionIds: [], coverage: [], sourceRevisions: [], creditApplications: [], methodType: 'card',
      lineItems: [{ ...template.lineItems[0], quantity: 1, unitCents: 0, totalCents: 0 }], subtotalCents: 0, taxableCents: 0, totalCents: 0,
      ...(status === 'paid' ? { paidAt: context().at } : {}) };
    insert.run(id, 'org-opwp', value.customerId, value.idempotencyKey, value.invoiceType, value.periodStart, value.periodEnd, value.revision, value.status, JSON.stringify(value), value.createdAt, value.updatedAt);
  };
  for (let index = 0; index < 110; index++) seed(`a-card-history-${String(index).padStart(3, '0')}`, 'paid');
  for (let index = 0; index < 137; index++) seed(`z-due-${String(index).padStart(3, '0')}`, 'approved');
  const now = Date.parse('2027-03-02T15:00:00Z'), first = await store.processCrmBilling(flags, { now, provider: f.provider });
  assert.equal(first.charged, 100); assert.equal(first.reconciled, 0); assert.equal(first.continuation, true); assert.deepEqual(first.errors, []);
  assert.equal(f.sql.prepare('SELECT cursor FROM crm_billing_runner_cursors').get().cursor, 'z-due-099');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM crm_billing_invoices WHERE id LIKE 'z-due-%' AND status='paid'").get().n, 100);
  const second = await store.processCrmBilling(flags, { now, provider: f.provider });
  assert.equal(second.charged, 37); assert.equal(second.reconciled, 0); assert.equal(second.continuation, false); assert.deepEqual(second.errors, []);
  assert.equal(f.sql.prepare('SELECT cursor FROM crm_billing_runner_cursors').get().cursor, '');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM crm_billing_invoices WHERE id LIKE 'z-due-%' AND status='paid'").get().n, 137);
  assert.equal((await store.processCrmBilling(flags, { now, provider: f.provider })).charged, 0);
  assert.equal(f.provider.calls.filter(call => ['charge', 'inquire'].includes(call.operation)).length, 0);
});

test('held and future-retry accounting jobs cannot starve a ready outbox job beyond the first hundred rows', async () => {
  const f = await fixture(); await saveSettings(f, { qboMapping: qboMapping() });
  const insert = f.sql.prepare('INSERT INTO crm_billing_qbo_outbox(id,source_key,kind,status,job_json,updated_at) VALUES (?,?,?,?,?,?)');
  for (const status of ['held', 'unsynced']) for (let index = 0; index < 125; index++) {
    const id = `${status}-${String(index).padStart(3, '0')}`;
    const job = { id, kind: 'invoice', payload: {}, status, attempts: status === 'held' ? 6 : 1, ...(status === 'unsynced' ? { retryAt: '2027-03-02T15:00:00Z' } : {}) };
    insert.run(id, id, 'invoice', status, JSON.stringify(job), '2027-02-28T15:00:00Z');
  }
  const source = { id: 'ready-monthly-fee', periodStart: '2027-02-01', periodEnd: '2027-03-01', postedDate: '2027-03-01', amountCents: 365 };
  const ready = await store.queueBillingAccounting(f.db, { requestId: crypto.randomUUID(), kind: 'fee', source, reason: 'Reviewed ready monthly fee fixture' }, context());
  const gateway = createFakeQboGateway(), result = await store.syncBillingQbo(f.db, {}, context(), { gateway });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].id, ready.jobId); assert.equal(result.jobs[0].status, 'synced');
  assert.equal(gateway.calls.length, 1); assert.equal(gateway.calls[0].entity, 'Purchase'); assert.equal(gateway.calls[0].expectedTotalCents, 365);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM crm_billing_qbo_outbox WHERE status='held'").get().n, 125);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM crm_billing_qbo_outbox WHERE status='unsynced'").get().n, 125);
});
