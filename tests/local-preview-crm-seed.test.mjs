import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createLocalPreviewCrmSeed } from '../scripts/local-preview-crm-seed.mjs';
import { defaultCrmPriceBook } from '../lib/crm-price-book.mjs';
import { filterSubscriptions, subscriptionView } from '../lib/crm-subscriptions.mjs';
import { readBillingWorkspace, runBillingCommand } from '../lib/crm-billing-store.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0070_crm_subscriptions.sql', '0071_crm_billing_uat.sql']) sql.exec(fs.readFileSync(new URL(`../schema-proposals/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(query) { return { bind(...args) { return { async first() { return sql.prepare(query).get(...args) || null; }, async all() { return { results: sql.prepare(query).all(...args) }; }, async run() { return sql.prepare(query).run(...args); }, query, args }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const result = statements.map(item => ({ results: sql.prepare(item.query).all(...item.args) })); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  return { sql, db };
}

test('local CRM seed is deterministic, self-contained and valid against the actual native schema', async () => {
  const first = await createLocalPreviewCrmSeed({ today: '2026-11-21' }), second = await createLocalPreviewCrmSeed({ today: '2026-11-21' });
  assert.equal(first.sql, second.sql);
  const { sql } = database(); sql.exec(first.sql);
  for (const [table, expected] of [['crm_subscription_customers', 25], ['crm_subscriptions', 24], ['crm_billing_invoices', 45], ['crm_billing_methods', 24], ['local_preview_customers', 25]]) assert.equal(sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, expected);
  assert.equal(first.manifest.draftCount, 44); assert.equal(sql.prepare("SELECT COUNT(*) n FROM crm_billing_invoices WHERE status='failed'").get().n, 1);
  assert.deepEqual([...new Set(first.customers.map(row => row.city))].sort(), ['Holland', 'Maumee', 'Perrysburg', 'Sylvania', 'Toledo']);
  assert.deepEqual([...new Set(first.customers.map(row => row.dogCount))].sort(), [1, 2, 3, 4, 5, 6]);
  assert.ok(first.customers.every(row => row.email.endsWith('.example.test') && row.phone.startsWith('+14195550')));
  assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('review has current and December drafts without duplicating consolidated coverage or reserved credits', async () => {
  const data = await createLocalPreviewCrmSeed({ today: '2026-11-21' }), { sql, db } = database(); sql.exec(data.sql);
  assert.deepEqual(data.manifest.invoicePeriods, [{ periodStart: '2026-11-01', count: 23, drafts: 22 }, { periodStart: '2026-12-01', count: 22, drafts: 22 }]);
  const december = await readBillingWorkspace(db, { period: '2026-12-01', filter: 'draft' });
  assert.equal(december.invoices.length, 22); assert.ok(december.invoices.every(invoice => invoice.status === 'draft'));
  assert.equal(data.invoices.filter(invoice => invoice.customerId === 'local-customer-25').length, 1);
  const newcomer = data.invoices.find(invoice => invoice.customerId === 'local-customer-25');
  assert.ok(newcomer.coverage.some(row => row.startDate === '2026-12-01' && row.endDate === '2027-01-01'));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_billing_credit_reservations').get().n, 1);
  assert.equal(sql.prepare(`SELECT COUNT(*) n FROM crm_billing_coverage a JOIN crm_billing_coverage b ON a.subscription_id=b.subscription_id AND a.invoice_id<b.invoice_id AND a.start_date<b.end_date AND b.start_date<a.end_date`).get().n, 0);
  assert.ok(data.invoices.some(invoice => invoice.customerId === 'local-customer-21' && invoice.periodStart === '2026-12-01'), 'paused service resumes with a December draft');
});

test('weekly one dog pricing is itemized and property copy is realistic without placeholders', async () => {
  const data = await createLocalPreviewCrmSeed({ today: '2026-11-21' });
  const weekly = data.subscriptions.find(row => row.id === 'local-subscription-01').versions.at(-1);
  assert.equal(weekly.lineItems.find(row => row.kind === 'base_plan').totalCents, 9500);
  assert.equal(weekly.totalCents, 27400);
  assert.equal(weekly.lineItems.find(row => row.id === 'addon:kitty_litter').totalCents, 12900);
  assert.equal(weekly.lineItems.find(row => row.id === 'addon:deodorize').totalCents, 5000);
  assert.doesNotMatch(data.customers.map(row => `${row.street} ${row.safetyNotes} ${row.todayNotes} ${row.persistentNotes}`).join(' '), /\b(?:example|fabricated|lorem|preview|demo)\b|[\u2013\u2014]/i);
  const yard = data.subscriptions.flatMap(row => row.versions.at(-1).lineItems).filter(row => row.kind === 'yard_size');
  assert.ok(yard.length > 0 && yard.every(row => row.itemized));
});

test('preview scenarios expose history, real amendments and manual rates without changing the source monthly grid', async () => {
  const data = await createLocalPreviewCrmSeed({ today: '2026-11-21' });
  assert.deepEqual(data.book.plans[0].rates, defaultCrmPriceBook().plans[0].rates);
  assert.equal(filterSubscriptions(data.subscriptions, 'past', '2026-11-21').length, 1);
  assert.equal(filterSubscriptions(data.subscriptions, 'all', '2026-11-21').length, 24);
  assert.equal(filterSubscriptions(data.subscriptions, 'active', '2026-11-21').length, 23);
  const paused = data.subscriptions.find(row => row.id === 'local-subscription-21');
  assert.equal(subscriptionView(paused, { date: '2026-11-21', book: data.book }).status, 'paused');
  for (const id of ['01', '02', '03']) { const sub = data.subscriptions.find(row => row.id === `local-subscription-${id}`); assert.equal(sub.versions.length, 2); assert.equal(sub.endDate, null); }
  const manual = data.subscriptions.find(row => row.id === 'local-subscription-04').versions.at(-1);
  assert.equal(manual.rateSource, 'manual'); assert.match(manual.manualReason, /loyalty/); assert.equal(manual.totalCents, 13000); assert.ok(manual.bookRateCents > manual.totalCents);
  assert.deepEqual(['kitty_litter', 'kitty_litter_extra_box', 'kitty_litter_changeout'].map(id => data.book.addons.find(row => row.id === id).unitCents), [12900, 3000, 5500]);
});

test('new and one-time clients each get one exact invoice, credits stay reserved and payment metadata is fake only', async () => {
  const data = await createLocalPreviewCrmSeed({ today: '2026-11-21' }), { sql } = database(); sql.exec(data.sql);
  for (const invoice of data.invoices) assert.equal(invoice.lineItems.reduce((sum, row) => sum + row.totalCents, 0), invoice.totalCents);
  const newcomer = data.invoices.filter(row => row.customerId === 'local-customer-25'); assert.equal(newcomer.length, 1);
  assert.equal(newcomer[0].invoiceType, 'new_client'); assert.equal(newcomer[0].firstPeriodMode, 'prorated'); assert.equal(newcomer[0].includeNextFullMonth, true);
  assert.equal(newcomer[0].coverage.length, 2); assert.ok(newcomer[0].lineItems.some(row => row.kind === 'initial_cleanup' && row.totalCents === 8500));
  assert.ok(newcomer[0].lineItems.some(row => row.id === 'initial_litter_changeout' && row.totalCents === 5500));
  const oneTime = data.invoices.filter(row => row.customerId === 'local-customer-24'); assert.equal(oneTime.length, 1); assert.equal(oneTime[0].totalCents, 15500); assert.equal(oneTime[0].coverage.length, 0);
  assert.equal(data.subscriptions.filter(row => row.customerId === 'local-customer-24').length, 0);
  assert.equal(data.subscriptions.find(row => row.id === 'local-subscription-07').credits[0].remainingCents, 1500);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM crm_billing_credit_reservations WHERE status='reserved'").get().n, 1);
  assert.equal(data.methods.every(row => row.provider === 'fake' && !Object.hasOwn(row, 'token')), true);
  assert.equal(data.methods.find(row => row.customerId === 'local-customer-23').methodType, 'card');
  assert.ok(data.methods.some(row => row.methodType === 'ach'));
});

test('seeded invoices can use the actual admin review and approval commands while missing-method review fails safely', async () => {
  const data = await createLocalPreviewCrmSeed({ today: '2026-11-21' }), { sql, db } = database(); sql.exec(data.sql);
  const workspace = await readBillingWorkspace(db, { period: '2026-11-01', filter: 'all' }); assert.equal(workspace.invoices.length, 23);
  const ctx = { actor: 'craig.preview@example.test', at: '2026-11-21T17:00:00.000Z' };
  const draft = data.invoices.find(row => row.id === 'local-invoice-01');
  const approved = await runBillingCommand(db, { action: 'approve', requestId: crypto.randomUUID(), invoiceId: draft.id, expectedRevision: draft.revision, reason: 'Local click-through reviewed approval' }, ctx);
  assert.equal(approved.invoice.status, 'approved'); assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_billing_attempts').get().n, 1, 'only the seeded historical decline exists; approval created no charge');
  const missing = data.invoices.find(row => row.id === 'local-invoice-08');
  await assert.rejects(runBillingCommand(db, { action: 'approve', requestId: crypto.randomUUID(), invoiceId: missing.id, expectedRevision: missing.revision, reason: 'Local missing-method review' }, ctx), /payment method/);
});
