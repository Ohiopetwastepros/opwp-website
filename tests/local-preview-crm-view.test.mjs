import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { localPreviewPaymentOrigin } from '../lib/local-preview-payments.mjs';
import { createLocalPreviewCrmSeed } from '../scripts/local-preview-crm-seed.mjs';
import { createLocalPreviewFieldSeed } from '../scripts/local-preview-field-seed.mjs';
import { officeWorkdays } from '../lib/field-workday-office.mjs';
import { FieldError } from '../lib/field-policy.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { technicianText } from '../lib/field-technician-view.mjs';

const origin = 'http://localhost:8787';
const localEnv = { APP_ENV: 'development', LOCAL_PREVIEW_ENABLED: 'true', LOCAL_PREVIEW_ORIGIN: origin, CRM_PAYMENTS_PROVIDER: 'fake', CRM_PAYMENTS_ENV: 'uat', ROUTE_OS_BILLING_ENABLED: 'true' };
const source = fs.readFileSync(new URL('../app/api/local-preview/crm-view/route.js', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
class PreviewDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-21T17:00:00Z'])); } }
function api({ authorized = true, env = {}, database = null } = {}) {
  const calls = [];
  const context = { Response, Intl, Date: PreviewDate, JSON, localPreviewPaymentOrigin, officeWorkdays,
    getRuntimeEnv: () => ({ ...localEnv, ...env }),
    verifyAdminRequest: async () => { calls.push('auth'); return { authorized }; },
    getDb: () => { calls.push('db'); return database; },
  };
  return { ...vm.runInNewContext(`${source}\n({GET})`, context), calls };
}
const request = (base = origin) => new Request(`${base}/api/local-preview/crm-view/`);

test('local CRM view rejects external origins and disabled or live-provider environments before reading state', async () => {
  for (const env of [{ APP_ENV: 'production' }, { LOCAL_PREVIEW_ENABLED: 'false' }, { CRM_PAYMENTS_PROVIDER: 'cardpointe' }, { CRM_PAYMENTS_ENV: 'production' }, { ROUTE_OS_BILLING_ENABLED: 'false' }, { LOCAL_PREVIEW_ORIGIN: 'https://example.test' }]) {
    const f = api({ env }); assert.equal((await f.GET(request())).status, 404); assert.equal(f.calls.length, 0);
  }
  const outside = api(); assert.equal((await outside.GET(request('https://example.test'))).status, 404); assert.equal(outside.calls.length, 0);
});

test('local CRM view requires an administrator session before accessing contact or route records', async () => {
  const f = api({ authorized: false }), response = await f.GET(request());
  assert.equal(response.status, 401); assert.deepEqual(f.calls, ['auth']);
  assert.match(response.headers.get('cache-control'), /private.*no-store/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('local CRM view reads actual seeded schemas without writes and returns current native route and service statuses', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    for (const file of fs.readdirSync(new URL('../tmp/test-migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(new URL(`../tmp/test-migrations/${file}`, import.meta.url), 'utf8'));
    for (const file of ['0070_crm_subscriptions.sql', '0071_crm_billing_uat.sql']) sql.exec(fs.readFileSync(new URL(`../schema-proposals/${file}`, import.meta.url), 'utf8'));
    const crm = await createLocalPreviewCrmSeed({ today: '2026-11-21' }), field = createLocalPreviewFieldSeed({ today: '2026-11-21' });
    sql.exec(crm.sql); sql.exec(field.sql);
    const firstTask = sql.prepare('SELECT id FROM route_partner_tasks ORDER BY id LIMIT 1').get().id;
    sql.prepare("UPDATE route_partner_tasks SET status='failed' WHERE id=?").run(firstTask);
    const before = sql.prepare('SELECT total_changes() AS n').get().n;
    const database = { prepare(query) { return { bind(...bindings) { return { async all() { return { results: sql.prepare(query).all(...bindings) }; } }; } }; } };
    const f = api({ database }), response = await f.GET(request()), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.date, '2026-11-21');
    assert.equal(body.profiles.length, 25); assert.equal(body.plans.length, 2); assert.equal(body.stops.length, 12);
    assert.ok(body.tasks.some(task => task.metadata.workday.serviceId === 'food'));
    assert.ok(body.tasks.some(task => task.metadata.workday.serviceId === 'litter' && task.metadata.workday.quantity === 2));
    assert.ok(body.issues.some(issue => issue.id === firstTask && issue.status === 'failed'));
    assert.deepEqual(body.messageDrafts, []); assert.equal(body.office.days.length, 0); assert.equal(body.office.released.length, 2);
    assert.equal(sql.prepare('SELECT total_changes() AS n').get().n, before);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally { sql.close(); }
});

test('local CRM storage errors return a safe unavailable response', async () => {
  const response = await api().GET(request()), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.error, 'Local operations records could not be loaded.'); assert.equal(Object.hasOwn(body, 'stack'), false);
});

const httpSource = fs.readFileSync(new URL('../lib/field-workday-http.js', import.meta.url), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
function postApi({ authorized = true, env = {}, rateAllowed = true, quotaAllowed = true, commandError = null } = {}) {
  const calls = [], database = {};
  const context = {
    Response, URL, Intl, Date: PreviewDate, JSON, RangeError, SyntaxError, FieldError,
    console: { error() {} }, technicianText, readBoundedProviderJson, localPreviewPaymentOrigin,
    getRuntimeEnv: () => ({ ...localEnv, ...env }),
    getDb: () => { calls.push('db'); return database; },
    verifyAdminRequest: async () => { calls.push('auth'); return { authorized, email: 'local.admin@example.test' }; },
    checkRateLimit: async (_, options) => { calls.push(['rate', options]); return { allowed: rateAllowed }; },
    fieldQuota: async (_, actor, scope, limit) => { calls.push(['quota', actor, scope, limit]); return quotaAllowed; },
    localCrmCommand: async (db, actor, body, date) => {
      calls.push(['command', db, actor, body, date]);
      if (commandError) throw commandError;
      return { ok: true, message: 'Local command saved.' };
    },
  };
  const handlers = vm.runInNewContext(`${httpSource}\n${source}\n({POST})`, context);
  return { ...handlers, calls, database };
}
function writeRequest({ base = origin, originHeader = origin, fetchSite = 'same-origin', raw = '{"action":"save_message_draft"}', headers = {}, body = null } = {}) {
  const values = { 'content-type': 'application/json', 'sec-fetch-site': fetchSite, ...headers };
  if (originHeader !== null) values.origin = originHeader;
  return new Request(`${base}/api/local-preview/crm-view/`, { method: 'POST', headers: values, body: body || raw, ...(body ? { duplex: 'half' } : {}) });
}

test('local CRM writes enforce every fake environment flag and exact loopback origin before auth or storage', async () => {
  for (const env of [{ APP_ENV: 'production' }, { LOCAL_PREVIEW_ENABLED: 'false' }, { CRM_PAYMENTS_PROVIDER: 'cardpointe' }, { CRM_PAYMENTS_ENV: 'production' }, { ROUTE_OS_BILLING_ENABLED: 'false' }, { LOCAL_PREVIEW_ORIGIN: 'https://example.test' }]) {
    const f = postApi({ env });
    assert.equal((await f.POST(writeRequest())).status, 404);
    assert.deepEqual(f.calls, []);
  }
  for (const base of ['https://example.test', 'http://127.0.0.1:8787', 'http://localhost:8788']) {
    const f = postApi();
    assert.equal((await f.POST(writeRequest({ base }))).status, 404);
    assert.deepEqual(f.calls, []);
  }
});

test('local CRM writes require administrator auth and same-origin CSRF headers before quotas or commands', async () => {
  const unauthenticated = postApi({ authorized: false });
  assert.equal((await unauthenticated.POST(writeRequest())).status, 401);
  assert.deepEqual(unauthenticated.calls, ['db', 'auth']);
  for (const options of [{ originHeader: null }, { originHeader: 'https://outside.example.test' }, { originHeader: 'null' }, { fetchSite: 'cross-site' }]) {
    const f = postApi();
    const response = await f.POST(writeRequest(options));
    assert.equal(response.status, 403);
    assert.deepEqual(f.calls, ['db', 'auth']);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
});

test('local CRM writes use fail-closed per-IP and account rate limits before commands', async () => {
  for (const options of [{ rateAllowed: false }, { quotaAllowed: false }]) {
    const f = postApi(options), response = await f.POST(writeRequest());
    assert.equal(response.status, 429);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'command'), false);
    const rate = f.calls.find(call => Array.isArray(call) && call[0] === 'rate')[1];
    assert.equal(rate.scope, 'local_preview_crm_write'); assert.equal(rate.limit, 30); assert.equal(rate.failClosed, true);
    if (options.quotaAllowed === false) assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === 'quota'), ['quota', 'local.admin@example.test', 'local_preview_crm_write_account', 30]);
  }
});

test('local CRM writes reject malformed JSON and declared or actual streaming bodies above 12 KB', async () => {
  const cases = [
    { raw: '{broken' },
    { raw: '{}', headers: { 'content-length': String(12 * 1024 + 1) } },
    { raw: JSON.stringify({ text: 'x'.repeat(12 * 1024) }) },
    { raw: JSON.stringify({ text: 'x'.repeat(12 * 1024) }), headers: { 'content-length': '1' } },
    { body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"text":"')); controller.enqueue(new TextEncoder().encode('x'.repeat(12 * 1024))); controller.close(); } }) },
    { raw: JSON.stringify({ text: '犬'.repeat(4500) }) },
  ];
  for (const options of cases) {
    const f = postApi(), response = await f.POST(writeRequest(options));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /12 KB or less/);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'command'), false);
  }
});

test('local CRM writes pass only bounded parsed data, authenticated actor and Eastern service date to command', async () => {
  const f = postApi(), body = { action: 'save_message_draft', requestId: crypto.randomUUID(), customerId: 'local-customer-01', text: 'Local draft.' };
  const response = await f.POST(writeRequest({ raw: JSON.stringify(body) }));
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  const call = f.calls.find(item => Array.isArray(item) && item[0] === 'command');
  assert.equal(call[1], f.database); assert.equal(call[2], 'local.admin@example.test');
  assert.equal(JSON.stringify(call[3]), JSON.stringify(body)); assert.equal(call[4], '2026-11-21');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
});

test('local CRM writes preserve expected command statuses while hiding unexpected database details', async () => {
  const invalid = postApi({ commandError: new FieldError('This customer already has a stop today.', 409) });
  assert.equal((await invalid.POST(writeRequest())).status, 409);
  const failed = postApi({ commandError: new Error('PRIVATE DATABASE connection detail') });
  const response = await failed.POST(writeRequest()), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.ok, false);
  assert.equal(JSON.stringify(body).includes('PRIVATE DATABASE'), false); assert.equal(Object.hasOwn(body, 'stack'), false);
});
