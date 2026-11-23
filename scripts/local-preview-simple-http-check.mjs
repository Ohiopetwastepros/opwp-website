// Read-only acceptance against the fixed fabricated loopback server. The only
// permitted POSTs create normal administrator/technician authentication sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { homeSummary, HOME_LINKS } from '../components/crm/operations-view.mjs';

const ORIGIN = 'http://localhost:8787';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPORT = path.join(ROOT, 'tmp/simple-ui-http-report.json');
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [year, month] = date.split('-').map(Number);
const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
const plan2 = `local-field-plan-2-${date}`;
const report = { origin: ORIGIN, readOnly: true, startedAt: new Date().toISOString(), pages: [], checks: [], errors: [] };
let guarded = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function flush() { fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n'); }
function passed(name, details = {}) { report.checks.push({ name, passed: true, ...details }); flush(); }

function connection() {
  const cookies = new Map(), requests = [];
  async function request(relative, { body = null, json = true } = {}) {
    const url = new URL(relative, ORIGIN), method = body === null ? 'GET' : 'POST';
    assert.equal(url.origin, ORIGIN); assert.equal(url.hostname, 'localhost');
    const headers = new Headers({ Origin: ORIGIN });
    if (cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    if (method === 'POST') {
      assert.equal(guarded, true, 'A verified fake local server is required before authentication.');
      assert.ok(['/api/admin/session/', '/api/field/session/'].includes(url.pathname), 'Business and field mutations are forbidden.');
      if (url.pathname === '/api/admin/session/') assert.ok(['password', 'verify'].includes(body.action));
      else assert.equal(body.email, 'tech2@example.test');
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30000), ...(body === null ? {} : { body: JSON.stringify(body) }) });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';'), split = pair.indexOf('='), key = pair.slice(0, split), value = pair.slice(split + 1);
      if (value) cookies.set(key, value); else cookies.delete(key);
    }
    const value = json ? await response.json() : await response.text();
    requests.push({ method, path: `${url.pathname}${url.search}`, status: response.status });
    return { status: response.status, headers: response.headers, body: value };
  }
  return { request, requests };
}
const anonymous = connection(), administrator = connection(), technician = connection();

async function healthGuard() {
  const result = await anonymous.request('/local-preview/health/');
  assert.equal(result.status, 200); assert.equal(result.body.origin, ORIGIN);
  assert.equal(result.body.localOnly, true); assert.equal(result.body.processor, 'fake');
  assert.equal(result.body.outboundFetch, 'blocked'); assert.equal(result.body.scheduledProcessors, 'disabled');
  assert.equal(result.body.counts.crm_subscription_customers, 25); assert.equal(result.body.counts.crm_billing_invoices, 45);
  guarded = true; return result.body;
}
async function loginAdmin() {
  await healthGuard();
  const password = await administrator.request('/api/admin/session/', { body: { action: 'password', username: 'preview.admin@example.test', password: 'LocalPreview!2026' } });
  assert.equal(password.status, 202); assert.equal(password.body.step, 'verify');
  for (let attempt = 0; attempt < 4; attempt++) {
    let access = await anonymous.request('/api/local-preview/access/'); assert.equal(access.status, 200);
    if (access.body.validForSeconds < 4) { await pause((access.body.validForSeconds + 1) * 1000); access = await anonymous.request('/api/local-preview/access/'); }
    assert.match(access.body.admin.code, /^\d{6}$/); await healthGuard();
    const verification = await administrator.request('/api/admin/session/', { body: { action: 'verify', code: access.body.admin.code, trustDevice: true } });
    if (verification.status === 200) { assert.equal(verification.body.step, 'complete'); return; }
    assert.match(verification.body.error || '', /invalid|already used/i);
    await pause((access.body.validForSeconds + 1) * 1000);
  }
  throw new Error('A fresh local administrator MFA code was unavailable.');
}
async function read(relative, client = administrator) {
  const result = await client.request(relative); assert.equal(result.status, 200, `${relative}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.ok, true); return result.body;
}
const operationsSnapshot = ops => ({ profiles: ops.profiles, plans: ops.plans, stops: ops.stops, tasks: ops.tasks, issues: ops.issues, drafts: ops.messageDrafts, days: ops.office.days, changes: ops.office.changes, messages: ops.office.messages });

const field = '/field/app/';
const stopLink = (view, route = 2, stop = 1, task = 1) => `${field}?${new URLSearchParams({ view, stopId: `local-field-stop-${route}-${stop}-${date}`, taskId: `local-field-task-${route}-${stop}-${task}-${date}` })}`;
const pages = [
  ['tech-login', '/field/login/?next=/field/app/', false],
  ['tech-route', `${field}?view=route`, false],
  ['tech-map', `${field}?view=map`, false],
  ['tech-stop', stopLink('stop'), false],
  ['tech-proof', stopLink('proof'), false],
  ['tech-complete', stopLink('complete', 2, 4, 3), false],
  ['tech-safety', stopLink('safety', 1, 5, 1), false],
  ['tech-closeout', `${field}?view=closeout`, false],
  ['dashboard', '/admin/crm/', true],
  ['routes', '/admin/crm/routes/', true],
  ['best-fit', '/admin/crm/best-fit/?customerId=local-customer-14', true],
  ['messages', '/admin/crm/messages/?customerId=local-customer-10', true],
  ['eta', '/admin/crm/eta/?customerId=local-customer-10', true],
  ['on-the-way', `/local-preview/on-the-way/?customerId=local-customer-10&planId=${plan2}&minutes=15`, false],
  ['analytics', '/admin/crm/analytics/', true],
  ['customers', '/admin/crm/customers/', true],
  ['customer-profile', '/admin/crm/customers/?customerId=local-customer-01', true],
  ['subscriptions', '/admin/crm/subscriptions/', true],
  ['billing', `/admin/crm/billing/?month=${nextMonth.slice(0, 7)}`, true],
  ['invoice-detail', `/admin/crm/billing/?month=${nextMonth.slice(0, 7)}&filter=all&invoiceId=local-invoice-01-${nextMonth.slice(0, 7)}`, true],
  ['price-book', '/admin/crm/subscriptions/?tab=book', true],
  ['work-queue', '/admin/crm/work-queue/', true],
  ['techs', '/admin/crm/techs/', true],
  ['dog-food', '/admin/crm/dog-food/', true],
  ['leads', '/admin/crm/leads/', true],
  ['settings', '/admin/crm/settings/', true],
  ['sync-issues', '/admin/crm/sync-issues/', true],
  ['schedule', '/admin/crm/schedule/', true],
];

try {
  flush(); report.healthBefore = await healthGuard(); passed('Fixed localhost fake-only and outbound-blocked guard');
  for (const endpoint of ['/api/local-preview/crm-view/', '/api/admin/crm/subscriptions/?view=all', '/api/admin/crm/billing/?filter=all']) assert.equal((await anonymous.request(endpoint)).status, 401);
  passed('Anonymous sessions cannot read office customer, subscription or billing APIs');
  await loginAdmin();
  const session = await administrator.request('/api/admin/session/');
  assert.equal(session.status, 200); assert.equal(session.body.authenticated, true); assert.equal(session.body.identity, 'preview.admin@example.test');
  passed('Normal fabricated administrator password and current MFA sign-in');
  assert.equal(pages.length, 28);
  for (const [id, relative, protectedPage] of pages) {
    const anonymousResult = await anonymous.request(relative, { json: false });
    if (protectedPage) {
      assert.ok([302, 303, 307, 308].includes(anonymousResult.status), `${id} must redirect anonymous sessions`);
      const destination = new URL(anonymousResult.headers.get('location'), ORIGIN);
      assert.equal(destination.origin, ORIGIN); assert.equal(destination.pathname, '/admin/login/');
    } else assert.equal(anonymousResult.status, 200, id);
    const result = protectedPage ? await administrator.request(relative, { json: false }) : anonymousResult;
    const page = { id, url: ORIGIN + relative, anonymousStatus: anonymousResult.status, status: result.status, passed: result.status === 200 && !/Application error:|a server-side exception|Internal Server Error/.test(result.body) };
    report.pages.push(page); flush(); assert.equal(page.passed, true, id);
    assert.equal(result.headers.get('x-local-preview'), 'fake-data-only');
  }
  passed('All 28 CRM, technician shell and branded customer URLs retain correct page and authentication behavior');
  const ops = await read('/api/local-preview/crm-view/');
  assert.equal(ops.date, date); assert.equal(ops.profiles.length, 25); assert.equal(ops.plans.length, 2);
  const originalOperations = operationsSnapshot(ops);
  const crm = await read('/api/admin/crm/subscriptions/?view=all');
  const november = await read(`/api/admin/crm/billing/?period=${date.slice(0, 7)}-01&filter=all`);
  const december = await read(`/api/admin/crm/billing/?period=${nextMonth}&filter=all`);
  const allBilling = await read('/api/admin/crm/billing/?filter=all');
  assert.ok(november.invoices.length > 0); assert.ok(december.invoices.length > 0);
  const agreement = crm.subscriptions.find(subscription => subscription.customerId === 'local-customer-01' && subscription.status === 'active');
  assert.ok(agreement); assert.equal(agreement.dogCount, 1); assert.equal(agreement.totalCents, 27400);
  assert.deepEqual(agreement.currentLines.filter(line => line.totalCents > 0).map(line => line.totalCents).sort((a, b) => a - b), [5000, 9500, 12900]);
  assert.equal(crm.report.activeMrrCents, 368800);
  const nextInvoice = december.invoices.find(invoice => invoice.customerId === 'local-customer-01');
  assert.ok(nextInvoice); assert.equal(nextInvoice.totalCents, 27400);
  passed('Native monthly pricing remains one dog $95 plus litter $129 plus deodorization $50, with MRR $3,688', { totalCents: agreement.totalCents, activeMrrCents: crm.report.activeMrrCents, currentInvoices: november.invoices.length, nextInvoices: december.invoices.length });
  const summary = homeSummary({ crm, billing: { ...november, historyInvoices: allBilling.invoices }, ops });
  assert.equal(new Set(summary.todaysJobs.map(job => job.id)).size, summary.todaysJobs.length);
  assert.ok(summary.openJobs.every(job => summary.todaysJobs.includes(job) && !job.accounted));
  assert.equal(summary.owingCents, summary.owingInvoices.reduce((total, invoice) => total + invoice.outstandingCents, 0));
  report.homeCounts = { unassigned: summary.eligibleUnassignedCustomers.length, changeRequests: summary.pendingAccountChanges.length, owingInvoices: summary.owingInvoices.length, openJobs: summary.openJobs.length, todaysJobs: summary.todaysJobs.length, routeOrderReview: summary.routeOrderReviewCount, mrrCents: summary.mrrCents, currentDraftCents: summary.currentDraftCents };
  for (const relative of Object.values(HOME_LINKS)) assert.equal((await administrator.request(relative, { json: false })).status, 200, relative);
  passed('Home counts share native property/account/invoice projections and canonical filter destinations', report.homeCounts);
  const home = await administrator.request('/admin/crm/', { json: false });
  for (const route of ['/admin/crm/subscriptions/', '/admin/crm/billing/', '/admin/crm/work-queue/', '/admin/crm/dog-food/', '/admin/crm/leads/', '/admin/crm/routes/']) assert.ok(home.body.includes(route), `Preserved feature link ${route}`);
  passed('Subscriptions, billing, account changes, food, leads and routes remain reachable');
  const existingDay = ops.office.days.find(day => day.planId === plan2);
  assert.ok(existingDay, 'Read-only field checks require an existing workday.');
  await healthGuard();
  const signIn = await technician.request('/api/field/session/', { body: { email: 'tech2@example.test', pin: '135790' } }); assert.equal(signIn.status, 200);
  for (const endpoint of ['/api/local-preview/crm-view/', '/api/admin/crm/subscriptions/?view=all', '/api/admin/crm/billing/?filter=all']) assert.equal((await technician.request(endpoint)).status, 401);
  const fieldResult = await read(`/api/field/workday/?date=${date}`, technician);
  assert.ok(fieldResult.day); assert.equal(fieldResult.day.id, existingDay.id);
  const privateKey = /^(?:phone|cellPhone|homePhone|email|price|totalCents|balance|paymentHistory|paymentStatus|planRevenue|routeRevenue|providerSecret|source|notificationPreference|propertyKey)$/i;
  function checkPrivacy(node) { if (!node || typeof node !== 'object') return; for (const [key, value] of Object.entries(node)) { assert.equal(privateKey.test(key), false, `Private field key ${key}`); checkPrivacy(value); } }
  checkPrivacy(fieldResult);
  assert.equal(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(JSON.stringify(fieldResult)), false);
  passed('Technician session cannot read office CRM and its existing workday projection excludes contact and financial fields');
  const opsAfter = await read('/api/local-preview/crm-view/'), billingAfter = await read('/api/admin/crm/billing/?filter=all'), crmAfter = await read('/api/admin/crm/subscriptions/?view=all');
  assert.deepEqual(operationsSnapshot(opsAfter), originalOperations);
  assert.deepEqual(billingAfter, allBilling); assert.deepEqual(crmAfter, crm);
  report.healthAfter = await healthGuard(); assert.deepEqual(report.healthAfter.counts, report.healthBefore.counts);
  report.stateDigests = { operationsBefore: digest(originalOperations), operationsAfter: digest(operationsSnapshot(opsAfter)), billingBefore: digest(allBilling), billingAfter: digest(billingAfter), subscriptionsBefore: digest(crm), subscriptionsAfter: digest(crmAfter) };
  passed('Main workdays, clocks, proof state, dispatch proposals, drafts, subscriptions and billing remain unchanged');
} catch (error) { report.errors.push({ message: error.message, stack: error.stack }); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
report.summary = { pages: report.pages.length, pagePasses: report.pages.filter(page => page.passed).length, checksPassed: report.checks.length, errors: report.errors.length };
report.requests = { administrator: administrator.requests, anonymous: anonymous.requests, technician: technician.requests };
flush();
console.log(JSON.stringify({ reportPath: REPORT, ...report.summary, homeCounts: report.homeCounts, errors: report.errors }, null, 2));
