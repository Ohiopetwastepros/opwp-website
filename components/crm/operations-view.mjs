// Read-only UI projections. Counts and destination lists share these arrays;
// nothing here changes native workdays, schedules, agreements or invoice state.
import { invoiceDisplayStatus, invoiceIsOwed, invoiceOutstandingCents } from './InvoiceView.mjs';

const list = value => Array.isArray(value) ? value : [];
const cents = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const nativeAccounted = new Set(['completed', 'skipped', 'cancelled']);
const storedAccounted = new Set(['completed', 'skipped', 'cancelled', 'failed', 'validation_pending']);
const cancelled = new Set(['cancelled', 'canceled', 'ended']);
const openShift = new Set(['ready', 'loading', 'loaded', 'on_route']);
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const easternDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const unique = values => [...new Map(list(values).filter(value => value?.id).map(value => [value.id, value])).values()];
export const HOME_LINKS = Object.freeze({
  unassigned: '/admin/crm/customers/?filter=unassigned',
  accountChanges: '/admin/crm/work-queue/?filter=requests',
  owing: '/admin/crm/billing/?status=owed&month=all',
  openJobs: '/admin/crm/routes/?view=open',
  routeOrderReview: '/admin/crm/routes/?view=order-review',
  todaysJobs: '/admin/crm/routes/',
});

function invoicesFor(billing) {
  const invoices = new Map();
  // Current-period records win equal-revision ties over the history projection.
  for (const invoice of [...list(billing.historyInvoices), ...list(billing.invoices)]) {
    if (!invoice?.id) continue;
    const prior = invoices.get(invoice.id);
    if (!prior || Number(invoice.revision || 0) >= Number(prior.revision || 0)) invoices.set(invoice.id, invoice);
  }
  return [...invoices.values()];
}

function jobsFor(ops, today) {
  if (ops.date !== today) return [];
  const plans = new Map(unique(ops.plans).map(plan => [plan.id, plan]));
  const profiles = new Map(unique(ops.profiles).map(profile => [profile.id, profile]));
  const days = list(ops.office?.days).filter(day => !day.date || day.date === today);
  const storedStops = unique(ops.stops), storedTasks = unique(ops.tasks);
  const stops = new Map(storedStops.map(stop => [stop.id, { stored: stop, native: null, day: null }]));
  for (const day of days) for (const stop of unique(day.stops)) {
    const previous = stops.get(stop.id);
    stops.set(stop.id, { stored: previous?.stored || null, native: stop, day });
  }
  return [...stops.values()].map(({ stored, native, day }) => {
    const id = native?.id || stored.id, routeId = day?.planId || stored?.route_plan_id || null;
    const plan = plans.get(routeId) || null;
    const dbTasks = storedTasks.filter(task => task.location_id === id);
    const useNative = Array.isArray(native?.tasks);
    const tasks = useNative ? unique(native.tasks).map(task => ({ ...dbTasks.find(storedTask => storedTask.id === task.id), ...task })) : dbTasks;
    const isAccounted = task => (useNative ? nativeAccounted : storedAccounted).has(task.status);
    const openTasks = tasks.filter(task => !isAccounted(task));
    const closedEmpty = !tasks.length && ['finished', 'completed', 'skipped', 'cancelled'].includes(native?.status || stored?.arrival_status);
    const accounted = closedEmpty || tasks.length > 0 && openTasks.length === 0;
    const completed = tasks.length > 0 && tasks.every(task => task.status === 'completed' || !useNative && task.status === 'validation_pending');
    const knownCustomer = [stored?.location_key, ...tasks.map(task => task.customer_external_id || task.source?.customerId)].find(customerId => profiles.has(customerId));
    const customerId = knownCustomer || null, profile = profiles.get(customerId);
    const name = native?.name || stored?.customer_display_name || profile?.name || 'Property';
    const address = native?.address || stored?.address || '';
    const sequence = day ? day.stops.findIndex(stop => stop.id === id) + 1 : Number(stored?.sequence || 0);
    const status = completed ? 'completed' : accounted ? tasks.length && tasks.every(task => task.status === 'cancelled') ? 'cancelled' : tasks.length && tasks.every(task => ['skipped', 'failed'].includes(task.status)) ? 'skipped' : 'accounted' : tasks.some(task => ['working', 'in_progress'].includes(task.status)) ? 'in_progress' : native?.arrivedAt || stored?.arrival_status === 'arrived' ? 'arrived' : 'scheduled';
    const stop = { ...stored, ...native, id, name, address, tasks, sequence, route_plan_id: routeId };
    return { id, name, address, customerId, routeId, technicianName: day?.memberName || plan?.technician_name || '', sequence, status, stop, plan, tasks, openTasks, accounted, completed, href: `/admin/crm/routes/?stopId=${encodeURIComponent(id)}` };
  }).sort((a, b) => String(a.routeId || '').localeCompare(String(b.routeId || '')) || a.sequence - b.sequence || a.id.localeCompare(b.id));
}

function changesFor(subscriptions, profiles, customers, today) {
  const names = new Map([...customers, ...profiles].map(customer => [customer.id, customer.name || customer.displayName || customer.id]));
  const changes = [];
  for (const subscription of subscriptions) {
    const versions = new Map();
    for (const version of [...list(subscription.scheduledChanges), ...list(subscription.versions)]) {
      if (!version?.id) continue;
      const prior = versions.get(version.id);
      versions.set(version.id, { ...prior, ...version, cancelledAt: prior?.cancelledAt || version.cancelledAt || null });
    }
    for (const version of versions.values()) {
      if (!validDay(version.effectiveDate) || version.effectiveDate <= today || version.cancelledAt || subscription.endDate && version.effectiveDate >= subscription.endDate) continue;
      changes.push({ ...version, subscriptionId: subscription.id, customerId: subscription.customerId, customerName: names.get(subscription.customerId) || subscription.customerId, status: 'scheduled', href: `/admin/crm/subscriptions/?customerId=${encodeURIComponent(subscription.customerId)}` });
    }
  }
  return changes.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id));
}

export function homeSummary({ crm = {}, billing = {}, ops = {} } = {}, now = Date.now()) {
  const date = easternDay(now), subscriptions = unique(crm.subscriptions), profiles = unique(ops.profiles);
  const active = subscriptions.filter(subscription => subscription.status === 'active' && (!subscription.startDate || subscription.startDate <= date) && (!subscription.endDate || subscription.endDate > date));
  const todaysJobs = jobsFor(ops, date), openJobs = todaysJobs.filter(job => !job.accounted);
  const assigned = new Set(todaysJobs.map(job => job.customerId).filter(Boolean));
  const changes = list(ops.office?.changes);
  for (const change of changes) if (change.kind === 'add_visit' && ['pending', 'accepted'].includes(change.status) && change.payload?.localCustomerId) assigned.add(change.payload.localCustomerId);
  const eligibleUnassignedCustomers = profiles.filter(profile => {
    if (assigned.has(profile.id) || profile.foodDelivery) return false;
    const agreements = subscriptions.filter(subscription => subscription.customerId === profile.id);
    const activeAgreement = active.some(subscription => subscription.customerId === profile.id);
    const oneTime = profile.frequency === 'one_time' && !agreements.some(subscription => subscription.status === 'paused' || cancelled.has(subscription.status));
    return activeAgreement || oneTime;
  });
  const pendingAccountChanges = changesFor(subscriptions, profiles, list(crm.customers), date);
  const invoices = invoicesFor(billing);
  const owingInvoices = invoices.filter(invoiceIsOwed).map(invoice => ({ ...invoice, displayStatus: invoiceDisplayStatus(invoice, now), outstandingCents: invoiceOutstandingCents(invoice), href: `/admin/crm/billing/?month=all&status=owed&invoiceId=${encodeURIComponent(invoice.id)}` }));
  const currentDraftInvoices = invoices.filter(invoice => invoice.status === 'draft' && validDay(invoice.periodStart) && invoice.periodStart.slice(0, 7) === date.slice(0, 7));
  const routeOrderReview = unique(ops.plans).filter(plan => {
    if (!['finalized', 'in_progress'].includes(plan.status) || !openJobs.some(job => job.routeId === plan.id)) return false;
    const day = list(ops.office?.days).find(day => day.planId === plan.id && (!day.date || day.date === date));
    if (day ? day.shift?.clockOut || !openShift.has(day.shift?.status) : !list(ops.office?.released).some(shift => shift.planId === plan.id)) return false;
    return !changes.some(change => change.kind === 'reorder' && change.status === 'pending' && change.shift_id === day?.id);
  });
  const mrrCents = Number.isSafeInteger(crm.report?.activeMrrCents) && (!crm.date || crm.date === date) ? cents(crm.report.activeMrrCents) : active.reduce((sum, subscription) => sum + cents(subscription.totalCents), 0);
  return {
    date, loadedServiceDate: ops.date || null,
    eligibleUnassignedCustomers, pendingAccountChanges, owingInvoices, openJobs, todaysJobs,
    routeOrderReview, routeOrderReviewCount: routeOrderReview.length,
    routeOrderReviewDetail: 'Routes with unfinished work, an available shift and no route-order proposal awaiting technician review.',
    mrrCents, currentDraftInvoices, currentDraftCents: currentDraftInvoices.reduce((sum, invoice) => sum + cents(invoice.totalCents), 0),
    owingCents: owingInvoices.reduce((sum, invoice) => sum + invoice.outstandingCents, 0),
    links: HOME_LINKS,
  };
}
