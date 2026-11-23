import * as model from './crm-subscriptions.mjs';
import { defaultCrmPriceBook } from './crm-price-book.mjs';
import { renderSubscriptionDocument } from './crm-subscription-documents.mjs';
import { operatingDate } from './field-policy.mjs';

const ORG = 'org-opwp';
export class CrmSubscriptionStoreError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'CrmSubscriptionStoreError'; this.status = status; }
}
const fail = (condition, message, status = 400) => { if (!condition) throw new CrmSubscriptionStoreError(message, status); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const reason = value => { fail(typeof value === 'string' && value.trim().length >= 1 && value.length <= 2000, 'Enter a reason for this change.'); return value.trim(); };
const json = value => { const result = JSON.stringify(value); fail(new TextEncoder().encode(result).length <= 1024 * 1024, 'This subscription needs archival review before more changes can be saved.', 413); return result; };
const context = (actor, now) => ({ actor, at: new Date(now).toISOString(), today: operatingDate(new Date(now)) });
const rows = async (db, sql, values = []) => (await db.prepare(sql).bind(...values).all()).results || [];
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(value))))), b => b.toString(16).padStart(2, '0')).join('');

export const crmSubscriptionsEnabled = env => env?.ROUTE_OS_SUBSCRIPTIONS_ENABLED === 'true';
export async function readCrmPriceBook(db) {
  const row = await db.prepare('SELECT body_json FROM crm_subscription_books WHERE organization_id=?').bind(ORG).first();
  const book = row ? JSON.parse(row.body_json) : defaultCrmPriceBook();
  model.validatePriceBook(book);
  return book;
}
async function customer(db, customerId) {
  fail(id(customerId), 'Choose a customer.');
  const value = await db.prepare('SELECT id,display_name,revision FROM crm_subscription_customers WHERE id=? AND organization_id=?').bind(customerId, ORG).first();
  fail(value, 'The customer was not found.', 404);
  return { id: value.id, name: value.display_name, revision: value.revision };
}
async function subscription(db, subscriptionId) {
  fail(id(subscriptionId), 'Choose a subscription.');
  const row = await db.prepare('SELECT state_json FROM crm_subscriptions WHERE id=? AND organization_id=?').bind(subscriptionId, ORG).first();
  fail(row, 'The subscription was not found.', 404);
  return JSON.parse(row.state_json);
}
async function allSubscriptions(db) {
  const result = []; let cursor = '';
  for (;;) {
    const page = await rows(db, 'SELECT id,state_json FROM crm_subscriptions WHERE organization_id=? AND id>? ORDER BY id LIMIT 250', [ORG, cursor]);
    result.push(...page.map(row => JSON.parse(row.state_json)));
    fail(result.length <= 10000, 'The report exceeds its safe size. Review a narrower reporting partition.', 413);
    if (page.length < 250) return result;
    cursor = page.at(-1).id;
  }
}
export async function readCrmAdmin(db, { customerId = '', view = 'active', date = operatingDate() } = {}) {
  fail(['active', 'past', 'all'].includes(view), 'Choose Active, Past or All.');
  const [book, customers, subs] = await Promise.all([
    readCrmPriceBook(db), rows(db, 'SELECT id,display_name AS name,revision FROM crm_subscription_customers WHERE organization_id=? ORDER BY display_name,id LIMIT 2001', [ORG]), allSubscriptions(db),
  ]);
  fail(customers.length <= 2000, 'Customer directory exceeds its safe size. Add paginated directory access before continuing.', 413);
  if (customerId) await customer(db, customerId);
  const selected = customerId ? subs.filter(sub => sub.customerId === customerId) : subs;
  return { customers, priceBook: book, subscriptions: model.filterSubscriptions(selected, view, date).map(sub => model.subscriptionView(sub, { date, book })), report: model.subscriptionReport(subs, book, date), view, date };
}

function documentFor(value) {
  if (!value) return null;
  return { currency: 'USD', billingInterval: 'monthly', lineItems: value.currentLines || value.lineItems || [], totalCents: value.totalCents, billingPeriodEnd: value.billingPeriodEnd || value.periodEnd };
}
async function operation(db, actor, command, book, now) {
  const ctx = context(actor, now), input = { ...command, effectiveDate: command.effectiveDate || ctx.today };
  const operationName = command.operation;
  if (operationName === 'price_book') {
    fail(command.expectedVersion === book.version, 'The price book changed. Preview it again.', 409);
    const next = { ...command.priceBook, id: book.id, version: book.version + 1 };
    model.validatePriceBook(next); reason(command.reason);
    return { updates: [], book: next, preview: { operation: operationName, oldPriceBook: book, priceBook: next, subscriptionsRepriced: 0 } };
  }
  let current = null, next, invoice = null, proration = null;
  if (operationName === 'create') {
    await customer(db, command.customerId);
    next = model.createSubscription({ ...input, id: command.id }, book, ctx);
  } else {
    current = await subscription(db, command.subscriptionId);
    if (command.customerId) fail(current.customerId === command.customerId, 'The subscription does not belong to this customer.', 403);
    fail(command.expectedRevision === current.revision, 'This subscription changed. Preview it again.', 409);
    if (['amend', 'schedule_change'].includes(operationName)) {
      next = model.amendSubscription(current, input, book, ctx);
    } else if (operationName === 'cancel') next = model.cancelSubscription(current, { ...input, endDate: input.endDate || input.effectiveDate }, ctx);
    else if (operationName === 'pause') next = model.pauseSubscription(current, { ...input, startDate: input.startDate || input.effectiveDate }, ctx);
    else if (operationName === 'skip') next = model.skipSubscription(current, { ...input, startDate: input.startDate || input.effectiveDate }, ctx);
    else if (operationName === 'promise_credit') next = model.promiseSubscriptionCredit(current, input, ctx);
    else if (operationName === 'resume') next = model.resumeSubscription(current, input, ctx);
    else if (operationName === 'acknowledge_notice') next = model.acknowledgeSubscriptionNotice(current, input, ctx);
    else if (operationName === 'invoice') {
      const result = model.issueSubscriptionInvoice(current, input, ctx); next = result.subscription; invoice = result.invoice;
    } else if (operationName === 'process_due') next = model.advanceSubscription(current, ctx);
    else throw new CrmSubscriptionStoreError('Choose a supported subscription operation.');
  }
  const customerRecord = await customer(db, next.customerId);
  const view = model.subscriptionView(next, { date: input.effectiveDate, book });
  if (current && !['invoice', 'process_due'].includes(operationName))
    proration = model.previewSubscriptionChangeProration(current, next, input.endDate || input.startDate || input.effectiveDate, { date: ctx.today });
  const document = documentFor(invoice || view);
  const credit = operationName === 'promise_credit' ? { amountCents: input.amountCents, recurringRateUnchanged: true } : null;
  const documentSelection = invoice ? next.versions.find(version => version.id === invoice.versionId)?.selection : view;
  const details = { customerName: customerRecord.name, reference: invoice?.id || next.id, billingPeriodEnd: invoice?.periodEnd || view.billingPeriodEnd, effectiveDate: input.effectiveDate, status: view.status, promisedCreditCents: credit?.amountCents, frequency: documentSelection?.frequency, dogCount: documentSelection?.dogCount };
  return { updates: [{ current, next }], preview: { operation: operationName, subscription: view, invoice, proration, credit,
    customerDocument: renderSubscriptionDocument(invoice ? 'invoice' : 'quote', document, details), confirmationEmail: renderSubscriptionDocument('confirmation', document, details) } };
}

export async function prepareCrmSubscriptionChange(db, actor, command, { now = Date.now() } = {}) {
  fail(command && typeof command === 'object' && !Array.isArray(command), 'Choose a subscription change.');
  const book = await readCrmPriceBook(db), ctx = context(actor, now);
  const normalized = { ...command, effectiveDate: command.effectiveDate || ctx.today };
  if (command.operation === 'create') { normalized.id = crypto.randomUUID(); normalized.effectiveDate = command.startDate || ctx.today; }
  if (command.operation === 'invoice') normalized.id = crypto.randomUUID();
  let plan;
  if (command.operation === 'bulk_reprice') {
    const subs = await allSubscriptions(db);
    const selected = selectBulk(subs, command.subscriptionIds);
    const proposal = model.previewBulkReprice(selected, book, normalized);
    const updated = model.applyBulkReprice(selected, proposal, book, ctx);
    const nextSubs = Array.isArray(updated) ? updated : updated.subscriptions;
    const billingImpacts = nextSubs.map(next => ({ subscriptionId: next.id, ...model.previewSubscriptionChangeProration(selected.find(sub => sub.id === next.id), next, normalized.effectiveDate, { date: ctx.today }) }));
    plan = { updates: nextSubs.map(next => ({ current: selected.find(sub => sub.id === next.id), next })), preview: { operation: 'bulk_reprice', bulk: proposal, billingImpacts, subscriptions: nextSubs.map(sub => model.subscriptionView(sub, { date: normalized.effectiveDate, book })) } };
  } else plan = await operation(db, actor, normalized, book, now);
  const token = crypto.randomUUID(), expiresAt = new Date(now + 15 * 60000).toISOString();
  const preview = { ...plan.preview, token, expiresAt };
  const stored = { command: normalized, bookVersion: book.version, bookDigest: await digest(book), expected: plan.updates.map(({ current, next }) => ({ id: next.id, revision: current?.revision ?? null })), preview };
  await db.prepare('INSERT INTO crm_subscription_previews(token,organization_id,actor,preview_json,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind(token, ORG, actor, json(stored), ctx.at, expiresAt).run();
  return preview;
}
function selectBulk(subs, supplied) {
  fail(Array.isArray(supplied) && supplied.length > 0 && supplied.length <= 500 && new Set(supplied).size === supplied.length && supplied.every(id), 'Select up to 500 distinct subscriptions.');
  const selected = supplied.map(value => subs.find(sub => sub.id === value));
  fail(selected.every(Boolean), 'A selected subscription was not found.', 404);
  return selected;
}
function guard(db, key, expected, actualSql, args) {
  return db.prepare(`INSERT INTO crm_subscription_write_guards(id,expected_revision,actual_revision) VALUES (?,?,${actualSql})`).bind(key, expected, ...args);
}
async function receipt(db, actor, requestId, hash) {
  const saved = await db.prepare('SELECT actor,organization_id,body_hash,result_json FROM crm_subscription_commands WHERE id=?').bind(requestId).first();
  if (!saved) return null;
  fail(saved.actor === actor && saved.organization_id === ORG && saved.body_hash === hash, 'This request ID was already used for different content.', 409);
  return { ...JSON.parse(saved.result_json), duplicate: true };
}
export async function applyCrmSubscriptionPreview(db, actor, previewToken, requestId, { now = Date.now(), allowLegacyInvoice = true } = {}) {
  fail(id(previewToken) && /^[a-f0-9-]{36}$/i.test(requestId || ''), 'Use the reviewed preview and a request ID.');
  const hash = await digest({ previewToken }), replay = await receipt(db, actor, requestId, hash);
  if (replay) return replay;
  const row = await db.prepare('SELECT * FROM crm_subscription_previews WHERE token=? AND organization_id=? AND actor=?').bind(previewToken, ORG, actor).first();
  fail(row && !row.consumed_at && Date.parse(row.expires_at) > now, 'This preview expired or was applied. Preview the change again.', 409);
  const stored = JSON.parse(row.preview_json), book = await readCrmPriceBook(db);
  fail(allowLegacyInvoice || stored.command.operation !== 'invoice', 'Prepare invoices in the billing review workspace.', 409);
  fail(stored.bookVersion === book.version && stored.bookDigest === await digest(book), 'The price book changed. Preview the change again.', 409);
  const ctx = context(actor, now); let plan;
  if (stored.command.operation === 'bulk_reprice') {
    const selected = selectBulk(await allSubscriptions(db), stored.command.subscriptionIds);
    const proposed = model.previewBulkReprice(selected, book, stored.command);
    const applied = model.applyBulkReprice(selected, proposed, book, ctx), updated = Array.isArray(applied) ? applied : applied.subscriptions;
    plan = { updates: updated.map(next => ({ current: selected.find(sub => sub.id === next.id), next })), preview: { operation: 'bulk_reprice', subscriptions: updated.map(sub => model.subscriptionView(sub, { date: stored.command.effectiveDate, book })) } };
  } else plan = await operation(db, actor, stored.command, book, now);
  fail(plan.updates.length === stored.expected.length && plan.updates.every(({ current, next }) => stored.expected.some(item => item.id === next.id && item.revision === (current?.revision ?? null))), 'Subscriptions changed after preview. Preview again.', 409);
  const result = { applied: true, operation: stored.command.operation, ...plan.preview };
  const statements = [
    guard(db, `${requestId}:preview`, 0, "(SELECT CASE WHEN consumed_at IS NULL THEN 0 ELSE 1 END FROM crm_subscription_previews WHERE token=?)", [previewToken]),
    guard(db, `${requestId}:book`, book.version, '(SELECT COALESCE((SELECT version FROM crm_subscription_books WHERE organization_id=?),1))', [ORG]),
    guard(db, `${requestId}:book-body`, 1, '(SELECT COALESCE((SELECT CASE WHEN body_json=? THEN 1 ELSE 0 END FROM crm_subscription_books WHERE organization_id=?),1))', [json(book), ORG]),
    // The first accepted command freezes the reviewed seed as an actual book.
    // Later code-only seed changes cannot silently redefine book version one.
    db.prepare('INSERT INTO crm_subscription_books(organization_id,version,body_json,updated_by,change_reason,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id) DO NOTHING').bind(ORG, book.version, json(book), actor, 'Initial reviewed price-book snapshot', ctx.at),
  ];
  for (const { current, next } of plan.updates) {
    statements.push(guard(db, `${requestId}:${next.id}`, current?.revision ?? -1, '(SELECT COALESCE((SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?),-1))', [next.id, ORG]));
    statements.push(db.prepare('INSERT INTO crm_subscriptions(id,organization_id,customer_id,revision,state_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,updated_at=excluded.updated_at').bind(next.id, ORG, next.customerId, next.revision, json(next), ctx.at));
  }
  if (plan.book) statements.push(db.prepare('INSERT INTO crm_subscription_books(organization_id,version,body_json,updated_by,change_reason,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_by=excluded.updated_by,change_reason=excluded.change_reason,updated_at=excluded.updated_at').bind(ORG, plan.book.version, json(plan.book), actor, reason(stored.command.reason), ctx.at));
  statements.push(db.prepare('UPDATE crm_subscription_previews SET consumed_at=? WHERE token=?').bind(ctx.at, previewToken));
  statements.push(db.prepare('INSERT INTO crm_subscription_commands(id,organization_id,actor,body_hash,result_json,created_at) VALUES (?,?,?,?,?,?)').bind(requestId, ORG, actor, hash, json(result), ctx.at));
  statements.push(db.prepare('DELETE FROM crm_subscription_write_guards WHERE id LIKE ?').bind(`${requestId}:%`));
  try { await db.batch(statements); }
  catch (error) { const prior = await receipt(db, actor, requestId, hash); if (prior) return prior; if (/constraint|conflict/i.test(error.message)) throw new CrmSubscriptionStoreError('This change conflicted with newer work. Preview it again.', 409); throw error; }
  return result;
}

export async function saveCrmSubscriptionCustomer(db, actor, input, { now = Date.now() } = {}) {
  const customerId = input.id || crypto.randomUUID();
  fail(id(customerId) && typeof input.name === 'string' && input.name.trim() && input.name.length <= 200, 'Enter a customer name and valid ID.');
  const note = reason(input.reason), ctx = context(actor, now);
  const prior = await db.prepare('SELECT revision,display_name,updated_by,change_reason FROM crm_subscription_customers WHERE id=? AND organization_id=?').bind(customerId, ORG).first();
  if (prior?.revision === 1 && (input.expectedRevision ?? 0) === 0 && prior.display_name === input.name.trim() && prior.updated_by === actor && prior.change_reason === note)
    return { id: customerId, name: prior.display_name, revision: prior.revision, duplicate: true };
  fail((prior?.revision ?? 0) === (input.expectedRevision ?? 0), 'This customer changed. Refresh first.', 409);
  const result = await db.prepare('INSERT INTO crm_subscription_customers(id,organization_id,display_name,revision,updated_by,change_reason,created_at,updated_at) VALUES (?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,revision=crm_subscription_customers.revision+1,updated_by=excluded.updated_by,change_reason=excluded.change_reason,updated_at=excluded.updated_at WHERE crm_subscription_customers.organization_id=excluded.organization_id AND crm_subscription_customers.revision=? RETURNING id,display_name AS name,revision').bind(customerId, ORG, input.name.trim(), actor, note, ctx.at, ctx.at, input.expectedRevision ?? 0).first();
  fail(result, 'This customer changed. Refresh first.', 409); return result;
}
export async function linkCrmSubscriptionPortal(db, actor, input, { now = Date.now() } = {}) {
  fail(input.verified === true, 'Confirm that this exact customer and portal account relationship was reviewed.');
  await customer(db, input.customerId); fail(id(input.accountId), 'Choose a verified portal account.');
  const account = await db.prepare('SELECT id FROM dog_food_accounts WHERE id=? AND verified_at IS NOT NULL').bind(input.accountId).first();
  fail(account, 'The verified portal account was not found.', 404);
  const old = await db.prepare('SELECT customer_id FROM crm_subscription_portal_links WHERE account_id=?').bind(input.accountId).first();
  fail(!old || old.customer_id === input.customerId, 'This portal account is already linked to another CRM customer. Review identity separately.', 409);
  await db.prepare('INSERT INTO crm_subscription_portal_links(account_id,organization_id,customer_id,verified_by,verification_reason,verified_at) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id) DO NOTHING').bind(input.accountId, ORG, input.customerId, actor, reason(input.reason), new Date(now).toISOString()).run();
  const saved = await db.prepare('SELECT customer_id FROM crm_subscription_portal_links WHERE account_id=? AND organization_id=?').bind(input.accountId, ORG).first();
  fail(saved?.customer_id === input.customerId, 'Portal identity changed. Review the link.', 409);
  return { linked: true };
}
export async function readCrmPortal(db, accountId, { cursor = '', limit = 100, date = operatingDate() } = {}) {
  fail(id(accountId) && (!cursor || id(cursor)), 'Invalid history request.');
  const link = await db.prepare('SELECT customer_id FROM crm_subscription_portal_links WHERE account_id=? AND organization_id=?').bind(accountId, ORG).first();
  if (!link) return { linked: false, subscriptions: [], nextCursor: null };
  const pageSize = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 100));
  const [page, book] = await Promise.all([rows(db, 'SELECT id,state_json FROM crm_subscriptions WHERE customer_id=? AND organization_id=? AND id>? ORDER BY id LIMIT ?', [link.customer_id, ORG, cursor, pageSize + 1]), readCrmPriceBook(db)]);
  const visible = page.slice(0, pageSize);
  return { linked: true, subscriptions: model.customerSubscriptionHistory(visible.map(row => JSON.parse(row.state_json)), link.customer_id, { date, book }), nextCursor: page.length > pageSize ? visible.at(-1).id : null };
}

export async function processDueCrmSubscriptions(env, { now = Date.now() } = {}) {
  if (!crmSubscriptionsEnabled(env) || !env.DB) return { status: 'disabled', updated: 0 };
  const db = env.DB, subs = await allSubscriptions(db), ctx = context('system:subscription-schedule', now); let updated = 0;
  for (const current of subs) {
    const next = model.advanceSubscription(current, ctx);
    if (JSON.stringify(current) === JSON.stringify(next)) continue;
    const key = crypto.randomUUID();
    await db.batch([
      guard(db, key, current.revision, '(SELECT revision FROM crm_subscriptions WHERE id=? AND organization_id=?)', [current.id, ORG]),
      db.prepare('UPDATE crm_subscriptions SET revision=?,state_json=?,updated_at=? WHERE id=? AND organization_id=?').bind(next.revision, json(next), ctx.at, current.id, ORG),
      db.prepare('DELETE FROM crm_subscription_write_guards WHERE id=?').bind(key),
    ]); updated++;
  }
  return { status: 'complete', updated };
}
