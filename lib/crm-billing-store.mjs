import * as billing from './crm-billing.mjs';
import { subscriptionView, subscriptionDate } from './crm-subscriptions.mjs';
import { readCrmPriceBook } from './crm-subscription-store.mjs';
import { safePaymentMethod, safePaymentResult, paymentOrderId, assertPaymentsProvider } from './payments-provider.mjs';
import { assertNoPaymentSecrets, crmBillingEnabled } from './crm-billing-security.mjs';
import { buildQboOperation, syncQboOutboxItem } from './crm-billing-qbo.mjs';

const ORG = 'org-opwp';
export class BillingStoreError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'BillingStoreError'; this.status = status; }
}
const fail = (value, message, status = 400) => { if (!value) throw new BillingStoreError(message, status); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const note = value => { fail(typeof value === 'string' && value.trim() && value.length <= 2000, 'A reason is required.'); assertNoPaymentSecrets({ reason: value }); return value.trim(); };
const json = value => { assertNoPaymentSecrets(value); const text = JSON.stringify(value); fail(new TextEncoder().encode(text).length <= 1024 * 1024, 'Billing record exceeds its safe size; review archival before continuing.', 413); return text; };
const at = ctx => ctx.at || ctx.atISO;
const rows = async (db, query, args = []) => (await db.prepare(query).bind(...args).all()).results || [];
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const subscriptionBillingDigest = sub => digest(billing.billingSubscriptionFingerprintSource(sub));
const verifyProvider = (provider, metadata) => fail(metadata.provider === provider.hostedTokenizerConfig({ methodType: metadata.methodType }).provider, 'The saved payment belongs to a different provider.', 409);
const ctxNow = (actor, now) => ({ actor, at: new Date(now).toISOString() });
const accountingLocked = row => row && (JSON.parse(row.job_json).attempts > 0 || JSON.parse(row.job_json).status === 'syncing');
const paidCredits = value => (value.credits || []).filter(row => row.affectsInvoiceTotal === false).reduce((sum, row) => sum + row.amountCents, 0);

export async function readBillingSettings(db) {
  const row = await db.prepare('SELECT revision,settings_json FROM crm_billing_settings WHERE organization_id=?').bind(ORG).first();
  return { ...billing.defaultBillingSettings(row ? JSON.parse(row.settings_json) : {}), revision: row?.revision || 0 };
}
async function customer(db, customerId) {
  fail(id(customerId), 'Choose a customer.');
  const row = await db.prepare('SELECT id,display_name AS name FROM crm_subscription_customers WHERE id=? AND organization_id=?').bind(customerId, ORG).first();
  fail(row, 'Customer not found.', 404); return row;
}
async function invoice(db, invoiceId) {
  fail(id(invoiceId), 'Choose an invoice.');
  const row = await db.prepare('SELECT state_json FROM crm_billing_invoices WHERE id=? AND organization_id=?').bind(invoiceId, ORG).first();
  fail(row, 'Invoice not found.', 404); return JSON.parse(row.state_json);
}
async function invoiceByKey(db, key) {
  const row = await db.prepare('SELECT state_json FROM crm_billing_invoices WHERE invoice_key=? AND organization_id=?').bind(key, ORG).first();
  return row ? JSON.parse(row.state_json) : null;
}
async function subscriptions(db, customerId = null) {
  const result = await rows(db, `SELECT id,revision,state_json FROM crm_subscriptions WHERE organization_id=?${customerId ? ' AND customer_id=?' : ''} ORDER BY id LIMIT 10001`, customerId ? [ORG, customerId] : [ORG]);
  fail(result.length <= 10000, 'Billing requires paginated partitioning before this volume can be processed.', 413);
  return result.map(row => JSON.parse(row.state_json));
}
async function methods(db, customerId = null) {
  return (await rows(db, `SELECT * FROM crm_billing_methods WHERE organization_id=?${customerId ? ' AND customer_id=?' : ''} ORDER BY customer_id,is_default DESC,id LIMIT 10001`, customerId ? [ORG, customerId] : [ORG])).map(row => ({ id: row.id, customerId: row.customer_id, revision: row.revision, ...safePaymentMethod(JSON.parse(row.method_json)), isDefault: row.is_default === 1 }));
}
async function method(db, methodId, customerId) {
  const value = (await methods(db, customerId)).find(item => item.id === methodId);
  fail(value, 'Choose a saved method owned by this customer.', 409); return value;
}
async function covered(db, customerId, excluding = '') {
  return rows(db, `SELECT c.subscription_id AS subscriptionId,c.start_date AS startDate,c.end_date AS endDate FROM crm_billing_coverage c JOIN crm_billing_invoices i ON i.id=c.invoice_id WHERE i.organization_id=? AND i.customer_id=? AND c.released_at IS NULL AND c.invoice_id<>?`, [ORG, customerId, excluding]);
}
function guard(db, key, expected, query, args) {
  return db.prepare(`INSERT INTO crm_billing_write_guards(id,expected_revision,actual_revision) VALUES (?,?,${query})`).bind(key, expected, ...args);
}
function audit(db, type, entityId, action, oldValue, newValue, reason, ctx) {
  return db.prepare('INSERT INTO crm_billing_audit(id,entity_type,entity_id,action,actor,occurred_at,old_json,new_json,reason) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), type, entityId, action, ctx.actor, at(ctx), oldValue == null ? null : json(oldValue), newValue == null ? null : json(newValue), note(reason));
}
function writeInvoice(db, value) {
  return db.prepare('UPDATE crm_billing_invoices SET revision=?,status=?,state_json=?,updated_at=? WHERE id=? AND organization_id=?').bind(value.revision, value.status, json(value), value.updatedAt, value.id, ORG);
}
async function replay(db, actor, requestId, hash) {
  const row = await db.prepare('SELECT * FROM crm_billing_commands WHERE id=?').bind(requestId).first();
  if (!row) return null;
  fail(row.actor === actor && row.body_hash === hash, 'Request ID was reused with different content or author.', 409);
  return { ...JSON.parse(row.result_json), duplicate: true, commandStatus: row.status };
}
function commandReceipt(db, input, ctx, hash, result, status = 'done') {
  return db.prepare('INSERT INTO crm_billing_commands(id,actor,body_hash,status,result_json,created_at) VALUES (?,?,?,?,?,?)').bind(input.requestId, ctx.actor, hash, status, json(result), at(ctx));
}
function request(input) {
  fail(/^[a-f0-9-]{36}$/i.test(input.requestId || ''), 'A stable request ID is required.');
  assertNoPaymentSecrets(input); return note(input.reason);
}

export async function readBillingWorkspace(db, { period = '', filter = 'all' } = {}) {
  if (period) subscriptionDate(period);
  const [invoiceRows, allMethods, settings, customers, syncRows, adjustmentRows] = await Promise.all([
    rows(db, `SELECT state_json FROM crm_billing_invoices WHERE organization_id=?${period ? ' AND period_start=?' : ''} ORDER BY created_at DESC,id LIMIT 2001`, period ? [ORG, period] : [ORG]),
    methods(db), readBillingSettings(db), rows(db, 'SELECT id,display_name AS name FROM crm_subscription_customers WHERE organization_id=? ORDER BY display_name,id LIMIT 2001', [ORG]),
    rows(db, "SELECT job_json FROM crm_billing_qbo_outbox WHERE status<>'synced' ORDER BY updated_at,id LIMIT 2001"),
    rows(db, `SELECT a.* FROM crm_billing_adjustments a JOIN crm_billing_invoices i ON i.id=a.invoice_id WHERE i.organization_id=?${period ? ' AND i.period_start=?' : ''} ORDER BY a.created_at,a.idempotency_key LIMIT 10001`, period ? [ORG, period] : [ORG]),
  ]);
  fail(invoiceRows.length <= 2000 && customers.length <= 2000 && syncRows.length <= 2000 && allMethods.length <= 10000 && adjustmentRows.length <= 10000, 'Narrow this billing review before continuing.', 413);
  const all = invoiceRows.map(row => { const value = JSON.parse(row.state_json); const chosen = allMethods.find(item => item.id === value.paymentMethodId) || allMethods.find(item => item.customerId === value.customerId && item.isDefault); const adjustments = adjustmentRows.filter(item => item.invoice_id === value.id).map(item => ({ id: item.idempotency_key, kind: item.kind, amountCents: item.amount_cents, status: item.status, processorCode: item.result_json ? JSON.parse(item.result_json).processorCode : null, actor: item.actor, reason: item.reason, createdAt: item.created_at, updatedAt: item.updated_at })); return { ...value, adjustments, customerName: customers.find(item => item.id === value.customerId)?.name || value.customerId, availableMethodId: chosen?.id || null, missingPaymentMethod: value.totalCents > 0 && !chosen }; });
  const selected = all.filter(value => filter === 'missing_method' || filter === 'missing_payment_method' ? value.missingPaymentMethod : billing.billingInvoiceMatchesFilter(value, filter));
  return { invoices: selected, methods: allMethods, customers, settings, syncIssues: syncRows.map(row => JSON.parse(row.job_json)), summary: billing.billingBatchSummary(all) };
}

async function availableCredits(db, sources, excluding = '') {
  const result = [];
  for (const sub of sources) for (const credit of sub.credits || []) {
    const used = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM crm_billing_credit_reservations WHERE subscription_id=? AND credit_id=? AND status='reserved' AND invoice_id<>?").bind(sub.id, credit.id, excluding).first();
    const amountCents = Math.max(0, credit.remainingCents - Number(used?.n || 0));
    if (amountCents) result.push({ id: credit.id, subscriptionId: sub.id, amountCents, availableCents: credit.remainingCents });
  }
  return result;
}
async function buildInvoice(db, input, ctx, invoiceId, excluding = '') {
  await customer(db, input.customerId);
  const [source, settings, allMethods, book, existingCoverage] = await Promise.all([subscriptions(db, input.customerId), readBillingSettings(db), methods(db, input.customerId), readCrmPriceBook(db), covered(db, input.customerId, excluding)]);
  const chosen = input.paymentMethodId ? allMethods.find(item => item.id === input.paymentMethodId) : allMethods.find(item => item.isDefault);
  if (input.paymentMethodId) fail(chosen, 'Choose a saved method owned by this customer.');
  const credits = await availableCredits(db, source, excluding);
  const builderInput = { ...input, id: invoiceId, settings, book, existingCoverage, credits, paymentMethodId: chosen?.id || null, methodType: chosen?.methodType || null };
  const value = input.invoiceType === 'new_client' ? billing.buildNewClientInvoice(source, builderInput, ctx) : billing.buildMonthlyInvoice(source, builderInput, ctx);
  value.builderInput = Object.fromEntries(['customerId', 'invoiceType', 'periodStart', 'startDate', 'initialCleanupCents', 'firstPeriodMode', 'includeNextFullMonth', 'additionalLines', 'taxBasisPoints', 'achDiscountBasisPoints'].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  value.sourceRevisions = await Promise.all(source.filter(sub => value.subscriptionIds.includes(sub.id)).map(async sub => ({ subscriptionId: sub.id, revision: sub.revision, billingDigest: await subscriptionBillingDigest(sub) })));
  const prior = await db.prepare('SELECT COUNT(*) n FROM crm_billing_invoices WHERE customer_id=? AND organization_id=?').bind(value.customerId, ORG).first();
  value.firstInvoice ||= !Number(prior?.n || 0);
  return { value, sources: source, credits };
}
function coverageStatements(db, value, credits) {
  return [
    ...(value.coverage || []).map(row => db.prepare('INSERT INTO crm_billing_coverage(invoice_id,subscription_id,start_date,end_date) VALUES (?,?,?,?)').bind(value.id, row.subscriptionId, row.startDate, row.endDate)),
    ...(value.creditApplications || []).map(row => { const available = credits.find(item => item.id === row.creditId && item.subscriptionId === row.subscriptionId); fail(available, 'Promised credit changed. Rebuild the draft.', 409); return db.prepare("INSERT INTO crm_billing_credit_reservations(invoice_id,subscription_id,credit_id,amount_cents,available_cents,status) VALUES (?,?,?,?,?,'reserved')").bind(value.id, row.subscriptionId, row.creditId, row.amountCents, available.availableCents); }),
  ];
}
async function createInvoice(db, input, ctx) {
  const key = billing.billingInvoiceKey(input.customerId, input.startDate || input.periodStart, input.invoiceType);
  const existing = await invoiceByKey(db, key);
  if (existing) return { invoice: existing, duplicate: true };
  const { value, sources, credits } = await buildInvoice(db, input, ctx, crypto.randomUUID());
  const commandId = crypto.randomUUID();
  const statements = sources.filter(sub => value.subscriptionIds.includes(sub.id)).map(sub => guard(db, `${commandId}:${sub.id}`, sub.revision, '(SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?)', [sub.id, ORG]));
  statements.push(db.prepare('INSERT INTO crm_billing_invoices(id,organization_id,customer_id,invoice_key,invoice_type,period_start,period_end,revision,status,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(value.id, ORG, value.customerId, value.idempotencyKey, value.invoiceType, value.periodStart, value.periodEnd, value.revision, value.status, json(value), value.createdAt, value.updatedAt), ...coverageStatements(db, value, credits), audit(db, 'invoice', value.id, 'draft_created', null, { totalCents: value.totalCents, status: value.status, key }, input.reason || 'Draft prepared for office approval', ctx), db.prepare('DELETE FROM crm_billing_write_guards WHERE id LIKE ?').bind(`${commandId}:%`));
  try { await db.batch(statements); }
  catch (error) { const saved = await invoiceByKey(db, key); if (saved) return { invoice: saved, duplicate: true }; if (/BILLING_COVERAGE|BILLING_CREDIT|constraint/i.test(error.message)) throw new BillingStoreError('Service coverage or credit was reserved by newer work. Review existing invoices before retrying.', 409); throw error; }
  return { invoice: value, duplicate: false };
}
export async function generateMonthlyBillingDrafts(db, input, ctx) {
  const periodStart = subscriptionDate(input.periodStart), all = await subscriptions(db), groups = [...new Set(all.map(sub => sub.customerId))];
  const generated = [], held = [];
  for (const customerId of groups) {
    if (input.customerId && input.customerId !== customerId) continue;
    try { generated.push(await createInvoice(db, { ...input, customerId, invoiceType: 'monthly', periodStart }, ctx)); }
    catch (error) { if (error instanceof billing.BillingError || error instanceof BillingStoreError) held.push({ customerId, reason: error.message }); else throw error; }
  }
  return { generated: generated.map(item => item.invoice), duplicateCount: generated.filter(item => item.duplicate).length, held };
}
export async function createNewClientBillingInvoice(db, input, ctx) { return createInvoice(db, { ...input, invoiceType: 'new_client' }, ctx); }

export async function scheduleBillingChargeNow(db, input, ctx) { return runBillingCommand(db, { ...input, action: 'charge_now' }, ctx); }

async function finishAdjustment(db, old, claim, raw, ctx) {
  let result; try { result = safePaymentResult(raw); } catch { result = {}; }
  const expectedStatus = claim.kind === 'void' ? 'voided' : 'refunded';
  const confirmed = !result.reconcileRequired && result.status === expectedStatus && result.amountCents === claim.amount_cents && result.orderId === await paymentOrderId(claim.idempotency_key) && result.transactionId;
  const failed = !result.reconcileRequired && result.status === 'failed' && result.amountCents === claim.amount_cents;
  const status = confirmed ? 'confirmed' : failed ? 'failed' : 'unknown', key = crypto.randomUUID(), statements = [];
  let next = old;
  if (confirmed) {
    next = billing.recordBillingRefund(old, { expectedRevision: old.revision, id: claim.idempotency_key, transactionId: result.orderId, kind: claim.kind, amountCents: claim.amount_cents, reason: claim.reason }, ctx);
    next.refunds.at(-1).processorTransactionId = result.transactionId;
    statements.push(guard(db, key, old.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [old.id, ORG]), writeInvoice(db, next), enqueue(db, 'refund', `refund:${claim.idempotency_key}`, { invoice: old, refund: { ...next.refunds.at(-1), status: 'refunded', confirmed: true, refundedAt: at(ctx) } }, old.id, ctx));
  }
  const safe = { ...result, status: result.status || 'unknown' };
  statements.push(db.prepare('UPDATE crm_billing_adjustments SET status=?,result_json=?,updated_at=? WHERE idempotency_key=?').bind(status, json(safe), at(ctx), claim.idempotency_key), audit(db, 'invoice', old.id, `processor_${claim.kind}_${status}`, { refundedCents: old.refundedCents }, { refundedCents: next.refundedCents, status, adjustmentId: claim.idempotency_key }, claim.reason, ctx), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=?').bind(key));
  await db.batch(statements); return { invoice: next, adjustment: { id: claim.idempotency_key, kind: claim.kind, status, result: safe } };
}
export async function refundBillingInvoice(db, invoiceId, input, ctx, { provider }) {
  request(input); assertPaymentsProvider(provider); const command = { ...input, invoiceId, action: input.action === 'void_payment' ? 'void_payment' : 'refund' }, hash = await digest(command), prior = await replay(db, ctx.actor, input.requestId, hash);
  if (prior) return { ...prior, invoice: await invoice(db, invoiceId) };
  const old = await invoice(db, invoiceId);
  fail(old.revision === input.expectedRevision && old.status === 'paid' && old.transactionId, 'A current, paid processor invoice is required.', 409);
  const originalAttempt = await db.prepare('SELECT method_json FROM crm_billing_attempts WHERE invoice_id=? ORDER BY attempt DESC LIMIT 1').bind(old.id).first();
  fail(originalAttempt, 'The original payment attempt is missing.', 409); verifyProvider(provider, JSON.parse(originalAttempt.method_json));
  const pending = await db.prepare("SELECT idempotency_key FROM crm_billing_adjustments WHERE invoice_id=? AND status IN('requested','unknown') LIMIT 1").bind(old.id).first();
  fail(!pending, 'An earlier adjustment needs reconciliation before another can be requested.', 409);
  fail(Number.isSafeInteger(input.amountCents) && input.amountCents > 0 && input.amountCents <= old.totalCents - old.refundedCents - paidCredits(old), 'Choose an amount within the remaining uncredited payment.');
  const kind = command.action === 'void_payment' ? 'void' : 'refund';
  fail(kind !== 'void' || input.amountCents === old.totalCents && old.refundedCents === 0 && paidCredits(old) === 0, 'A processor void must reverse the full untouched payment.');
  const claim = { idempotency_key: `${old.id}:${kind}:${input.requestId}`, invoice_id: old.id, kind, amount_cents: input.amountCents, reason: input.reason };
  await db.batch([guard(db, input.requestId, old.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [old.id, ORG]), db.prepare("INSERT INTO crm_billing_adjustments(idempotency_key,invoice_id,kind,amount_cents,status,actor,reason,created_at,updated_at) VALUES (?,?,?,?,'requested',?,?,?,?)").bind(claim.idempotency_key, old.id, kind, input.amountCents, ctx.actor, note(input.reason), at(ctx), at(ctx)), audit(db, 'invoice', old.id, `${kind}_requested`, { refundedCents: old.refundedCents }, { adjustmentId: claim.idempotency_key, amountCents: input.amountCents }, input.reason, ctx), commandReceipt(db, command, ctx, hash, { invoice: old, adjustmentId: claim.idempotency_key }, 'claimed'), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=?').bind(input.requestId)]);
  let result; try { result = await provider[kind]({ transactionId: old.transactionId, amountCents: claim.amount_cents, idempotencyKey: claim.idempotency_key }); } catch { result = { status: 'unknown', amountCents: claim.amount_cents, reconcileRequired: true }; }
  return finishAdjustment(db, old, claim, result, ctx);
}
export async function reconcileBillingAdjustment(db, input, ctx, { provider }) {
  assertPaymentsProvider(provider); fail(id(input.adjustmentId), 'Choose a recorded adjustment.'); note(input.reason);
  const claim = await db.prepare('SELECT * FROM crm_billing_adjustments WHERE idempotency_key=?').bind(input.adjustmentId).first(); fail(claim, 'Adjustment not found.', 404);
  const old = await invoice(db, claim.invoice_id);
  const originalAttempt = await db.prepare('SELECT method_json FROM crm_billing_attempts WHERE invoice_id=? ORDER BY attempt DESC LIMIT 1').bind(old.id).first();
  fail(originalAttempt, 'The original payment attempt is missing.', 409); verifyProvider(provider, JSON.parse(originalAttempt.method_json));
  if (['confirmed', 'failed'].includes(claim.status)) return { invoice: old, duplicate: true };
  const orderId = await paymentOrderId(claim.idempotency_key); let result;
  try {
    result = await provider.inquire({ ...(claim.kind === 'void' ? { transactionId: old.transactionId } : { orderId }), amountCents: claim.amount_cents, methodType: old.methodType });
    if (claim.kind === 'void' && result.status === 'voided' && result.transactionId === old.transactionId && result.amountCents === claim.amount_cents) result = { ...result, orderId };
  } catch { result = { status: 'unknown', amountCents: claim.amount_cents, reconcileRequired: true }; }
  return finishAdjustment(db, old, claim, result, ctx);
}

export async function recordBillingWebhookHint(db, input, ctx, { provider }) {
  assertNoPaymentSecrets(input); const allowed = new Set(['eventId', 'invoiceId', 'orderId', 'transactionId']);
  fail(Object.keys(input).every(key => allowed.has(key)) && id(input.eventId) && (id(input.orderId) || id(input.transactionId)), 'Use a safe UAT relay inquiry hint.');
  const existing = await db.prepare('SELECT * FROM crm_billing_webhook_hints WHERE event_id=?').bind(input.eventId).first();
  if (existing) {
    fail(existing.order_id === (input.orderId || null) && existing.transaction_id === (input.transactionId || null) && (!input.invoiceId || existing.invoice_id === input.invoiceId), 'Relay event ID was reused with different references.', 409);
    const current = await invoice(db, existing.invoice_id);
    return ['charging', 'pending', 'paid'].includes(current.status) ? { duplicate: true, ...await reconcileBillingInvoice(db, existing.invoice_id, {}, ctx, { provider }) } : { duplicate: true, invoice: current };
  }
  const candidates = await rows(db, "SELECT * FROM crm_billing_attempts WHERE provider_order_id=? OR json_extract(result_json,'$.transactionId')=?", [input.orderId || '', input.transactionId || '']);
  fail(candidates.length === 1, 'Relay hint does not identify exactly one durable charge attempt.', 409);
  const claim = candidates[0]; fail(!input.invoiceId || input.invoiceId === claim.invoice_id, 'Relay invoice reference does not match.', 409);
  fail(!input.orderId || input.orderId === claim.provider_order_id, 'Relay order reference does not match.', 409);
  const result = claim.result_json ? JSON.parse(claim.result_json) : {};
  fail(!input.transactionId || !result.transactionId || input.transactionId === result.transactionId, 'Relay transaction reference does not match.', 409);
  await db.batch([db.prepare('INSERT INTO crm_billing_webhook_hints(event_id,provider,invoice_id,order_id,transaction_id,received_at) VALUES (?,?,?,?,?,?)').bind(input.eventId, JSON.parse(claim.method_json).provider, claim.invoice_id, input.orderId || null, input.transactionId || null, at(ctx)), audit(db, 'relay_hint', input.eventId, 'inquiry_hint_received', null, { invoiceId: claim.invoice_id, orderId: input.orderId || null, transactionId: input.transactionId || null }, 'Authenticated UAT relay hint; status is independently inquired', ctx)]);
  const current = await invoice(db, claim.invoice_id);
  if (!['charging', 'pending', 'paid'].includes(current.status)) return { accepted: true, invoice: current };
  return { accepted: true, ...await reconcileBillingInvoice(db, claim.invoice_id, {}, ctx, { provider }) };
}

export async function queueBillingAccounting(db, input, ctx) {
  request(input); fail(['deposit', 'fee', 'fee_accrual', 'fee_settlement'].includes(input.kind) && id(input.source?.id), 'Choose a reviewed gross deposit or monthly fee source.');
  const hash = await digest(input), prior = await replay(db, ctx.actor, input.requestId, hash); if (prior) return prior;
  const sourceKey = `${input.kind}:${input.source.id}`, settings = await readBillingSettings(db);
  await buildQboOperation(input.kind, input.source, settings.qboMapping);
  const saved = await db.prepare('SELECT job_json FROM crm_billing_qbo_outbox WHERE source_key=?').bind(sourceKey).first();
  if (saved) fail(json(canonical(JSON.parse(saved.job_json).sourceSnapshot)) === json(canonical(input.source)), 'This accounting source ID already has different content.', 409);
  const statements = [];
  if (input.kind.startsWith('fee')) {
    const mode = input.kind === 'fee' ? 'direct' : 'accrual';
    if (input.kind === 'fee_settlement') {
      const accrual = await db.prepare("SELECT status,job_json FROM crm_billing_qbo_outbox WHERE source_key=?").bind(`fee_accrual:${input.source.id}`).first();
      fail(accrual?.status === 'synced', 'Synchronize the reviewed fee accrual before recording its settlement.', 409);
      const recorded = JSON.parse(accrual.job_json).sourceSnapshot;
      fail(['id', 'amountCents', 'periodStart', 'periodEnd'].every(key => recorded[key] === input.source[key]), 'Fee settlement must match its recorded accrual amount and statement period.', 409);
    }
    statements.push(db.prepare('INSERT INTO crm_billing_fee_statements(statement_id,recognition_mode) VALUES (?,?) ON CONFLICT(statement_id) DO NOTHING').bind(input.source.id, mode), guard(db, input.requestId, 1, '(SELECT CASE WHEN recognition_mode=? THEN 1 ELSE 0 END FROM crm_billing_fee_statements WHERE statement_id=?)', [mode, input.source.id]));
  }
  const result = { queued: true, jobId: sourceKey };
  statements.push(enqueue(db, input.kind, sourceKey, input.source, null, ctx), guard(db, `${input.requestId}:source`, 1, "(SELECT CASE WHEN json_extract(job_json,'$.sourceSnapshot')=? THEN 1 ELSE 0 END FROM crm_billing_qbo_outbox WHERE source_key=?)", [json(canonical(input.source)), sourceKey]));
  if (input.kind === 'deposit') for (const payment of input.source.payments) {
    statements.push(db.prepare('INSERT INTO crm_billing_deposit_links(qbo_payment_id,source_key) VALUES (?,?) ON CONFLICT(qbo_payment_id) DO NOTHING').bind(payment.qboPaymentId, sourceKey), guard(db, `${input.requestId}:${payment.qboPaymentId}`, 1, '(SELECT CASE WHEN source_key=? THEN 1 ELSE 0 END FROM crm_billing_deposit_links WHERE qbo_payment_id=?)', [sourceKey, payment.qboPaymentId]));
  }
  statements.push(audit(db, 'qbo_sync', sourceKey, 'accounting_queued', null, { kind: input.kind, sourceId: input.source.id }, input.reason, ctx), commandReceipt(db, input, ctx, hash, result), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=? OR id LIKE ?').bind(input.requestId, `${input.requestId}:%`));
  await db.batch(statements); return result;
}
export async function syncBillingQbo(db, input, ctx, { gateway }) {
  fail(gateway?.fixtureOnly === true, 'Only fixture QBO synchronization is available in this phase.', 503);
  const settings = await readBillingSettings(db), result = [];
  const jobs = await rows(db, `SELECT * FROM crm_billing_qbo_outbox WHERE status IN(${input.force && input.jobId ? "'unsynced','syncing','held'" : "'unsynced','syncing'"})${input.jobId ? ' AND id=?' : ''}${input.force ? '' : " AND (json_extract(job_json,'$.retryAt') IS NULL OR json_extract(job_json,'$.retryAt')<=?)"} ORDER BY CASE kind WHEN 'invoice' THEN 0 WHEN 'payment' THEN 1 ELSE 2 END,updated_at,id LIMIT 100`, [...(input.jobId ? [input.jobId] : []), ...(input.force ? [] : [at(ctx)])]);
  for (const row of jobs) {
    let job = JSON.parse(row.job_json);
    if (!input.force && (job.status === 'held' || job.retryAt && Date.parse(job.retryAt) > Date.parse(at(ctx)))) continue;
    const customerId = job.payload?.invoice?.customerId || job.payload?.customerId;
    if (!job.payload?.entity) {
      const customerMapping = settings.qboMapping?.customerMappings?.[customerId];
      job.mapping = { ...settings.qboMapping, ...(customerMapping || {}), invoiceId: undefined, paymentId: undefined };
      if (customerId && !customerMapping?.customerId) job.mapping = { ...job.mapping, customerId: undefined, reviewed: false };
      if (row.invoice_id) {
        const invoiceJob = await db.prepare('SELECT qbo_id FROM crm_billing_qbo_outbox WHERE source_key=?').bind(`invoice:${row.invoice_id}`).first();
        if (invoiceJob?.qbo_id) job.mapping.invoiceId = invoiceJob.qbo_id;
        const paymentJob = await db.prepare("SELECT qbo_id FROM crm_billing_qbo_outbox WHERE invoice_id=? AND kind='payment' AND status='synced' ORDER BY updated_at DESC LIMIT 1").bind(row.invoice_id).first();
        if (paymentJob?.qbo_id) job.mapping.paymentId = paymentJob.qbo_id;
      }
      try { job.payload = await buildQboOperation(job.kind, job.payload, job.mapping); }
      catch { /* The outbox records a safe missing-mapping error without a network call. */ }
    }
    const key = crypto.randomUUID(), claimed = { ...job, status: 'syncing' };
    await db.batch([guard(db, key, 1, '(SELECT CASE WHEN job_json=? THEN 1 ELSE 0 END FROM crm_billing_qbo_outbox WHERE id=?)', [row.job_json, row.id]), db.prepare("UPDATE crm_billing_qbo_outbox SET status='syncing',job_json=?,updated_at=? WHERE id=?").bind(json(claimed), at(ctx), row.id), audit(db, 'qbo_sync', row.id, 'sync_claimed', { status: row.status }, { status: 'syncing', attempts: job.attempts || 0 }, input.reason || 'Fixture QBO retry', ctx), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=?').bind(key)]);
    const next = await syncQboOutboxItem(claimed, gateway, { actor: ctx.actor, now: Date.parse(at(ctx)), reason: input.reason || 'Fixture QBO synchronization' });
    await db.batch([guard(db, key, 1, '(SELECT CASE WHEN job_json=? THEN 1 ELSE 0 END FROM crm_billing_qbo_outbox WHERE id=?)', [json(claimed), row.id]), db.prepare('UPDATE crm_billing_qbo_outbox SET status=?,job_json=?,qbo_id=?,updated_at=? WHERE id=?').bind(next.status, json(next), next.qboId || null, at(ctx), row.id), audit(db, 'qbo_sync', row.id, 'sync_result', { status: 'syncing' }, { status: next.status, qboId: next.qboId || null, errorCode: next.lastErrorCode || null }, input.reason || 'Fixture accounting result', ctx), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=?').bind(key)]);
    result.push(next);
  }
  return { jobs: result };
}

export async function processCrmBilling(env, { now = Date.now(), provider = null } = {}) {
  if (!crmBillingEnabled(env) || !env.DB) return { status: 'disabled' };
  const db = env.DB, ctx = ctxNow('system:crm-billing-uat', now), settings = await readBillingSettings(db), schedule = billing.billingSchedule(now, settings), errors = [];
  const generated = schedule.draftDue ? await generateMonthlyBillingDrafts(db, { periodStart: schedule.periodStart, reason: 'Scheduled monthly drafts for office review' }, ctx) : null;
  const cursor = await db.prepare('SELECT cursor FROM crm_billing_runner_cursors WHERE id=?').bind(ORG).first();
  const cutoff = new Date(now - 60 * 86400000).toISOString();
  const candidates = await rows(db, "SELECT id,state_json FROM crm_billing_invoices WHERE organization_id=? AND id>? AND (status='approved' AND json_extract(state_json,'$.scheduledChargeAt')<=? OR status IN('charging','pending') OR status='failed' AND ?=1 AND json_extract(state_json,'$.methodType')='card' AND json_extract(state_json,'$.retryAt')<=? OR status='paid' AND json_extract(state_json,'$.methodType')='ach' AND json_extract(state_json,'$.achReturnedAt') IS NULL AND json_extract(state_json,'$.paidAt')>=?) ORDER BY id LIMIT 100", [ORG, cursor?.cursor || '', at(ctx), settings.autoRetryCards ? 1 : 0, at(ctx), cutoff]);
  let charged = 0, reconciled = 0;
  for (const row of candidates) {
    let value = JSON.parse(row.state_json);
    try {
      if (value.status === 'failed' && settings.autoRetryCards && value.methodType === 'card' && value.retryAt && Date.parse(value.retryAt) <= now && !value.held && !value.reconciliationRequired) {
        value = (await runBillingCommand(db, { action: 'retry', invoiceId: value.id, expectedRevision: value.revision, requestId: crypto.randomUUID(), reason: 'Previously approved card invoice reached its configured retry time' }, ctx)).invoice;
      }
      if (value.status === 'approved' && !value.held && Date.parse(value.scheduledChargeAt) <= now) { fail(provider, 'The UAT provider is not configured.', 503); await chargeBillingInvoice(db, value.id, { expectedRevision: value.revision, requestId: crypto.randomUUID(), reason: 'Previously approved invoice reached its charge time' }, ctx, { provider }); charged++; }
      else if (['charging', 'pending'].includes(value.status) || value.status === 'paid' && value.methodType === 'ach' && !value.achReturnedAt && now - Date.parse(value.paidAt) <= 60 * 86400000) { fail(provider, 'The UAT provider is not configured.', 503); await reconcileBillingInvoice(db, value.id, {}, ctx, { provider }); reconciled++; }
    } catch (error) { errors.push({ invoiceId: value.id, code: error instanceof BillingStoreError || error instanceof billing.BillingError ? 'review_required' : 'uat_operation_unconfirmed' }); }
  }
  await db.prepare('INSERT INTO crm_billing_runner_cursors(id,cursor) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor').bind(ORG, candidates.length === 100 ? candidates.at(-1).id : '').run();
  return { status: 'complete', generated, charged, reconciled, errors, continuation: candidates.length === 100 };
}

async function consumeCredits(db, value, ctx, key) {
  const reserved = await rows(db, "SELECT * FROM crm_billing_credit_reservations WHERE invoice_id=? AND status='reserved'", [value.id]);
  const statements = [], sources = await subscriptions(db, value.customerId);
  for (const subscriptionId of new Set(reserved.map(row => row.subscription_id))) {
    const old = sources.find(sub => sub.id === subscriptionId); fail(old, 'Reserved credit subscription is missing.', 409);
    const next = structuredClone(old), changes = [];
    for (const row of reserved.filter(entry => entry.subscription_id === subscriptionId)) {
      const credit = next.credits.find(entry => entry.id === row.credit_id);
      fail(credit && credit.remainingCents >= row.amount_cents && !credit.applications.some(entry => entry.invoiceId === value.id), 'Reserved credit changed. Reconcile this payment before continuing.', 409);
      credit.remainingCents -= row.amount_cents; credit.applications.push({ invoiceId: value.id, amountCents: row.amount_cents, at: at(ctx) });
      changes.push({ creditId: row.credit_id, amountCents: row.amount_cents });
    }
    next.revision++; next.updatedAt = at(ctx);
    next.audit.push({ id: crypto.randomUUID(), actor: ctx.actor, at: at(ctx), action: 'billing_credit_applied', oldValue: { revision: old.revision }, newValue: { invoiceId: value.id, applications: changes }, reason: 'Reserved credit applied to a confirmed billing settlement' });
    statements.push(guard(db, `${key}:sub:${old.id}`, old.revision, '(SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?)', [old.id, ORG]), db.prepare('UPDATE crm_subscriptions SET revision=?,state_json=?,updated_at=? WHERE id=? AND organization_id=?').bind(next.revision, json(next), at(ctx), next.id, ORG), audit(db, 'subscription', old.id, 'billing_credit_applied', { revision: old.revision }, { invoiceId: value.id, applications: changes }, 'Credit applied only after confirmed settlement', ctx));
  }
  statements.push(db.prepare("UPDATE crm_billing_credit_reservations SET status='applied' WHERE invoice_id=? AND status='reserved'").bind(value.id));
  return statements;
}
function normalizedResult(raw, claim) {
  let result;
  try { result = safePaymentResult(raw); } catch { result = {}; }
  const unsafe = !['paid', 'pending', 'failed', 'unknown'].includes(result.status)
    || result.reconcileRequired && result.status !== 'unknown'
    || result.amountCents !== claim.amount_cents
    || result.orderId && result.orderId !== claim.provider_order_id
    || result.status === 'pending' && JSON.parse(claim.method_json).methodType !== 'ach';
  if (unsafe) return { status: 'unknown', amountCents: claim.amount_cents, processorCode: 'result_requires_review', reconcileRequired: true };
  return result;
}
async function finishBillingAttempt(db, value, claim, raw, ctx) {
  const result = normalizedResult(raw, claim), key = crypto.randomUUID();
  const next = billing.recordBillingResult(value, { expectedRevision: value.revision, attempt: claim.attempt, result, reason: 'Authenticated UAT processor result reconciled against the durable attempt' }, ctx);
  if (next.revision === value.revision) return { invoice: value, duplicate: true };
  const statements = [guard(db, `${key}:invoice`, value.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [value.id, ORG]), writeInvoice(db, next), db.prepare('UPDATE crm_billing_attempts SET status=?,result_json=?,updated_at=? WHERE idempotency_key=?').bind(next.attempts.at(-1).status, json(result), at(ctx), claim.idempotency_key), audit(db, 'invoice', value.id, 'processor_result', { status: value.status, revision: value.revision }, { status: next.status, attempt: claim.attempt, processorCode: result.processorCode || null, transactionId: result.transactionId || null }, 'Authenticated UAT result; no customer notice sent', ctx)];
  if (next.status === 'paid') {
    statements.push(...await consumeCredits(db, next, ctx, key));
    statements.push(enqueue(db, 'payment', `payment:${claim.idempotency_key}`, { invoice: next, payment: { id: claim.idempotency_key, status: 'paid', confirmed: true, amountCents: next.totalCents, transactionId: next.transactionId, paidAt: next.paidAt } }, next.id, ctx));
  }
  statements.push(db.prepare('DELETE FROM crm_billing_write_guards WHERE id LIKE ?').bind(`${key}:%`));
  try { await db.batch(statements); } catch (error) { const saved = await invoice(db, value.id); if (saved.revision !== value.revision) return { invoice: saved, concurrent: true }; throw error; }
  return { invoice: next };
}
export async function chargeBillingInvoice(db, invoiceId, input, ctx, { provider }) {
  request(input); assertPaymentsProvider(provider);
  const command = { ...input, invoiceId, action: 'charge' }, hash = await digest(command), previous = await replay(db, ctx.actor, input.requestId, hash);
  if (previous) return { ...previous, invoice: await invoice(db, invoiceId) };
  const old = await invoice(db, invoiceId);
  fail(input.expectedRevision === old.revision, 'Invoice changed. Review before charging.', 409);
  const coverageSources = await verifyCoverageActive(db, old);
  const key = input.requestId;
  if (old.totalCents === 0) {
    const next = billing.settleZeroBillingInvoice(old, input, ctx), result = { invoice: next };
    await db.batch([guard(db, `${key}:invoice`, old.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [old.id, ORG]), ...coverageSources.map(sub => guard(db, `${key}:source:${sub.id}`, sub.revision, '(SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?)', [sub.id, ORG])), writeInvoice(db, next), ...await consumeCredits(db, next, ctx, key), audit(db, 'invoice', old.id, 'credit_settled', { status: old.status }, { status: 'paid', totalCents: 0 }, input.reason, ctx), commandReceipt(db, command, ctx, hash, result), db.prepare('DELETE FROM crm_billing_write_guards WHERE id LIKE ?').bind(`${key}:%`)]);
    return result;
  }
  const selected = await method(db, old.paymentMethodId, old.customerId);
  verifyProvider(provider, selected);
  const next = billing.startBillingCharge(old, input, ctx), attempt = next.attempts.at(-1), orderId = await paymentOrderId(attempt.idempotencyKey), snapshot = safePaymentMethod(selected);
  const claim = { idempotency_key: attempt.idempotencyKey, invoice_id: old.id, attempt: attempt.attempt, method_id: selected.id, provider_order_id: orderId, amount_cents: next.totalCents, method_json: json(snapshot) };
  try {
    await db.batch([guard(db, `${key}:invoice`, old.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [old.id, ORG]), ...coverageSources.map(sub => guard(db, `${key}:source:${sub.id}`, sub.revision, '(SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?)', [sub.id, ORG])), writeInvoice(db, next), db.prepare("INSERT INTO crm_billing_attempts(idempotency_key,invoice_id,attempt,method_id,provider_order_id,amount_cents,method_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'charging',?,?)").bind(claim.idempotency_key, old.id, claim.attempt, selected.id, orderId, claim.amount_cents, claim.method_json, at(ctx), at(ctx)), audit(db, 'invoice', old.id, 'charge_claimed', { status: old.status }, { status: 'charging', idempotencyKey: attempt.idempotencyKey, orderId, amountCents: old.totalCents }, input.reason, ctx), commandReceipt(db, command, ctx, hash, { invoice: next }, 'claimed'), db.prepare('DELETE FROM crm_billing_write_guards WHERE id LIKE ?').bind(`${key}:%`)]);
  } catch (error) { const saved = await replay(db, ctx.actor, key, hash); if (saved) return { ...saved, invoice: await invoice(db, invoiceId) }; throw error; }
  let result;
  try { result = await provider.charge({ invoiceId: next.id, attempt: claim.attempt, idempotencyKey: claim.idempotency_key, amountCents: claim.amount_cents, method: snapshot, recurring: true }); }
  catch { result = { status: 'unknown', provider: snapshot.provider, orderId, amountCents: claim.amount_cents, processorCode: 'transport_unknown', reconcileRequired: true }; }
  return finishBillingAttempt(db, next, claim, result, ctx);
}

export async function reconcileBillingInvoice(db, invoiceId, input, ctx, { provider }) {
  assertPaymentsProvider(provider); const old = await invoice(db, invoiceId);
  fail(['charging', 'pending', 'paid'].includes(old.status), 'This invoice has no unsettled processor attempt.', 409);
  if (input.expectedRevision !== undefined) fail(input.expectedRevision === old.revision, 'Refresh this invoice before reconciling.', 409);
  const claim = await db.prepare('SELECT * FROM crm_billing_attempts WHERE invoice_id=? ORDER BY attempt DESC LIMIT 1').bind(old.id).first(); fail(claim, 'Durable attempt is missing.', 409);
  const saved = claim.result_json ? JSON.parse(claim.result_json) : {}, selected = JSON.parse(claim.method_json);
  verifyProvider(provider, selected);
  let raw;
  try { raw = await provider[selected.methodType === 'ach' ? 'pollAch' : 'inquire']({ transactionId: saved.transactionId || undefined, orderId: claim.provider_order_id, amountCents: claim.amount_cents, methodType: selected.methodType, fundingDate: input.fundingDate || at(ctx).slice(0, 10) }); }
  catch { raw = { status: 'unknown', amountCents: claim.amount_cents, processorCode: 'inquiry_unknown' }; }
  if (old.status === 'paid') {
    const result = normalizedResult(raw, claim);
    if (selected.methodType !== 'ach' || !result.achReturnCode || result.status !== 'failed') return { invoice: old, duplicate: true };
    const returnId = `ach_return:${claim.idempotency_key}:${result.achReturnCode}`;
    if (old.refunds.some(row => row.id === returnId)) return { invoice: old, duplicate: true };
    const next = billing.recordBillingAchReturn(old, { expectedRevision: old.revision, id: returnId, transactionId: `${result.transactionId || old.transactionId}:${result.achReturnCode}`, amountCents: old.totalCents - old.refundedCents, achReturnCode: result.achReturnCode, reason: 'Authenticated ACH return recorded separately from the original paid invoice' }, ctx), key = crypto.randomUUID();
    await db.batch([guard(db, key, old.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [old.id, ORG]), writeInvoice(db, next), audit(db, 'invoice', old.id, 'ach_return', { status: old.status, refundedCents: old.refundedCents }, { status: next.status, refundedCents: next.refundedCents, achReturnCode: result.achReturnCode }, 'ACH return requires office accounting review; no automatic re-debit', ctx), enqueue(db, 'ach_return', returnId, { invoice: old, returned: { ...next.refunds.at(-1), confirmed: true } }, old.id, ctx), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=?').bind(key)]);
    return { invoice: next };
  }
  return finishBillingAttempt(db, old, claim, raw, ctx);
}

export async function setDefaultBillingMethod(db, input, ctx) {
  request(input); const hash = await digest(input), prior = await replay(db, ctx.actor, input.requestId, hash); if (prior) return prior;
  const selected = await method(db, input.paymentMethodId, input.customerId), all = await methods(db, input.customerId), statements = [];
  for (const old of all) if (old.isDefault || old.id === selected.id) {
    const next = { ...safePaymentMethod(old), isDefault: old.id === selected.id };
    statements.push(guard(db, `${input.requestId}:${old.id}`, old.revision, '(SELECT revision FROM crm_billing_methods WHERE id=? AND organization_id=?)', [old.id, ORG]), db.prepare('UPDATE crm_billing_methods SET revision=revision+1,is_default=?,method_json=?,updated_at=? WHERE id=?').bind(0, json({ ...next, isDefault: false }), at(ctx), old.id), audit(db, 'payment_method', old.id, 'default_changed', safePaymentMethod(old), next, input.reason, ctx));
  }
  statements.push(db.prepare('UPDATE crm_billing_methods SET is_default=1,method_json=? WHERE id=?').bind(json({ ...safePaymentMethod(selected), isDefault: true }), selected.id));
  const result = { method: { ...selected, isDefault: true, revision: selected.revision + 1 } };
  await db.batch([...statements, commandReceipt(db, input, ctx, hash, result), db.prepare('DELETE FROM crm_billing_write_guards WHERE id LIKE ?').bind(`${input.requestId}:%`)]); return result;
}

function enqueue(db, kind, sourceKey, payload, invoiceId, ctx) {
  const job = { id: sourceKey, kind, payload, sourceSnapshot: canonical(payload), status: 'unsynced', qboId: null, attempts: 0, audit: [] };
  return db.prepare("INSERT INTO crm_billing_qbo_outbox(id,source_key,kind,invoice_id,status,job_json,updated_at) VALUES (?,?,?,?,'unsynced',?,?) ON CONFLICT(source_key) DO NOTHING").bind(sourceKey, sourceKey, kind, invoiceId || null, json(job), at(ctx));
}
export async function saveBillingSettings(db, input, ctx) {
  request(input); const hash = await digest(input), previous = await replay(db, ctx.actor, input.requestId, hash); if (previous) return previous;
  const old = await readBillingSettings(db);
  fail(input.expectedRevision === old.revision, 'Billing settings changed. Review them again.', 409);
  const allowed = new Set(['timeZone', 'draftDaysBefore', 'draftHour', 'draftMinute', 'chargeHour', 'chargeMinute', 'newClientFirstPeriodMode', 'includeNextFullMonth', 'taxBasisPoints', 'achDiscountBasisPoints', 'cardRetryDays', 'autoRetryCards', 'customerNoticesEnabled', 'qboMapping', 'achClearingTime']);
  fail(input.settings && Object.keys(input.settings).every(key => allowed.has(key)), 'Use supported billing settings only.');
  const settings = billing.defaultBillingSettings(input.settings), result = { settings: { ...settings, revision: old.revision + 1 } };
  await db.batch([
    guard(db, input.requestId, old.revision, '(SELECT COALESCE((SELECT revision FROM crm_billing_settings WHERE organization_id=?),0))', [ORG]),
    db.prepare('INSERT INTO crm_billing_settings(organization_id,revision,settings_json,updated_by,reason,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision,settings_json=excluded.settings_json,updated_by=excluded.updated_by,reason=excluded.reason,updated_at=excluded.updated_at').bind(ORG, old.revision + 1, json(settings), ctx.actor, note(input.reason), at(ctx)),
    audit(db, 'settings', ORG, 'settings_changed', old, result.settings, input.reason, ctx), commandReceipt(db, input, ctx, hash, result), db.prepare('DELETE FROM crm_billing_write_guards WHERE id=?').bind(input.requestId),
  ]); return result;
}
export async function registerBillingMethod(db, customerId, metadata, input, ctx) {
  await customer(db, customerId); const safe = safePaymentMethod(metadata), methodId = input.id || crypto.randomUUID(), previous = await methods(db, customerId);
  fail(id(methodId), 'Use a method ID.'); note(input.reason);
  const same = previous.find(item => item.provider === safe.provider && item.profileId === safe.profileId && item.profileAccountId === safe.profileAccountId);
  if (same) return { method: same, duplicate: true };
  const statements = [];
  if (safe.isDefault) for (const old of previous.filter(item => item.isDefault)) {
    const changed = { ...safePaymentMethod(old), isDefault: false };
    statements.push(db.prepare('UPDATE crm_billing_methods SET is_default=0,revision=revision+1,method_json=?,updated_at=? WHERE id=? AND customer_id=?').bind(json(changed), at(ctx), old.id, customerId), audit(db, 'payment_method', old.id, 'default_removed', safePaymentMethod(old), changed, input.reason, ctx));
  }
  statements.push(db.prepare('INSERT INTO crm_billing_methods(id,customer_id,organization_id,revision,is_default,method_json,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?)').bind(methodId, customerId, ORG, safe.isDefault ? 1 : 0, json(safe), at(ctx), at(ctx)), audit(db, 'payment_method', methodId, 'profile_registered', null, safe, input.reason, ctx));
  await db.batch(statements); return { method: { ...safe, id: methodId, customerId, revision: 1 } };
}
export async function createHostedBillingMethod(db, input, ctx, { provider }) {
  assertPaymentsProvider(provider); await customer(db, input.customerId);
  assertNoPaymentSecrets(input, { allowToken: true });
  fail(input.consent === true, 'Stored-payment authorization is required.');
  const operationId = crypto.randomUUID(), publicInput = { methodType: input.methodType, customerId: input.customerId, consent: true };
  await db.batch([audit(db, 'payment_method', operationId, 'hosted_profile_requested', null, publicInput, 'Hosted profile request with recorded customer authorization', ctx)]);
  try {
    const safe = await provider.createProfile({ token: input.token, methodType: input.methodType, expiry: input.expiry, billingZip: input.billingZip, consent: true, isDefault: input.isDefault === true });
    return await registerBillingMethod(db, input.customerId, safe, { reason: 'Processor-hosted UAT profile saved after authorization' }, ctx);
  } catch (error) {
    await db.batch([audit(db, 'payment_method', operationId, 'hosted_profile_unconfirmed', publicInput, { status: 'unconfirmed' }, 'Reconcile the UAT profile before attempting another save', ctx)]); throw error;
  }
}
async function currentMethod(db, value, input) {
  const all = await methods(db, value.customerId), chosen = input.paymentMethodId ? all.find(item => item.id === input.paymentMethodId) : all.find(item => item.id === value.paymentMethodId) || all.find(item => item.isDefault);
  fail(value.totalCents === 0 || chosen, 'A saved customer payment method is required.');
  return chosen;
}
async function verifyCoverageActive(db, value) {
  const source = await subscriptions(db, value.customerId);
  for (const snapshot of value.sourceRevisions || []) {
    const current = source.find(sub => sub.id === snapshot.subscriptionId);
    fail(current && (snapshot.billingDigest ? await subscriptionBillingDigest(current) === snapshot.billingDigest : current.revision === snapshot.revision), 'A subscription changed after this draft. Refresh and review it before collection.', 409);
  }
  for (const row of value.coverage || []) {
    const sub = source.find(item => item.id === row.subscriptionId);
    fail(sub && subscriptionView(sub, { date: row.startDate }).status === 'active', 'Service is paused, skipped or ended. Review the draft before approval or collection.', 409);
  }
  return source.filter(sub => value.subscriptionIds.includes(sub.id));
}
export async function runBillingCommand(db, input, ctx) {
  request(input); const hash = await digest(input), prior = await replay(db, ctx.actor, input.requestId, hash); if (prior) return prior;
  const ids = input.action === 'approve_batch' ? input.invoiceIds : [input.invoiceId];
  fail(Array.isArray(ids) && ids.length > 0 && ids.length <= 500 && new Set(ids).size === ids.length && ids.every(id), 'Choose distinct invoices.');
  const updates = [];
  for (const invoiceId of ids) {
    const old = await invoice(db, invoiceId);
    const expected = input.expectedRevisions?.[invoiceId] ?? input.expectedRevision;
    fail(expected === old.revision, 'The invoice changed. Review it again.', 409);
    const args = { ...input, expectedRevision: old.revision }; let next;
    if (['approve', 'approve_batch', 'retry'].includes(input.action)) {
      const chosen = await currentMethod(db, old, { ...input, paymentMethodId: input.paymentMethods?.[invoiceId] || input.paymentMethodId });
      args.coverageSources = await verifyCoverageActive(db, old);
      if (chosen) { args.paymentMethodId = chosen.id; args.methodType = chosen.methodType; }
      fail(!old.settingsSnapshot.achDiscountBasisPoints || !chosen || chosen.methodType === old.methodType, 'Refresh the draft for the selected method and review its ACH discount before approval.', 409);
      next = input.action === 'retry' ? billing.retryBillingInvoice(old, args, ctx) : billing.approveBillingInvoice(old, args, ctx);
    } else if (input.action === 'charge_now') {
      args.coverageSources = await verifyCoverageActive(db, old);
      next = billing.scheduleBillingChargeNow(old, args, ctx);
    } else if (input.action === 'edit') {
      const synced = await db.prepare("SELECT job_json FROM crm_billing_qbo_outbox WHERE source_key=?").bind(`invoice:${old.id}`).first();
      fail(!accountingLocked(synced), 'Accounting synchronization was attempted. Reconcile the accounting invoice before changing financial lines.', 409);
      next = billing.editBillingInvoice(old, args, ctx);
    } else if (input.action === 'hold') {
      const accounting = await db.prepare('SELECT job_json FROM crm_billing_qbo_outbox WHERE source_key=?').bind(`invoice:${old.id}`).first();
      fail(!accounting || JSON.parse(accounting.job_json).status !== 'syncing', 'Accounting synchronization is in progress. Reconcile it before changing this approval.', 409);
      next = billing.holdBillingInvoice(old, args, ctx);
    }
    else if (input.action === 'void') {
      const accounting = await db.prepare('SELECT job_json FROM crm_billing_qbo_outbox WHERE source_key=?').bind(`invoice:${old.id}`).first();
      fail(!accountingLocked(accounting), 'Accounting sync was attempted. Reconcile its invoice before voiding this draft.', 409);
      next = billing.voidBillingInvoice(old, args, ctx);
    }
    else if (input.action === 'credit') {
      if (old.status !== 'paid') {
        const accounting = await db.prepare('SELECT job_json FROM crm_billing_qbo_outbox WHERE source_key=?').bind(`invoice:${old.id}`).first();
      fail(!accountingLocked(accounting), 'Reconcile accounting before changing this invoice amount.', 409);
      }
      next = billing.recordBillingCredit(old, { ...args, id: input.requestId }, ctx);
    }
    else if (input.action === 'write_off') next = billing.writeOffBillingInvoice(old, args, ctx);
    else if (input.action === 'refresh') {
      const accounting = await db.prepare('SELECT job_json FROM crm_billing_qbo_outbox WHERE source_key=?').bind(`invoice:${old.id}`).first();
      fail(!accountingLocked(accounting), 'Reconcile the accounting invoice before refreshing financial lines.', 409);
      fail(['draft', 'approved', 'failed'].includes(old.status) && !old.reconciliationRequired && (!old.attempts.length || old.attempts.at(-1).status === 'failed'), 'Reconcile every processor attempt before refreshing a draft.', 409);
      const built = await buildInvoice(db, { ...old.builderInput, paymentMethodId: input.paymentMethodId, reason: input.reason }, ctx, old.id, old.id);
      next = { ...built.value, revision: old.revision + 1, attempts: old.attempts, createdAt: old.createdAt, held: old.held, holdReason: old.holdReason,
        audit: [...old.audit, { id: `${old.id}:audit:${old.revision + 1}`, actor: ctx.actor, at: at(ctx), action: 'draft_refreshed', oldValue: { totalCents: old.totalCents }, newValue: { totalCents: built.value.totalCents }, reason: input.reason }] };
      updates.push({ old, next, rebuilt: built }); continue;
    } else throw new BillingStoreError('Choose a supported invoice action.');
    updates.push({ old, next, coverageSources: args.coverageSources });
  }
  const result = { invoices: updates.map(item => item.next), invoice: updates.length === 1 ? updates[0].next : undefined };
  const statements = [];
  for (const { old, next, rebuilt, coverageSources } of updates) {
    if (input.action === 'credit' && old.status === 'paid') statements.push(guard(db, `${input.requestId}:${old.id}:adjustment`, 0, "(SELECT COUNT(*) FROM crm_billing_adjustments WHERE invoice_id=? AND status IN('requested','unknown'))", [old.id]));
    if (['edit', 'credit', 'refresh', 'void', 'hold'].includes(input.action) && old.status !== 'paid') statements.push(guard(db, `${input.requestId}:${old.id}:sync`, 0, "(SELECT COUNT(*) FROM crm_billing_qbo_outbox WHERE invoice_id=? AND status='syncing')", [old.id]));
    for (const sub of coverageSources || []) statements.push(guard(db, `${input.requestId}:${old.id}:sub:${sub.id}`, sub.revision, '(SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?)', [sub.id, ORG]));
    statements.push(guard(db, `${input.requestId}:${old.id}`, old.revision, '(SELECT revision FROM crm_billing_invoices WHERE id=? AND organization_id=?)', [old.id, ORG]), writeInvoice(db, next), audit(db, 'invoice', old.id, input.action, { status: old.status, totalCents: old.totalCents, revision: old.revision }, { status: next.status, totalCents: next.totalCents, revision: next.revision }, input.reason, ctx));
    if (rebuilt) {
      statements.push(db.prepare('DELETE FROM crm_billing_coverage WHERE invoice_id=?').bind(old.id), db.prepare("DELETE FROM crm_billing_credit_reservations WHERE invoice_id=? AND status='reserved'").bind(old.id), ...coverageStatements(db, next, rebuilt.credits));
    }
    if (['void', 'written_off'].includes(next.status)) statements.push(db.prepare('UPDATE crm_billing_coverage SET released_at=? WHERE invoice_id=? AND released_at IS NULL').bind(at(ctx), old.id), db.prepare("UPDATE crm_billing_credit_reservations SET status='released' WHERE invoice_id=? AND status='reserved'").bind(old.id));
    if (next.status === 'approved') statements.push(enqueue(db, 'invoice', `invoice:${old.id}`, next, old.id, ctx));
    if (input.action === 'credit' && old.status === 'paid') statements.push(enqueue(db, 'credit', `credit:${input.requestId}`, { invoice: old, credit: { ...next.credits.at(-1), confirmed: true } }, old.id, ctx));
    if (input.action === 'write_off') statements.push(enqueue(db, 'write_off', `write_off:${old.id}`, { invoice: next, writeOff: { id: input.requestId, amountCents: next.writtenOffCents, confirmed: true, at: at(ctx), reason: input.reason } }, old.id, ctx));
    if (['draft', 'void'].includes(next.status)) statements.push(db.prepare("DELETE FROM crm_billing_qbo_outbox WHERE source_key=? AND status='unsynced' AND COALESCE(json_extract(job_json,'$.attempts'),0)=0").bind(`invoice:${old.id}`));
  }
  statements.push(commandReceipt(db, input, ctx, hash, result), db.prepare('DELETE FROM crm_billing_write_guards WHERE id LIKE ?').bind(`${input.requestId}:%`));
  try { await db.batch(statements); }
  catch (error) { const saved = await replay(db, ctx.actor, input.requestId, hash); if (saved) return saved; if (/constraint|conflict/i.test(error.message)) throw new BillingStoreError('An invoice changed while this batch was being reviewed.', 409); throw error; }
  return result;
}
