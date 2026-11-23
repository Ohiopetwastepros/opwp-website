import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SubscriptionError } from '../lib/crm-subscriptions.mjs';
import { CrmSubscriptionStoreError, crmSubscriptionsEnabled, applyCrmSubscriptionPreview } from '../lib/crm-subscription-store.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { crmBillingEnabled } from '../lib/crm-billing-security.mjs';

const origin = 'https://example.test', actor = 'actual-admin@example.test';
function source(file) {
  return fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
}
function adminFixture({ authorized = true, enabled = true, billingEnabled = false, allowed = true, unavailable = false, failure = null } = {}) {
  const calls = [], env = { ROUTE_OS_SUBSCRIPTIONS_ENABLED: enabled ? 'true' : 'false', APP_ENV: 'test', ROUTE_OS_BILLING_ENABLED: billingEnabled ? 'true' : 'false', CRM_PAYMENTS_ENV: 'uat' }, db = {};
  const invoke = (name, value = {}) => async (...args) => { calls.push({ name, args }); if (failure) throw failure; return value; };
  const context = {
    Response, URL, RangeError, SubscriptionError, CrmSubscriptionStoreError, readBoundedProviderJson, crmSubscriptionsEnabled, crmBillingEnabled,
    verifyAdminRequest: async () => ({ authorized, email: actor }), getRuntimeEnv: () => env,
    getDb: () => { calls.push({ name: 'db' }); return db; },
    checkRateLimit: async () => ({ allowed, unavailable }),
    rateLimitResponse: rate => Response.json({ ok: false, error: 'Rate protection unavailable' }, { status: rate.unavailable ? 503 : 429 }),
    readCrmAdmin: invoke('read', { subscriptions: [], customers: [], view: 'active' }),
    prepareCrmSubscriptionChange: invoke('preview', { token: 'preview-token', previewOnly: true }),
    applyCrmSubscriptionPreview: invoke('apply', { applied: true }),
    saveCrmSubscriptionCustomer: invoke('customer', { id: 'customer-a' }),
    linkCrmSubscriptionPortal: invoke('link', { linked: true }),
  };
  return { api: vm.runInNewContext(`${source('../app/api/admin/crm/subscriptions/route.js')}\n({GET,POST})`, context), calls };
}
function portalFixture({ authenticated = true, enabled = true, failure = null } = {}) {
  const calls = [], account = { id: 'verified-account-a', customer_id: 'native-food-customer-a', email: 'own@example.test' };
  const context = {
    Response, URL, SubscriptionError, CrmSubscriptionStoreError, crmSubscriptionsEnabled,
    getDb: () => ({}), getRuntimeEnv: () => ({ ROUTE_OS_SUBSCRIPTIONS_ENABLED: enabled ? 'true' : 'false' }),
    foodAccountSession: async () => authenticated ? account : null,
    readCrmPortal: async (...args) => { calls.push(args); if (failure) throw failure; return { linked: true, subscriptions: [{ id: 'active-own', status: 'active' }, { id: 'past-own', status: 'cancelled' }], nextCursor: 'next-own' }; },
  };
  const api = vm.runInNewContext(`${source('../app/api/crm/subscriptions/portal/route.js')}\n({GET})`, context);
  return { api, calls };
}
const get = suffix => new Request(`${origin}/api/admin/crm/subscriptions/${suffix || ''}`);
const post = (body, headers = { origin, 'content-type': 'application/json' }) => new Request(`${origin}/api/admin/crm/subscriptions/`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('admin subscription APIs reject unauthenticated, expired, portal and field sessions before data access', async () => {
  for (const cookie of ['', '__Host-opwp-food=portal-session', 'opwp_field=field-session', '__Host-opwp_admin_mfa=expired']) {
    const fixture = adminFixture({ authorized: false });
    const request = post({ action: 'preview', operation: 'create' }, { origin, cookie });
    assert.equal((await fixture.api.GET(get())).status, 401); assert.equal((await fixture.api.POST(request)).status, 401);
    assert.equal(fixture.calls.length, 0);
  }
});

test('subscription rollout is closed by default without reading or mutating the proposed schema', async () => {
  assert.equal(crmSubscriptionsEnabled({}), false); assert.equal(crmSubscriptionsEnabled({ ROUTE_OS_SUBSCRIPTIONS_ENABLED: true }), false);
  const fixture = adminFixture({ enabled: false });
  const response = await fixture.api.GET(get()), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.enabled, false); assert.deepEqual(body.subscriptions, []);
  assert.equal((await fixture.api.POST(post({ action: 'apply', previewToken: 'anything' }))).status, 503);
  assert.equal(fixture.calls.length, 0);
});

test('Active is the admin default and Past/All selections are forwarded with the selected customer only', async () => {
  for (const view of ['', 'past', 'all']) {
    const fixture = adminFixture();
    const response = await fixture.api.GET(get(`?customerId=customer-a${view ? `&view=${view}` : ''}`));
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    const read = fixture.calls.find(call => call.name === 'read');
    assert.equal(read.args[1].customerId, 'customer-a'); assert.equal(read.args[1].view, view || 'active');
  }
});

test('cross-site mutations, missing origin and failed abuse controls cannot reach subscription services', async () => {
  for (const headers of [{}, { origin: 'https://other.test' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
    const fixture = adminFixture();
    assert.equal((await fixture.api.POST(post({ action: 'preview' }, headers))).status, 403); assert.equal(fixture.calls.length, 0);
  }
  for (const options of [{ allowed: false }, { allowed: false, unavailable: true }]) {
    const fixture = adminFixture(options), response = await fixture.api.POST(post({ action: 'apply' }));
    assert.equal(response.status, options.unavailable ? 503 : 429); assert.equal(fixture.calls.length, 0);
  }
});

test('bounded JSON rejects malformed and oversized changes before calling the domain or store', async () => {
  for (const [body, status] of [['{invalid', 400], ['null', 400], ['[]', 400], ['1', 400], [JSON.stringify({ action: 'preview', notes: 'x'.repeat(65536) }), 413]]) {
    const fixture = adminFixture();
    assert.equal((await fixture.api.POST(post(body))).status, status); assert.equal(fixture.calls.length, 0);
  }
});

test('preview and apply are separate operations and audit identity comes from admin auth', async () => {
  const preview = adminFixture();
  const response = await preview.api.POST(post({ action: 'preview', operation: 'amend', actor: 'forged@example.test', expectedRevision: 4 }));
  assert.equal(response.status, 200); assert.equal((await response.json()).preview.token, 'preview-token');
  assert.equal(preview.calls.filter(call => call.name === 'apply').length, 0);
  assert.equal(preview.calls.find(call => call.name === 'preview').args[1], actor);
  const apply = adminFixture();
  assert.equal((await apply.api.POST(post({ action: 'apply', previewToken: 'reviewed-token', requestId: 'request-id', actor: 'forged@example.test' }))).status, 200);
  assert.equal(apply.calls.find(call => call.name === 'apply').args[1], actor);
  assert.equal(apply.calls.find(call => call.name === 'apply').args[2], 'reviewed-token');
});

test('bulk, customer and portal-link actions retain their distinct server paths', async () => {
  for (const [body, expected] of [
    [{ action: 'preview_bulk_reprice', subscriptionIds: ['sub-a'] }, 'preview'],
    [{ action: 'apply_bulk_reprice', previewToken: 'reviewed', requestId: 'request' }, 'apply'],
    [{ action: 'save_customer', requestId: crypto.randomUUID(), id: 'customer-a', name: 'Sample Customer', reason: 'Reviewed' }, 'customer'],
    [{ action: 'link_portal', requestId: crypto.randomUUID(), accountId: 'account-a', customerId: 'customer-a', verified: true, reason: 'Reviewed exact identity' }, 'link'],
  ]) {
    const fixture = adminFixture(); assert.equal((await fixture.api.POST(post(body))).status, 200);
    const call = fixture.calls.find(item => item.name === expected); assert.ok(call); assert.equal(call.args[1], actor);
    if (body.action === 'preview_bulk_reprice') assert.equal(call.args[2].operation, 'bulk_reprice');
  }
});

test('expected conflicts remain actionable while internal storage errors remain private', async () => {
  const conflict = adminFixture({ failure: new CrmSubscriptionStoreError('Preview changed; refresh first.', 409) });
  assert.equal((await conflict.api.POST(post({ action: 'apply' }))).status, 409);
  const internal = adminFixture({ failure: new Error('SQLITE private_customer_table private@example.test') });
  const response = await internal.api.GET(get()); assert.equal(response.status, 503);
  const body = await response.text(); assert.ok(!body.includes('SQLITE')); assert.ok(!body.includes('private@example.test'));
});

test('billing rollout preserves subscription reads while routing legacy invoice previews and old applies through the billing guard', async () => {
  const fixture = adminFixture({ billingEnabled: true });
  const read = await fixture.api.GET(get()); assert.equal(read.status, 200); assert.equal((await read.json()).enabled, true);
  assert.equal((await fixture.api.POST(post({ action: 'preview', operation: 'invoice' }))).status, 409);
  assert.equal(fixture.calls.some(call => call.name === 'preview'), false);
  assert.equal((await fixture.api.POST(post({ action: 'apply', previewToken: 'old-invoice-preview', requestId: crypto.randomUUID() }))).status, 200);
  assert.equal(fixture.calls.find(call => call.name === 'apply').args[4].allowLegacyInvoice, false);
});

test('a previously prepared legacy invoice preview cannot be applied once billing owns invoices', async () => {
  let writes = 0;
  const db = { prepare(sql) { return { bind() { return { async first() {
    if (sql.includes('crm_subscription_previews')) return { consumed_at: null, expires_at: '2027-01-01T00:00:00Z', preview_json: JSON.stringify({ command: { operation: 'invoice' } }) };
    return null;
  } }; } }; }, async batch() { writes++; throw new Error('Unexpected legacy invoice write'); } };
  await assert.rejects(applyCrmSubscriptionPreview(db, actor, 'old-invoice-preview', crypto.randomUUID(), { now: Date.parse('2026-12-01T00:00:00Z'), allowLegacyInvoice: false }), /billing review workspace/);
  assert.equal(writes, 0);
});

test('portal history uses the verified account ID, ignores supplied identities/Active filter and retains past rows', async () => {
  const fixture = portalFixture(), response = await fixture.api.GET(new Request(`${origin}/api/crm/subscriptions/portal/?customerId=other-customer&accountId=other-account&view=active&cursor=own-cursor`));
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  const body = await response.json(); assert.deepEqual(body.subscriptions.map(sub => sub.status), ['active', 'cancelled']);
  assert.equal(body.nextCursor, 'next-own'); assert.equal(fixture.calls[0][1], 'verified-account-a');
  assert.equal(fixture.calls[0][2].cursor, 'own-cursor'); assert.deepEqual(Object.keys(fixture.calls[0][2]), ['cursor']);
});

test('portal denies missing/expired sessions and disabled rollout, and hides internal errors', async () => {
  const missing = portalFixture({ authenticated: false });
  assert.equal((await missing.api.GET(get())).status, 401); assert.equal(missing.calls.length, 0);
  const disabled = portalFixture({ enabled: false });
  assert.equal((await disabled.api.GET(get())).status, 503); assert.equal(disabled.calls.length, 0);
  const broken = portalFixture({ failure: new Error('SQLITE private billing table') });
  const response = await broken.api.GET(get()); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('SQLITE'));
});
