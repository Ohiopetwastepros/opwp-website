import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SubscriptionError, validatePriceBook, quoteSubscription, createSubscription, amendSubscription, cancelSubscription, endSubscription,
  pauseSubscription, skipSubscription, resumeSubscription, promiseSubscriptionCredit, filterSubscriptions, customerPricing, subscriptionView,
  customerSubscriptionHistory, previewProration, previewSubscriptionChangeProration, issueSubscriptionInvoice, advanceSubscription, acknowledgeSubscriptionNotice,
  previewBulkReprice, applyBulkReprice, subscriptionReport,
} from '../lib/crm-subscriptions.mjs';

const ctx = (today = '2026-03-01', actor = 'office@example.test') => ({ actor, today, at: `${today}T17:00:00Z` });
function book(overrides = {}) {
  return { id: 'book', version: 1, effectiveDate: '2026-01-01', currency: 'USD',
    zones: [{ id: 'standard', label: 'Standard', zips: ['43601'] }, { id: 'outer', label: 'Outer zone', zips: ['43551'] }],
    plans: [{ id: 'yard', label: 'Weekly yard plan', rates: [
      { frequency: 'weekly', dogCount: 1, zoneId: 'standard', baseCents: 9500, extraDogsCents: 0 },
      { frequency: 'weekly', dogCount: 2, zoneId: 'standard', baseCents: 9500, extraDogsCents: 1000 },
      { frequency: 'biweekly', dogCount: 2, zoneId: 'standard', baseCents: 7200, extraDogsCents: 800 },
      { frequency: 'weekly', dogCount: 2, zoneId: 'outer', baseCents: 10500, extraDogsCents: 1000 },
    ] }], yardTiers: [{ id: 'standard', label: 'Standard yard', upchargeCents: 0 }, { id: 'large', label: 'Large yard', upchargeCents: 1500 }],
    addons: [{ id: 'deodorize', label: 'Deodorization', unitCents: 2500 }, { id: 'litter', label: 'Litter box service', unitCents: 1000 }], ...overrides };
}
const selection = (extra = {}) => ({ planId: 'yard', frequency: 'weekly', dogCount: 2, zip: '43601', yardTierId: 'standard', addons: [], discounts: [], lineVisibility: {}, ...extra });
function subscription(overrides = {}) { return createSubscription({ id: 'sub', customerId: 'customer', startDate: '2026-03-01', billingPeriodStart: '2026-03-01', billingPeriodEnd: '2026-04-01', selection: selection(), ...overrides }, book(), ctx()); }
const change = (sub, extra = {}) => ({ expectedRevision: sub.revision, reason: 'Office reviewed change', ...extra });

test('preset lookup uses plan, frequency, dogs and ZIP zone with fixed monthly totals', () => {
  const quoted = quoteSubscription(book(), selection({ yardTierId: 'large' }));
  assert.equal(quoted.totalCents, 12000); assert.equal(quoted.billingInterval, 'monthly');
  assert.deepEqual(quoted.lineItems.map(line => [line.kind, line.totalCents]), [['base_plan', 9500], ['extra_dogs', 1000], ['yard_size', 1500]]);
  assert.equal(quoteSubscription(book(), selection({ zip: '43551' })).totalCents, 11500);
  assert.throws(() => quoteSubscription(book(), selection({ zip: '99999' })), SubscriptionError);
  assert.throws(() => quoteSubscription(book(), selection({ dogCount: 9 })), /approved quote/);
});

test('price, frequency and dog-count amendments retain one subscription and its audit/version history', () => {
  const first = subscription(), modified = amendSubscription(first, change(first, { effectiveDate: '2026-03-16', selection: { frequency: 'biweekly' } }), book(), ctx('2026-03-16'));
  assert.equal(first.versions.length, 1); assert.equal(modified.id, first.id); assert.equal(modified.customerId, first.customerId);
  assert.equal(modified.endDate, null); assert.equal(modified.terminationReason, null); assert.equal(modified.versions.length, 2);
  assert.equal(subscriptionView(modified, { date: '2026-03-15', book: book() }).totalCents, 10500);
  assert.equal(subscriptionView(modified, { date: '2026-03-16', book: book() }).totalCents, 8000);
  assert.equal(modified.audit.at(-1).action, 'amended'); assert.equal(modified.audit.at(-1).actor, ctx().actor);
  assert.equal(modified.audit.at(-1).oldValue.totalCents, 10500); assert.equal(modified.audit.at(-1).newValue.totalCents, 8000);
  assert.throws(() => amendSubscription(modified, change(first), book(), ctx('2026-03-16')), /Refresh/);
});

test('manual rate requires a reason and retains both actual manual and original book rates', () => {
  assert.throws(() => subscription({ rateSource: 'manual', manualRateCents: 9000 }), /manual-rate reason/);
  const manual = subscription({ rateSource: 'manual', manualRateCents: 9000, manualReason: 'Loyal customer approval' });
  const view = subscriptionView(manual, { date: '2026-03-01', book: book() });
  assert.equal(view.bookRateCents, 10500); assert.equal(view.manualRateCents, 9000); assert.equal(view.totalCents, 9000); assert.equal(view.belowBook, true);
  assert.equal(view.currentLines.at(-1).totalCents, -1500);
  const preset = amendSubscription(manual, change(manual, { rateSource: 'preset' }), book(), ctx());
  assert.equal(preset.versions.at(-1).manualRateCents, null); assert.equal(preset.versions.at(-1).totalCents, 10500);
});

test('editing a book never mutates or automatically reprices an existing subscription', () => {
  const sub = subscription(), original = JSON.stringify(sub), nextBook = book({ version: 2 }); nextBook.plans[0].rates[1].extraDogsCents = 2500;
  assert.equal(subscriptionView(sub, { date: '2026-03-01', book: nextBook }).currentBookRateCents, 12000);
  assert.equal(subscriptionView(sub, { date: '2026-03-01', book: nextBook }).totalCents, 10500);
  assert.equal(JSON.stringify(sub), original);
  const invoice = issueSubscriptionInvoice(sub, change(sub, { id: 'invoice' }), ctx());
  assert.equal(invoice.invoice.totalCents, 10500);
});

test('itemized and folded customer pricing exactly reconcile across quotes and invoice credits', () => {
  const quote = quoteSubscription(book(), selection({ yardTierId: 'large', addons: [{ id: 'litter', quantity: 2 }], lineVisibility: { yard: false, 'addon:litter': true, extra_dogs: false } }));
  const customer = customerPricing(quote);
  assert.equal(quote.totalCents, 14000); assert.equal(customer.lineItems.find(line => line.kind === 'base_plan').totalCents, 12000);
  assert.equal(customer.lineItems.reduce((n, line) => n + line.totalCents, 0), quote.totalCents);
  const withCredit = { ...quote, lineItems: [...quote.lineItems, { id: 'credit', label: 'Service credit', kind: 'credit', quantity: 1, unitCents: -137, totalCents: -137, itemized: false }], totalCents: quote.totalCents - 137 };
  assert.equal(customerPricing(withCredit).lineItems.reduce((n, line) => n + line.totalCents, 0), withCredit.totalCents);
  assert.throws(() => customerPricing({ ...quote, totalCents: quote.totalCents + 1 }), /exactly/);
});

test('explicit discounts require reasons, remain itemized and cannot make totals negative', () => {
  const discounted = quoteSubscription(book(), selection({ discounts: [{ id: 'loyalty', label: 'Loyalty discount', amountCents: 1000, reason: 'Approved retention offer' }] }));
  assert.equal(discounted.bookRateCents, 10500); assert.equal(discounted.totalCents, 9500);
  assert.equal(discounted.lineItems.at(-1).kind, 'discount');
  assert.throws(() => quoteSubscription(book(), selection({ discounts: [{ id: 'x', label: 'Discount', amountCents: 500 }] })), /discount reason/);
  assert.throws(() => quoteSubscription(book(), selection({ discounts: [{ id: 'x', label: 'Discount', amountCents: 20000, reason: 'Too large' }] })), /negative/);
});

test('Active is default and Past/All distinguish real endings while customer history always includes both', () => {
  const active = subscription(), cancelled = cancelSubscription(subscription({ id: 'cancelled' }), change(active, { terminationReason: 'moved' }), ctx()), ended = endSubscription(subscription({ id: 'ended' }), change(active), ctx());
  const rows = [active, cancelled, ended];
  assert.deepEqual(filterSubscriptions(rows, undefined, '2026-03-01').map(row => row.id), ['sub']);
  assert.deepEqual(filterSubscriptions(rows, 'past', '2026-03-01').map(row => row.id), ['cancelled', 'ended']);
  assert.equal(filterSubscriptions(rows, 'all', '2026-03-01').length, 3);
  assert.equal(customerSubscriptionHistory([...rows, subscription({ id: 'foreign', customerId: 'other' })], 'customer', { date: '2026-03-01', book: book() }).length, 3);
  const past = subscriptionView(cancelled, { date: '2026-03-01', book: book() });
  assert.equal(past.startDate, '2026-03-01'); assert.equal(past.endDate, '2026-03-01'); assert.equal(past.finalPriceCents, 10500); assert.equal(past.terminationReason, 'moved');
});

test('termination reasons are only required for actual cancellation and other requires a note', () => {
  const sub = subscription();
  assert.throws(() => cancelSubscription(sub, change(sub), ctx()), /termination reason/);
  assert.throws(() => cancelSubscription(sub, change(sub, { terminationReason: 'other' }), ctx()), /other termination reason/);
  assert.equal(cancelSubscription(sub, change(sub, { terminationReason: 'other', terminationNote: 'No longer owns pets' }), ctx()).endKind, 'cancelled');
  assert.equal(pauseSubscription(sub, change(sub, { resumeDate: '2026-03-08' }), ctx()).terminationReason, null);
  assert.equal(amendSubscription(sub, change(sub), book(), ctx()).terminationReason, null);
});

test('pause and skip resume by date without cancelling or creating a new subscription', () => {
  const sub = subscription(), paused = pauseSubscription(sub, change(sub, { resumeDate: '2026-03-08' }), ctx());
  assert.equal(subscriptionView(paused, { date: '2026-03-07' }).status, 'paused');
  assert.equal(subscriptionView(paused, { date: '2026-03-08' }).status, 'active');
  const resumed = advanceSubscription(paused, ctx('2026-03-08'));
  assert.equal(resumed.id, sub.id); assert.ok(resumed.pauses[0].resumedAt); assert.equal(resumed.endDate, null);
  assert.equal(advanceSubscription(resumed, ctx('2026-03-09')).revision, resumed.revision);
  const skipped = skipSubscription(resumed, change(resumed, { resumeDate: '2026-03-11' }), ctx('2026-03-08'));
  assert.equal(subscriptionView(skipped, { date: '2026-03-10' }).status, 'skipped'); assert.equal(subscriptionView(skipped, { date: '2026-03-11' }).status, 'active');
  assert.equal(filterSubscriptions([paused], 'active', '2026-03-04').length, 1);
  assert.throws(() => pauseSubscription(paused, change(paused, { resumeDate: '2026-03-04' }), ctx()), /overlap/);
});

test('future amendments keep current price until effective date and raise notice reminders without sending', () => {
  const sub = subscription(), scheduled = amendSubscription(sub, change(sub, { effectiveDate: '2027-01-01', noticeReminderDate: '2026-12-01', rateSource: 'manual', manualRateCents: 12000, manualReason: 'Reviewed next-year rate' }), book(), ctx());
  assert.equal(subscriptionView(scheduled, { date: '2026-12-31' }).totalCents, 10500);
  assert.equal(subscriptionView(scheduled, { date: '2027-01-01' }).totalCents, 12000);
  const due = advanceSubscription(scheduled, ctx('2026-12-01')); assert.equal(due.versions.at(-1).noticeStatus, 'pending');
  assert.ok(due.versions.at(-1).noticeReminderRaisedAt); assert.equal(due.versions.at(-1).activatedAt, null);
  const confirmed = acknowledgeSubscriptionNotice(due, change(due, { versionId: due.versions.at(-1).id, customerNotified: true, reason: 'Office retained confirmation evidence' }), ctx('2026-12-02'));
  assert.equal(confirmed.versions.at(-1).noticeStatus, 'acknowledged');
  const effective = advanceSubscription(confirmed, ctx('2027-01-01')); assert.ok(effective.versions.at(-1).activatedAt);
  assert.equal(subscriptionReport([due], book(), '2027-01-02').noticeReminders[0].versionId, due.versions.at(-1).id, 'overdue reminder remains visible after price takes effect');
  assert.equal(subscriptionReport([confirmed], book(), '2027-01-02').noticeReminders.length, 0);
});

test('office can resume a pause early without replacing or cancelling the agreement', () => {
  const sub = subscription(), paused = pauseSubscription(sub, change(sub, { resumeDate: '2026-03-20' }), ctx());
  const resumed = resumeSubscription(paused, change(paused, { reason: 'Customer requested service again' }), ctx('2026-03-08'));
  assert.equal(resumed.id, sub.id); assert.equal(resumed.endDate, null);
  assert.equal(resumed.pauses[0].resumeDate, '2026-03-08'); assert.equal(subscriptionView(resumed, { date: '2026-03-08' }).status, 'active');
  assert.equal(resumed.audit.at(-1).oldValue.resumeDate, '2026-03-20'); assert.equal(resumed.audit.at(-1).reason, 'Customer requested service again');
});

test('effective-date timeline sorts scheduled changes and includes removed add-on price history', () => {
  let sub = subscription({ selection: selection({ addons: [{ id: 'deodorize', quantity: 1 }] }) });
  sub = amendSubscription(sub, change(sub, { effectiveDate: '2027-01-01', selection: { addons: [{ id: 'deodorize', quantity: 2 }] } }), book(), ctx());
  sub = amendSubscription(sub, change(sub, { effectiveDate: '2026-12-15', selection: { addons: [] } }), book(), ctx());
  const versions = subscriptionView(sub, { date: '2026-03-01' }).versions;
  assert.deepEqual(versions.map(row => row.effectiveDate), ['2026-03-01', '2026-12-15', '2027-01-01']);
  assert.equal(versions[0].endDate, '2026-12-15');
  assert.deepEqual(versions[1].changes.find(row => row.lineId === 'addon:deodorize'), { lineId: 'addon:deodorize', label: 'Deodorization', oldCents: 2500, newCents: 0 });
});

test('promised credits apply once to next draft, cap at zero and carry forward remainder', () => {
  let sub = subscription(); sub = promiseSubscriptionCredit(sub, change(sub, { amountCents: 15000, reason: 'Verified service commitment' }), ctx());
  const first = issueSubscriptionInvoice(sub, change(sub, { id: 'first' }), ctx());
  assert.equal(first.invoice.status, 'draft'); assert.equal(first.invoice.totalCents, 0); assert.equal(first.subscription.credits[0].remainingCents, 4500);
  assert.equal(first.invoice.lineItems.reduce((n, row) => n + row.totalCents, 0), first.invoice.totalCents);
  const second = issueSubscriptionInvoice(first.subscription, change(first.subscription, { id: 'second' }), ctx('2026-04-01'));
  assert.equal(second.invoice.totalCents, 6000); assert.equal(second.subscription.credits[0].remainingCents, 0);
  assert.equal(second.subscription.credits[0].applications.length, 2);
  assert.throws(() => issueSubscriptionInvoice(second.subscription, change(second.subscription, { id: 'first' }), ctx('2026-04-01')), /already exists/);
});

test('invoice periods cannot overlap or silently ignore a mid-period price change or pause', () => {
  const sub = subscription(), invoice = issueSubscriptionInvoice(sub, change(sub, { id: 'one' }), ctx());
  assert.throws(() => issueSubscriptionInvoice(invoice.subscription, change(invoice.subscription, { id: 'two', periodStart: '2026-03-16', periodEnd: '2026-04-15' }), ctx()), /covers/);
  const modified = amendSubscription(sub, change(sub, { effectiveDate: '2026-03-16', rateSource: 'manual', manualRateCents: 11000, manualReason: 'Reviewed rate' }), book(), ctx());
  assert.throws(() => issueSubscriptionInvoice(modified, change(modified, { id: 'changed' }), ctx()), /proration/);
  const paused = pauseSubscription(sub, change(sub, { startDate: '2026-03-16', resumeDate: '2026-04-01' }), ctx());
  assert.throws(() => issueSubscriptionInvoice(paused, change(paused, { id: 'paused' }), ctx()), /proration/);
});

test('drafting invoices does not prematurely move the current billing boundary or break change previews', () => {
  const sub = subscription(), currentDraft = issueSubscriptionInvoice(sub, change(sub, { id: 'march' }), ctx()).subscription;
  assert.equal(currentDraft.billingPeriodStart, '2026-03-01'); assert.equal(currentDraft.billingPeriodEnd, '2026-04-01');
  assert.equal(previewProration(currentDraft, { totalCents: 0 }, '2026-03-16').remainingDays, 16);
  const futureDraft = issueSubscriptionInvoice(currentDraft, change(currentDraft, { id: 'april' }), ctx()).subscription;
  assert.equal(futureDraft.invoices[1].periodStart, '2026-04-01'); assert.equal(futureDraft.billingPeriodEnd, '2026-04-01');
  assert.equal(subscriptionView(futureDraft, { date: '2026-04-10' }).billingPeriodEnd, '2026-05-01');
  const advanced = advanceSubscription(futureDraft, ctx('2026-04-01'));
  assert.equal(advanced.billingPeriodStart, '2026-04-01'); assert.equal(advanced.billingPeriodEnd, '2026-05-01');
});

test('proration uses exact calendar-day rational rounding and is only a preview', () => {
  const sub = subscription(), original = JSON.stringify(sub);
  const preview = previewProration(sub, { totalCents: 11001 }, '2026-03-16');
  assert.equal(preview.totalDays, 31); assert.equal(preview.remainingDays, 16); assert.equal(preview.adjustmentCents, 259); assert.equal(preview.previewOnly, true);
  assert.equal(previewProration(sub, { totalCents: 9999 }, '2026-03-16').adjustmentCents, -259);
  assert.equal(previewProration(sub, { totalCents: 20000 }, '2027-01-01').adjustmentCents, 0);
  assert.equal(JSON.stringify(sub), original);
  const paused = previewProration(sub, { totalCents: 0 }, '2026-03-16', { resumeDate: '2026-03-21' });
  assert.equal(paused.remainingDays, 16); assert.equal(paused.affectedDays, 5); assert.equal(paused.adjustmentCents, -1694);
  const november = { ...sub, billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-12-01', versions: [{ ...sub.versions[0], totalCents: 12000 }] };
  assert.equal(previewProration(november, { totalCents: 0 }, '2026-11-20', { resumeDate: '2026-11-25' }).adjustmentCents, -2000);
});

test('bulk repricing requires an unchanged preview and explicitly amends selected records', () => {
  const first = subscription(), second = subscription({ id: 'second' }), higher = book({ version: 2 }); higher.plans[0].rates[1].extraDogsCents = 2000;
  const rows = [first, second], preview = previewBulkReprice(rows, higher, { effectiveDate: '2026-04-01', subscriptionIds: ['sub'], reason: 'Reviewed spring rate reset' });
  assert.equal(preview.rows[0].oldTotalCents, 10500); assert.equal(preview.rows[0].newTotalCents, 11500); assert.equal(first.versions.length, 1);
  const applied = applyBulkReprice(rows, preview, higher, ctx());
  assert.equal(applied.length, 2); assert.equal(applied[0].id, first.id); assert.equal(applied[0].versions.length, 2); assert.equal(applied[1].versions.length, 1);
  assert.equal(applied[0].audit.at(-1).reason, 'Reviewed spring rate reset');
  assert.throws(() => applyBulkReprice(applied, preview, higher, ctx()), /Refresh/);
  const forged = structuredClone(preview); forged.rows[0].newTotalCents = 1;
  assert.throws(() => applyBulkReprice(rows, forged, higher, ctx()), /Refresh/);
  assert.throws(() => applyBulkReprice(rows, preview, { ...higher, version: 3 }, ctx()), /book changed/);
});

test('lifecycle proration compares bounded pause, early resume, cancellation and scheduled price segments', () => {
  const monthly = book(); monthly.plans[0].rates[1].extraDogsCents = 2500;
  const active = createSubscription({ id: 'november', customerId: 'customer', selection: selection(), startDate: '2026-11-01', billingPeriodStart: '2026-11-01', billingPeriodEnd: '2026-12-01' }, monthly, ctx('2026-11-01'));
  const paused = pauseSubscription(active, change(active, { startDate: '2026-11-20', resumeDate: '2026-11-25' }), ctx('2026-11-20'));
  const pausePreview = previewSubscriptionChangeProration(active, paused, '2026-11-20', { date: '2026-11-20' });
  assert.equal(pausePreview.adjustmentCents, -2000); assert.equal(pausePreview.affectedDays, 5); assert.equal(pausePreview.remainingDays, 11);
  const resumed = resumeSubscription(paused, change(paused), ctx('2026-11-22'));
  const resumePreview = previewSubscriptionChangeProration(paused, resumed, '2026-11-22', { date: '2026-11-22' });
  assert.equal(resumePreview.adjustmentCents, 1200); assert.equal(resumePreview.affectedDays, 3);
  const scheduled = amendSubscription(active, change(active, { effectiveDate: '2026-11-25', rateSource: 'manual', manualRateCents: 15000, manualReason: 'Approved future rate' }), monthly, ctx('2026-11-20'));
  const cancelled = cancelSubscription(scheduled, change(scheduled, { endDate: '2026-11-20', terminationReason: 'moved' }), ctx('2026-11-20'));
  assert.equal(previewSubscriptionChangeProration(scheduled, cancelled, '2026-11-20', { date: '2026-11-20' }).adjustmentCents, -5000);
  const credited = promiseSubscriptionCredit(active, change(active, { amountCents: 1000, reason: 'Next invoice credit' }), ctx('2026-11-20'));
  assert.equal(previewSubscriptionChangeProration(active, credited, '2026-11-20', { date: '2026-11-20' }).adjustmentCents, 0);
  const january = amendSubscription(active, change(active, { effectiveDate: '2027-01-01', rateSource: 'manual', manualRateCents: 16000, manualReason: 'Next-year rate' }), monthly, ctx('2026-11-20'));
  assert.equal(previewSubscriptionChangeProration(active, january, '2027-01-01', { date: '2026-11-20' }).adjustmentCents, 0);
});

test('admin MRR allocates discounts across plan/add-ons exactly and excludes paused, past and invoice-only credits', () => {
  const regular = subscription({ selection: selection({ addons: [{ id: 'deodorize', quantity: 1 }] }), rateSource: 'manual', manualRateCents: 11700, manualReason: 'Approved retention rate' });
  const paused = pauseSubscription(subscription({ id: 'paused' }), change(regular, { resumeDate: '2026-03-08' }), ctx());
  const cancelled = cancelSubscription(subscription({ id: 'cancelled' }), change(regular, { terminationReason: 'price' }), ctx());
  const credited = promiseSubscriptionCredit(regular, change(regular, { amountCents: 1000, reason: 'Promised invoice-only credit' }), ctx());
  const report = subscriptionReport([credited, paused, cancelled], book(), '2026-03-01');
  assert.equal(report.activeMrrCents, 11700); assert.equal(report.manualOverrides.length, 1); assert.equal(report.belowBook.length, 1);
  assert.equal(report.byPlan.reduce((n, row) => n + row.mrrCents, 0) + report.byAddon.reduce((n, row) => n + row.mrrCents, 0), report.activeMrrCents);
  assert.ok(report.byPlan.every(row => row.mrrCents >= 0)); assert.equal(report.cancellationsByReason.find(row => row.reason === 'price').count, 1);
});

test('customer full history excludes office-only reasons, actors and book/manual override data', () => {
  let sub = subscription({ rateSource: 'manual', manualRateCents: 10000, manualReason: 'PRIVATE ADMIN REASON', selection: selection({ discounts: [{ id: 'private', label: 'Service discount', amountCents: 10, reason: 'PRIVATE DISCOUNT REASON' }] }) });
  sub = cancelSubscription(sub, change(sub, { terminationReason: 'other', terminationNote: 'PRIVATE OFFICE TERMINATION NOTE' }), ctx());
  const history = customerSubscriptionHistory([sub], 'customer', { date: '2026-03-01', book: book() }), encoded = JSON.stringify(history);
  for (const secret of ['PRIVATE ADMIN REASON', 'PRIVATE DISCOUNT REASON', 'PRIVATE OFFICE TERMINATION NOTE', 'office@example.test', 'bookRateCents', 'manualRateCents', 'audit', 'rateSource']) assert.ok(!encoded.includes(secret), secret);
  assert.equal(history[0].totalCents, 10000); assert.equal(history[0].versions[0].frequency, 'weekly');
});

test('book validation rejects floating cents, ambiguous zones, invalid dates and one-time recurring add-ons', () => {
  for (const effectiveDate of ['2026-99-99', '2026-02-30', '2026-2-01']) assert.throws(() => validatePriceBook(book({ effectiveDate })), SubscriptionError);
  const floating = book(); floating.plans[0].rates[0].baseCents = 9500.1; assert.throws(() => validatePriceBook(floating), /whole-cent/);
  const ambiguous = book(); ambiguous.zones[1].zips.push('43601'); assert.throws(() => validatePriceBook(ambiguous), /exactly one/);
  const once = book(); once.addons[0].billingCadence = 'one_time'; assert.throws(() => validatePriceBook(once), /explicit monthly/);
  const treatment = book(); treatment.addons[0].billingCadence = 'per_treatment';
  assert.throws(() => quoteSubscription(treatment, selection({ addons: [{ id: 'deodorize' }] })), /explicit quantity/);
  assert.equal(quoteSubscription(treatment, selection({ addons: [{ id: 'deodorize', quantity: 2 }] })).totalCents, 15500);
});

test('a cancelled subscription does not activate future changes or automatically resume after its end', () => {
  let sub = subscription(); sub = pauseSubscription(sub, change(sub, { resumeDate: '2026-03-20' }), ctx());
  sub = amendSubscription(sub, change(sub, { effectiveDate: '2026-04-01' }), book(), ctx());
  sub = cancelSubscription(sub, change(sub, { endDate: '2026-03-10', terminationReason: 'moved' }), ctx());
  const advanced = advanceSubscription(sub, ctx('2026-04-02'));
  assert.equal(subscriptionView(advanced, { date: '2026-04-02' }).status, 'cancelled');
  assert.equal(advanced.pauses[0].resumedAt, null); assert.equal(advanced.versions[1].activatedAt, null);
  assert.equal(subscriptionView(advanced, { date: '2026-03-01' }).scheduledChanges.length, 0);
});

test('ended subscription history uses the final service price rather than a later scheduled version', () => {
  for (const endDate of ['2026-03-20', '2026-04-01']) {
    let sub = subscription();
    sub = amendSubscription(sub, change(sub, { effectiveDate: '2026-04-01', rateSource: 'manual', manualRateCents: 12000, manualReason: 'Scheduled next cycle' }), book(), ctx());
    sub = endSubscription(sub, change(sub, { endDate }), ctx());
    const past = subscriptionView(sub, { date: '2026-05-01', book: book() });
    assert.equal(past.status, 'ended'); assert.equal(past.totalCents, 10500); assert.equal(past.finalPriceCents, 10500);
    assert.equal(past.versions[0].endDate, endDate); assert.equal(past.scheduledChanges.length, 0);
  }
});
