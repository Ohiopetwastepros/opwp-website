import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import * as store from '../lib/crm-subscription-store.mjs';
import * as model from '../lib/crm-subscriptions.mjs';
import { defaultCrmPriceBook } from '../lib/crm-price-book.mjs';
import { PRICING, YARD_TIERS } from '../app/free-quote/pricing.js';
import { renderSubscriptionDocument } from '../lib/crm-subscription-documents.mjs';
import { operatingDate } from '../lib/field-policy.mjs';

const now = Date.parse('2026-11-20T18:00:00Z'), actor = 'admin@example.test', day = '2026-11-20';
const book = () => ({ id: 'test-book', version: 1, effectiveDate: '2026-01-01', currency: 'USD',
  zones: [{ id: 'standard', label: 'Standard', zips: ['43601'] }],
  plans: [{ id: 'yard', label: 'Weekly yard service', rates: [
    { frequency: 'weekly', dogCount: 2, zoneId: 'standard', baseCents: 9500, extraDogsCents: 1000 },
    { frequency: 'weekly', dogCount: 3, zoneId: 'standard', baseCents: 9500, extraDogsCents: 2000 },
  ] }], yardTiers: [{ id: 'large', label: 'Large yard', upchargeCents: 1500 }],
  addons: [{ id: 'deodorize', label: 'Deodorization', unitCents: 2500, billingInterval: 'monthly' }],
});
const selection = () => ({ planId: 'yard', frequency: 'weekly', dogCount: 2, zip: '43601', yardTierId: 'large', addons: [], discounts: [], lineVisibility: {} });
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(new URL('../schema-proposals/0070_crm_subscriptions.sql', import.meta.url), 'utf8'));
  sql.exec('CREATE TABLE dog_food_accounts(id TEXT PRIMARY KEY,verified_at TEXT)');
  const db = {
    failAfter: null, beforeBatch: null,
    prepare(query) { return { bind(...args) { return {
      query, args,
      async first() { return sql.prepare(query).get(...args) || null; },
      async all() { return { results: sql.prepare(query).all(...args) }; },
      async run() { return sql.prepare(query).run(...args); },
    }; } }; },
    async batch(statements) {
      if (db.beforeBatch) { const callback = db.beforeBatch; db.beforeBatch = null; callback(); }
      sql.exec('BEGIN');
      try {
        const results = statements.map((statement, index) => {
          if (db.failAfter === index) { db.failAfter = null; throw new Error('Injected local atomic-write failure'); }
          return { results: sql.prepare(statement.query).all(...statement.args) };
        });
        sql.exec('COMMIT'); return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  const initialBook = book();
  sql.prepare('INSERT INTO crm_subscription_books VALUES(?,?,?,?,?,?)').run('org-opwp', 1, JSON.stringify(initialBook), actor, 'Fabricated test book', new Date(now).toISOString());
  for (const [id, name] of [['customer-a', 'Sample Customer A'], ['customer-b', 'Sample Customer B']]) {
    sql.prepare('INSERT INTO crm_subscription_customers VALUES(?,?,?,?,?,?,?,?)').run(id, 'org-opwp', name, 1, actor, 'Fabricated test identity', new Date(now).toISOString(), new Date(now).toISOString());
  }
  const count = table => sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const state = id => JSON.parse(sql.prepare('SELECT state_json FROM crm_subscriptions WHERE id=?').get(id).state_json);
  const prepare = command => store.prepareCrmSubscriptionChange(db, actor, command, { now });
  const apply = (preview, requestId = crypto.randomUUID(), options = {}) => store.applyCrmSubscriptionPreview(db, actor, preview.token, requestId, { now, ...options });
  const create = async (input = {}) => {
    const preview = await prepare({ operation: 'create', customerId: 'customer-a', selection: selection(), startDate: '2026-11-01', billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-12-01', reason: 'Approved new test agreement', ...input });
    return { preview, result: await apply(preview), id: preview.subscription.id };
  };
  return { sql, db, count, state, prepare, apply, create };
}

test('a preview writes no subscription until explicit apply, and lost-response replay applies exactly once', async () => {
  const f = fixture();
  const preview = await f.prepare({ operation: 'create', customerId: 'customer-a', selection: selection(), startDate: day, reason: 'Approved test agreement' });
  assert.equal(f.count('crm_subscriptions'), 0); assert.equal(f.count('crm_subscription_previews'), 1);
  assert.equal(preview.customerDocument.totalCents, 12000); assert.equal(preview.confirmationEmail.totalCents, 12000);
  const requestId = crypto.randomUUID(), first = await f.apply(preview, requestId), replay = await f.apply(preview, requestId);
  assert.equal(first.applied, true); assert.equal(replay.duplicate, true);
  assert.equal(f.count('crm_subscriptions'), 1); assert.equal(f.count('crm_subscription_commands'), 1);
  assert.equal(f.state(preview.subscription.id).versions.length, 1); assert.equal(f.state(preview.subscription.id).audit.length, 1);
  assert.equal(f.count('crm_subscription_write_guards'), 0);
  await assert.rejects(store.applyCrmSubscriptionPreview(f.db, 'other-admin', preview.token, requestId, { now }), /different content/);
});

test('partial amendments retain one subscription and preview its actual manual-rate proration', async () => {
  const f = fixture(), created = await f.create(), original = f.state(created.id);
  const preview = await f.prepare({ operation: 'amend', subscriptionId: created.id, expectedRevision: original.revision, selection: { dogCount: 3 },
    rateSource: 'manual', manualRateCents: 9000, manualReason: 'Approved retention rate', effectiveDate: day, reason: 'Dog count and agreed price amended' });
  assert.equal(preview.subscription.id, created.id); assert.equal(preview.subscription.totalCents, 9000);
  assert.equal(preview.proration.newTotalCents, 9000); assert.equal(preview.proration.adjustmentCents, -1100);
  await f.apply(preview);
  const changed = f.state(created.id);
  assert.equal(f.count('crm_subscriptions'), 1); assert.equal(changed.versions.length, 2); assert.equal(changed.endDate, null);
  assert.equal(changed.versions[1].manualRateCents, 9000); assert.equal(changed.versions[1].manualReason, 'Approved retention rate');
  assert.ok(changed.audit.every(row => row.actor === actor && row.at && row.reason));
});

test('book changes flag below-book agreements without changing their saved rates or histories', async () => {
  const f = fixture(), created = await f.create(), before = JSON.stringify(f.state(created.id));
  const changedBook = book(); changedBook.plans[0].rates.forEach(rate => { rate.baseCents += 1000; });
  const preview = await f.prepare({ operation: 'price_book', expectedVersion: 1, priceBook: changedBook, reason: 'New approved test book' });
  assert.equal(preview.subscriptionsRepriced, 0); await f.apply(preview);
  assert.equal(JSON.stringify(f.state(created.id)), before);
  const view = await store.readCrmAdmin(f.db, { customerId: 'customer-a', date: day });
  assert.equal(view.subscriptions[0].totalCents, 12000); assert.equal(view.subscriptions[0].belowBook, true);
  assert.equal(view.priceBook.version, 2); assert.equal(view.report.belowBook.length, 1);
});

test('a stale bulk preview cannot partially reprice customers or consume its receipt', async () => {
  const f = fixture(), first = await f.create(), second = await f.create({ customerId: 'customer-b' });
  const bulk = await f.prepare({ operation: 'bulk_reprice', subscriptionIds: [first.id, second.id], effectiveDate: '2027-01-01', reason: 'Reviewed bulk rates' });
  const current = f.state(first.id);
  await f.apply(await f.prepare({ operation: 'amend', subscriptionId: first.id, expectedRevision: current.revision, selection: { dogCount: 3 }, effectiveDate: day, reason: 'Concurrent dog count correction' }));
  const count = f.count('crm_subscription_commands');
  await assert.rejects(f.apply(bulk), /changed|Preview/i);
  assert.equal(f.state(second.id).versions.length, 1); assert.equal(f.count('crm_subscription_commands'), count);
  assert.equal(f.sql.prepare('SELECT consumed_at FROM crm_subscription_previews WHERE token=?').get(bulk.token).consumed_at, null);
});

test('preview ownership, expiration and command identity are enforced before any agreement write', async () => {
  const f = fixture(), preview = await f.prepare({ operation: 'create', customerId: 'customer-a', selection: selection(), startDate: day, reason: 'Approved test agreement' });
  await assert.rejects(store.applyCrmSubscriptionPreview(f.db, 'other-admin', preview.token, crypto.randomUUID(), { now }), /expired|applied|again/i);
  await assert.rejects(f.apply(preview, crypto.randomUUID(), { now: now + 16 * 60000 }), /expired/i);
  assert.equal(f.count('crm_subscriptions'), 0);
  const firstId = crypto.randomUUID(); await f.apply(preview, firstId);
  const other = await f.prepare({ operation: 'create', customerId: 'customer-b', selection: selection(), startDate: day, reason: 'Another test agreement' });
  await assert.rejects(f.apply(other, firstId), /different content/);
  assert.equal(f.count('crm_subscriptions'), 1);
});

test('promised credits enter the next invoice once and exact customer totals survive retry', async () => {
  const f = fixture(), created = await f.create();
  await f.apply(await f.prepare({ operation: 'promise_credit', subscriptionId: created.id, expectedRevision: f.state(created.id).revision, amountCents: 2501, reason: 'Approved service recovery credit' }));
  const preview = await f.prepare({ operation: 'invoice', subscriptionId: created.id, expectedRevision: f.state(created.id).revision, periodStart: '2026-11-01', periodEnd: '2026-12-01', reason: 'Prepare next local invoice' });
  assert.equal(preview.invoice.totalCents, 9499); assert.equal(preview.customerDocument.totalCents, 9499);
  assert.equal(preview.invoice.lineItems.reduce((sum, row) => sum + row.totalCents, 0), 9499);
  assert.equal(preview.confirmationEmail.totalCents, 9499);
  assert.equal(f.state(created.id).credits[0].remainingCents, 2501, 'previewing an invoice must not consume the promised credit');
  const requestId = crypto.randomUUID(); await f.apply(preview, requestId); await f.apply(preview, requestId);
  const saved = f.state(created.id);
  assert.equal(saved.invoices.length, 1); assert.equal(saved.credits[0].remainingCents, 0);
  assert.equal(saved.credits[0].applications.length, 1); assert.equal(saved.billingPeriodStart, '2026-11-01');
  assert.equal(saved.billingPeriodEnd, '2026-12-01', 'drafting an invoice must not advance the customer current billing period');
});

test('an atomic storage failure leaves no subscription, receipt or consumed preview', async () => {
  const f = fixture(), preview = await f.prepare({ operation: 'create', customerId: 'customer-a', selection: selection(), startDate: day, reason: 'Approved test agreement' });
  f.db.failAfter = 3;
  await assert.rejects(f.apply(preview), /Injected local/);
  assert.equal(f.count('crm_subscriptions'), 0); assert.equal(f.count('crm_subscription_commands'), 0); assert.equal(f.count('crm_subscription_write_guards'), 0);
  assert.equal(f.sql.prepare('SELECT consumed_at FROM crm_subscription_previews WHERE token=?').get(preview.token).consumed_at, null);
  await f.apply(preview); assert.equal(f.count('crm_subscriptions'), 1);
});

test('a race after preview validation is rejected by the transactional revision guard', async () => {
  const f = fixture(), created = await f.create(), preview = await f.prepare({ operation: 'amend', subscriptionId: created.id, expectedRevision: f.state(created.id).revision,
    selection: { dogCount: 3 }, effectiveDate: day, reason: 'Dog count changed' });
  f.db.beforeBatch = () => {
    const newer = f.state(created.id); newer.revision += 1;
    f.sql.prepare('UPDATE crm_subscriptions SET revision=?,state_json=? WHERE id=?').run(newer.revision, JSON.stringify(newer), created.id);
  };
  const commands = f.count('crm_subscription_commands');
  await assert.rejects(f.apply(preview), /conflicted|newer work/i);
  assert.equal(f.state(created.id).versions.length, 1); assert.equal(f.count('crm_subscription_commands'), commands);
  assert.equal(f.count('crm_subscription_write_guards'), 0);
});

test('portal history is exact-account linked, includes past subscriptions and paginates beyond twenty', async () => {
  const f = fixture();
  f.sql.prepare('INSERT INTO dog_food_accounts VALUES(?,?)').run('account-a', '2026-11-01T00:00:00Z');
  f.sql.prepare('INSERT INTO dog_food_accounts VALUES(?,?)').run('account-b', '2026-11-01T00:00:00Z');
  await assert.rejects(store.linkCrmSubscriptionPortal(f.db, actor, { accountId: 'account-a', customerId: 'customer-a', reason: 'Unconfirmed link' }, { now }), /reviewed/);
  await store.linkCrmSubscriptionPortal(f.db, actor, { accountId: 'account-a', customerId: 'customer-a', verified: true, reason: 'Explicit verified test link' }, { now });
  const historicalContext = { actor, at: '2026-11-01T18:00:00Z', today: '2026-11-01' };
  for (let index = 0; index < 26; index++) {
    const customerId = index === 25 ? 'customer-b' : 'customer-a';
    let sub = model.createSubscription({ id: `sub-${String(index).padStart(3, '0')}`, customerId, selection: selection(), startDate: '2026-11-01' }, book(), historicalContext);
    if (index % 2 === 0) sub = model.cancelSubscription(sub, { expectedRevision: sub.revision, endDate: '2026-11-10', terminationReason: index === 0 ? 'other' : 'moved', ...(index === 0 ? { terminationNote: 'PRIVATE-TERMINATION-NOTE for office review' } : {}) }, { actor, at: '2026-11-10T18:00:00Z', today: '2026-11-10' });
    f.sql.prepare('INSERT INTO crm_subscriptions VALUES(?,?,?,?,?,?)').run(sub.id, 'org-opwp', customerId, sub.revision, JSON.stringify(sub), new Date(now).toISOString());
  }
  const all = []; let cursor = '';
  do {
    const page = await store.readCrmPortal(f.db, 'account-a', { cursor, limit: 7, date: day });
    all.push(...page.subscriptions); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(all.length, 25); assert.ok(all.some(sub => sub.status === 'cancelled')); assert.ok(all.some(sub => sub.status === 'active'));
  assert.ok(!all.some(sub => sub.id === 'sub-025'));
  assert.ok(!/manualReason|bookRateCents|currentBookRateCents|terminationNote|PRIVATE-TERMINATION-NOTE|"audit"|"actor"/.test(JSON.stringify(all)));
  assert.equal(all.find(sub => sub.id === 'sub-000').terminationReason, 'other', 'the public history retains the reason code, not the internal note');
  const unlinked = await store.readCrmPortal(f.db, 'account-b', { date: day }); assert.equal(unlinked.linked, false); assert.deepEqual(unlinked.subscriptions, []);
  await assert.rejects(store.linkCrmSubscriptionPortal(f.db, actor, { accountId: 'account-a', customerId: 'customer-b', verified: true, reason: 'Wrong identity must be reviewed' }, { now }), /already linked/);
});

test('Active default and Past/All views filter subscriptions without hiding pause history from the portal', async () => {
  const f = fixture(), first = await f.create(), second = await f.create();
  await f.apply(await f.prepare({ operation: 'cancel', subscriptionId: second.id, expectedRevision: f.state(second.id).revision, endDate: day, terminationReason: 'price' }));
  const active = await store.readCrmAdmin(f.db, { customerId: 'customer-a', date: day });
  const past = await store.readCrmAdmin(f.db, { customerId: 'customer-a', view: 'past', date: day });
  const all = await store.readCrmAdmin(f.db, { customerId: 'customer-a', view: 'all', date: day });
  assert.deepEqual(active.subscriptions.map(sub => sub.id), [first.id]); assert.deepEqual(past.subscriptions.map(sub => sub.id), [second.id]); assert.equal(all.subscriptions.length, 2);
  assert.equal(past.subscriptions[0].finalPriceCents, 12000); assert.equal(past.subscriptions[0].terminationReason, 'price');
  await assert.rejects(store.readCrmAdmin(f.db, { view: 'garbage', date: day }), /Active, Past or All/);
});

test('disabled scheduled processing reads no data; enabled resume processing is idempotent', async () => {
  assert.deepEqual(await store.processDueCrmSubscriptions({ DB: { prepare() { throw new Error('Must not read'); } } }, { now }), { status: 'disabled', updated: 0 });
  const f = fixture(), created = await f.create();
  await f.apply(await f.prepare({ operation: 'pause', subscriptionId: created.id, expectedRevision: f.state(created.id).revision, startDate: day, resumeDate: '2026-11-25', reason: 'Vacation pause' }));
  const future = Date.parse('2026-11-25T18:00:00Z');
  const processed = await store.processDueCrmSubscriptions({ DB: f.db, ROUTE_OS_SUBSCRIPTIONS_ENABLED: 'true' }, { now: future });
  const replay = await store.processDueCrmSubscriptions({ DB: f.db, ROUTE_OS_SUBSCRIPTIONS_ENABLED: 'true' }, { now: future });
  assert.equal(processed.updated, 1); assert.equal(replay.updated, 0);
  assert.equal(model.subscriptionView(f.state(created.id), { date: '2026-11-25', book: book() }).status, 'active');
});

test('the default book preserves every existing fixed monthly rate, availability and yard tier without inventing litter pricing', () => {
  const seeded = defaultCrmPriceBook(); model.validatePriceBook(seeded);
  const rates = seeded.plans[0].rates;
  let expectedCount = 0;
  for (const [frequency, grid] of Object.entries(PRICING.monthly)) {
    for (const [dogs, dollars] of Object.entries(grid)) {
      const rate = rates.find(row => row.frequency === frequency && row.dogCount === Number(dogs));
      if (dollars == null) { assert.equal(rate, undefined); continue; }
      expectedCount++;
      assert.ok(rate, `${frequency}/${dogs}`); assert.equal(rate.baseCents + rate.extraDogsCents, dollars * 100);
    }
  }
  assert.equal(rates.length, expectedCount);
  assert.deepEqual(seeded.zones[0].zips, PRICING.serviceZips);
  assert.deepEqual(seeded.yardTiers.map(tier => [tier.id, tier.upchargeCents]), YARD_TIERS.filter(tier => Number.isInteger(tier.upcharge)).map(tier => [tier.id, tier.upcharge * 100]));
  const existingMonthly = PRICING.addons.filter(addon => addon.charge === 'monthly' && addon.price3Plus == null);
  assert.deepEqual(seeded.addons.map(addon => [addon.id, addon.unitCents]), existingMonthly.map(addon => [addon.id, addon.price * 100]));
  assert.ok(!seeded.addons.some(addon => addon.id.includes('litter')));
  assert.ok(!seeded.addons.some(addon => PRICING.addons.find(existing => existing.id === addon.id)?.charge !== 'monthly'));
});

test('customer creation can safely replay the same identity after a lost response without an extra row or revision', async () => {
  const f = fixture(), input = { id: 'customer-command-c', name: 'Sample Customer C', reason: 'Reviewed local customer identity', expectedRevision: 0 };
  const first = await store.saveCrmSubscriptionCustomer(f.db, actor, input, { now });
  const replay = await store.saveCrmSubscriptionCustomer(f.db, actor, input, { now });
  assert.equal(first.id, replay.id); assert.equal(first.revision, 1); assert.equal(replay.revision, 1);
  assert.equal(f.count('crm_subscription_customers'), 3);
  await assert.rejects(store.saveCrmSubscriptionCustomer(f.db, actor, { ...input, name: 'Different identity' }, { now }), /changed|conflict|different/i);
  await assert.rejects(store.saveCrmSubscriptionCustomer(f.db, 'other-admin', input, { now }), /changed|conflict|different/i);
});

test('cancellation, finite pause/skip and promised-credit previews state billing impact without applying it', async () => {
  for (const [operation, input, expected] of [
    ['cancel', { endDate: day, terminationReason: 'moved' }, -4400],
    ['pause', { startDate: day, resumeDate: '2026-11-25' }, -2000],
    ['skip', { startDate: day, resumeDate: '2026-11-23' }, -1200],
    ['promise_credit', { amountCents: 2501 }, 0],
  ]) {
    const f = fixture(), created = await f.create(), before = JSON.stringify(f.state(created.id));
    const preview = await f.prepare({ operation, subscriptionId: created.id, expectedRevision: f.state(created.id).revision, reason: 'Reviewed lifecycle change', ...input });
    assert.equal(preview.proration.periodEnd, '2026-12-01'); assert.equal(preview.proration.adjustmentCents, expected, operation);
    assert.equal(preview.proration.previewOnly, true); assert.equal(JSON.stringify(f.state(created.id)), before);
    assert.match(preview.customerDocument.text, /Billing period ends: 2026-11-30/);
  }
});

test('first agreement application persists its initial book so later source defaults cannot silently alter authoritative pricing', async () => {
  const f = fixture(); f.sql.exec('DELETE FROM crm_subscription_books');
  const seeded = defaultCrmPriceBook(), picked = { planId: 'yard_cleanup', frequency: 'once_a_week', dogCount: 2, zip: '43601', yardTierId: 'tiny', addons: [], discounts: [], lineVisibility: {} };
  const expected = model.quoteSubscription(seeded, picked).totalCents;
  const preview = await f.prepare({ operation: 'create', customerId: 'customer-a', selection: picked, startDate: day, reason: 'First approved agreement using its saved source book' });
  assert.equal(f.count('crm_subscription_books'), 0, 'preview must not silently establish an authoritative book');
  await f.apply(preview);
  const saved = f.sql.prepare('SELECT version,body_json FROM crm_subscription_books WHERE organization_id=?').get('org-opwp');
  assert.ok(saved, 'first applied agreement must retain the exact source book'); assert.equal(saved.version, 1);
  assert.deepEqual(JSON.parse(saved.body_json), seeded);
  const before = JSON.stringify(f.state(preview.subscription.id));
  const changedSeed = structuredClone(seeded); changedSeed.sourceVersion = 'future-code-default'; changedSeed.plans[0].rates.forEach(rate => { rate.baseCents += 5000; });
  let fallbackCalls = 0;
  const source = fs.readFileSync(new URL('../lib/crm-subscription-store.mjs', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  const futureReader = vm.runInNewContext(`${source}\n({readCrmPriceBook})`, { model, defaultCrmPriceBook: () => { fallbackCalls++; return changedSeed; }, TextEncoder, crypto });
  const authoritative = await futureReader.readCrmPriceBook(f.db);
  assert.equal(fallbackCalls, 0); assert.equal(model.quoteSubscription(authoritative, picked).totalCents, expected);
  assert.equal(JSON.stringify(f.state(preview.subscription.id)), before);
});

test('an unpersisted default book changing under the same version invalidates an older preview instead of applying unseen rates', async () => {
  const f = fixture(); f.sql.exec('DELETE FROM crm_subscription_books');
  const picked = { planId: 'yard_cleanup', frequency: 'once_a_week', dogCount: 2, zip: '43601', yardTierId: 'tiny', addons: [], discounts: [], lineVisibility: {} };
  const preview = await f.prepare({ operation: 'create', customerId: 'customer-a', selection: picked, startDate: day, reason: 'Review the initial source rate' });
  const changedSeed = defaultCrmPriceBook(); changedSeed.plans[0].rates.forEach(rate => { rate.baseCents += 5000; });
  const source = fs.readFileSync(new URL('../lib/crm-subscription-store.mjs', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  const futureStore = vm.runInNewContext(`${source}\n({applyCrmSubscriptionPreview})`, { model, defaultCrmPriceBook: () => changedSeed, renderSubscriptionDocument, operatingDate, TextEncoder, crypto });
  await assert.rejects(futureStore.applyCrmSubscriptionPreview(f.db, actor, preview.token, crypto.randomUUID(), { now }), /book.*changed|preview.*again|reviewed/i);
  assert.equal(f.count('crm_subscriptions'), 0); assert.equal(f.count('crm_subscription_commands'), 0);
  assert.equal(f.count('crm_subscription_books'), 0);
});

test('a competing initial book with the same version is rejected inside the atomic apply', async () => {
  const f = fixture(); f.sql.exec('DELETE FROM crm_subscription_books');
  const picked = { planId: 'yard_cleanup', frequency: 'once_a_week', dogCount: 2, zip: '43601', yardTierId: 'tiny', addons: [], discounts: [], lineVisibility: {} };
  const preview = await f.prepare({ operation: 'create', customerId: 'customer-a', selection: picked, startDate: day, reason: 'Reviewed initial source rate' });
  f.db.beforeBatch = () => {
    const competing = defaultCrmPriceBook(); competing.plans[0].rates.forEach(rate => { rate.baseCents += 5000; });
    f.sql.prepare('INSERT INTO crm_subscription_books VALUES(?,?,?,?,?,?)').run('org-opwp', 1, JSON.stringify(competing), actor, 'Competing reviewed initial book', new Date(now).toISOString());
  };
  await assert.rejects(f.apply(preview), /conflicted|changed|newer/i);
  assert.equal(f.count('crm_subscriptions'), 0); assert.equal(f.count('crm_subscription_commands'), 0);
  assert.equal(f.count('crm_subscription_write_guards'), 0);
});
