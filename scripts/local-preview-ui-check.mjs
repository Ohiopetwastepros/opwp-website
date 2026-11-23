// Explicit local fixture acceptance only. No external origin, production data,
// deployment, charge, email, or text is permitted by this script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'http://localhost:8787';
const root = fileURLToPath(new URL('../', import.meta.url));
const reportPath = path.join(root, 'tmp/crm-ui-http-report.json');
const report = { origin: ORIGIN, startedAt: new Date().toISOString(), checks: [], pages: [], fixtureChanges: [], errors: [] };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function client() {
  const cookies = new Map(), requests = [];
  async function request(relative, { body = null, method = body === null ? 'GET' : 'POST', json = true } = {}) {
    const url = new URL(relative, ORIGIN);
    assert.equal(url.origin, ORIGIN, 'Only the explicit local preview origin is permitted.');
    assert.equal(url.hostname, 'localhost');
    const headers = new Headers({ Origin: ORIGIN });
    if (cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    if (body !== null) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30000), ...(body === null ? {} : { body: JSON.stringify(body) }) });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';'), index = pair.indexOf('='), key = pair.slice(0, index), value = pair.slice(index + 1);
      if (value) cookies.set(key, value); else cookies.delete(key);
    }
    requests.push({ method, path: `${url.pathname}${url.search}`, status: response.status });
    return { status: response.status, headers: response.headers, body: json ? await response.json() : await response.text() };
  }
  return { request, requests };
}
function passed(name, details = {}) { report.checks.push({ name, passed: true, ...details }); }
async function login(admin, anonymous) {
  const password = await admin.request('/api/admin/session/', { body: { action: 'password', username: 'preview.admin@example.test', password: 'LocalPreview!2026' } });
  assert.equal(password.status, 202); assert.equal(password.body.step, 'verify');
  for (let attempt = 0; attempt < 4; attempt++) {
    let access = await anonymous.request('/api/local-preview/access/'); assert.equal(access.status, 200);
    if (access.body.validForSeconds < 3) { await pause((access.body.validForSeconds + 1) * 1000); access = await anonymous.request('/api/local-preview/access/'); }
    assert.match(access.body.admin.code, /^\d{6}$/);
    const verified = await admin.request('/api/admin/session/', { body: { action: 'verify', code: access.body.admin.code, trustDevice: true } });
    if (verified.status === 200) { assert.equal(verified.body.step, 'complete'); return; }
    assert.match(verified.body.error || '', /invalid|already used/i, `Unexpected MFA result ${verified.status}`);
    await pause((access.body.validForSeconds + 1) * 1000);
  }
  throw new Error('A fresh local MFA code was unavailable.');
}
const admin = client(), anonymous = client(), technician = client();
try {
  const health = await anonymous.request('/local-preview/health/');
  assert.equal(health.status, 200); assert.equal(health.body.localOnly, true); assert.equal(health.body.processor, 'fake'); assert.equal(health.body.outboundFetch, 'blocked'); assert.equal(health.body.scheduledProcessors, 'disabled');
  assert.equal(health.body.counts.crm_subscription_customers, 25); assert.equal(health.body.counts.crm_billing_invoices, 45);
  report.healthBefore = health.body; passed('Isolated local server, fake provider, outbound and scheduled processing blocked');

  const denied = await anonymous.request('/api/local-preview/crm-view/'); assert.equal(denied.status, 401);
  assert.match(denied.headers.get('cache-control'), /no-store/); passed('Unauthenticated CRM data request denied');
  const techLogin = await technician.request('/api/field/session/', { body: { email: 'tech2@example.test', pin: '135790' } }); assert.equal(techLogin.status, 200);
  const techDenied = await technician.request('/api/local-preview/crm-view/'); assert.equal(techDenied.status, 401);
  const techBillingDenied = await technician.request('/api/admin/crm/billing/'); assert.equal(techBillingDenied.status, 401);
  passed('Technician session denied CRM contacts and admin billing');

  await login(admin, anonymous);
  const session = await admin.request('/api/admin/session/'); assert.equal(session.status, 200); assert.equal(session.body.authenticated, true); assert.equal(session.body.identity, 'preview.admin@example.test');
  passed('Normal administrator password and current MFA sign-in');
  const pages = ['/admin/crm/', ...['customers', 'routes', 'work-queue', 'techs', 'leads', 'dog-food', 'reports', 'settings', 'sync-issues', 'subscriptions', 'billing'].map(screen => `/admin/crm/${screen}/`), '/admin/crm/subscriptions/?tab=book', '/admin/crm/customers/?customerId=local-customer-01'];
  for (const url of pages) {
    const response = await admin.request(url, { json: false });
    const page = { url: `${ORIGIN}${url}`, status: response.status, passed: response.status === 200 && !/Application error:|a server-side exception|Internal Server Error/.test(response.body) };
    report.pages.push(page); assert.equal(page.passed, true, `Local page failed: ${url} (${response.status})`);
    assert.equal(response.headers.get('x-local-preview'), 'fake-data-only');
  }
  passed('All rebuilt workspace page URLs return 200 without application errors', { count: pages.length });

  const ops = await admin.request('/api/local-preview/crm-view/'); assert.equal(ops.status, 200); assert.equal(ops.body.profiles.length, 25); assert.equal(ops.body.plans.length, 2); assert.equal(ops.body.stops.length, 12);
  assert.ok(ops.body.tasks.some(task => task.metadata.workday.serviceId === 'food'));
  assert.ok(ops.body.tasks.some(task => task.metadata.workday.serviceId === 'litter' && task.metadata.workday.quantity === 2));
  assert.ok(ops.body.tasks.some(task => task.metadata.field.dogSafetySource === 'unsafe' && /Unsafe dog reported/.test(task.metadata.field.sourceNote)));
  assert.doesNotMatch(ops.body.profiles.map(profile => `${profile.street} ${profile.safetyNotes}`).join(' '), /\bexample\b|Fabricated preview property|Lorem/i);
  passed('Realistic customer directory, two native routes, litter and food work, unsafe-dog instructions', { customers: 25, routes: 2, stops: 12, tasks: ops.body.tasks.length });

  const crm = await admin.request('/api/admin/crm/subscriptions/?view=all'); assert.equal(crm.status, 200); assert.equal(crm.body.subscriptions.length, 24);
  const active = crm.body.subscriptions.filter(subscription => subscription.status === 'active'), paused = crm.body.subscriptions.filter(subscription => subscription.status === 'paused');
  assert.equal(active.length, 22); assert.equal(paused.length, 1); assert.equal(active.reduce((sum, subscription) => sum + subscription.totalCents, 0), 368800); assert.equal(crm.body.report.activeMrrCents, 368800);
  assert.ok(crm.body.subscriptions.filter(subscription => subscription.versions.length >= 2).length >= 3);
  passed('Native and displayed active MRR agree, paused agreements excluded', { activeSubscriptions: 22, pausedSubscriptions: 1, activeMrrCents: 368800 });
  const oneDog = crm.body.subscriptions.find(subscription => subscription.id === 'local-subscription-01');
  assert.equal(oneDog.currentLines.find(line => line.kind === 'base_plan').totalCents, 9500); assert.equal(oneDog.totalCents, 27400);
  assert.equal(oneDog.currentLines.find(line => line.id === 'addon:kitty_litter').totalCents, 12900); assert.equal(oneDog.currentLines.find(line => line.id === 'addon:deodorize').totalCents, 5000);
  passed('Weekly 1 dog amount verified with separate litter and deodorization lines', { baseCents: 9500, totalCents: 27400 });

  const november = await admin.request('/api/admin/crm/billing/?period=2026-11-01&filter=all'), december = await admin.request('/api/admin/crm/billing/?period=2026-12-01&filter=all');
  assert.equal(november.status, 200); assert.equal(december.status, 200); assert.equal(november.body.invoices.length, 23); assert.equal(december.body.invoices.length, 22);
  assert.equal(november.body.invoices.filter(invoice => invoice.status === 'draft').length, 22); assert.equal(december.body.invoices.filter(invoice => invoice.status === 'draft').length, 22);
  assert.equal(november.body.tokenizerConfigs.card.provider, 'fake'); assert.equal(december.body.tokenizerConfigs.ach.provider, 'fake');
  passed('November and December contain real draft invoice records', { novemberInvoices: 23, novemberDrafts: 22, decemberInvoices: 22, decemberDrafts: 22 });
  const allInvoices = [...november.body.invoices, ...december.body.invoices], newcomer = allInvoices.filter(invoice => invoice.customerId === 'local-customer-25');
  assert.equal(newcomer.length, 1); assert.equal(newcomer[0].invoiceType, 'new_client'); assert.equal(newcomer[0].coverage.length, 2);
  assert.ok(newcomer[0].coverage.some(coverage => coverage.startDate === '2026-12-01' && coverage.endDate === '2027-01-01'));
  assert.ok(newcomer[0].lineItems.some(line => line.kind === 'initial_cleanup'));
  for (const invoice of allInvoices) assert.equal(invoice.lineItems.reduce((sum, line) => sum + line.totalCents, 0), invoice.totalCents);
  const yardLines = allInvoices.flatMap(invoice => invoice.lineItems).filter(line => line.kind === 'yard_size'); assert.ok(yardLines.length && yardLines.every(line => line.itemized));
  passed('One consolidated new-client invoice, exact invoice totals, visible yard-size surcharges', { invoiceId: newcomer[0].id, totalCents: newcomer[0].totalCents, coveragePeriods: 2 });

  const draft = november.body.invoices.find(invoice => invoice.id === 'local-invoice-01'); assert.equal(draft.status, 'draft'); assert.equal(draft.attempts.length, 0);
  const unapproved = await admin.request('/api/admin/crm/billing/', { body: { action: 'charge_now', invoiceId: draft.id, expectedRevision: draft.revision, requestId: crypto.randomUUID(), reason: 'Local UI acceptance: verify an unapproved draft cannot be collected' } });
  assert.equal(unapproved.status, 409); passed('Unapproved invoice collection rejected before a payment attempt');
  const approval = { action: 'approve', invoiceId: draft.id, expectedRevision: draft.revision, requestId: crypto.randomUUID(), reason: 'Local UI acceptance: reviewed fake invoice approval only', chargeNow: false };
  const approved = await admin.request('/api/admin/crm/billing/', { body: approval }); assert.equal(approved.status, 200, approved.body.error); assert.equal(approved.body.invoice.status, 'approved'); assert.equal(approved.body.invoice.attempts.length, 0);
  const repeated = await admin.request('/api/admin/crm/billing/', { body: approval }); assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true); assert.equal(repeated.body.invoice.revision, approved.body.invoice.revision); assert.equal(repeated.body.invoice.attempts.length, 0);
  report.fixtureChanges.push({ invoiceId: draft.id, from: 'draft', to: 'approved', attempts: 0, duplicateApproval: true });
  passed('Reviewed approval creates no charge, repeated request reuses its receipt', { invoiceId: draft.id, revision: approved.body.invoice.revision, attempts: 0 });

  const egress = await anonymous.request('/local-preview/check-egress/'); assert.equal(egress.status, 200); assert.equal(egress.body.blocked, true);
  const deployment = await admin.request('/api/admin/deployments/', { method: 'POST', body: { summary: 'Local acceptance check of the disabled deployment boundary' }, json: false }); assert.equal(deployment.status, 403); assert.match(deployment.body, /disabled/i);
  passed('Worker blocks outbound egress and rejects deployment mutations');
  const healthAfter = await anonymous.request('/local-preview/health/'); assert.equal(healthAfter.body.processor, 'fake'); assert.equal(healthAfter.body.outboundFetch, 'blocked'); assert.equal(healthAfter.body.scheduledProcessors, 'disabled'); report.healthAfter = healthAfter.body;
} catch (error) { report.errors.push({ message: error.message, stack: error.stack }); }
report.finishedAt = new Date().toISOString();
report.requests = { anonymous: anonymous.requests, admin: admin.requests, technician: technician.requests };
report.summary = { pages: report.pages.length, pagePasses: report.pages.filter(page => page.passed).length, checksPassed: report.checks.length, errors: report.errors.length };
fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, ...report.summary, checks: report.checks, fixtureChanges: report.fixtureChanges, errors: report.errors }, null, 2));
if (report.errors.length || report.pages.some(page => !page.passed)) process.exitCode = 1;
