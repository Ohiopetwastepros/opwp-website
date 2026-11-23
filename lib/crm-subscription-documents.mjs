import { customerPricing } from './crm-subscriptions.mjs';

const titles = Object.freeze({
  quote: 'Subscription quote',
  invoice: 'Subscription invoice',
  confirmation: 'Subscription confirmation',
});
const statuses = Object.freeze({ active: 'Active', paused: 'Paused', skipped: 'Skipped', scheduled: 'Scheduled', cancelled: 'Cancelled', ended: 'Ended' });
const frequencies = Object.freeze({ twice_a_week: 'Twice weekly', once_a_week: 'Weekly', weekly: 'Weekly', every_other_week: 'Every other week', biweekly: 'Every other week', once_a_month: 'Monthly', monthly: 'Monthly', one_time: 'One-time' });
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function subscriptionMoney(cents) {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Subscription amounts must be integer cents.');
  const value = BigInt(cents), absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}$${String(absolute / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(absolute % 100n).padStart(2, '0')}`;
}

function date(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Use a subscription date in YYYY-MM-DD format.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TypeError('Use a valid subscription date.');
  return value;
}

// Quote, invoice and prepared confirmation email share the same customer-facing
// projection. This module never sends a message or contacts a billing provider.
export function renderSubscriptionDocument(kind, document, details = {}) {
  if (!Object.hasOwn(titles, kind)) throw new TypeError('Choose quote, invoice or confirmation.');
  const pricing = customerPricing(document);
  if (pricing.currency !== 'USD' || !Number.isSafeInteger(pricing.totalCents)) throw new TypeError('Use validated USD subscription pricing.');
  let sum = 0n;
  for (const line of pricing.lineItems) {
    if (!Number.isSafeInteger(line.totalCents)) throw new TypeError('Each customer line must use integer cents.');
    sum += BigInt(line.totalCents);
  }
  if (sum !== BigInt(pricing.totalCents)) throw new TypeError('Customer pricing must match the document total exactly.');
  const customerName = typeof details.customerName === 'string' ? details.customerName.trim().slice(0, 200) : '';
  const reference = typeof details.reference === 'string' ? details.reference.trim().slice(0, 160) : '';
  const periodEnd = date(details.billingPeriodEnd ?? document?.billingPeriodEnd ?? document?.periodEnd);
  const finalServiceDay = periodEnd ? new Date(Date.parse(`${periodEnd}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : null;
  const effectiveDate = date(details.effectiveDate ?? document?.effectiveDate);
  const cadence = kind === 'invoice' ? 'Invoice total' : pricing.billingInterval === 'monthly' ? 'Fixed monthly total' : 'Total';
  if (details.status != null && !Object.hasOwn(statuses, details.status)) throw new TypeError('Use a supported subscription status.');
  const credit = details.promisedCreditCents;
  if (credit != null && (!Number.isSafeInteger(credit) || credit <= 0)) throw new TypeError('A promised credit must be a positive amount in whole cents.');
  if (details.frequency != null && (typeof details.frequency !== 'string' || !details.frequency.trim() || details.frequency.length > 80)) throw new TypeError('Use a supported service schedule.');
  if (details.dogCount != null && (!Number.isSafeInteger(details.dogCount) || details.dogCount < 0 || details.dogCount > 99)) throw new TypeError('Use a whole dog count from 0 to 99.');
  const schedule = details.frequency ? frequencies[details.frequency] || details.frequency.replaceAll('_', ' ').replace(/\s+/g, ' ').trim() : null;
  const metadata = [
    ...(customerName ? [`Customer: ${customerName}`] : []),
    ...(reference ? [`Reference: ${reference}`] : []),
    ...(details.status ? [`Subscription status: ${statuses[details.status]}`] : []),
    ...(schedule ? [`Service schedule: ${schedule}`] : []),
    ...(details.dogCount != null ? [`Dogs: ${details.dogCount}`] : []),
    ...(effectiveDate ? [`Effective date: ${effectiveDate}`] : []),
    ...(periodEnd ? [`Billing period ends: ${finalServiceDay}`, `Next billing period starts: ${periodEnd}`] : []),
    ...(credit != null ? [`Promised credit: ${subscriptionMoney(credit)}. Applied to your next invoice.`] : []),
  ];
  const lineText = pricing.lineItems.map(line => `${line.label}: ${subscriptionMoney(line.totalCents)}`);
  const total = subscriptionMoney(pricing.totalCents);
  const text = ['Ohio Pet Waste Pros', titles[kind], ...metadata, '', ...lineText, `${cadence}: ${total}`].join('\n');
  const rows = pricing.lineItems.map(line => `<tr><th scope="row">${escapeHtml(line.label)}</th><td>${escapeHtml(subscriptionMoney(line.totalCents))}</td></tr>`).join('');
  const html = `<section><h1>${escapeHtml(titles[kind])}</h1><p>Ohio Pet Waste Pros</p>${metadata.map(item => `<p>${escapeHtml(item)}</p>`).join('')}<table><thead><tr><th scope="col">Service</th><th scope="col">Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">${cadence}</th><td>${escapeHtml(total)}</td></tr></tfoot></table></section>`;
  return { kind, subject: `Your Ohio Pet Waste Pros ${kind === 'confirmation' ? 'subscription confirmation' : `subscription ${kind}`}`, pricing, totalCents: pricing.totalCents, text, html, preparedOnly: true };
}
