import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { localPreviewPaymentOrigin, loopbackPreviewOrigin, fakeHostedTokenizerConfig } from '../lib/local-preview-payments.mjs';
import { localPreviewAdminCode, localPreviewAdminSeed, LOCAL_PREVIEW_ADMIN_EMAIL } from '../lib/local-preview-admin.mjs';
import { safeHostedTokenizerConfig, parseHostedTokenizerMessage } from '../lib/hosted-payment-tokenizer.mjs';
import { createFakePaymentsProvider } from '../lib/fake-payments-provider.mjs';
import { beginMfaLogin, finishMfaLogin, verifyMfaSession } from '../lib/admin-mfa.mjs';

const origin = 'http://localhost:8787';
const env = () => ({ LOCAL_PREVIEW_ENABLED: 'true', APP_ENV: 'development', CRM_PAYMENTS_PROVIDER: 'fake', CRM_PAYMENTS_ENV: 'uat', ROUTE_OS_BILLING_ENABLED: 'true', LOCAL_PREVIEW_ORIGIN: origin,
  ADMIN_USERNAME: LOCAL_PREVIEW_ADMIN_EMAIL, ADMIN_PASSWORD: 'LocalPreview!2026', ADMIN_SESSION_SECRET: 'local-preview-admin-session-secret-only-2026-11-21', ADMIN_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), LOCAL_PREVIEW_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP' });

test('fake hosted preview requires every local flag and the exact loopback request origin', () => {
  const local = env(); assert.equal(localPreviewPaymentOrigin(local, `${origin}/admin/crm/billing/`), origin);
  for (const values of [{ APP_ENV: 'production' }, { APP_ENV: 'preview' }, { LOCAL_PREVIEW_ENABLED: 'false' }, { CRM_PAYMENTS_PROVIDER: 'cardpointe' }, { CRM_PAYMENTS_ENV: 'production' }, { ROUTE_OS_BILLING_ENABLED: 'false' }, { LOCAL_PREVIEW_ORIGIN: 'https://www.ohiopetwastepros.com' }]) assert.equal(localPreviewPaymentOrigin({ ...local, ...values }), null);
  for (const request of ['https://www.ohiopetwastepros.com/admin/crm/billing/', 'http://127.0.0.1:8787/admin/crm/billing/', 'http://localhost:9000/']) assert.equal(localPreviewPaymentOrigin(local, request), null);
  for (const bad of ['https://localhost:8787', 'http://localhost.evil.example:8787', 'http://user:pass@localhost:8787', 'http://localhost:8787/path', `${origin}/?token=x`]) assert.equal(loopbackPreviewOrigin(bad), null);
});

test('fake tokenizer config and messages are restricted to exact local paths, origin and frame source', () => {
  const frame = {}, provider = createFakePaymentsProvider({ tokenizerOrigin: origin });
  for (const methodType of ['card', 'ach']) {
    const config = provider.hostedTokenizerConfig({ methodType }); assert.equal(config.provider, 'fake'); assert.equal(config.environment, 'local');
    assert.deepEqual(safeHostedTokenizerConfig(config), fakeHostedTokenizerConfig(origin, methodType));
    for (const bad of [{ ...config, environment: 'uat' }, { ...config, url: `${origin}/another/` }, { ...config, url: `${config.url}&extra=true` }, { ...config, origin: 'http://localhost.evil.example:8787' }]) assert.equal(safeHostedTokenizerConfig(bad), null);
    const event = { origin, source: frame, data: JSON.stringify({ token: '9000000000000001', errorCode: '0' }) };
    assert.equal(parseHostedTokenizerMessage(event, { origin, source: frame }).status, 'ready');
    assert.equal(parseHostedTokenizerMessage({ ...event, source: {} }, { origin, source: frame }), null);
    assert.equal(parseHostedTokenizerMessage({ ...event, origin: 'https://evil.example' }, { origin, source: frame }), null);
  }
  assert.equal(createFakePaymentsProvider().hostedTokenizerConfig().url, null);
});

function loadRoute(relative, local, authorized = true) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(`${source}\n({GET})`, { Response, URL, crypto, Uint8Array, btoa, JSON, Date, localPreviewPaymentOrigin, localPreviewAdminCode, LOCAL_PREVIEW_ADMIN_EMAIL, getRuntimeEnv: () => local, verifyAdminRequest: async () => ({ authorized }) });
}

test('fake iframe route needs local environment and admin session and contains no real payment inputs', async () => {
  const path = '../app/local-preview/payment-tokenizer/route.js', request = new Request(`${origin}/local-preview/payment-tokenizer/?methodType=ach`);
  assert.equal((await loadRoute(path, { ...env(), APP_ENV: 'production' }).GET(request)).status, 404);
  assert.equal((await loadRoute(path, env(), false).GET(request)).status, 401);
  const response = await loadRoute(path, env()).GET(request), html = await response.text();
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN'); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(html, /Local fake tokenizer/); assert.match(html, /Fake checking ending 6789/); assert.match(html, /postMessage/); assert.match(html, /9000000000000002/);
  assert.doesNotMatch(html, /<input|fetch\(|XMLHttpRequest|https:\/\/|localStorage|sessionStorage|indexedDB/i);
  const posted = [], handlers = {}, status = {};
  vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { parent: { postMessage: (...args) => posted.push(args) }, JSON, document: { getElementById: id => id === 'choose' ? { addEventListener: (event, handler) => { handlers[event] = handler; } } : status } });
  handlers.click(); assert.equal(posted.length, 1); assert.equal(posted[0][1], origin); assert.equal(JSON.parse(posted[0][0]).token, '9000000000000002');
});

test('fake profile saves expose only safe metadata and charge card versus Pending ACH without external transport', async () => {
  const provider = createFakePaymentsProvider({ tokenizerOrigin: origin });
  for (const methodType of ['card', 'ach']) {
    const token = methodType === 'card' ? '9000000000000001' : '9000000000000002';
    const method = await provider.createProfile({ token, methodType, consent: true, billingZip: '43560', isDefault: true });
    assert.equal(method.last4, methodType === 'card' ? '4242' : '6789'); assert.equal(method.provider, 'fake'); assert.ok(!JSON.stringify(method).includes(token));
    const result = await provider.charge({ invoiceId: `preview-${methodType}`, attempt: 1, idempotencyKey: `preview-${methodType}:1`, amountCents: 12900, method, recurring: true });
    assert.equal(result.status, methodType === 'card' ? 'paid' : 'pending');
  }
});

test('local admin fixture uses the real encrypted MFA login and session path', async () => {
  const local = env(), sqlite = new DatabaseSync(':memory:'), now = 1_800_000_000;
  sqlite.exec('CREATE TABLE api_rate_limits(scope TEXT,client_key TEXT,window_start INTEGER,request_count INTEGER,expires_at TEXT,PRIMARY KEY(scope,client_key,window_start));');
  sqlite.exec(fs.readFileSync(new URL('../tmp/test-migrations/0041_admin_mfa.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: statement.run(...args) }; } }; }, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  const seeded = await localPreviewAdminSeed(local, now * 1000); sqlite.exec(seeded.sql); assert.equal(seeded.username, local.ADMIN_USERNAME); assert.ok(!seeded.sql.includes(local.LOCAL_PREVIEW_ADMIN_TOTP_SECRET));
  const completeEnv = { ...local, DB }, challenge = await beginMfaLogin(completeEnv, { username: local.ADMIN_USERNAME, password: local.ADMIN_PASSWORD }, now);
  assert.equal(challenge.step, 'verify');
  const login = await finishMfaLogin(completeEnv, challenge.challengeToken, { code: localPreviewAdminCode(local, now * 1000), trustDevice: true }, 'Preview browser', now);
  assert.equal((await verifyMfaSession(completeEnv, login.sessionToken, now)).authorized, true);
  await assert.rejects(localPreviewAdminSeed({ ...local, APP_ENV: 'production' }), /not configured/);
});

test('local MFA code helper is unavailable outside the explicit fake loopback preview', async () => {
  const path = '../app/api/local-preview/access/route.js', request = new Request(`${origin}/api/local-preview/access/`);
  const response = await loadRoute(path, env()).GET(request), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.admin.username, LOCAL_PREVIEW_ADMIN_EMAIL); assert.match(body.admin.code, /^\d{6}$/); assert.equal(body.admin.password, undefined);
  for (const overrides of [{ APP_ENV: 'production' }, { LOCAL_PREVIEW_ENABLED: 'false' }, { CRM_PAYMENTS_PROVIDER: 'cardpointe' }]) assert.equal((await loadRoute(path, { ...env(), ...overrides }).GET(request)).status, 404);
  assert.equal((await loadRoute(path, env()).GET(new Request('https://example.test/api/local-preview/access/'))).status, 404);
});
