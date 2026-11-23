import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_LINKS, homeSummary } from '../components/crm/operations-view.mjs';

const date = '2026-11-21', now = new Date('2026-11-21T17:00:00Z');
const profile = (id, extra = {}) => ({ id, name: id, frequency: 'once_a_week', ...extra });
const agreement = (id, customerId, status = 'active', extra = {}) => ({ id, customerId, status, totalCents: 9500, versions: [], scheduledChanges: [], ...extra });
const storedStop = (id, extra = {}) => ({ id, route_plan_id: 'route', location_key: id, sequence: 1, customer_display_name: id, address: `${id} Street`, ...extra });
const storedTask = (id, locationId, status = 'scheduled') => ({ id, location_id: locationId, customer_external_id: locationId, product_summary: 'Yard cleanup', status });

test('home unassigned list requires active or one-time service and excludes paused, cancelled, assigned and pending visits', () => {
  const profiles = ['active', 'paused', 'cancelled', 'none', 'one', 'assigned', 'pending', 'accepted', 'food', 'renewed', 'future'].map(id => profile(id, id === 'one' ? { frequency: 'one_time' } : id === 'food' ? { foodDelivery: { quantity: 1 } } : {}));
  const crm = { subscriptions: [agreement('a', 'active'), agreement('p', 'paused', 'paused'), agreement('c', 'cancelled', 'cancelled'), agreement('s', 'assigned'), agreement('pending', 'pending'), agreement('accepted', 'accepted'), agreement('f', 'food'), agreement('old', 'renewed', 'cancelled'), agreement('renewal', 'renewed'), agreement('future', 'future', 'active', { startDate: '2026-12-01' })] };
  const ops = { date, profiles, stops: [storedStop('assigned')], tasks: [storedTask('t', 'assigned')], office: { changes: [{ kind: 'add_visit', status: 'pending', payload: { localCustomerId: 'pending' } }, { kind: 'add_visit', status: 'accepted', payload: { localCustomerId: 'accepted' } }] } };
  const summary = homeSummary({ crm, ops }, now);
  assert.deepEqual(summary.eligibleUnassignedCustomers.map(customer => customer.id), ['active', 'one', 'renewed']);
  assert.equal(summary.links.unassigned, '/admin/crm/customers/?filter=unassigned');
});

test('account-change count uses actual future uncancelled versions once rather than paused or manual-rate accounts', () => {
  const scheduled = { id: 'future', effectiveDate: '2026-12-01', reason: 'Approved future change' };
  const cancelledVersion = { id: 'cancelled', effectiveDate: '2026-12-02', cancelledAt: '2026-11-20T12:00:00Z' };
  const sub = agreement('sub', 'customer', 'active', { rateSource: 'manual', versions: [{ id: 'past', effectiveDate: '2026-11-01' }, { id: 'today', effectiveDate: date }, scheduled, cancelledVersion, { id: 'after-end', effectiveDate: '2027-01-01' }], scheduledChanges: [scheduled, { ...cancelledVersion, cancelledAt: null }], endDate: '2027-01-01' });
  const paused = agreement('paused-sub', 'paused', 'paused', { versions: [{ id: 'resume-rate', effectiveDate: '2026-12-03' }] });
  const summary = homeSummary({ crm: { subscriptions: [sub, paused] }, ops: { profiles: [profile('customer')] } }, now);
  assert.deepEqual(summary.pendingAccountChanges.map(change => change.id), ['future', 'resume-rate']);
  assert.equal(summary.pendingAccountChanges[0].customerName, 'customer');
  assert.equal(summary.pendingAccountChanges[0].subscriptionId, 'sub');
  assert.equal(summary.links.accountChanges, '/admin/crm/work-queue/?filter=requests');
});

test('owing invoices use native collectible state and deduplicate current/history invoices without double-subtracting credit', () => {
  const invoice = (id, status, totalCents, extra = {}) => ({ id, status, totalCents, revision: 1, periodStart: '2026-11-01', ...extra });
  const oldPaid = invoice('settled', 'failed', 10000);
  const current = [invoice('settled', 'paid', 10000, { revision: 2 }), invoice('owing', 'approved', 9000, { creditedCents: 1000, dueDate: '2026-11-20' }), invoice('failed', 'failed', 5000), invoice('future-approved', 'approved', 3000, { scheduledChargeAt: '2026-12-10T13:00:00Z' }), invoice('draft', 'draft', 2000), invoice('pending', 'pending', 7000), invoice('charging', 'charging', 8000), invoice('void', 'void', 1000), invoice('written', 'written_off', 1000), invoice('reconcile', 'failed', 1000, { reconciliationRequired: true }), invoice('zero', 'failed', 0)];
  const summary = homeSummary({ billing: { invoices: current, historyInvoices: [oldPaid, current[1], invoice('future-draft', 'draft', 6000, { periodStart: '2026-12-01' })] } }, now);
  assert.deepEqual(summary.owingInvoices.map(invoice => invoice.id), ['owing', 'failed', 'future-approved']);
  assert.equal(summary.owingCents, 17000); assert.equal(summary.owingInvoices[0].outstandingCents, 9000);
  assert.equal(summary.owingInvoices[0].displayStatus, 'overdue');
  assert.equal(summary.owingInvoices[2].displayStatus, 'open');
  assert.equal(summary.currentDraftCents, 2000); assert.equal(summary.currentDraftInvoices.length, 1);
  assert.equal(summary.links.owing, '/admin/crm/billing/?status=owed&month=all');
});

test('open jobs count properties once and prefer native completed/skipped/cancelled work over stale stored statuses', () => {
  const ids = ['completed', 'skipped', 'cancelled', 'failed', 'validation', 'mixed', 'empty'];
  const ops = { date, profiles: ids.map(id => profile(id)), plans: [{ id: 'route', technician_name: 'Alex Turner', status: 'in_progress' }], stops: ids.map((id, index) => storedStop(id, { sequence: index + 1 })), tasks: [storedTask('c', 'completed'), storedTask('s', 'skipped'), storedTask('x', 'cancelled'), storedTask('f', 'failed', 'failed'), storedTask('v', 'validation', 'validation_pending'), storedTask('m1', 'mixed', 'completed'), storedTask('m2', 'mixed')], office: { days: [{ id: 'shift', planId: 'route', date, memberName: 'Alex Turner', shift: { status: 'on_route' }, stops: [{ id: 'completed', name: 'Completed property', tasks: [{ id: 'c', status: 'completed' }] }, { id: 'skipped', tasks: [{ id: 's', status: 'skipped' }] }, { id: 'cancelled', tasks: [{ id: 'x', status: 'cancelled' }] }, { id: 'mixed', tasks: [{ id: 'm1', status: 'completed' }, { id: 'm2', status: 'working' }] }, { id: 'native-only', name: 'Appended property', address: 'New Street', tasks: [{ id: 'new', status: 'pending' }] }] }] } };
  const summary = homeSummary({ ops }, now);
  assert.equal(summary.todaysJobs.length, 8);
  assert.deepEqual(summary.openJobs.map(job => job.id), ['mixed', 'native-only', 'empty']);
  assert.equal(summary.openJobs.find(job => job.id === 'mixed').openTasks.length, 1);
  assert.equal(summary.openJobs.find(job => job.id === 'mixed').status, 'in_progress');
  const completed = summary.todaysJobs.find(job => job.id === 'completed');
  assert.equal(completed.name, 'Completed property'); assert.equal(completed.address, 'completed Street');
  assert.equal(completed.technicianName, 'Alex Turner'); assert.equal(completed.plan.id, 'route'); assert.equal(completed.stop.id, completed.id);
  assert.equal(summary.todaysJobs.find(job => job.id === 'skipped').status, 'skipped');
  assert.equal(summary.todaysJobs.find(job => job.id === 'cancelled').status, 'cancelled');
});

test('route-order review lists only unfinished available routes without an existing pending reorder', () => {
  const ids = ['available', 'queued', 'wrapping', 'closed', 'released', 'unreleased', 'cancelled', 'finished'];
  const ops = { date, plans: ids.map(id => ({ id, status: id === 'cancelled' ? 'cancelled' : 'finalized' })), stops: ids.map(id => storedStop(id, { route_plan_id: id })), tasks: ids.map(id => storedTask(id, id, id === 'finished' ? 'completed' : 'scheduled')), office: { released: [{ id: 'released-shift', planId: 'released' }], days: ['available', 'queued', 'wrapping', 'closed'].map(id => ({ id: `${id}-shift`, planId: id, date, shift: { status: id === 'wrapping' ? 'wrapping' : 'on_route', clockOut: id === 'closed' ? '2026-11-21T16:00:00Z' : null }, stops: [] })), changes: [{ kind: 'reorder', shift_id: 'queued-shift', status: 'pending' }, { kind: 'reorder', shift_id: 'available-shift', status: 'cancelled' }] } };
  const summary = homeSummary({ ops }, now);
  assert.deepEqual(summary.routeOrderReview.map(plan => plan.id), ['available', 'released']);
  assert.equal(summary.routeOrderReviewCount, 2); assert.equal(summary.links.routeOrderReview, '/admin/crm/routes/?view=order-review');
  assert.equal(Object.hasOwn(summary, 'unoptimized'), false); assert.doesNotMatch(JSON.stringify(summary), /unoptimized/);
});

test('today uses the Eastern calendar date and does not relabel a stale loaded service day as today', () => {
  const ops = { date, stops: [storedStop('property')], tasks: [storedTask('task', 'property')] };
  const beforeMidnight = homeSummary({ ops }, new Date('2026-11-21T04:30:00Z'));
  assert.equal(beforeMidnight.date, '2026-11-20'); assert.equal(beforeMidnight.todaysJobs.length, 0);
  assert.equal(homeSummary({ ops }, new Date('2026-11-21T05:30:00Z')).todaysJobs.length, 1);
});

test('home projection preserves source objects and empty input produces matching empty lists and counts', () => {
  const input = { crm: { subscriptions: [agreement('active', 'customer')], report: { activeMrrCents: 9500 } }, ops: { date, profiles: [profile('customer')] }, billing: { invoices: [] } };
  const before = structuredClone(input), summary = homeSummary(input, now);
  assert.deepEqual(input, before); assert.equal(summary.mrrCents, 9500);
  const empty = homeSummary({}, now);
  for (const key of ['eligibleUnassignedCustomers', 'pendingAccountChanges', 'owingInvoices', 'openJobs', 'todaysJobs', 'routeOrderReview', 'currentDraftInvoices']) assert.deepEqual(empty[key], []);
  assert.equal(empty.routeOrderReviewCount, 0); assert.equal(empty.currentDraftCents, 0); assert.equal(empty.owingCents, 0);
  assert.equal(summary.links, HOME_LINKS);
});
