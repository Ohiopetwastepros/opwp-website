import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscription, amendSubscription, pauseSubscription, promiseSubscriptionCredit } from '../lib/crm-subscriptions.mjs';
import {
  defaultBillingSettings, billingSchedule, billingLocalInstant, billingInvoiceKey, billingSubscriptionFingerprintSource, buildMonthlyInvoice, buildNewClientInvoice,
  editBillingInvoice, holdBillingInvoice, voidBillingInvoice, approveBillingInvoice, scheduleBillingChargeNow, startBillingCharge, recordBillingResult,
  retryBillingInvoice, settleZeroBillingInvoice, billingRefundableCents, recordBillingRefund, recordBillingCredit, recordBillingAchReturn,
  writeOffBillingInvoice, achReturnAction, billingInvoiceMatchesFilter, billingBatchSummary,
} from '../lib/crm-billing.mjs';

const ctx = (at = '2027-03-01T15:00:00Z', actor = 'owner@example.test') => ({ actor, at });
const book = () => ({ id: 'fixture', version: 1, effectiveDate: '2026-01-01', currency: 'USD', zones: [{ id: 'zone', label: 'Fixture zone', zips: ['43601'] }],
  plans: [{ id: 'yard', label: 'Weekly yard service', rates: [{ frequency: 'once_a_week', dogCount: 2, zoneId: 'zone', baseCents: 9500, extraDogsCents: 1000 }] }],
  yardTiers: [{ id: 'large', label: 'Large yard', upchargeCents: 1500 }], addons: [{ id: 'deodorize', label: 'Deodorization', unitCents: 2500 }] });
const selection = extra => ({ planId: 'yard', frequency: 'once_a_week', dogCount: 2, zip: '43601', yardTierId: 'large', addons: [], ...extra });
function sub(extra = {}) { return createSubscription({ id: 'sub-a', customerId: 'customer', startDate: '2027-01-01', selection: selection(), ...extra }, book(), ctx('2027-01-01T15:00:00Z')); }
function invoice(extra = {}, subscriptions = [sub()]) { return buildMonthlyInvoice(subscriptions, { id: 'invoice-a', customerId: 'customer', periodStart: '2027-03-01', paymentMethodId: 'method-a', methodType: 'card', ...extra }, ctx()); }
const input = (value, extra = {}) => ({ expectedRevision: value.revision, reason: 'Owner reviewed fixture action', ...extra });
function approved(value = invoice(), extra = {}) { return approveBillingInvoice(value, input(value, { chargeNow: true, ...extra }), ctx()); }
function charging(value = approved()) { return startBillingCharge(value, input(value), ctx()); }
function paid(value = charging(), extra = {}) { return recordBillingResult(value, input(value, { attempt: value.attempts.at(-1).attempt, result: { status: 'paid', amountCents: value.totalCents, transactionId: 'transaction-a', processorCode: '000', ...extra } }), ctx()); }
const total = value => value.lineItems.reduce((sum, row) => sum + row.totalCents, 0);

test('monthly draft generation uses evening before first and charge first in America/New_York across DST', () => {
  assert.equal(billingSchedule('2027-03-31T21:59:00Z').draftDue, false);
  const due = billingSchedule('2027-03-31T22:00:00Z');
  assert.equal(due.periodStart, '2027-04-01'); assert.equal(due.periodEnd, '2027-05-01'); assert.equal(due.draftDue, true);
  assert.equal(due.chargeAt, '2027-04-01T13:00:00.000Z');
  assert.equal(billingSchedule('2027-04-01T00:00:00Z').periodStart, '2027-04-01', 'UTC midnight remains March31 in NY');
  assert.equal(billingSchedule('2027-04-01T12:59:00Z').chargeDue, false);
  assert.equal(billingSchedule('2027-04-01T13:00:00Z').chargeDue, true);
  assert.equal(billingSchedule('2027-02-28T23:00:00Z').chargeAt, '2027-03-01T14:00:00.000Z');
  assert.equal(billingSchedule('2027-03-29T22:00:00Z', { draftDaysBefore: 3 }).draftDue, true);
  assert.equal(billingSchedule('2027-04-01T11:00:00Z').draftDue, true, 'first-day catch-up still creates drafts, never implicit approval');
  assert.equal(billingLocalInstant('2027-11-01', 9), '2027-11-01T13:00:00.000Z');
});

test('scheduler configuration remains bounded and customer notices cannot be enabled in this phase', () => {
  assert.equal(defaultBillingSettings().autoRetryCards, false); assert.equal(defaultBillingSettings().customerNoticesEnabled, false);
  for (const settings of [{ timeZone: 'UTC' }, { draftHour: 24 }, { cardRetryDays: [3, 1] }, { taxBasisPoints: 1.1 }, { customerNoticesEnabled: true }, { autoRetryCards: 'false' }, { includeNextFullMonth: 1 }]) assert.throws(() => defaultBillingSettings(settings));
});

test('monthly generation consolidates eligible agreements into one exact itemized customer draft', () => {
  const first = sub(), second = sub({ id: 'sub-b', selection: selection({ addons: [{ id: 'deodorize', quantity: 1 }] }) });
  const built = invoice({ firstInvoice: true, book: book() }, [first, second]);
  assert.equal(built.status, 'draft'); assert.equal(built.totalCents, 26500); assert.equal(total(built), built.totalCents);
  assert.deepEqual(built.subscriptionIds, ['sub-a', 'sub-b']); assert.equal(built.coverage.length, 2);
  assert.equal(built.attempts.length, 0); assert.equal(built.approvedAt, null); assert.equal(built.firstInvoice, true);
  assert.equal(new Set(built.lineItems.map(row => row.id)).size, built.lineItems.length);
});

test('paused, skipped, future and already covered agreements are excluded without cancellation', () => {
  const active = sub(), paused = pauseSubscription(sub({ id: 'sub-b' }), { expectedRevision: 1, startDate: '2027-03-01', resumeDate: '2027-04-01', reason: 'Seasonal hold' }, ctx('2027-02-28T15:00:00Z'));
  const built = invoice({}, [active, paused]); assert.deepEqual(built.subscriptionIds, ['sub-a']); assert.equal(built.totalCents, 12000);
  assert.throws(() => invoice({}, [paused]), /no active/);
  assert.throws(() => invoice({ existingCoverage: [{ subscriptionId: active.id, startDate: '2027-03-01', endDate: '2027-04-01' }] }), /no active/);
  assert.throws(() => invoice({}, [sub({ customerId: 'other' })]), /another customer/);
});

test('monthly generation never silently prices through a mid-period change', () => {
  const original = sub(), changed = amendSubscription(original, { expectedRevision: original.revision, effectiveDate: '2027-03-16', selection: { addons: [{ id: 'deodorize', quantity: 1 }] }, reason: 'New treatment' }, book(), ctx());
  assert.throws(() => invoice({}, [changed]), /Review proration/);
});

test('book/manual comparisons use frozen agreement rates rather than repricing from current book', () => {
  const manual = sub({ rateSource: 'manual', manualRateCents: 10000, manualReason: 'Reviewed legacy rate' });
  const current = book(); current.version = 2; current.plans[0].rates[0].baseCents = 12000;
  const built = invoice({ book: current }, [manual]);
  assert.equal(built.totalCents, 10000); assert.equal(built.bookRateCents, 12000); assert.equal(built.manualRateCents, 10000);
  assert.equal(built.belowBook, true); assert.equal(built.rateSnapshots[0].rateSource, 'manual');
});

test('billing subscription fingerprints ignore derived metadata and spent credits while detecting service and new credit commitments', () => {
  const current = sub(), fingerprint = billingSubscriptionFingerprintSource(current), derived = structuredClone(current);
  derived.billingPeriodStart = '2027-03-01'; derived.billingPeriodEnd = '2027-04-01'; derived.revision++;
  Object.assign(derived.versions[0], { activatedAt: ctx().at, noticeStatus: 'acknowledged', noticeAcknowledgedAt: ctx().at });
  assert.deepEqual(billingSubscriptionFingerprintSource(derived), fingerprint);
  const promised = promiseSubscriptionCredit(current, { expectedRevision: current.revision, amountCents: 2000, reason: 'Service promise' }, ctx());
  assert.notDeepEqual(billingSubscriptionFingerprintSource(promised), fingerprint);
  const consumed = structuredClone(promised); consumed.credits[0].remainingCents = 0; consumed.credits[0].applications.push({ invoiceId: 'prior-invoice', amountCents: 2000, at: ctx().at });
  assert.deepEqual(billingSubscriptionFingerprintSource(consumed), billingSubscriptionFingerprintSource(promised));
  const amended = amendSubscription(current, { expectedRevision: current.revision, effectiveDate: '2027-03-01', rateSource: 'manual', manualRateCents: 11000, manualReason: 'Reviewed agreement rate', reason: 'Rate change' }, book(), ctx());
  assert.notDeepEqual(billingSubscriptionFingerprintSource(amended), fingerprint);
  const paused = pauseSubscription(current, { expectedRevision: current.revision, startDate: '2027-03-01', resumeDate: '2027-04-01', reason: 'Seasonal hold' }, ctx());
  const resumed = structuredClone(paused); resumed.pauses[0].resumedAt = '2027-04-01T13:00:00Z';
  assert.deepEqual(billingSubscriptionFingerprintSource(resumed), billingSubscriptionFingerprintSource(paused));
  assert.notDeepEqual(billingSubscriptionFingerprintSource(paused), fingerprint);
});

test('new client produces one stable invoice with initial cleanup and prorated first period', () => {
  const args = { id: 'new-a', customerId: 'customer', startDate: '2027-03-16', initialCleanupCents: 5000, firstPeriodMode: 'prorated', paymentMethodId: 'method-a', methodType: 'card' };
  const first = buildNewClientInvoice([sub()], args, ctx('2027-03-16T15:00:00Z')), replay = buildNewClientInvoice([sub()], args, ctx('2027-03-16T15:00:00Z'));
  assert.equal(first.totalCents, 11194); assert.equal(total(first), 11194); assert.equal(first.lineItems.filter(row => row.kind === 'initial_cleanup').length, 1);
  assert.equal(first.idempotencyKey, 'customer:2027-03-01:new_client'); assert.deepEqual(replay, first);
  assert.deepEqual(first.coverage, [{ subscriptionId: 'sub-a', startDate: '2027-03-16', endDate: '2027-04-01' }]);
});

test('full first-period and optional next full month remain on the same single new-client invoice', () => {
  const built = buildNewClientInvoice([sub()], { id: 'new-a', customerId: 'customer', startDate: '2027-03-16', initialCleanupCents: 5000, firstPeriodMode: 'full', includeNextFullMonth: true }, ctx('2027-03-16T15:00:00Z'));
  assert.equal(built.totalCents, 29000); assert.equal(built.coverage.length, 2); assert.equal(built.periodEnd, '2027-05-01');
  assert.equal(built.lineItems.filter(row => row.kind === 'initial_cleanup').length, 1);
  const converted = buildNewClientInvoice([sub({ startDate: '2027-04-01' })], { id: 'conversion', customerId: 'customer', startDate: '2027-03-16', initialCleanupCents: 5000, includeNextFullMonth: true }, ctx('2027-03-16T15:00:00Z'));
  assert.equal(converted.totalCents, 17000); assert.equal(converted.coverage.length, 1);
  assert.equal(converted.coverage[0].startDate, '2027-04-01');
});

test('new-client invoices wait for the configured first unless charge now is explicitly approved', () => {
  const args = { id: 'new-a', customerId: 'customer', startDate: '2027-03-16', initialCleanupCents: 5000, paymentMethodId: 'method-a', methodType: 'card' };
  const draft = buildNewClientInvoice([sub()], args, ctx('2027-03-16T15:00:00Z'));
  assert.equal(draft.scheduledChargeAt, '2027-04-01T13:00:00.000Z');
  const scheduled = approveBillingInvoice(draft, input(draft), ctx('2027-03-16T15:00:00Z'));
  assert.throws(() => startBillingCharge(scheduled, input(scheduled), ctx('2027-03-16T15:00:00Z')), /not due/);
  assert.throws(() => approveBillingInvoice(draft, input(draft, { scheduledChargeAt: '2027-03-16T15:00:00Z' }), ctx()), /first-day/);
  assert.throws(() => buildNewClientInvoice([sub()], { ...args, scheduledChargeAt: '2027-03-16T15:00:00Z' }, ctx()), /first-day/);
  const now = approveBillingInvoice(draft, input(draft, { chargeNow: true }), ctx('2027-03-16T15:00:00Z'));
  assert.equal(startBillingCharge(now, input(now), ctx('2027-03-16T15:00:00Z')).status, 'charging');
  const edited = editBillingInvoice(now, input(now, { lineItems: now.lineItems }), ctx('2027-03-16T15:00:00Z'));
  assert.equal(approveBillingInvoice(edited, input(edited), ctx('2027-03-16T15:00:00Z')).scheduledChargeAt, draft.scheduledChargeAt);
  const firstDay = buildNewClientInvoice([sub()], { ...args, startDate: '2027-04-01' }, ctx('2027-03-31T23:00:00Z'));
  assert.equal(firstDay.scheduledChargeAt, '2027-04-01T13:00:00.000Z');
});

test('ACH discount, configured tax and promised credits match the charge amount in exact cents', () => {
  const built = invoice({ methodType: 'ach', taxBasisPoints: 725, achDiscountBasisPoints: 300, credits: [{ id: 'credit-a', subscriptionId: 'sub-a', amountCents: 2501 }] });
  assert.equal(built.achDiscountCents, 360); assert.equal(built.taxCents, 844); assert.equal(built.totalCents, 9983);
  assert.equal(total(built), 9983); assert.equal(built.creditApplications[0].amountCents, 2501);
  assert.equal(charging(approved(built)).attempts[0].amountCents, 9983);
  assert.throws(() => approved(built, { methodType: 'card' }), /ACH discount/);
});

test('no invoice can charge before approval or its approved scheduled time', () => {
  const draft = invoice(); assert.throws(() => startBillingCharge(draft, input(draft), ctx()), /approval/);
  const value = approveBillingInvoice(draft, input(draft), ctx('2027-02-28T23:00:00Z'));
  assert.equal(value.status, 'approved'); assert.throws(() => startBillingCharge(value, input(value), ctx('2027-03-01T13:59:00Z')), /not due/);
  const started = startBillingCharge(value, input(value), ctx('2027-03-01T14:00:00Z'));
  assert.equal(started.status, 'charging'); assert.equal(started.attempts[0].idempotencyKey, 'invoice-a:1');
  assert.equal(started.attempts[0].amountCents, value.totalCents);
});

test('charge now requires an existing office approval and records a separately audited schedule change', () => {
  const draft = invoice({ periodStart: '2027-04-01' });
  assert.throws(() => scheduleBillingChargeNow(draft, input(draft), ctx()), /approved, unheld/);
  const approved = approveBillingInvoice(draft, input(draft), ctx());
  assert.throws(() => scheduleBillingChargeNow(approved, input(draft), ctx()), /changed/);
  const due = scheduleBillingChargeNow(approved, input(approved), ctx());
  assert.equal(due.scheduledChargeAt, ctx().at); assert.equal(due.audit.at(-1).action, 'charge_now_scheduled');
  assert.equal(due.defaultScheduledChargeAt, '2027-04-01T13:00:00.000Z');
  assert.equal(startBillingCharge(due, input(due), ctx()).status, 'charging');
});

test('approve then charge can produce Paid; replay of the same settled result is immutable', () => {
  const started = charging(), result = { status: 'paid', amountCents: started.totalCents, transactionId: 'transaction-a', processorCode: '000' };
  const settled = recordBillingResult(started, input(started, { attempt: 1, result }), ctx());
  assert.equal(settled.status, 'paid'); assert.equal(settled.transactionId, 'transaction-a');
  assert.deepEqual(recordBillingResult(settled, { expectedRevision: started.revision, attempt: 1, result }, ctx()), settled);
  assert.throws(() => recordBillingResult(settled, { expectedRevision: started.revision, attempt: 1, result: { ...result, amountCents: settled.totalCents + 1 } }, ctx()), /amount does not match/);
  for (const operation of [editBillingInvoice, holdBillingInvoice, voidBillingInvoice, retryBillingInvoice]) assert.throws(() => operation(settled, input(settled, { lineItems: settled.lineItems }), ctx()));
});

test('failed charge never becomes Paid and retry uses invoice ID plus a new recorded attempt', () => {
  const started = charging(), failed = recordBillingResult(started, input(started, { attempt: 1, result: { status: 'failed', processorCode: '05', retryable: true } }), ctx());
  assert.equal(failed.status, 'failed'); assert.equal(failed.paidAt, undefined); assert.equal(failed.retryAt, '2027-03-02T15:00:00.000Z');
  const ready = retryBillingInvoice(failed, input(failed, { chargeNow: true }), ctx());
  const second = startBillingCharge(ready, input(ready), ctx());
  assert.equal(second.attempts.length, 2); assert.equal(second.attempts[1].idempotencyKey, 'invoice-a:2');
});

test('unknown processor outcome stays reconciliation-blocked and cannot create a retry charge', () => {
  const started = charging(), uncertain = recordBillingResult(started, input(started, { attempt: 1, result: { status: 'unknown' } }), ctx());
  assert.equal(uncertain.status, 'charging'); assert.equal(uncertain.reconciliationRequired, true);
  assert.throws(() => retryBillingInvoice(uncertain, input(uncertain), ctx()), /failed invoice/);
  assert.throws(() => startBillingCharge(uncertain, input(uncertain), ctx()), /approval/);
  const found = recordBillingResult(uncertain, input(uncertain, { attempt: 1, result: { status: 'paid', amountCents: uncertain.totalCents, transactionId: 'found-existing' } }), ctx());
  assert.equal(found.status, 'paid'); assert.equal(found.attempts.length, 1);
});

test('ACH remains Pending until settlement, and a return follows its code-aware path', () => {
  const started = charging(approved(invoice({ methodType: 'ach' })));
  const pending = recordBillingResult(started, input(started, { attempt: 1, result: { status: 'pending', transactionId: 'ach-a', processorCode: '00' } }), ctx());
  assert.equal(pending.status, 'pending'); assert.equal(pending.paidAt, undefined); assert.match(pending.clearingTime, /Pending ACH/);
  assert.throws(() => retryBillingInvoice(pending, input(pending), ctx()));
  const returned = recordBillingResult(pending, input(pending, { attempt: 1, result: { status: 'failed', transactionId: 'ach-a', achReturnCode: 'R10' } }), ctx());
  assert.equal(returned.status, 'failed'); assert.equal(returned.retryAt, null); assert.equal(returned.returnAction, 'new_authorization_or_method_required');
  assert.throws(() => retryBillingInvoice(returned, input(returned, { achReviewed: true }), ctx()), /authorization/);
  assert.equal(retryBillingInvoice(returned, input(returned, { achReviewed: true, newAuthorization: true, paymentMethodId: 'reauthorized' }), ctx()).status, 'approved');
  assert.equal(achReturnAction('R01'), 'office_review_before_retry');
  const settled = recordBillingResult(pending, input(pending, { attempt: 1, result: { status: 'paid', transactionId: 'ach-a' } }), ctx());
  assert.equal(settled.status, 'paid');
  const discounted = charging(approved(invoice({ methodType: 'ach', achDiscountBasisPoints: 300 })));
  const declined = recordBillingResult(discounted, input(discounted, { attempt: 1, result: { status: 'failed', transactionId: 'ach-b', achReturnCode: 'R01' } }), ctx());
  assert.throws(() => retryBillingInvoice(declined, input(declined, { achReviewed: true, paymentMethodId: 'card-method', methodType: 'card' }), ctx()), /ACH discount/);
});

test('late ACH return records a financial reversal without rewriting original Paid history', () => {
  const settled = paid(charging(approved(invoice({ methodType: 'ach' }))));
  const returned = recordBillingAchReturn(settled, input(settled, { id: 'return-a', amountCents: 12000, transactionId: 'return-reference', achReturnCode: 'R02' }), ctx());
  assert.equal(returned.status, 'paid'); assert.equal(returned.totalCents, 12000); assert.equal(returned.refundedCents, 12000);
  assert.equal(returned.refunds[0].kind, 'ach_return'); assert.equal(returned.refunds[0].achReturnCode, 'R02');
});

test('processor amount and payment rail are validated before any successful result is recorded', () => {
  const started = charging();
  assert.throws(() => recordBillingResult(started, input(started, { attempt: 1, result: { status: 'paid', transactionId: 'a', amountCents: 11999 } }), ctx()), /amount does not match/);
  assert.throws(() => recordBillingResult(started, input(started, { attempt: 1, result: { status: 'pending', transactionId: 'a' } }), ctx()), /Only ACH/);
  assert.throws(() => recordBillingResult(started, input(started, { attempt: 1, result: { status: 'paid' } }), ctx()), /reference/);
});

test('editing or holding an approved invoice revokes approval and requires a fresh review', () => {
  const value = approved(), lines = value.lineItems.map(row => ({ ...row })); lines.push({ id: 'manual', label: 'Reviewed rate correction', kind: 'manual_adjustment', quantity: 1, unitCents: -500, totalCents: -500 });
  const edited = editBillingInvoice(value, input(value, { lineItems: lines }), ctx());
  assert.equal(edited.status, 'draft'); assert.equal(edited.totalCents, 11500); assert.equal(edited.approvedAt, null);
  const held = holdBillingInvoice(value, input(value), ctx()); assert.equal(held.status, 'draft'); assert.equal(held.held, true);
  assert.throws(() => approveBillingInvoice(held, input(held), ctx()), /unheld/);
  const released = holdBillingInvoice(held, input(held, { held: false }), ctx()); assert.equal(released.status, 'draft'); assert.equal(released.held, false);
  assert.equal(voidBillingInvoice(released, input(released), ctx()).status, 'void');
});

test('editing, crediting or holding a failed invoice cannot bypass ACH authorization or permanent card failure review', () => {
  for (const methodType of ['ach', 'card']) {
    const started = charging(approved(invoice({ methodType })));
    const failed = recordBillingResult(started, input(started, { attempt: 1, result: { status: 'failed', transactionId: `${methodType}-decline`, achReturnCode: methodType === 'ach' ? 'R10' : undefined, retryable: false } }), ctx());
    const edited = editBillingInvoice(failed, input(failed, { lineItems: failed.lineItems }), ctx());
    const credited = recordBillingCredit(failed, input(failed, { id: 'failure-credit', amountCents: 1000 }), ctx());
    const held = holdBillingInvoice(failed, input(failed), ctx()), released = holdBillingInvoice(held, input(held, { held: false }), ctx());
    for (const draft of [edited, credited, released]) {
      assert.equal(draft.status, 'draft');
      assert.throws(() => approveBillingInvoice(draft, input(draft), ctx()), /ACH return|payment method/);
      if (methodType === 'ach') assert.throws(() => approveBillingInvoice(draft, input(draft, { achReviewed: true }), ctx()), /authorization/);
      const reviewed = approveBillingInvoice(draft, input(draft, methodType === 'ach' ? { achReviewed: true, newAuthorization: true } : { methodUpdated: true }), ctx());
      assert.equal(reviewed.status, 'approved'); assert.equal(reviewed.scheduledChargeAt, draft.defaultScheduledChargeAt);
    }
  }
});

test('draft line edits recompute tax and discount review metadata without stale totals', () => {
  const original = approved(invoice({ taxBasisPoints: 725 }));
  const lines = original.lineItems.map(row => row.kind === 'tax' ? { ...row, unitCents: 900, totalCents: 900 } : { ...row });
  const edited = editBillingInvoice(original, input(original, { lineItems: lines }), ctx());
  assert.equal(edited.totalCents, 12900); assert.equal(edited.subtotalCents, 12000); assert.equal(edited.taxableCents, 12000);
  assert.equal(edited.taxCents, 900); assert.equal(edited.achDiscountCents, 0); assert.equal(edited.approvedAt, null);
  assert.equal(total(edited), edited.totalCents);
});

test('promised credits are snapshots only and zero invoices settle after approval without a processor call', () => {
  const credit = { id: 'credit-a', subscriptionId: 'sub-a', amountCents: 15000 }, before = structuredClone(credit);
  const built = invoice({ credits: [credit] }); assert.equal(built.totalCents, 0); assert.equal(built.creditApplications[0].amountCents, 12000); assert.deepEqual(credit, before);
  assert.throws(() => settleZeroBillingInvoice(built, input(built), ctx()), /approved zero/);
  const value = approved(built); const settled = settleZeroBillingInvoice(value, input(value), ctx());
  assert.equal(settled.status, 'paid'); assert.equal(settled.settlementSource, 'credits'); assert.equal(settled.attempts.length, 0);
});

test('refunds are capped and preserve paid amount/status while credits on unpaid invoices reduce the next approved amount', () => {
  const settled = paid(), refunded = recordBillingRefund(settled, input(settled, { id: 'refund-a', amountCents: 3000, transactionId: 'refund-transaction' }), ctx());
  assert.equal(refunded.status, 'paid'); assert.equal(refunded.totalCents, 12000); assert.equal(refunded.refundedCents, 3000);
  assert.throws(() => recordBillingRefund(refunded, input(refunded, { id: 'refund-b', amountCents: 9001, transactionId: 'refund-other' }), ctx()), /cannot exceed/);
  const creditedPaid = recordBillingCredit(refunded, input(refunded, { id: 'credit-paid', amountCents: 2000 }), ctx());
  assert.equal(creditedPaid.totalCents, 12000); assert.equal(creditedPaid.status, 'paid'); assert.equal(creditedPaid.credits[0].affectsInvoiceTotal, false);
  assert.throws(() => recordBillingRefund(creditedPaid, input(creditedPaid, { id: 'refund-excess', amountCents: 7001, transactionId: 'refund-excess-tx' }), ctx()), /cannot exceed/);
  const started = charging(), failed = recordBillingResult(started, input(started, { attempt: 1, result: { status: 'failed', processorCode: '05' } }), ctx());
  const credited = recordBillingCredit(failed, input(failed, { id: 'credit-unpaid', amountCents: 2000 }), ctx());
  assert.equal(credited.totalCents, 10000); assert.equal(credited.status, 'draft'); assert.equal(total(credited), 10000); assert.equal(credited.credits[0].affectsInvoiceTotal, true);
  assert.equal(charging(approved(credited)).attempts.at(-1).amountCents, 10000);
});

test('write-off and every invoice action retain author, timestamp, before/after and required reason', () => {
  const started = charging(), failed = recordBillingResult(started, input(started, { attempt: 1, result: { status: 'failed', processorCode: '05' } }), ctx());
  assert.throws(() => writeOffBillingInvoice(failed, { expectedRevision: failed.revision, reason: '' }, ctx()), /reason/);
  const written = writeOffBillingInvoice(failed, input(failed), ctx()); assert.equal(written.status, 'written_off'); assert.equal(written.writtenOffCents, 12000);
  for (const entry of written.audit) { assert.equal(entry.actor, 'owner@example.test'); assert.ok(entry.at); assert.ok(Object.hasOwn(entry, 'oldValue')); assert.ok(Object.hasOwn(entry, 'newValue')); assert.ok(entry.reason); }
});

test('credits already itemized before charging do not reduce the refundable paid balance a second time', () => {
  const draft = invoice(), credited = recordBillingCredit(draft, input(draft, { id: 'inline-credit', amountCents: 2000 }), ctx());
  const settled = paid(charging(approved(credited)));
  assert.equal(settled.totalCents, 10000); assert.equal(settled.creditedCents, 2000); assert.equal(billingRefundableCents(settled), 10000);
  const refunded = recordBillingRefund(settled, input(settled, { id: 'full-net-refund', amountCents: 10000, transactionId: 'net-refund-reference' }), ctx());
  assert.equal(refunded.refundedCents, 10000); assert.equal(billingRefundableCents(refunded), 0);
  const paidCredit = recordBillingCredit(settled, input(settled, { id: 'after-payment-credit', amountCents: 10000 }), ctx());
  assert.equal(paidCredit.totalCents, 10000); assert.equal(billingRefundableCents(paidCredit), 0);
});

test('review filters and summaries distinguish held, below-book, missing method, rails, first invoices and credits', () => {
  const value = invoice({ firstInvoice: true, credits: [{ id: 'credit', amountCents: 100 }] }); value.belowBook = true;
  assert.ok(billingInvoiceMatchesFilter(value, 'draft')); assert.ok(billingInvoiceMatchesFilter(value, 'credits')); assert.ok(billingInvoiceMatchesFilter(value, 'first_invoice')); assert.ok(billingInvoiceMatchesFilter(value, 'below_book')); assert.ok(billingInvoiceMatchesFilter(value, 'card'));
  assert.equal(billingInvoiceMatchesFilter(value, 'ach'), false); value.paymentMethodId = null; assert.ok(billingInvoiceMatchesFilter(value, 'missing_payment_method'));
  value.held = true; assert.ok(billingInvoiceMatchesFilter(value, 'held'));
  assert.deepEqual(billingBatchSummary([value]), { count: 1, totalCents: 11900, draftCents: 11900, approvedCents: 0, paidCents: 0, pendingCents: 0, failedCents: 0, heldCount: 1 });
  assert.equal(billingInvoiceKey('customer', '2027-03-16', 'new_client'), 'customer:2027-03-01:new_client');
});
