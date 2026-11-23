// Native CRM subscription rules. Provider charging, messaging and authorization
// belong to adapters; this module never performs an external write.
export class SubscriptionError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'SubscriptionError'; this.status = status; }
}
export const TERMINATION_REASONS = Object.freeze(['moved', 'price', 'service_issue', 'seasonal_pause', 'other']);
export const SUBSCRIPTION_FILTERS = Object.freeze(['active', 'past', 'all']);
const fail = (condition, message, status = 400) => { if (!condition) throw new SubscriptionError(message, status); };
const clone = value => structuredClone(value);
const text = (value, label, max = 1000) => { fail(typeof value === 'string' && value.trim() && value.length <= max, `Enter ${label}.`); return value.trim(); };
const cents = (value, label = 'a whole-cent amount', signed = false) => { fail(Number.isSafeInteger(value) && Math.abs(value) <= 100000000 && (signed || value >= 0), `Enter ${label}.`); return value; };
const sum = lines => lines.reduce((total, line) => cents(total + cents(line.totalCents, 'a line amount', true), 'a total', true), 0);
export function subscriptionDate(value) {
  const parsed = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : null;
  fail(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed?.getTime()) && parsed.toISOString().slice(0, 10) === value, 'Choose a valid date.');
  return value;
}
const dayNumber = value => Date.parse(`${subscriptionDate(value)}T00:00:00Z`) / 86400000;
function context(ctx = {}) {
  const actor = text(ctx.actor, 'the change author', 200);
  fail(typeof ctx.at === 'string' && Number.isFinite(Date.parse(ctx.at)), 'A valid audit timestamp is required.');
  const today = subscriptionDate(ctx.today || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ctx.at)));
  return { actor, at: ctx.at, today };
}
function monthAfter(date) {
  const [year, month, day] = date.split('-').map(Number);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}
function billingPeriodFor(sub, date) {
  const invoice = sub.invoices.find(item => item.periodStart <= date && date < item.periodEnd);
  return invoice ? { periodStart: invoice.periodStart, periodEnd: invoice.periodEnd } : { periodStart: sub.billingPeriodStart, periodEnd: sub.billingPeriodEnd };
}
function assertRevision(sub, input) {
  fail(sub && input.expectedRevision === sub.revision, 'The subscription changed. Refresh before applying this change.', 409);
}
function audit(sub, action, oldValue, newValue, reason, ctx) {
  const actor = context(ctx);
  sub.revision += 1;
  sub.audit.push({ id: `${sub.id}:audit:${sub.revision}`, action, actor: actor.actor, at: actor.at, oldValue: clone(oldValue), newValue: clone(newValue), reason: text(reason, 'the change reason') });
  sub.updatedAt = actor.at;
  return sub;
}
function line(id, label, kind, quantity, unitCents, itemized = true) {
  fail(Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1000, 'Choose a bounded whole quantity.');
  cents(unitCents, 'a unit price in cents', true);
  return { id, label: text(label, 'a line label', 200), kind, quantity, unitCents, totalCents: cents(quantity * unitCents, 'a line total', true), itemized: itemized !== false };
}
const visible = (selection, id, fallback = true) => Object.hasOwn(selection.lineVisibility || {}, id) ? selection.lineVisibility[id] !== false : fallback;

export function validatePriceBook(book) {
  fail(book && typeof book === 'object' && !Array.isArray(book), 'Provide a price book.');
  text(book.id, 'a book ID', 100); fail(Number.isSafeInteger(book.version) && book.version >= 1, 'Provide a positive book version.');
  subscriptionDate(book.effectiveDate); fail(!book.currency || book.currency === 'USD', 'Only USD is supported.');
  for (const collection of ['plans', 'zones', 'yardTiers', 'addons']) fail(Array.isArray(book[collection]) && book[collection].length <= 500, `Provide bounded ${collection}.`);
  for (const collection of ['plans', 'zones', 'yardTiers', 'addons']) {
    const ids = book[collection].map(item => text(item.id, `${collection} ID`, 100));
    fail(new Set(ids).size === ids.length, `Duplicate ${collection} IDs are not allowed.`);
  }
  const zips = new Set();
  for (const zone of book.zones) {
    fail(Array.isArray(zone.zips) && zone.zips.length <= 1000, 'Provide zone ZIP codes.');
    for (const zip of zone.zips) { fail(/^\d{5}$/.test(zip) && !zips.has(zip), 'A ZIP must belong to exactly one pricing zone.'); zips.add(zip); }
  }
  for (const tier of book.yardTiers) { text(tier.label, 'a yard-tier label', 200); cents(tier.upchargeCents); }
  for (const addon of book.addons) { text(addon.label, 'an add-on label', 200); cents(addon.unitCents); fail((!addon.billingInterval || addon.billingInterval === 'monthly') && (!addon.billingCadence || ['monthly', 'per_treatment'].includes(addon.billingCadence)), 'Subscription add-ons need an explicit monthly rate or treatment quantity per monthly period.'); }
  for (const plan of book.plans) {
    text(plan.label, 'a plan label', 200); fail(Array.isArray(plan.rates) && plan.rates.length <= 5000, 'Provide bounded plan rates.');
    const rateKeys = new Set();
    for (const rate of plan.rates) {
      text(rate.frequency, 'a service frequency', 50); fail(Number.isSafeInteger(rate.dogCount) && rate.dogCount >= 0 && rate.dogCount <= 99, 'Provide a valid dog count.');
      fail(book.zones.some(zone => zone.id === rate.zoneId), 'A rate must reference a pricing zone.');
      cents(rate.baseCents); cents(rate.extraDogsCents ?? 0);
      const key = `${rate.frequency}:${rate.dogCount}:${rate.zoneId}`; fail(!rateKeys.has(key), 'Duplicate plan rates are not allowed.'); rateKeys.add(key);
    }
  }
  return clone(book);
}

export function quoteSubscription(book, rawSelection) {
  validatePriceBook(book);
  const selection = clone(rawSelection || {});
  const plan = book.plans.find(item => item.id === selection.planId), zone = book.zones.find(item => item.zips.includes(selection.zip));
  fail(plan && zone, 'Choose a plan and a ZIP in the approved pricing area.');
  const rate = plan.rates.find(item => item.frequency === selection.frequency && item.dogCount === selection.dogCount && item.zoneId === zone.id);
  fail(rate, 'This plan, frequency, dog count and zone require an approved quote.');
  const tier = book.yardTiers.find(item => item.id === selection.yardTierId);
  fail(tier, 'Choose an approved yard-size tier.');
  fail(!selection.lineVisibility || typeof selection.lineVisibility === 'object' && !Array.isArray(selection.lineVisibility) && Object.values(selection.lineVisibility).every(item => typeof item === 'boolean'), 'Choose itemized or rolled pricing for each line.');
  const lines = [line('base', plan.label, 'base_plan', 1, rate.baseCents, true)];
  if (rate.extraDogsCents) lines.push(line('extra_dogs', 'Extra dogs', 'extra_dogs', 1, rate.extraDogsCents, visible(selection, 'extra_dogs')));
  if (tier.upchargeCents) lines.push(line('yard', tier.label, 'yard_size', 1, tier.upchargeCents, visible(selection, 'yard')));
  fail(Array.isArray(selection.addons || []) && (selection.addons || []).length <= 50, 'Choose bounded add-ons.');
  const addonIds = new Set();
  for (const item of selection.addons || []) {
    const addon = book.addons.find(option => option.id === item.id); fail(addon && !addonIds.has(item.id), 'Choose each approved add-on once.'); addonIds.add(item.id);
    if (addon.billingCadence === 'per_treatment') fail(Number.isSafeInteger(item.quantity) && item.quantity > 0, 'Treatment add-ons need an explicit quantity per monthly billing period.');
    lines.push({ ...line(`addon:${addon.id}`, addon.label, 'addon', item.quantity ?? 1, addon.unitCents, visible(selection, `addon:${addon.id}`)), billingCadence: addon.billingCadence || 'monthly' });
  }
  const bookRateCents = sum(lines), discounts = selection.discounts || [];
  fail(Array.isArray(discounts) && discounts.length <= 20, 'Choose bounded discount lines.');
  const discountIds = new Set();
  for (const discount of discounts) {
    text(discount.id, 'a discount ID', 100); fail(!discountIds.has(discount.id), 'Use unique discount lines.'); discountIds.add(discount.id);
    text(discount.reason, 'the discount reason');
    lines.push(line(`discount:${discount.id}`, discount.label, 'discount', 1, -cents(discount.amountCents), visible(selection, `discount:${discount.id}`, discount.itemized)));
  }
  const totalCents = sum(lines); fail(totalCents >= 0, 'Discounts cannot make the subscription total negative.');
  return { bookId: book.id, bookVersion: book.version, currency: 'USD', billingInterval: 'monthly', selection, lineItems: lines, totalCents, bookRateCents, zoneId: zone.id };
}
function versionFor(sub, date) {
  return sub.versions.filter(item => item.effectiveDate <= date && !item.cancelledAt).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence).at(-1) || null;
}
function rateVersion(subId, sequence, input, book, ctx) {
  const effectiveDate = subscriptionDate(input.effectiveDate), at = context(ctx);
  fail(book.effectiveDate <= effectiveDate, 'The price book is not effective on that date.');
  const quote = quoteSubscription(book, input.selection), rateSource = input.rateSource || 'preset';
  fail(['preset', 'manual'].includes(rateSource), 'Choose preset or manual pricing.');
  let manualRateCents = null, manualReason = null;
  if (rateSource === 'manual') {
    manualRateCents = cents(input.manualRateCents); manualReason = text(input.manualReason, 'the manual-rate reason');
    const adjustment = manualRateCents - quote.totalCents;
    if (adjustment) quote.lineItems.push(line('manual_adjustment', 'Manual rate adjustment', 'manual_adjustment', 1, adjustment, visible(input.selection, 'manual_adjustment')));
    quote.totalCents = manualRateCents;
  }
  const noticeReminderDate = input.noticeReminderDate ? subscriptionDate(input.noticeReminderDate) : effectiveDate > at.today ? at.today : null;
  fail(!noticeReminderDate || noticeReminderDate <= effectiveDate, 'The customer notice reminder must be on or before the change.');
  return { ...quote, id: `${subId}:version:${sequence}`, sequence, effectiveDate, rateSource, manualRateCents, manualReason,
    reason: input.reason || 'Subscription created', createdAt: at.at, createdBy: at.actor, noticeReminderDate,
    noticeStatus: noticeReminderDate ? 'pending' : 'not_required', activatedAt: effectiveDate <= at.today ? at.at : null };
}

export function createSubscription(input, book, ctx) {
  const at = context(ctx), id = text(input.id, 'a subscription ID', 100), customerId = text(input.customerId, 'a customer ID', 100);
  const startDate = subscriptionDate(input.startDate || at.today), billingPeriodStart = subscriptionDate(input.billingPeriodStart || startDate), billingPeriodEnd = subscriptionDate(input.billingPeriodEnd || monthAfter(billingPeriodStart));
  fail(billingPeriodEnd > billingPeriodStart, 'The billing period must end after it starts.');
  const version = rateVersion(id, 1, { ...input, effectiveDate: startDate }, book, ctx);
  const sub = { schemaVersion: 1, id, customerId, startDate, endDate: null, endKind: null, terminationReason: null, terminationNote: null,
    billingPeriodStart, billingPeriodEnd, revision: 0, versions: [version], pauses: [], skips: [], credits: [], invoices: [], audit: [], createdAt: at.at, updatedAt: at.at };
  return audit(sub, 'created', null, { selection: version.selection, totalCents: version.totalCents, rateSource: version.rateSource, bookRateCents: version.bookRateCents, manualRateCents: version.manualRateCents }, input.reason || 'Subscription created', ctx);
}

export function amendSubscription(original, input, book, ctx) {
  assertRevision(original, input); const at = context(ctx), sub = clone(original), effectiveDate = subscriptionDate(input.effectiveDate || at.today);
  fail(!sub.endDate || effectiveDate < sub.endDate, 'A past or terminated subscription cannot be amended.');
  fail(effectiveDate >= at.today && effectiveDate >= sub.startDate, 'Amendments cannot rewrite an earlier effective date.');
  const prior = versionFor(sub, effectiveDate) || sub.versions[0], selection = { ...clone(prior.selection), ...clone(input.selection || {}) };
  const reason = text(input.reason, 'the amendment reason'), next = rateVersion(sub.id, sub.versions.length + 1, { ...input, effectiveDate, selection, reason }, book, ctx);
  sub.versions.push(next);
  return audit(sub, effectiveDate > at.today ? 'change_scheduled' : 'amended', { versionId: prior.id, selection: prior.selection, lineItems: prior.lineItems, totalCents: prior.totalCents, rateSource: prior.rateSource, bookRateCents: prior.bookRateCents, manualRateCents: prior.manualRateCents, manualReason: prior.manualReason }, { versionId: next.id, selection: next.selection, lineItems: next.lineItems, totalCents: next.totalCents, rateSource: next.rateSource, effectiveDate, bookRateCents: next.bookRateCents, manualRateCents: next.manualRateCents, manualReason: next.manualReason }, reason, ctx);
}
export function cancelSubscription(original, input, ctx) {
  assertRevision(original, input); const sub = clone(original), at = context(ctx), endDate = subscriptionDate(input.endDate || at.today);
  fail(!sub.endDate, 'This subscription already has an end date.');
  fail(endDate >= sub.startDate && endDate >= at.today, 'Cancellation cannot rewrite a prior service date.');
  fail(TERMINATION_REASONS.includes(input.terminationReason), 'Choose a termination reason.');
  const note = input.terminationReason === 'other' ? text(input.terminationNote, 'a note for the other termination reason') : typeof input.terminationNote === 'string' ? input.terminationNote.trim().slice(0, 1000) : '';
  Object.assign(sub, { endDate, endKind: 'cancelled', terminationReason: input.terminationReason, terminationNote: note });
  for (const version of sub.versions) if (version.effectiveDate >= endDate && version.effectiveDate > at.today) version.cancelledAt = at.at;
  return audit(sub, 'cancelled', { endDate: null }, { endDate, terminationReason: input.terminationReason, terminationNote: note }, input.reason || `Cancellation: ${input.terminationReason}`, ctx);
}
export function endSubscription(original, input, ctx) {
  assertRevision(original, input); const sub = clone(original), endDate = subscriptionDate(input.endDate || context(ctx).today);
  fail(!sub.endDate && endDate >= sub.startDate, 'Choose a valid end date for an open subscription.');
  Object.assign(sub, { endDate, endKind: 'ended' });
  for (const version of sub.versions) if (version.effectiveDate >= endDate) version.cancelledAt = context(ctx).at;
  return audit(sub, 'ended', { endDate: null }, { endDate }, input.reason || 'Agreement ended', ctx);
}
function suspension(original, input, ctx, kind) {
  assertRevision(original, input); const sub = clone(original), at = context(ctx), startDate = subscriptionDate(input.startDate || at.today), resumeDate = subscriptionDate(input.resumeDate);
  fail(startDate >= at.today && resumeDate > startDate && (!sub.endDate || startDate < sub.endDate), 'Choose a future resume date after the pause/skip begins.');
  const rows = kind === 'pause' ? sub.pauses : sub.skips;
  fail(![...sub.pauses, ...sub.skips].some(row => row.startDate < resumeDate && startDate < row.resumeDate), 'Pause and skip windows cannot overlap.');
  const entry = { id: `${sub.id}:${kind}:${rows.length + 1}`, kind, startDate, resumeDate, reason: text(input.reason, `the ${kind} reason`), resumedAt: null };
  rows.push(entry); return audit(sub, kind === 'pause' ? 'paused' : 'skipped', null, entry, entry.reason, ctx);
}
export const pauseSubscription = (sub, input, ctx) => suspension(sub, input, ctx, 'pause');
export const skipSubscription = (sub, input, ctx) => suspension(sub, input, ctx, 'skip');
export function resumeSubscription(original, input, ctx) {
  assertRevision(original, input); const sub = clone(original), at = context(ctx), resumeDate = subscriptionDate(input.resumeDate || at.today);
  fail(!sub.endDate || resumeDate < sub.endDate, 'An ended subscription cannot be resumed.');
  const row = [...sub.pauses, ...sub.skips].find(item => (!input.suspensionId || item.id === input.suspensionId) && item.startDate <= resumeDate && resumeDate <= item.resumeDate && !item.resumedAt);
  fail(row && resumeDate >= at.today, 'Choose an active pause or skip to resume.');
  const oldValue = clone(row); row.resumeDate = resumeDate; row.resumedAt = resumeDate <= at.today ? at.at : null;
  return audit(sub, 'resumed', oldValue, row, text(input.reason, 'the resume reason'), ctx);
}

export function promiseSubscriptionCredit(original, input, ctx) {
  assertRevision(original, input); const sub = clone(original), at = context(ctx), amountCents = cents(input.amountCents);
  fail(amountCents > 0, 'A promised credit must be positive.');
  const credit = { id: input.id || `${sub.id}:credit:${sub.credits.length + 1}`, amountCents, remainingCents: amountCents, reason: text(input.reason, 'the credit reason'), promisedAt: at.at, promisedBy: at.actor, applications: [] };
  fail(!sub.credits.some(row => row.id === credit.id), 'This credit reference already exists.', 409);
  sub.credits.push(credit); return audit(sub, 'credit_promised', null, credit, credit.reason, ctx);
}
function statusAt(sub, date) {
  if (sub.endDate && sub.endDate <= date) return sub.endKind || 'ended';
  if (date < sub.startDate) return 'scheduled';
  if (sub.pauses.some(row => row.startDate <= date && date < row.resumeDate)) return 'paused';
  if (sub.skips.some(row => row.startDate <= date && date < row.resumeDate)) return 'skipped';
  return 'active';
}
export function filterSubscriptions(subscriptions, filter = 'active', date) {
  subscriptionDate(date); fail(SUBSCRIPTION_FILTERS.includes(filter), 'Choose Active, Past or All.');
  return subscriptions.filter(sub => filter === 'all' || (filter === 'past') === ['cancelled', 'ended'].includes(statusAt(sub, date)));
}

export function customerPricing(document) {
  const source = document.lineItems || document.currentLines || [], originalTotal = cents(document.totalCents);
  fail(Array.isArray(source) && source.length <= 200, 'Provide bounded pricing lines.');
  fail(sum(source) === originalTotal, 'Itemized pricing must equal the document total exactly.');
  const rolled = source.filter(item => item.itemized === false).reduce((n, item) => n + item.totalCents, 0);
  const lines = source.filter(item => item.itemized !== false).map(item => line(item.id, item.label, item.kind, item.quantity ?? 1, item.unitCents ?? item.totalCents, true));
  let base = lines.find(item => item.kind === 'base_plan');
  if (rolled || !lines.length) {
    if (!base) { base = line('base', 'Service plan including adjustments', 'base_plan', 1, 0); lines.unshift(base); }
    base.totalCents += rolled; base.unitCents = base.totalCents; base.quantity = 1;
  }
  fail(sum(lines) === originalTotal, 'Customer pricing must equal the document total exactly.');
  return { lineItems: lines, totalCents: originalTotal, currency: 'USD', billingInterval: 'monthly' };
}

export function subscriptionView(sub, { date, book, customer = false } = {}) {
  subscriptionDate(date); const status = statusAt(sub, date);
  const finalDate = sub.endDate ? new Date((dayNumber(sub.endDate) - 1) * 86400000).toISOString().slice(0, 10) : date;
  const pricingDate = sub.endDate && sub.endDate <= date ? finalDate : date;
  const version = versionFor(sub, pricingDate) || sub.versions[0];
  const period = billingPeriodFor(sub, pricingDate);
  let currentBookRateCents = null;
  if (book && book.effectiveDate <= date) try { currentBookRateCents = quoteSubscription(book, { ...version.selection, discounts: [] }).bookRateCents; } catch { /* Unavailable combinations stay explicit rather than becoming a guessed rate. */ }
  const ordered = [...sub.versions].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sequence - b.sequence);
  const versions = ordered.map((item, index) => {
    const priorLines = ordered[index - 1]?.lineItems || [], lineIds = [...new Set([...priorLines.map(row => row.id), ...item.lineItems.map(row => row.id)])];
    const nextDate = ordered[index + 1]?.effectiveDate || null;
    return { ...clone(item), endDate: item.cancelledAt ? item.effectiveDate : nextDate && sub.endDate ? (nextDate < sub.endDate ? nextDate : sub.endDate) : nextDate || sub.endDate || null,
      changes: lineIds.map(id => { const prior = priorLines.find(row => row.id === id), next = item.lineItems.find(row => row.id === id); return { lineId: id, label: next?.label || prior.label, oldCents: prior?.totalCents ?? null, newCents: next?.totalCents ?? 0 }; }).filter(change => change.oldCents !== change.newCents) };
  });
  const view = { id: sub.id, customerId: sub.customerId, revision: sub.revision, status, ...clone(version.selection), startDate: sub.startDate, endDate: sub.endDate,
    terminationReason: sub.terminationReason, terminationNote: sub.terminationNote, billingPeriodStart: period.periodStart, billingPeriodEnd: period.periodEnd,
    currentLines: clone(version.lineItems), totalCents: version.totalCents, finalPriceCents: versionFor(sub, finalDate)?.totalCents ?? version.totalCents,
    rateSource: version.rateSource, bookRateCents: version.bookRateCents, manualRateCents: version.manualRateCents, manualReason: version.manualReason,
    currentBookRateCents, belowBook: currentBookRateCents !== null && version.totalCents < currentBookRateCents,
    versions, scheduledChanges: versions.filter(item => item.effectiveDate > date && !item.cancelledAt), pauses: clone(sub.pauses), skips: clone(sub.skips), credits: clone(sub.credits), audit: clone(sub.audit),
    invoices: clone(sub.invoices), currency: 'USD', billingInterval: 'monthly' };
  if (!customer) return view;
  const pricing = customerPricing(view);
  return { id: view.id, status, planId: view.planId, frequency: view.frequency, dogCount: view.dogCount, startDate: view.startDate, endDate: view.endDate,
    terminationReason: view.terminationReason, finalPriceCents: view.finalPriceCents,
    billingPeriodStart: view.billingPeriodStart, billingPeriodEnd: view.billingPeriodEnd, ...pricing,
    versions: versions.map(item => ({ id: item.id, effectiveDate: item.effectiveDate, frequency: item.selection.frequency, dogCount: item.selection.dogCount, ...customerPricing(item) })),
    scheduledChanges: view.scheduledChanges.map(item => ({ id: item.id, effectiveDate: item.effectiveDate, frequency: item.selection.frequency, dogCount: item.selection.dogCount, ...customerPricing(item) })),
    pauses: sub.pauses.map(({ startDate, resumeDate }) => ({ startDate, resumeDate })), skips: sub.skips.map(({ startDate, resumeDate }) => ({ startDate, resumeDate })),
    credits: sub.credits.map(({ amountCents, remainingCents }) => ({ amountCents, remainingCents })) };
}
export function customerSubscriptionHistory(subscriptions, customerId, options) {
  return subscriptions.filter(sub => sub.customerId === customerId).map(sub => subscriptionView(sub, { ...options, customer: true }));
}

export function previewProration(sub, nextQuote, effectiveDate, { resumeDate = null } = {}) {
  subscriptionDate(effectiveDate); const period = billingPeriodFor(sub, effectiveDate);
  const periodStart = subscriptionDate(period.periodStart), periodEnd = subscriptionDate(period.periodEnd);
  fail(periodEnd > periodStart && effectiveDate >= periodStart, 'Choose a change date on or after the billing period starts.');
  const old = versionFor(sub, effectiveDate) || sub.versions[0], totalDays = dayNumber(periodEnd) - dayNumber(periodStart), remainingDays = Math.max(0, dayNumber(periodEnd) - dayNumber(effectiveDate));
  if (resumeDate) { subscriptionDate(resumeDate); fail(resumeDate > effectiveDate, 'The resume date must follow the pause/skip start.'); }
  const affectedDays = resumeDate ? Math.max(0, Math.min(dayNumber(periodEnd), dayNumber(resumeDate)) - dayNumber(effectiveDate)) : remainingDays;
  const delta = cents(nextQuote.totalCents) - old.totalCents, absolute = Math.abs(delta) * affectedDays;
  const rounded = Math.floor((absolute + totalDays / 2) / totalDays);
  return { periodStart, periodEnd, effectiveDate, resumeDate, totalDays, remainingDays, affectedDays, oldTotalCents: old.totalCents, newTotalCents: nextQuote.totalCents,
    adjustmentCents: Math.sign(delta) * rounded, futurePeriod: effectiveDate >= periodEnd, policy: 'daily_actual_days', previewOnly: true };
}

export function previewSubscriptionChangeProration(original, proposed, effectiveDate, { date = effectiveDate } = {}) {
  subscriptionDate(effectiveDate); subscriptionDate(date);
  const period = billingPeriodFor(original, date), periodStart = subscriptionDate(period.periodStart), periodEnd = subscriptionDate(period.periodEnd);
  fail(periodEnd > periodStart, 'The billing period must end after it starts.');
  const totalDays = dayNumber(periodEnd) - dayNumber(periodStart), comparisonStart = effectiveDate > periodStart ? effectiveDate : periodStart;
  const remainingDays = Math.max(0, dayNumber(periodEnd) - dayNumber(comparisonStart));
  const boundaries = new Set([periodStart, periodEnd]);
  for (const sub of [original, proposed]) {
    for (const boundary of [sub.startDate, sub.endDate, effectiveDate, ...sub.versions.map(item => item.effectiveDate), ...[...sub.pauses, ...sub.skips].flatMap(item => [item.startDate, item.resumeDate])]) {
      if (boundary && periodStart < boundary && boundary < periodEnd) boundaries.add(boundary);
    }
  }
  const ordered = [...boundaries].sort(), segments = []; let weighted = 0n, affectedDays = 0;
  const cost = (sub, onDate) => statusAt(sub, onDate) === 'active' ? versionFor(sub, onDate)?.totalCents || 0 : 0;
  for (let index = 0; index < ordered.length - 1; index++) {
    const startDate = ordered[index], endDate = ordered[index + 1];
    if (startDate < comparisonStart) continue;
    const days = dayNumber(endDate) - dayNumber(startDate), oldMonthlyCents = cost(original, startDate), newMonthlyCents = cost(proposed, startDate);
    weighted += BigInt(newMonthlyCents - oldMonthlyCents) * BigInt(days);
    if (oldMonthlyCents !== newMonthlyCents) affectedDays += days;
    segments.push({ startDate, endDate, days, oldMonthlyCents, newMonthlyCents, oldStatus: statusAt(original, startDate), newStatus: statusAt(proposed, startDate) });
  }
  const magnitude = weighted < 0n ? -weighted : weighted;
  const rounded = Number((magnitude + BigInt(Math.floor(totalDays / 2))) / BigInt(totalDays));
  return { periodStart, periodEnd, effectiveDate, totalDays, remainingDays, affectedDays, oldTotalCents: cost(original, comparisonStart), newTotalCents: cost(proposed, comparisonStart),
    adjustmentCents: weighted < 0n ? -rounded : rounded, futurePeriod: effectiveDate >= periodEnd, policy: 'daily_actual_days_segmented', previewOnly: true, segments };
}

export function issueSubscriptionInvoice(original, input, ctx) {
  assertRevision(original, input); const sub = clone(original), at = context(ctx), id = text(input.id, 'an invoice ID', 100);
  const existing = sub.invoices.find(item => item.id === id); fail(!existing, 'This invoice reference already exists.', 409);
  const latestInvoice = [...sub.invoices].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);
  const periodStart = subscriptionDate(input.periodStart || latestInvoice?.periodEnd || sub.billingPeriodStart), periodEnd = subscriptionDate(input.periodEnd || (latestInvoice || input.periodStart ? monthAfter(periodStart) : sub.billingPeriodEnd));
  fail(periodEnd > periodStart, 'The invoice period must end after it starts.');
  fail(!sub.invoices.some(item => item.periodStart < periodEnd && periodStart < item.periodEnd), 'An invoice already covers this billing period.', 409);
  fail(statusAt(sub, periodStart) === 'active', 'A paused, skipped, scheduled or ended subscription cannot generate an automatic invoice.');
  const version = versionFor(sub, periodStart); fail(version, 'No price version is effective for this invoice.');
  // Mid-period amendments or suspension boundaries need a deliberate proration
  // decision. Never silently charge an entire period at the wrong version.
  fail(!sub.versions.some(item => item.effectiveDate > periodStart && item.effectiveDate < periodEnd)
    && ![...sub.pauses, ...sub.skips].some(item => item.startDate > periodStart && item.startDate < periodEnd || item.resumeDate > periodStart && item.resumeDate < periodEnd)
    && (!sub.endDate || sub.endDate >= periodEnd), 'This period contains a change. Review the proration preview before invoicing.', 409);
  const lineItems = clone(version.lineItems), creditApplications = [];
  let remaining = version.totalCents;
  for (const credit of sub.credits) {
    if (!credit.remainingCents || !remaining || credit.promisedAt > at.at) continue;
    const amountCents = Math.min(credit.remainingCents, remaining); credit.remainingCents -= amountCents; remaining -= amountCents;
    credit.applications.push({ invoiceId: id, amountCents, at: at.at }); creditApplications.push({ creditId: credit.id, amountCents });
    lineItems.push(line(`credit:${credit.id}`, 'Promised service credit', 'credit', 1, -amountCents, visible(version.selection, `credit:${credit.id}`)));
  }
  const invoice = { id, subscriptionId: sub.id, customerId: sub.customerId, periodStart, periodEnd, versionId: version.id, lineItems,
    totalCents: sum(lineItems), subtotalCents: version.totalCents, creditApplications, currency: 'USD', billingInterval: 'monthly', status: 'draft', createdAt: at.at };
  customerPricing(invoice); sub.invoices.push(invoice);
  if (periodStart <= at.today && at.today < periodEnd) { sub.billingPeriodStart = periodStart; sub.billingPeriodEnd = periodEnd; }
  audit(sub, 'invoice_drafted', { billingPeriodStart: original.billingPeriodStart, billingPeriodEnd: original.billingPeriodEnd }, { invoiceId: id, totalCents: invoice.totalCents, creditApplications, billingPeriodStart: sub.billingPeriodStart, billingPeriodEnd: sub.billingPeriodEnd }, input.reason || 'Next invoice draft; no external charge', ctx);
  return { subscription: sub, invoice };
}

export function advanceSubscription(original, ctx) {
  const at = context(ctx), sub = clone(original), changes = [];
  const period = billingPeriodFor(sub, at.today);
  if (period.periodStart !== sub.billingPeriodStart || period.periodEnd !== sub.billingPeriodEnd) {
    changes.push({ type: 'billing_period_current', oldValue: { periodStart: sub.billingPeriodStart, periodEnd: sub.billingPeriodEnd }, newValue: period });
    sub.billingPeriodStart = period.periodStart; sub.billingPeriodEnd = period.periodEnd;
  }
  for (const version of sub.versions) {
    if (version.cancelledAt) continue;
    if (!version.activatedAt && version.effectiveDate <= at.today) { version.activatedAt = at.at; changes.push({ type: 'change_effective', versionId: version.id, effectiveDate: version.effectiveDate }); }
    if (version.noticeStatus === 'pending' && version.noticeReminderDate <= at.today && !version.noticeReminderRaisedAt) { version.noticeReminderRaisedAt = at.at; changes.push({ type: 'customer_notice_due', versionId: version.id, effectiveDate: version.effectiveDate }); }
  }
  for (const row of [...sub.pauses, ...sub.skips]) if (!row.resumedAt && row.resumeDate <= at.today && (!sub.endDate || row.resumeDate < sub.endDate)) { row.resumedAt = at.at; changes.push({ type: 'automatically_resumed', suspensionId: row.id, resumeDate: row.resumeDate }); }
  if (!changes.length) return sub;
  return audit(sub, 'scheduled_progress', null, { changes }, 'Effective-date and resume-date processing; no customer message sent', ctx);
}
export function acknowledgeSubscriptionNotice(original, input, ctx) {
  assertRevision(original, input); const sub = clone(original), version = sub.versions.find(item => item.id === input.versionId);
  fail(version && version.noticeStatus === 'pending', 'Choose a pending customer notice reminder.');
  fail(input.customerNotified === true, 'Confirm the customer notice was handled.');
  version.noticeStatus = 'acknowledged'; version.noticeAcknowledgedAt = context(ctx).at;
  return audit(sub, 'notice_acknowledged', { noticeStatus: 'pending' }, { versionId: version.id, noticeStatus: version.noticeStatus }, text(input.reason, 'the notice evidence'), ctx);
}

export function previewBulkReprice(subscriptions, book, input) {
  validatePriceBook(book); const effectiveDate = subscriptionDate(input.effectiveDate), ids = input.subscriptionIds || subscriptions.map(sub => sub.id);
  fail(book.effectiveDate <= effectiveDate, 'The price book is not effective on the selected repricing date.');
  fail(Array.isArray(ids) && ids.length <= 1000 && new Set(ids).size === ids.length, 'Choose a bounded unique subscription list.');
  const rows = ids.map(id => {
    const sub = subscriptions.find(item => item.id === id); fail(sub, 'A selected subscription was not found.', 404);
    fail(!sub.endDate || effectiveDate < sub.endDate, 'Past subscriptions cannot be bulk repriced.');
    const current = versionFor(sub, effectiveDate) || sub.versions[0], quote = quoteSubscription(book, { ...current.selection, discounts: [] });
    return { subscriptionId: sub.id, customerId: sub.customerId, expectedRevision: sub.revision, oldTotalCents: current.totalCents, newTotalCents: quote.totalCents,
      deltaCents: quote.totalCents - current.totalCents, selection: quote.selection, quote };
  });
  return { bookId: book.id, bookVersion: book.version, effectiveDate, reason: text(input.reason || 'Office-approved bulk repricing preview', 'the bulk repricing reason'), rows, previewOnly: true };
}
export function applyBulkReprice(subscriptions, preview, book, ctx) {
  fail(preview && preview.bookId === book.id && preview.bookVersion === book.version, 'The price book changed. Refresh the bulk preview.', 409);
  fail(preview.effectiveDate >= context(ctx).today, 'Bulk repricing cannot rewrite prior dates.');
  const checked = previewBulkReprice(subscriptions, book, { effectiveDate: preview.effectiveDate, subscriptionIds: preview.rows.map(item => item.subscriptionId), reason: preview.reason });
  fail(JSON.stringify(checked) === JSON.stringify(preview), 'Subscription or price-book details changed. Refresh the bulk preview.', 409);
  return subscriptions.map(sub => {
    const row = preview.rows.find(item => item.subscriptionId === sub.id); if (!row) return clone(sub);
    return amendSubscription(sub, { expectedRevision: row.expectedRevision, effectiveDate: preview.effectiveDate, selection: row.selection, rateSource: 'preset', reason: preview.reason }, book, ctx);
  });
}

export function subscriptionReport(subscriptions, book, date) {
  subscriptionDate(date); const byPlan = new Map(), byAddon = new Map(), manualOverrides = [], belowBook = [], noticeReminders = [], cancellations = new Map(); let activeMrrCents = 0;
  for (const sub of subscriptions) {
    const view = subscriptionView(sub, { date, book });
    for (const version of sub.versions) if (!version.cancelledAt && version.noticeStatus === 'pending' && version.noticeReminderDate <= date) noticeReminders.push({ subscriptionId: sub.id, customerId: sub.customerId, versionId: version.id, dueDate: version.noticeReminderDate, effectiveDate: version.effectiveDate, raised: Boolean(version.noticeReminderRaisedAt) });
    if (sub.endKind === 'cancelled' && sub.endDate <= date) cancellations.set(sub.terminationReason, (cancellations.get(sub.terminationReason) || 0) + 1);
    if (['active', 'paused', 'skipped'].includes(view.status)) {
      const row = { subscriptionId: sub.id, customerId: sub.customerId, bookRateCents: view.currentBookRateCents, manualRateCents: view.manualRateCents, currentRateCents: view.totalCents, driftCents: view.currentBookRateCents === null ? null : view.totalCents - view.currentBookRateCents };
      if (view.rateSource === 'manual') manualOverrides.push({ ...row, reason: view.manualReason });
      if (view.belowBook) belowBook.push(row);
    }
    if (view.status !== 'active') continue;
    activeMrrCents += view.totalCents;
    const addonLines = view.currentLines.filter(item => item.kind === 'addon');
    // Allocate recurring discounts/manual adjustments proportionally across the
    // plan and add-ons, with exact cents and a deterministic remainder order.
    const weights = [{ id: 'plan', weight: view.currentLines.filter(item => item.kind !== 'addon' && item.totalCents > 0).reduce((n, item) => n + item.totalCents, 0) }, ...addonLines.map(item => ({ id: item.id, weight: item.totalCents }))];
    const denominator = weights.reduce((n, item) => n + item.weight, 0) || 1;
    const allocated = weights.map(item => { const product = BigInt(view.totalCents) * BigInt(item.weight); return { ...item, amount: Number(product / BigInt(denominator)), remainder: product % BigInt(denominator) }; });
    let remainder = view.totalCents - allocated.reduce((n, item) => n + item.amount, 0);
    const remainderOrder = [...allocated].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
    for (const item of remainderOrder) if (remainder-- > 0) item.amount += 1;
    const plan = byPlan.get(view.planId) || { id: view.planId, label: book.plans.find(item => item.id === view.planId)?.label || view.planId, mrrCents: 0, count: 0 };
    plan.mrrCents += allocated.find(item => item.id === 'plan').amount; plan.count += 1; byPlan.set(view.planId, plan);
    for (const item of addonLines) { const row = byAddon.get(item.id) || { id: item.id, label: item.label, mrrCents: 0, count: 0 }; row.mrrCents += allocated.find(group => group.id === item.id).amount; row.count += 1; byAddon.set(item.id, row); }
  }
  return { asOf: date, activeMrrCents, byPlan: [...byPlan.values()], byAddon: [...byAddon.values()], manualOverrides, belowBook, noticeReminders: noticeReminders.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.versionId.localeCompare(b.versionId)),
    cancellationsByReason: TERMINATION_REASONS.map(reason => ({ reason, count: cancellations.get(reason) || 0 })) };
}
