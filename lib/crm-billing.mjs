import { subscriptionDate, subscriptionView } from './crm-subscriptions.mjs';

export class BillingError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'BillingError'; this.status = status; }
}
const fail = (condition, message, status = 400) => { if (!condition) throw new BillingError(message, status); };
const copy = value => structuredClone(value);
const money = (value, signed = false) => { fail(Number.isSafeInteger(value) && Math.abs(value) <= 100000000 && (signed || value >= 0), 'Use bounded whole-cent amounts.'); return value; };
const text = (value, label = 'a reason', max = 2000) => { fail(typeof value === 'string' && value.trim() && value.length <= max, `Enter ${label}.`); return value.trim(); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const dayNumber = value => Date.parse(`${subscriptionDate(value)}T00:00:00Z`) / 86400000;
const day = value => new Date(value * 86400000).toISOString().slice(0, 10);
const monthStart = value => `${subscriptionDate(value).slice(0, 7)}-01`;
const nextMonth = value => { const [year, month] = monthStart(value).split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); };
const previousDay = value => day(dayNumber(value) - 1);
const sum = lines => lines.reduce((total, row) => money(total + money(row.totalCents, true), true), 0);
const roundRatio = (amount, numerator, denominator) => {
  const product = BigInt(amount) * BigInt(numerator), absolute = product < 0n ? -product : product;
  const result = Number((absolute + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
  return product < 0n ? -result : result;
};
const east = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function localParts(now) {
  fail(Number.isFinite(new Date(now).getTime()), 'Use a valid scheduler time.');
  const parts = Object.fromEntries(east.formatToParts(new Date(now)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
export function billingLocalInstant(date, hour, minute = 0) {
  subscriptionDate(date); fail(Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59, 'Use a valid local billing time.');
  const [year, month, dateOfMonth] = date.split('-').map(Number), target = Date.UTC(year, month - 1, dateOfMonth, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const observed = localParts(guess), [y, m, d] = observed.date.split('-').map(Number);
    const observedWall = Date.UTC(y, m - 1, d, observed.hour, observed.minute, observed.second);
    const difference = target - observedWall; if (!difference) return new Date(guess).toISOString(); guess += difference;
  }
  throw new BillingError('This local billing time does not exist. Choose another hour.');
}
function context(ctx) {
  const actor = text(ctx?.actor, 'the audit author', 200), at = ctx?.at ?? ctx?.atISO;
  fail(typeof at === 'string' && Number.isFinite(Date.parse(at)), 'Use a valid audit timestamp.');
  return { actor, at, today: localParts(Date.parse(at)).date };
}
export function defaultBillingSettings(overrides = {}) {
  const settings = { timeZone: 'America/New_York', draftDaysBefore: 1, draftHour: 18, draftMinute: 0, chargeHour: 9, chargeMinute: 0,
    newClientFirstPeriodMode: 'prorated', includeNextFullMonth: false, taxBasisPoints: 0, achDiscountBasisPoints: 0,
    cardRetryDays: [1, 3, 7], autoRetryCards: false, customerNoticesEnabled: false, ...copy(overrides) };
  fail(settings.timeZone === 'America/New_York', 'Billing uses America/New_York.');
  for (const [key, maximum] of [['draftHour', 23], ['chargeHour', 23], ['draftMinute', 59], ['chargeMinute', 59]]) fail(Number.isInteger(settings[key]) && settings[key] >= 0 && settings[key] <= maximum, 'Use valid billing job and charge times.');
  fail(Number.isInteger(settings.draftDaysBefore) && settings.draftDaysBefore >= 1 && settings.draftDaysBefore <= 7, 'Generate drafts one to seven days before the first.');
  for (const key of ['taxBasisPoints', 'achDiscountBasisPoints']) fail(Number.isInteger(settings[key]) && settings[key] >= 0 && settings[key] <= 10000, 'Use an approved basis-point amount.');
  fail(['prorated', 'full'].includes(settings.newClientFirstPeriodMode), 'Choose prorated or full first-period billing.');
  fail(typeof settings.autoRetryCards === 'boolean' && typeof settings.includeNextFullMonth === 'boolean', 'Use explicit billing settings switches.');
  fail(Array.isArray(settings.cardRetryDays) && settings.cardRetryDays.length <= 6 && settings.cardRetryDays.every((value, index, all) => Number.isInteger(value) && value >= 1 && value <= 60 && (index === 0 || value > all[index - 1])), 'Use distinct increasing card retry days.');
  fail(settings.customerNoticesEnabled === false, 'Customer notices remain disabled in this phase.');
  return settings;
}
export function billingSchedule(now, rawSettings = {}) {
  const settings = defaultBillingSettings(rawSettings), local = localParts(now), thisMonth = monthStart(local.date), following = nextMonth(local.date);
  const followingDraftDate = day(dayNumber(following) - settings.draftDaysBefore);
  const periodStart = local.date >= followingDraftDate ? following : thisMonth;
  const draftDate = day(dayNumber(periodStart) - settings.draftDaysBefore);
  const draftAt = billingLocalInstant(draftDate, settings.draftHour, settings.draftMinute), chargeAt = billingLocalInstant(periodStart, settings.chargeHour, settings.chargeMinute);
  const instant = new Date(now).getTime(); fail(Number.isFinite(instant), 'Use a valid scheduler time.');
  return { timeZone: settings.timeZone, localDate: local.date, periodStart, periodEnd: nextMonth(periodStart), draftAt, chargeAt,
    draftDue: instant >= Date.parse(draftAt) && local.date <= periodStart, chargeDue: instant >= Date.parse(chargeAt), draftOnly: true };
}
function validLine(value) {
  fail(value && identifier(value.id), 'Use stable invoice line IDs.');
  const quantity = value.quantity ?? 1; fail(Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000, 'Use a bounded whole line quantity.');
  const unitCents = money(value.unitCents ?? value.totalCents, true), totalCents = money(value.totalCents ?? unitCents * quantity, true);
  fail(unitCents * quantity === totalCents, 'Invoice quantity and unit amount must equal its line total.');
  return { id: value.id, label: text(value.label, 'a line label', 200), kind: text(value.kind || 'adjustment', 'a line kind', 60), quantity, unitCents, totalCents, itemized: value.itemized !== false,
    ...(identifier(value.subscriptionId) ? { subscriptionId: value.subscriptionId } : {}), ...(typeof value.taxable === 'boolean' ? { taxable: value.taxable } : {}) };
}
function validateLines(values) {
  fail(Array.isArray(values) && values.length > 0 && values.length <= 500, 'Provide bounded invoice lines.');
  const lines = values.map(validLine); fail(new Set(lines.map(row => row.id)).size === lines.length, 'Each invoice line ID must be unique.'); return lines;
}
function allocateProration(lines, numerator, denominator) {
  const target = roundRatio(sum(lines), numerator, denominator);
  const result = lines.map(row => {
    const product = BigInt(row.totalCents) * BigInt(numerator), base = Number(product / BigInt(denominator));
    return { ...copy(row), quantity: 1, unitCents: base, totalCents: base, remainder: product % BigInt(denominator) };
  });
  let difference = target - sum(result);
  const order = [...result].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  if (difference < 0) order.reverse();
  for (let index = 0; difference !== 0; index++) { const row = order[index % order.length], delta = difference > 0 ? 1 : -1; row.unitCents += delta; row.totalCents += delta; difference -= delta; }
  return result.map(({ remainder: _remainder, ...row }) => row);
}
function adjustmentLine(id, label, kind, totalCents) { return { id, label, kind, quantity: 1, unitCents: totalCents, totalCents, itemized: true }; }
function priceLines(source, input, settings) {
  const lines = validateLines(source), subtotalCents = sum(lines); fail(subtotalCents >= 0, 'Invoice adjustments cannot make the subtotal negative.');
  const achDiscountCents = input.methodType === 'ach' ? roundRatio(subtotalCents, settings.achDiscountBasisPoints, 10000) : 0;
  if (achDiscountCents) lines.push(adjustmentLine('ach_discount', 'ACH payment discount', 'ach_discount', -achDiscountCents));
  const taxableCents = subtotalCents - achDiscountCents, taxCents = roundRatio(taxableCents, settings.taxBasisPoints, 10000);
  for (const row of lines) row.taxable = settings.taxBasisPoints > 0 && row.totalCents > 0;
  if (taxCents) lines.push(adjustmentLine('tax', 'Configured sales tax', 'tax', taxCents));
  let remaining = taxableCents + taxCents;
  const creditApplications = [];
  fail(Array.isArray(input.credits || []) && (input.credits || []).length <= 100, 'Use bounded promised credits.');
  const creditIds = new Set();
  for (const credit of input.credits || []) {
    fail(identifier(credit.id) && !creditIds.has(credit.id), 'Use each credit once.'); creditIds.add(credit.id);
    const amountCents = Math.min(money(credit.amountCents), remaining); if (!amountCents) continue;
    remaining -= amountCents;
    lines.push(adjustmentLine(`credit:${credit.id}`, 'Promised service credit', 'credit', -amountCents));
    creditApplications.push({ creditId: credit.id, ...(identifier(credit.subscriptionId) ? { subscriptionId: credit.subscriptionId } : {}), amountCents });
  }
  fail(sum(lines) === remaining, 'Itemized invoice totals must match exactly.');
  validateLines(lines);
  return { lineItems: lines, subtotalCents, taxableCents, achDiscountCents, taxCents, totalCents: remaining, creditApplications };
}
function audit(invoice, action, before, after, input, ctx) {
  const at = context(ctx); invoice.revision++;
  invoice.audit.push({ id: `${invoice.id}:audit:${invoice.revision}`, action, actor: at.actor, at: at.at, oldValue: copy(before), newValue: copy(after), reason: text(input.reason) });
  invoice.updatedAt = at.at; return invoice;
}
export function billingInvoiceKey(customerId, periodStart, invoiceType) {
  fail(identifier(customerId) && ['monthly', 'new_client'].includes(invoiceType), 'Use a customer and supported invoice type.');
  return `${customerId}:${monthStart(periodStart)}:${invoiceType}`;
}
export function billingSubscriptionFingerprintSource(sub) {
  const select = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, copy(value[key])]));
  const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const byId = (a, b) => a.id.localeCompare(b.id);
  const source = select(sub, ['id', 'customerId', 'startDate', 'endDate', 'endKind', 'terminationReason', 'terminationNote']);
  source.versions = sub.versions.map(row => select(row, ['id', 'sequence', 'effectiveDate', 'cancelledAt', 'bookId', 'bookVersion', 'currency', 'billingInterval', 'selection', 'lineItems', 'totalCents', 'bookRateCents', 'zoneId', 'rateSource', 'manualRateCents', 'manualReason'])).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence || byId(a, b));
  for (const key of ['pauses', 'skips']) source[key] = sub[key].map(row => select(row, ['id', 'kind', 'startDate', 'resumeDate'])).sort(byId);
  source.credits = sub.credits.map(row => select(row, ['id', 'amountCents', 'promisedAt'])).sort(byId);
  return canonical(source);
}
function makeInvoice(input, source, coverage, rateSnapshots, ctx) {
  const at = context(ctx), settings = defaultBillingSettings({ ...input.settings, ...(input.taxBasisPoints === undefined ? {} : { taxBasisPoints: input.taxBasisPoints }), ...(input.achDiscountBasisPoints === undefined ? {} : { achDiscountBasisPoints: input.achDiscountBasisPoints }) });
  fail(identifier(input.id) && identifier(input.customerId), 'Use invoice and customer IDs.');
  const periodStart = subscriptionDate(input.periodStart), periodEnd = subscriptionDate(input.periodEnd);
  fail(periodEnd > periodStart, 'The invoice period must end after it starts.');
  const chargeDate = input.invoiceType === 'new_client' && input.startDate !== monthStart(input.startDate) ? nextMonth(input.startDate) : monthStart(periodStart);
  const defaultScheduledChargeAt = billingLocalInstant(chargeDate, settings.chargeHour, settings.chargeMinute);
  fail(input.scheduledChargeAt === undefined || Date.parse(input.scheduledChargeAt) === Date.parse(defaultScheduledChargeAt), 'Use the configured first-day schedule or explicitly approve charge now.');
  const priced = priceLines(source, input, settings);
  const invoice = { schemaVersion: 1, id: input.id, customerId: input.customerId, invoiceType: input.invoiceType, periodStart, periodEnd,
    idempotencyKey: billingInvoiceKey(input.customerId, periodStart, input.invoiceType), subscriptionIds: [...new Set(coverage.map(item => item.subscriptionId))], coverage: copy(coverage),
    ...priced, currency: 'USD', rateSnapshots, bookRateCents: rateSnapshots.reduce((n, item) => n + item.bookRateCents, 0),
    manualRateCents: rateSnapshots.some(item => item.rateSource === 'manual') ? rateSnapshots.reduce((n, item) => n + item.amountCents, 0) : null,
    rateSource: rateSnapshots.some(item => item.rateSource === 'manual') ? 'manual' : 'preset', belowBook: rateSnapshots.some(item => item.belowBook),
    status: 'draft', revision: 0, held: false, holdReason: null, firstInvoice: input.firstInvoice === true || input.invoiceType === 'new_client',
    paymentMethodId: input.paymentMethodId || null, methodType: input.methodType || null, approvedBy: null, approvedAt: null,
    defaultScheduledChargeAt, scheduledChargeAt: defaultScheduledChargeAt,
    attempts: [], refunds: [], credits: [], refundedCents: 0, creditedCents: 0, reconciliationRequired: false,
    settingsSnapshot: settings, createdAt: at.at, updatedAt: at.at, audit: [], customerNoticesEnabled: false };
  return audit(invoice, 'draft_created', null, { idempotencyKey: invoice.idempotencyKey, totalCents: invoice.totalCents, coverage, creditApplications: invoice.creditApplications }, { reason: input.reason || 'Prepared draft for office approval; no charge or customer message' }, ctx);
}
function covered(existing, subscriptionId, startDate, endDate) {
  return (existing || []).some(row => row.subscriptionId === subscriptionId && row.startDate < endDate && startDate < row.endDate);
}
function monthlySources(subscriptions, input, startDate, endDate, prorate = false) {
  const lines = [], coverage = [], rates = [];
  fail(Array.isArray(subscriptions) && subscriptions.length <= 500, 'Provide a bounded customer subscription list.');
  for (const sub of subscriptions) {
    fail(sub.customerId === input.customerId, 'A subscription belongs to another customer.', 403);
    const view = subscriptionView(sub, { date: startDate, book: input.book });
    if (view.status !== 'active' || covered(input.existingCoverage, sub.id, startDate, endDate)) continue;
    // Full monthly drafts cannot silently ignore scheduled changes or suspension
    // boundaries inside the billed period. The office must review proration.
    fail(!sub.versions.some(version => !version.cancelledAt && version.effectiveDate > startDate && version.effectiveDate < endDate)
      && ![...sub.pauses, ...sub.skips].some(window => window.startDate > startDate && window.startDate < endDate || window.resumeDate > startDate && window.resumeDate < endDate)
      && (!sub.endDate || sub.endDate >= endDate), 'This period contains a service or rate change. Review proration before generating the invoice.', 409);
    const numerator = prorate ? dayNumber(endDate) - dayNumber(startDate) : 1, denominator = prorate ? dayNumber(endDate) - dayNumber(monthStart(startDate)) : 1;
    const current = view.currentLines.map(row => ({ ...row, id: `${sub.id}:${startDate}:${row.id}`, subscriptionId: sub.id }));
    const billed = prorate ? allocateProration(current, numerator, denominator) : current;
    lines.push(...billed); coverage.push({ subscriptionId: sub.id, startDate, endDate });
    rates.push({ subscriptionId: sub.id, versionId: sub.versions.filter(version => !version.cancelledAt && version.effectiveDate <= startDate).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence).at(-1)?.id || null,
      bookRateCents: roundRatio(view.bookRateCents, numerator, denominator), manualRateCents: view.manualRateCents === null ? null : roundRatio(view.manualRateCents, numerator, denominator),
      amountCents: sum(billed), rateSource: view.rateSource, belowBook: view.belowBook, periodStart: startDate, periodEnd: endDate });
  }
  return { lines, coverage, rates };
}
export function buildMonthlyInvoice(subscriptions, input, ctx) {
  const periodStart = subscriptionDate(input.periodStart); fail(periodStart.endsWith('-01'), 'Prepaid monthly billing periods begin on the first.');
  const periodEnd = nextMonth(periodStart), source = monthlySources(subscriptions, input, periodStart, periodEnd);
  fail(source.coverage.length > 0, 'There are no active, unpaused and unbilled subscriptions for this customer period.', 409);
  return makeInvoice({ ...input, invoiceType: 'monthly', periodStart, periodEnd }, source.lines, source.coverage, source.rates, ctx);
}
export function buildNewClientInvoice(subscriptions, input, ctx) {
  const startDate = subscriptionDate(input.startDate), settings = defaultBillingSettings(input.settings), firstPeriodMode = input.firstPeriodMode || settings.newClientFirstPeriodMode;
  fail(['prorated', 'full'].includes(firstPeriodMode), 'Choose prorated or full first-period billing.');
  const periodStart = monthStart(startDate), firstEnd = nextMonth(startDate), source = monthlySources(subscriptions, input, startDate, firstEnd, firstPeriodMode === 'prorated');
  const cleanup = money(input.initialCleanupCents ?? 0);
  if (cleanup) source.lines.unshift(adjustmentLine('initial_cleanup', 'Initial cleanup', 'initial_cleanup', cleanup));
  const includeNextFullMonth = input.includeNextFullMonth ?? settings.includeNextFullMonth;
  fail(typeof includeNextFullMonth === 'boolean', 'Choose whether the next full month is included.');
  let periodEnd = firstEnd;
  if (includeNextFullMonth) {
    periodEnd = nextMonth(firstEnd); const next = monthlySources(subscriptions, input, firstEnd, periodEnd);
    source.lines.push(...next.lines); source.coverage.push(...next.coverage); source.rates.push(...next.rates);
  }
  for (const row of input.additionalLines || []) source.lines.push(validLine(row));
  fail(source.lines.length > 0, 'Provide initial cleanup or an eligible first service period.');
  const result = makeInvoice({ ...input, invoiceType: 'new_client', periodStart, periodEnd, firstInvoice: true }, source.lines, source.coverage, source.rates, ctx);
  result.firstPeriodMode = firstPeriodMode; result.serviceStartDate = startDate; result.includeNextFullMonth = includeNextFullMonth; return result;
}
function revision(invoice, input) { fail(invoice && input.expectedRevision === invoice.revision, 'The invoice changed. Refresh and review it again.', 409); }
function mutable(invoice) { fail(!['paid', 'pending', 'charging', 'void', 'written_off'].includes(invoice.status), 'This invoice cannot be edited or retried in its current state.', 409); }
function clearApproval(invoice) { invoice.approvedAt = null; invoice.approvedBy = null; invoice.status = 'draft'; invoice.scheduledChargeAt = invoice.defaultScheduledChargeAt || invoice.scheduledChargeAt; }
function reviewFailedAttempt(invoice, input) {
  const previous = invoice.attempts.at(-1); if (!previous) return;
  fail(previous.status === 'failed' && !invoice.reconciliationRequired, 'Reconcile the prior processor attempt before approving another collection.', 409);
  if (previous.methodType === 'ach') fail(input.achReviewed === true && (invoice.returnAction !== 'new_authorization_or_method_required' || input.newAuthorization === true), 'Review the ACH return and obtain any required new authorization before retrying.');
  else fail(invoice.retryable !== false || input.methodUpdated === true, 'Update the payment method before retrying this failure.');
  fail(invoice.attempts.length <= invoice.settingsSnapshot.cardRetryDays.length || input.manualRetry === true, 'The configured retry schedule is exhausted. Review a manual retry.');
}
export function editBillingInvoice(original, input, ctx) {
  revision(original, input); mutable(original); const invoice = copy(original), before = { lineItems: invoice.lineItems, totalCents: invoice.totalCents, status: invoice.status };
  const lines = validateLines(input.lineItems); fail(sum(lines) >= 0, 'Invoice totals cannot be negative.');
  fail(!invoice.creditApplications.length || JSON.stringify(lines.filter(row => row.kind === 'credit')) === JSON.stringify(invoice.lineItems.filter(row => row.kind === 'credit')), 'Promised credit reservations require a separately reviewed release before editing their amounts.', 409);
  invoice.lineItems = lines; invoice.totalCents = sum(lines); invoice.manualRateCents = invoice.totalCents; invoice.rateSource = 'invoice_manual'; clearApproval(invoice);
  invoice.subtotalCents = sum(lines.filter(row => !['tax', 'ach_discount', 'credit'].includes(row.kind)));
  invoice.taxCents = sum(lines.filter(row => row.kind === 'tax')); invoice.achDiscountCents = -sum(lines.filter(row => row.kind === 'ach_discount')) || 0;
  fail(invoice.taxCents >= 0 && invoice.achDiscountCents >= 0, 'Review the tax and ACH discount line signs.');
  invoice.taxableCents = Math.max(0, invoice.subtotalCents - invoice.achDiscountCents);
  return audit(invoice, 'draft_edited', before, { lineItems: lines, totalCents: invoice.totalCents, status: invoice.status }, input, ctx);
}
export function holdBillingInvoice(original, input, ctx) {
  revision(original, input); fail(!['paid', 'pending', 'charging', 'void', 'written_off'].includes(original.status), 'Only open, uncharged invoices may be held.', 409);
  const invoice = copy(original), before = { held: invoice.held, status: invoice.status };
  invoice.held = input.held !== false; invoice.holdReason = invoice.held ? text(input.reason) : null;
  if (invoice.held) clearApproval(invoice);
  return audit(invoice, invoice.held ? 'held' : 'hold_released', before, { held: invoice.held, status: invoice.status }, input, ctx);
}
export function voidBillingInvoice(original, input, ctx) {
  revision(original, input); mutable(original); const invoice = copy(original); invoice.status = 'void'; invoice.held = true; invoice.holdReason = text(input.reason);
  return audit(invoice, 'voided', { status: original.status }, { status: 'void' }, input, ctx);
}
export function approveBillingInvoice(original, input, ctx) {
  revision(original, input); fail(original.status === 'draft' && !original.held, 'Only an unheld draft can be approved.', 409);
  reviewFailedAttempt(original, input);
  const invoice = copy(original), at = context(ctx);
  invoice.paymentMethodId = input.paymentMethodId || invoice.paymentMethodId; invoice.methodType = input.methodType || invoice.methodType;
  fail(invoice.totalCents === 0 || identifier(invoice.paymentMethodId) && ['card', 'ach'].includes(invoice.methodType), 'Choose a saved, authorized payment method before approval.');
  fail(!invoice.achDiscountCents || invoice.methodType === 'ach', 'Review the ACH discount before approving a card payment.');
  invoice.status = 'approved'; invoice.approvedAt = at.at; invoice.approvedBy = at.actor;
  const scheduled = invoice.defaultScheduledChargeAt || invoice.scheduledChargeAt;
  fail(input.chargeNow === true || input.scheduledChargeAt === undefined || Date.parse(input.scheduledChargeAt) === Date.parse(scheduled), 'Use the configured first-day schedule or explicitly approve charge now.');
  invoice.scheduledChargeAt = input.chargeNow === true ? at.at : scheduled;
  fail(Number.isFinite(Date.parse(invoice.scheduledChargeAt)), 'Choose a valid charge time.');
  return audit(invoice, 'approved', { status: original.status }, { status: 'approved', totalCents: invoice.totalCents, paymentMethodId: invoice.paymentMethodId, methodType: invoice.methodType, scheduledChargeAt: invoice.scheduledChargeAt }, input, ctx);
}
export function startBillingCharge(original, input, ctx) {
  revision(original, input); const at = context(ctx);
  fail(original.status === 'approved' && !original.held && original.approvedAt && original.approvedBy, 'Office approval is required before charging.', 409);
  fail(!original.reconciliationRequired && Date.parse(original.scheduledChargeAt) <= Date.parse(at.at), 'This invoice is not due or needs processor reconciliation.', 409);
  fail(original.totalCents > 0, 'A zero-dollar approved invoice must be settled by credits without a processor charge.');
  const invoice = copy(original), attempt = invoice.attempts.length + 1;
  fail(input.attempt === undefined || input.attempt === attempt, 'Use the next recorded charge attempt.', 409);
  fail(identifier(invoice.paymentMethodId) && ['card', 'ach'].includes(invoice.methodType), 'Choose a saved payment method.');
  const payment = { attempt, idempotencyKey: `${invoice.id}:${attempt}`, paymentMethodId: invoice.paymentMethodId, methodType: invoice.methodType, amountCents: invoice.totalCents, status: 'charging', startedAt: at.at, transactionId: null, processorCode: null, achReturnCode: null };
  invoice.status = 'charging'; invoice.attempts.push(payment);
  return audit(invoice, 'charge_started', { status: original.status }, { status: 'charging', attempt, idempotencyKey: payment.idempotencyKey, amountCents: invoice.totalCents }, input, ctx);
}
export function scheduleBillingChargeNow(original, input, ctx) {
  revision(original, input);
  fail(original.status === 'approved' && !original.held && original.approvedAt && original.approvedBy && !original.reconciliationRequired, 'An approved, unheld invoice is required before charge now.', 409);
  const invoice = copy(original); invoice.scheduledChargeAt = context(ctx).at;
  return audit(invoice, 'charge_now_scheduled', { scheduledChargeAt: original.scheduledChargeAt }, { scheduledChargeAt: invoice.scheduledChargeAt }, input, ctx);
}
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null;
export function achReturnAction(code) {
  if (['R02', 'R03', 'R04', 'R07', 'R08', 'R10', 'R11', 'R16', 'R20', 'R29'].includes(code)) return 'new_authorization_or_method_required';
  if (['R01', 'R09'].includes(code)) return 'office_review_before_retry';
  return 'office_review_required';
}
export function recordBillingResult(original, input, ctx) {
  const result = input.result || {}, payment = original.attempts.find(row => row.attempt === input.attempt);
  fail(payment, 'The recorded processor attempt was not found.', 409);
  fail(result.amountCents === undefined || result.amountCents === payment.amountCents, 'The processor amount does not match the approved invoice.', 409);
  if (['paid', 'failed'].includes(payment.status) && payment.status === result.status && (!result.transactionId || result.transactionId === payment.transactionId)) return copy(original);
  revision(original, input); fail(['charging', 'pending'].includes(original.status) && ['charging', 'pending'].includes(payment.status), 'Only an unsettled recorded attempt can accept a processor result.', 409);
  fail(['paid', 'failed', 'pending', 'unknown'].includes(result.status), 'Use a normalized processor result.');
  fail(result.status !== 'pending' || payment.methodType === 'ach', 'Only ACH may remain pending settlement.');
  fail(!['paid', 'pending'].includes(result.status) || safeCode(result.transactionId), 'A processor transaction reference is required.');
  fail(!payment.transactionId || !result.transactionId || payment.transactionId === result.transactionId, 'The processor reference changed. Reconcile the attempt.', 409);
  const invoice = copy(original), current = invoice.attempts.find(row => row.attempt === input.attempt), at = context(ctx);
  current.transactionId = safeCode(result.transactionId) || current.transactionId; current.processorCode = safeCode(result.processorCode); current.achReturnCode = safeCode(result.achReturnCode);
  current.status = result.status === 'unknown' ? 'charging' : result.status; current.updatedAt = at.at;
  invoice.status = current.status; invoice.reconciliationRequired = result.status === 'unknown';
  if (result.status === 'paid') { invoice.paidAt = at.at; invoice.transactionId = current.transactionId; invoice.retryAt = null; }
  if (result.status === 'pending') { invoice.clearingTime = 'Pending ACH settlement; processor clearing and return status are polled.'; invoice.retryAt = null; }
  if (result.status === 'failed') {
    invoice.failedAt = at.at;
    if (current.methodType === 'ach') { invoice.returnAction = achReturnAction(current.achReturnCode); invoice.retryAt = null; }
    else {
      const delay = invoice.settingsSnapshot.cardRetryDays[current.attempt - 1];
      invoice.retryAt = result.retryable !== false && delay ? new Date(Date.parse(at.at) + delay * 86400000).toISOString() : null;
      invoice.retryable = result.retryable !== false;
    }
  }
  return audit(invoice, `processor_${result.status}`, { status: original.status }, { status: invoice.status, attempt: current.attempt, transactionId: current.transactionId, processorCode: current.processorCode, achReturnCode: current.achReturnCode, reconciliationRequired: invoice.reconciliationRequired }, { reason: input.reason || 'Normalized processor result recorded' }, ctx);
}
export function retryBillingInvoice(original, input, ctx) {
  revision(original, input); fail(original.status === 'failed' && !original.reconciliationRequired && !original.held, 'Only a reconciled, failed invoice can be retried.', 409);
  const invoice = copy(original), at = context(ctx);
  reviewFailedAttempt(invoice, input);
  invoice.paymentMethodId = input.paymentMethodId || invoice.paymentMethodId; invoice.methodType = input.methodType || invoice.methodType;
  fail(identifier(invoice.paymentMethodId) && ['card', 'ach'].includes(invoice.methodType), 'Choose a saved payment method.');
  fail(!invoice.achDiscountCents || invoice.methodType === 'ach', 'Review the ACH discount before retrying a card payment.');
  invoice.status = 'approved'; invoice.scheduledChargeAt = input.chargeNow === true ? at.at : input.scheduledChargeAt || invoice.retryAt || at.at;
  fail(Number.isFinite(Date.parse(invoice.scheduledChargeAt)), 'Choose a valid retry charge time.');
  return audit(invoice, 'retry_authorized', { status: original.status, paymentMethodId: original.paymentMethodId }, { status: 'approved', paymentMethodId: invoice.paymentMethodId, nextAttempt: invoice.attempts.length + 1, scheduledChargeAt: invoice.scheduledChargeAt }, input, ctx);
}
export function settleZeroBillingInvoice(original, input, ctx) {
  revision(original, input); fail(original.status === 'approved' && original.totalCents === 0 && !original.held, 'Only an approved zero-dollar invoice may be settled without a charge.', 409);
  fail(Date.parse(original.scheduledChargeAt) <= Date.parse(context(ctx).at), 'This credit settlement is not due yet.', 409);
  const invoice = copy(original); invoice.status = 'paid'; invoice.paidAt = context(ctx).at; invoice.transactionId = null; invoice.settlementSource = 'credits';
  return audit(invoice, 'credit_settled', { status: 'approved' }, { status: 'paid', amountCents: 0, processorCalled: false }, input, ctx);
}
export function billingRefundableCents(invoice) {
  const paidCredits = (invoice.credits || []).filter(row => row.affectsInvoiceTotal === false).reduce((total, row) => money(total + row.amountCents), 0);
  return money(Math.max(0, invoice.totalCents - invoice.refundedCents - paidCredits));
}
export function recordBillingRefund(original, input, ctx) {
  revision(original, input); fail(original.status === 'paid', 'A refund requires a recorded paid invoice.', 409);
  const available = input.kind === 'ach_return' ? original.totalCents - original.refundedCents : billingRefundableCents(original);
  const amountCents = money(input.amountCents); fail(amountCents > 0 && amountCents <= available, 'Refunds cannot exceed the remaining paid amount after refunds and credits.');
  fail(safeCode(input.transactionId) && identifier(input.id), 'Record the confirmed processor refund reference.');
  fail(!original.refunds.some(row => row.id === input.id || row.transactionId === input.transactionId), 'This refund was already recorded.', 409);
  const invoice = copy(original), entry = { id: input.id, kind: input.kind === 'void' ? 'void' : input.kind === 'ach_return' ? 'ach_return' : 'refund', amountCents, transactionId: input.transactionId, at: context(ctx).at, reason: text(input.reason) };
  invoice.refunds.push(entry); invoice.refundedCents += amountCents;
  return audit(invoice, entry.kind === 'ach_return' ? 'ach_return_recorded' : 'refund_recorded', { refundedCents: original.refundedCents }, { refundedCents: invoice.refundedCents, entry }, input, ctx);
}
export function recordBillingCredit(original, input, ctx) {
  revision(original, input); fail(!['charging', 'pending', 'void', 'written_off'].includes(original.status), 'Reconcile unsettled processor work before recording a credit.', 409);
  const amountCents = money(input.amountCents), available = original.status === 'paid' ? billingRefundableCents(original) : original.totalCents;
  fail(amountCents > 0 && amountCents <= available && identifier(input.id), 'Use a credit ID and an amount no greater than the remaining invoice balance.');
  fail(!original.credits.some(row => row.id === input.id), 'This credit was already recorded.', 409);
  const invoice = copy(original), entry = { id: input.id, amountCents, at: context(ctx).at, reason: text(input.reason), affectsInvoiceTotal: original.status !== 'paid' };
  invoice.credits.push(entry); invoice.creditedCents += amountCents;
  if (entry.affectsInvoiceTotal) { invoice.lineItems.push(adjustmentLine(`invoice_credit:${input.id}`, 'Office-approved invoice credit', 'credit', -amountCents)); invoice.totalCents -= amountCents; clearApproval(invoice); }
  return audit(invoice, 'credit_recorded', { creditedCents: original.creditedCents, totalCents: original.totalCents, status: original.status }, { creditedCents: invoice.creditedCents, totalCents: invoice.totalCents, status: invoice.status, entry }, input, ctx);
}
export function recordBillingAchReturn(original, input, ctx) {
  const code = safeCode(input.achReturnCode); fail(/^R\d{2}$/.test(code || ''), 'Record the normalized ACH return code.');
  const invoice = recordBillingRefund(original, { ...input, kind: 'ach_return' }, ctx);
  invoice.refunds.at(-1).achReturnCode = code; invoice.returnAction = achReturnAction(code); invoice.achReturnedAt = context(ctx).at;
  return invoice;
}
export function writeOffBillingInvoice(original, input, ctx) {
  revision(original, input); fail(original.status === 'failed' && !original.reconciliationRequired, 'Only a reconciled failed invoice may be written off.', 409);
  const invoice = copy(original); invoice.status = 'written_off'; invoice.writtenOffCents = invoice.totalCents; invoice.retryAt = null;
  return audit(invoice, 'written_off', { status: original.status }, { status: 'written_off', amountCents: invoice.totalCents }, input, ctx);
}
export function billingInvoiceMatchesFilter(invoice, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'held') return invoice.held;
  if (filter === 'below_book') return invoice.belowBook;
  if (filter === 'missing_payment_method') return invoice.totalCents > 0 && !invoice.paymentMethodId;
  if (filter === 'ach' || filter === 'card') return invoice.methodType === filter;
  if (filter === 'first_invoice') return invoice.firstInvoice;
  if (filter === 'credits') return invoice.creditApplications.length > 0;
  return invoice.status === filter;
}
export function billingBatchSummary(invoices) {
  const summary = { count: invoices.length, totalCents: 0, draftCents: 0, approvedCents: 0, paidCents: 0, pendingCents: 0, failedCents: 0, heldCount: 0 };
  for (const invoice of invoices) { summary.totalCents = money(summary.totalCents + invoice.totalCents); if (Object.hasOwn(summary, `${invoice.status}Cents`)) summary[`${invoice.status}Cents`] += invoice.totalCents; if (invoice.held) summary.heldCount++; }
  return summary;
}
