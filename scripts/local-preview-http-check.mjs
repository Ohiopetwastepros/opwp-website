import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Explicit loopback origin only. This is an authenticated LOCAL fixture test,
// never a public-site smoke test or a production credential discovery script.
const origin = 'http://localhost:8787';
const root = fileURLToPath(new URL('../', import.meta.url));
const reportPath = path.join(root, 'tmp/local-preview-http-report.json');
const cookies = new Map();
const report = { origin, startedAt: new Date().toISOString(), checks: [], pages: [], fixtureChanges: [], errors: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function remember(response) {
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0], equals = pair.indexOf('=');
    const name = pair.slice(0, equals), value = pair.slice(equals + 1);
    if (value) cookies.set(name, value); else cookies.delete(name);
  }
}
async function request(relative, { body = null, auth = true } = {}) {
  const url = new URL(relative, origin);
  if (url.origin !== origin || !['localhost'].includes(url.hostname)) throw new Error('Nonlocal HTTP request refused.');
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { ...(auth && cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}), ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  remember(response); return response;
}
async function json(relative, options) {
  const response = await request(relative, options), body = await response.json();
  return { status: response.status, body, headers: response.headers };
}
async function login() {
  const password = await json('/api/admin/session/', { body: { action: 'password', username: 'preview.admin@example.test', password: 'LocalPreview!2026' }, auth: false });
  assert.equal(password.status, 202); assert.equal(password.body.step, 'verify');
  for (let attempt = 0; attempt < 3; attempt++) {
    let access = await json('/api/local-preview/access/', { auth: false });
    assert.equal(access.status, 200); assert.match(access.body.admin.code, /^\d{6}$/);
    if (access.body.validForSeconds < 3) { await pause((access.body.validForSeconds + 1) * 1000); access = await json('/api/local-preview/access/', { auth: false }); }
    const verified = await json('/api/admin/session/', { body: { action: 'verify', code: access.body.admin.code, trustDevice: true } });
    if (verified.status === 200) { assert.equal(verified.body.step, 'complete'); report.checks.push({ name: 'Normal admin password + MFA login', passed: true }); return; }
    if (!/invalid|already used/i.test(verified.body.error || '')) throw new Error(`Admin verification failed (${verified.status}): ${verified.body.error}`);
    await pause((access.body.validForSeconds + 1) * 1000);
  }
  throw new Error('Could not obtain a fresh local MFA code.');
}
function pages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? pages(path.join(directory, entry.name)) : entry.name === 'page.js' ? [path.join(directory, entry.name)] : []);
}
async function checkPages() {
  const queue = pages(path.join(root, 'app/admin')).map(file => `/${path.relative(path.join(root, 'app'), file).replaceAll(path.sep, '/').replace(/page.js$/, '')}`);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const relative = queue.shift();
      try {
        const response = await request(relative), text = await response.text(), location = response.headers.get('location');
        const redirectIsLocal = !location || new URL(location, origin).origin === origin;
        const title = /<title>([^<]*)<\/title>/.exec(text)?.[1] || '';
        report.pages.push({ url: `${origin}${relative}`, status: response.status, title, location, passed: (response.status === 200 || [301, 302, 303, 307, 308].includes(response.status) && redirectIsLocal) && !/Application error: a server-side exception/.test(text) });
      } catch (error) { report.pages.push({ url: `${origin}${relative}`, passed: false, error: error.message }); }
    }
  }));
  report.pages.sort((a, b) => a.url.localeCompare(b.url));
}
async function checkCrmAndBilling() {
  const all = await json('/api/admin/crm/subscriptions/?view=all'); assert.equal(all.status, 200); assert.equal(all.body.customers.length, 25); assert.equal(all.body.subscriptions.length, 24);
  const history = [];
  for (const view of ['active', 'past', 'all']) {
    const result = await json(`/api/admin/crm/subscriptions/?customerId=local-customer-22&view=${view}`); assert.equal(result.status, 200);
    history.push({ view, count: result.body.subscriptions.length }); assert.equal(result.body.subscriptions.length, view === 'active' ? 0 : 1);
    if (view !== 'active') assert.equal(result.body.subscriptions[0].terminationReason, 'moved');
  }
  assert.equal(all.body.subscriptions.filter(sub => sub.versions.length >= 2).length >= 3, true);
  const override = all.body.subscriptions.find(sub => sub.customerId === 'local-customer-04'); assert.equal(override.rateSource, 'manual'); assert.ok(override.manualReason);
  for (const [id, unitCents] of [['kitty_litter', 12900], ['kitty_litter_extra_box', 3000], ['kitty_litter_changeout', 5500]]) assert.equal(all.body.priceBook.addons.find(item => item.id === id).unitCents, unitCents);
  report.checks.push({ name: 'Native CRM directory/history/manual rate/amendments/litter rates', passed: true, customers: 25, subscriptions: 24, cancelledCustomerToggle: history });
  let workspace = await json('/api/admin/crm/billing/'); assert.equal(workspace.status, 200);
  assert.equal(workspace.body.invoices.length, 23); assert.equal(workspace.body.tokenizerConfigs.card.provider, 'fake');
  assert.equal(workspace.body.invoices.filter(item => item.customerId === 'local-customer-25').length, 1);
  const consolidated = workspace.body.invoices.find(item => item.customerId === 'local-customer-25'); assert.ok(consolidated.lineItems.some(item => item.kind === 'initial_cleanup')); assert.equal(consolidated.lineItems.reduce((sum, item) => sum + item.totalCents, 0), consolidated.totalCents);
  for (const methodType of ['card', 'ach']) {
    const config = workspace.body.tokenizerConfigs[methodType]; assert.equal(new URL(config.url).origin, origin);
    const iframe = await request(config.url), html = await iframe.text(); assert.equal(iframe.status, 200); assert.match(html, /Local fake tokenizer/); assert.doesNotMatch(html, /<input|https:\/\//i);
  }
  report.checks.push({ name: 'Billing draft directory, one consolidated new-client invoice and both fake tokenizer frames', passed: true, invoices: 23, newClientInvoiceId: consolidated.id });
  for (const [suffix, methodType] of [['09', 'card'], ['10', 'ach']]) {
    const customerId = `local-customer-${suffix}`;
    const saved = await json('/api/admin/crm/billing/methods/', { body: { customerId, token: methodType === 'card' ? '9000000000000001' : '9000000000000002', methodType, billingZip: suffix === '09' ? '43537' : '43615', consent: true, isDefault: false } });
    assert.equal(saved.status, 200); assert.equal(saved.body.method.provider, 'fake'); assert.equal(saved.body.method.methodType, methodType);
    assert.ok(!('token' in saved.body.method));
    workspace = await json('/api/admin/crm/billing/'); let invoice = workspace.body.invoices.find(item => item.customerId === customerId);
    const command = (action, fields = {}) => json('/api/admin/crm/billing/', { body: { action, invoiceId: invoice.id, expectedRevision: invoice.revision, requestId: crypto.randomUUID(), reason: 'Local HTTP acceptance with fake payments only', ...fields } });
    const unapproved = await command('charge_now'); assert.equal(unapproved.status, 409);
    const refreshed = await command('refresh', { paymentMethodId: saved.body.method.id }); assert.equal(refreshed.status, 200); invoice = refreshed.body.invoice;
    const approved = await command('approve', { paymentMethodId: saved.body.method.id, chargeNow: false }); assert.equal(approved.status, 200); invoice = approved.body.invoice;
    assert.equal(invoice.status, 'approved'); assert.equal(invoice.attempts.length, 0);
    const chargeBody = { action: 'charge_now', invoiceId: invoice.id, expectedRevision: invoice.revision, requestId: crypto.randomUUID(), reason: 'Explicit local fake payment charge-now acceptance' };
    const charged = await json('/api/admin/crm/billing/', { body: chargeBody }); assert.equal(charged.status, 200); invoice = charged.body.invoice;
    assert.equal(invoice.status, methodType === 'card' ? 'paid' : 'pending'); assert.equal(invoice.attempts.length, 1); assert.equal(invoice.attempts[0].amountCents, invoice.totalCents);
    const replay = await json('/api/admin/crm/billing/', { body: chargeBody }); assert.equal(replay.status, 200); assert.equal(replay.body.invoice.attempts.length, 1); assert.equal(replay.body.invoice.totalCents, invoice.totalCents);
    if (methodType === 'ach') { const checked = await command('reconcile'); assert.equal(checked.status, 200); assert.equal(checked.body.invoice.status, 'pending'); assert.equal(checked.body.invoice.attempts.length, 1); }
    report.fixtureChanges.push({ customerId, invoiceId: invoice.id, methodType, paymentMethodId: saved.body.method.id, status: invoice.status, totalCents: invoice.totalCents, attempts: 1 });
    report.checks.push({ name: `Fake ${methodType} save / no charge before approval / approval / explicit charge / replay`, passed: true, customerId, status: invoice.status, exactCents: invoice.totalCents });
  }
  const after = await json('/api/admin/crm/billing/'); assert.equal(after.body.invoices.length, 23); assert.equal(after.body.invoices.filter(item => item.customerId === 'local-customer-25').length, 1);
}

try {
  const health = await json('/local-preview/health/', { auth: false }); assert.equal(health.status, 200); assert.equal(health.body.localOnly, true); assert.equal(health.body.processor, 'fake'); assert.equal(health.body.outboundFetch, 'blocked');
  report.healthBefore = health.body;
  await login();
  const session = await json('/api/admin/session/'); assert.equal(session.body.authenticated, true); assert.equal(session.body.identity, 'preview.admin@example.test');
  await checkPages();
  await checkCrmAndBilling();
} catch (error) { report.errors.push({ message: error.message, stack: error.stack }); }
report.healthAfter = (await json('/local-preview/health/', { auth: false })).body;
report.finishedAt = new Date().toISOString();
report.summary = { pageCount: report.pages.length, pagePasses: report.pages.filter(page => page.passed).length, checksPassed: report.checks.length, errors: report.errors.length, failedPages: report.pages.filter(page => !page.passed).map(page => ({ url: page.url, status: page.status, error: page.error })) };
fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, ...report.summary, checks: report.checks, fixtureChanges: report.fixtureChanges, errors: report.errors }));
if (report.errors.length || report.pages.some(page => !page.passed)) process.exitCode = 1;
