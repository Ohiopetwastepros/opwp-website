import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { defaultCrmPriceBook } from '../lib/crm-price-book.mjs';
import { createSubscription, amendSubscription, pauseSubscription, cancelSubscription, promiseSubscriptionCredit, validatePriceBook, subscriptionDate } from '../lib/crm-subscriptions.mjs';
import { buildMonthlyInvoice, buildNewClientInvoice, approveBillingInvoice, startBillingCharge, recordBillingResult, defaultBillingSettings, billingSubscriptionFingerprintSource } from '../lib/crm-billing.mjs';
import { safePaymentMethod, paymentOrderId } from '../lib/payments-provider.mjs';
import { assertNoPaymentSecrets } from '../lib/crm-billing-security.mjs';
import { localPreviewCustomers, LOCAL_PREVIEW_ACTOR, LOCAL_PREVIEW_SEED_VERSION } from './local-preview-fixtures.mjs';

const ORG = 'org-opwp';
const sqlValue = value => value === null || value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const insert = (table, fields, values) => `INSERT INTO ${table}(${fields.join(',')}) VALUES (${values.map(sqlValue).join(',')});`;
const json = value => JSON.stringify(value);
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const month = date => `${date.slice(0, 7)}-01`;
const shiftMonth = (date, offset) => { const [year, number] = date.split('-').map(Number); return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 10); };
const shiftDay = (date, offset) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const context = date => ({ actor: LOCAL_PREVIEW_ACTOR, at: `${date}T17:00:00.000Z`, today: date });

export async function createLocalPreviewCrmSeed({ today = '2026-11-21' } = {}) {
  subscriptionDate(today);
  const periodStart = month(today), periodEnd = shiftMonth(today, 1), historyStart = shiftMonth(today, -6), amendmentDate = shiftMonth(today, -1), created = context(historyStart), now = context(today);
  const oldBook = defaultCrmPriceBook();
  oldBook.id = 'local-preview-price-book'; oldBook.version = 1; oldBook.effectiveDate = `${Number(historyStart.slice(0, 4)) - 1}-01-01`; oldBook.sourceVersion = `${oldBook.sourceVersion}:local-preview-only`;
  oldBook.plans[0].label = 'Yard Cleanup';
  oldBook.addons.push(
    { id: 'deodorize', label: 'Deodorization', unitCents: 2500, unitLabel: 'treatment', billingCadence: 'per_treatment' },
    { id: 'haul_away', label: 'Waste haul away', unitCents: 2100, unitLabel: 'month', billingCadence: 'monthly' },
    { id: 'kitty_litter', label: 'Kitty litter service - first box', unitCents: 12900, unitLabel: 'month', billingCadence: 'monthly' },
    { id: 'kitty_litter_extra_box', label: 'Kitty litter - extra box', unitCents: 3000, unitLabel: 'extra box / month', billingCadence: 'monthly' },
    { id: 'kitty_litter_changeout', label: 'Kitty litter - change-out', unitCents: 5500, unitLabel: 'change-out', billingCadence: 'per_treatment' },
  );
  const book = structuredClone(oldBook); book.version = 2; book.effectiveDate = amendmentDate; book.addons.find(row => row.id === 'deodorize').unitCents = 5000;
  validatePriceBook(oldBook); validatePriceBook(book);
  const customers = localPreviewCustomers(), subscriptions = [], methods = [], invoices = [], statements = [];
  const settings = defaultBillingSettings({ achDiscountBasisPoints: 100, autoRetryCards: false, cardRetryDays: [1, 3, 7], customerNoticesEnabled: false,
    qboMapping: { reviewed: true, realmId: 'local-fixture-realm', customerMappings: Object.fromEntries(customers.map(row => [row.id, { customerId: `local-qbo-${row.id}` }])),
      itemIds: { base_plan: 'local-item-service', yard_size: 'local-item-yard', extra_dogs: 'local-item-dogs', addon: 'local-item-addon', initial_cleanup: 'local-item-cleanup', manual_adjustment: 'local-item-service' },
      discountAccountId: 'local-discounts', undepositedFundsAccountId: 'local-undeposited', bankAccountId: 'local-bank', feeExpenseAccountId: 'local-fees', feePayableAccountId: 'local-fees-payable',
      creditItemId: 'local-credit-item', refundItemId: 'local-refund-item', voidReturnAccountId: 'local-undeposited', receivablesAccountId: 'local-receivables', returnCashAccountId: 'local-return-clearing', writeoffExpenseAccountId: 'local-bad-debt' } });
  statements.push('-- FABRICATED LOCAL PREVIEW DATA ONLY. No tokens, live records, or provider requests.',
    'CREATE TABLE IF NOT EXISTS local_preview_customers(id TEXT PRIMARY KEY,profile_json TEXT NOT NULL CHECK(json_valid(profile_json)));',
    'CREATE TABLE IF NOT EXISTS local_preview_seed_manifests(id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)));');
  statements.push(insert('crm_subscription_books', ['organization_id', 'version', 'body_json', 'updated_by', 'change_reason', 'updated_at'], [ORG, book.version, json(book), LOCAL_PREVIEW_ACTOR, 'Fabricated local price book; fixed monthly source grid retained; litter prices authorized for this preview only', now.at]));
  statements.push(insert('crm_billing_settings', ['organization_id', 'revision', 'settings_json', 'updated_by', 'reason', 'updated_at'], [ORG, 1, json(settings), LOCAL_PREVIEW_ACTOR, 'Local-only fake payments and fixture accounting; no customer notices', now.at]));
  for (const [index, customer] of customers.entries()) {
    statements.push(insert('crm_subscription_customers', ['id', 'organization_id', 'display_name', 'revision', 'updated_by', 'change_reason', 'created_at', 'updated_at'], [customer.id, ORG, customer.displayName, 1, LOCAL_PREVIEW_ACTOR, 'Fabricated local preview customer', created.at, now.at]));
    statements.push(insert('local_preview_customers', ['id', 'profile_json'], [customer.id, json(customer)]));
    if (customer.scenario !== 'missing_method') {
      const methodType = customer.scenario !== 'past_due' && index % 4 === 2 ? 'ach' : 'card';
      const metadata = safePaymentMethod({ provider: 'fake', processorCustomerId: `local-profile-customer-${index + 1}`, profileId: `fake_local_profile_${index + 1}`, profileAccountId: '1',
        methodType, last4: methodType === 'ach' ? '6789' : '4242', expMonth: methodType === 'card' ? 12 : null, expYear: methodType === 'card' ? Number(today.slice(0, 4)) + 4 : null,
        brand: methodType === 'ach' ? 'ACH' : 'Visa', billingZip: customer.zip, isDefault: true });
      const method = { ...metadata, id: `local-method-${String(index + 1).padStart(2, '0')}`, customerId: customer.id };
      methods.push(method);
      statements.push(insert('crm_billing_methods', ['id', 'customer_id', 'organization_id', 'revision', 'is_default', 'method_json', 'created_at', 'updated_at'], [method.id, customer.id, ORG, 1, 1, json(metadata), created.at, now.at]));
    }
    if (customer.scenario === 'one_time') continue;
    const selection = { planId: 'yard_cleanup', frequency: customer.frequency, dogCount: customer.dogCount, zip: customer.zip, yardTierId: customer.yardTierId,
      addons: customer.addOnIds.map(id => ({ id, quantity: 1 })), lineVisibility: {} };
    const initialSelection = { ...selection, ...(customer.scenario === 'dog_count_amendment' ? { dogCount: 1 } : {}), ...(customer.scenario === 'frequency_amendment' ? { frequency: 'every_other_week' } : {}) };
    const startDate = customer.scenario === 'new_client' ? today : historyStart;
    let sub = createSubscription({ id: customer.subscriptionId, customerId: customer.id, startDate, billingPeriodStart: periodStart, billingPeriodEnd: periodEnd, selection: initialSelection,
      ...(customer.scenario === 'manual_override' ? { rateSource: 'manual', manualRateCents: 13000, manualReason: 'Owner-approved loyalty rate retained for a long-standing customer' } : {}), reason: 'Service agreement approved after property review' }, customer.scenario === 'new_client' ? book : oldBook, context(startDate));
    if (['deodorization_amendment', 'dog_count_amendment', 'frequency_amendment'].includes(customer.scenario)) sub = amendSubscription(sub, { expectedRevision: sub.revision, effectiveDate: amendmentDate, selection,
      reason: customer.scenario === 'deodorization_amendment' ? 'Deodorization increased from $25 to $50 with customer approval' : customer.scenario === 'dog_count_amendment' ? 'Customer added a second dog' : 'Customer requested weekly service instead of biweekly' }, book, context(amendmentDate));
    if (customer.scenario === 'paused') sub = pauseSubscription(sub, { expectedRevision: sub.revision, startDate: periodStart, resumeDate: periodEnd, reason: 'Family away this month; resume automatically next month' }, context(periodStart));
    if (customer.scenario === 'cancelled') sub = cancelSubscription(sub, { expectedRevision: sub.revision, endDate: periodStart, terminationReason: 'moved', reason: 'Customer moved outside the service area' }, context(periodStart));
    if (customer.scenario === 'promised_credit') sub = promiseSubscriptionCredit(sub, { expectedRevision: sub.revision, id: 'local-credit-07', amountCents: 1500, reason: 'Promised credit for a previously missed visit' }, context(shiftMonth(today, -1)));
    subscriptions.push(sub);
    statements.push(insert('crm_subscriptions', ['id', 'organization_id', 'customer_id', 'revision', 'state_json', 'updated_at'], [sub.id, ORG, sub.customerId, sub.revision, json(sub), sub.updatedAt]));
  }
  for (const customer of customers) {
    if (['paused', 'cancelled'].includes(customer.scenario)) continue;
    const sub = subscriptions.find(row => row.customerId === customer.id), method = methods.find(row => row.customerId === customer.id), key = customer.id.slice(-2);
    const credits = (sub?.credits || []).filter(credit => credit.remainingCents).map(credit => ({ id: credit.id, subscriptionId: sub.id, amountCents: credit.remainingCents }));
    let invoice;
    const builderInput = { customerId: customer.id, invoiceType: ['one_time', 'new_client'].includes(customer.scenario) ? 'new_client' : 'monthly', periodStart };
    const input = { id: `local-invoice-${key}`, customerId: customer.id, periodStart, settings, book, paymentMethodId: method?.id || null, methodType: method?.methodType || null, credits, firstInvoice: key === '01', reason: 'Local preview monthly draft; no charge or notice sent' };
    if (customer.scenario === 'one_time') {
      Object.assign(builderInput, { startDate: today, initialCleanupCents: 15500, firstPeriodMode: 'full', includeNextFullMonth: false });
      invoice = buildNewClientInvoice([], { ...input, ...builderInput }, now);
    } else if (customer.scenario === 'new_client') {
      Object.assign(builderInput, { startDate: today, initialCleanupCents: 8500, firstPeriodMode: 'prorated', includeNextFullMonth: true,
        additionalLines: [{ id: 'initial_litter_changeout', label: 'Initial kitty litter change-out', kind: 'addon', quantity: 1, unitCents: 5500, totalCents: 5500, itemized: true }] });
      invoice = buildNewClientInvoice([sub], { ...input, ...builderInput }, now);
    } else invoice = buildMonthlyInvoice([sub], input, now);
    invoice.builderInput = builderInput;
    invoice.sourceRevisions = sub ? [{ subscriptionId: sub.id, revision: sub.revision, billingDigest: hash(billingSubscriptionFingerprintSource(sub)) }] : [];
    if (customer.scenario === 'past_due') {
      const first = context(periodStart);
      invoice = approveBillingInvoice(invoice, { expectedRevision: invoice.revision, paymentMethodId: method.id, methodType: method.methodType, chargeNow: true, reason: 'Fabricated prior approval for the declined local example' }, first);
      invoice = startBillingCharge(invoice, { expectedRevision: invoice.revision, reason: 'Fabricated local charge attempt; no processor called' }, first);
      invoice = recordBillingResult(invoice, { expectedRevision: invoice.revision, attempt: 1, result: { status: 'failed', transactionId: 'fake_local_decline_23', amountCents: invoice.totalCents, processorCode: '51', retryable: true }, reason: 'Fabricated declined payment for past-due review' }, first);
      const attempt = invoice.attempts[0], orderId = await paymentOrderId(attempt.idempotencyKey);
      statements.push(insert('crm_billing_attempts', ['idempotency_key', 'invoice_id', 'attempt', 'method_id', 'provider_order_id', 'amount_cents', 'method_json', 'status', 'result_json', 'created_at', 'updated_at'], [attempt.idempotencyKey, invoice.id, 1, method.id, orderId, invoice.totalCents, json(safePaymentMethod(method)), 'failed', json({ provider: 'fake', status: 'failed', amountCents: invoice.totalCents, transactionId: attempt.transactionId, orderId, processorCode: '51', retryable: true }), first.at, first.at]));
    }
    assertNoPaymentSecrets(invoice); invoices.push(invoice);
    // Insert invoice before its foreign-key-dependent attempt rows.
    const invoiceStatement = insert('crm_billing_invoices', ['id', 'organization_id', 'customer_id', 'invoice_key', 'invoice_type', 'period_start', 'period_end', 'revision', 'status', 'state_json', 'created_at', 'updated_at'], [invoice.id, ORG, invoice.customerId, invoice.idempotencyKey, invoice.invoiceType, invoice.periodStart, invoice.periodEnd, invoice.revision, invoice.status, json(invoice), invoice.createdAt, invoice.updatedAt]);
    if (customer.scenario === 'past_due') statements.splice(statements.length - 1, 0, invoiceStatement); else statements.push(invoiceStatement);
    for (const coverage of invoice.coverage) statements.push(insert('crm_billing_coverage', ['invoice_id', 'subscription_id', 'start_date', 'end_date'], [invoice.id, coverage.subscriptionId, coverage.startDate, coverage.endDate]));
    for (const credit of invoice.creditApplications) statements.push(insert('crm_billing_credit_reservations', ['invoice_id', 'subscription_id', 'credit_id', 'amount_cents', 'available_cents', 'status'], [invoice.id, credit.subscriptionId, credit.creditId, credit.amountCents, credit.amountCents, 'reserved']));
    statements.push(insert('crm_billing_audit', ['id', 'entity_type', 'entity_id', 'action', 'actor', 'occurred_at', 'old_json', 'new_json', 'reason'], [`local-audit-${key}`, 'invoice', invoice.id, 'local_fixture_seeded', LOCAL_PREVIEW_ACTOR, now.at, null, json({ status: invoice.status, totalCents: invoice.totalCents }), 'Fabricated local click-through record; no external effect']));
  }
  // Seed the upcoming review month as actual draft records. Existing consolidated
  // new-client coverage is honored, so December is not invoiced a second time.
  const nextPeriodStart = shiftMonth(today, 1);
  for (const customer of customers) {
    const sub = subscriptions.find(row => row.customerId === customer.id);
    if (!sub || customer.scenario === 'cancelled' || customer.scenario === 'new_client') continue;
    const method = methods.find(row => row.customerId === customer.id), key = `${customer.id.slice(-2)}-${nextPeriodStart.slice(0, 7)}`;
    const invoice = buildMonthlyInvoice([sub], { id: `local-invoice-${key}`, customerId: customer.id, periodStart: nextPeriodStart, settings, book,
      paymentMethodId: method?.id || null, methodType: method?.methodType || null, credits: [],
      existingCoverage: invoices.flatMap(row => row.coverage), reason: 'Upcoming monthly service prepared for office approval' }, now);
    invoice.builderInput = { customerId: customer.id, invoiceType: 'monthly', periodStart: nextPeriodStart };
    invoice.sourceRevisions = [{ subscriptionId: sub.id, revision: sub.revision, billingDigest: hash(billingSubscriptionFingerprintSource(sub)) }];
    assertNoPaymentSecrets(invoice); invoices.push(invoice);
    statements.push(insert('crm_billing_invoices', ['id', 'organization_id', 'customer_id', 'invoice_key', 'invoice_type', 'period_start', 'period_end', 'revision', 'status', 'state_json', 'created_at', 'updated_at'], [invoice.id, ORG, invoice.customerId, invoice.idempotencyKey, invoice.invoiceType, invoice.periodStart, invoice.periodEnd, invoice.revision, invoice.status, json(invoice), invoice.createdAt, invoice.updatedAt]));
    for (const coverage of invoice.coverage) statements.push(insert('crm_billing_coverage', ['invoice_id', 'subscription_id', 'start_date', 'end_date'], [invoice.id, coverage.subscriptionId, coverage.startDate, coverage.endDate]));
    statements.push(insert('crm_billing_audit', ['id', 'entity_type', 'entity_id', 'action', 'actor', 'occurred_at', 'old_json', 'new_json', 'reason'], [`local-audit-${key}`, 'invoice', invoice.id, 'local_fixture_seeded', LOCAL_PREVIEW_ACTOR, now.at, null, json({ status: invoice.status, totalCents: invoice.totalCents }), 'Upcoming draft prepared for review; no external effect']));
  }
  const manifest = { id: LOCAL_PREVIEW_SEED_VERSION, today, periodStart, periodEnd, customers, invoiceCount: invoices.length, draftCount: invoices.filter(row => row.status === 'draft').length,
    invoicePeriods: [periodStart, nextPeriodStart].map(date => ({ periodStart: date, count: invoices.filter(row => row.periodStart === date).length, drafts: invoices.filter(row => row.periodStart === date && row.status === 'draft').length })),
    priceBookHistory: [oldBook, book].map(row => ({ version: row.version, effectiveDate: row.effectiveDate, sourceVersion: row.sourceVersion })),
    pricingCheck: { customerId: 'local-customer-01', weeklyOneDogBaseCents: 9500, litterMonthlyCents: 12900, deodorizationCents: 5000, totalCents: 27400, reason: 'The weekly 1 dog base is $95. This account also has $129 kitty litter service and $50 deodorization.' },
    subscriptionCount: subscriptions.length, methodCount: methods.length, scenarios: Object.fromEntries(customers.filter(row => row.scenario !== 'active').map(row => [row.scenario, { customerId: row.id, name: row.displayName, subscriptionId: row.scenario === 'one_time' ? null : row.subscriptionId, invoiceId: invoices.find(invoice => invoice.customerId === row.id)?.id || null }])),
    limitations: ['Native recurring subscriptions have monthly billing semantics. The one-time cleanup customer has a standalone invoice and no recurring agreement/MRR.', 'Full contact/property CRM editing is not yet part of the native subscription customer registry; fabricated property/contact details are in local_preview_customers and shared field fixtures.', 'All payment profiles are fake metadata. No real token, card or bank data is seeded.'] };
  statements.push(insert('local_preview_seed_manifests', ['id', 'manifest_json'], [LOCAL_PREVIEW_SEED_VERSION, json(manifest)]));
  return { sql: `${statements.join('\n')}\n`, manifest, book, books: [oldBook, book], customers, subscriptions, methods, invoices, settings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dateArg = process.argv.find(arg => arg.startsWith('--date='));
  const outputArg = process.argv.find(arg => arg.startsWith('--out='));
  const today = dateArg?.slice(7) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const output = path.resolve(outputArg?.slice(6) || 'tmp/local-preview-crm.sql');
  if (!output.includes(`${path.sep}tmp${path.sep}`)) throw new Error('Local preview SQL must be written under a tmp directory.');
  const data = await createLocalPreviewCrmSeed({ today });
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, data.sql); fs.writeFileSync(output.replace(/\.sql$/, '.manifest.json'), `${JSON.stringify(data.manifest, null, 2)}\n`);
  console.log(JSON.stringify({ sqlPath: output, today, customers: data.customers.length, subscriptions: data.subscriptions.length, drafts: data.manifest.draftCount, invoices: data.invoices.length, fakeMethods: data.methods.length }));
}
