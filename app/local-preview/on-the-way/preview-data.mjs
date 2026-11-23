import { localPreviewPaymentOrigin } from '../../../lib/local-preview-payments.mjs';
import { localPreviewCustomers } from '../../../scripts/local-preview-fixtures.mjs';

const ETA_OPTIONS = new Set(['5', '10', '15', '20', '30', '45']);
const QUERY_KEYS = new Set(['customerId', 'planId', 'minutes']);
const TECHNICIANS = [
  { name: 'Alex Turner', initials: 'AT' },
  { name: 'Jamie Miller', initials: 'JM' },
];

export function isLocalArrivalPreview(env, host, protocol) {
  const origin = localPreviewPaymentOrigin(env);
  return Boolean(origin && host === new URL(origin).host && (!protocol || protocol === 'http'));
}

// This projection deliberately excludes contacts, prices, access codes and notes.
// It reads fabricated fixtures only and never reads a database or provider.
export function arrivalPreviewData(query = {}, now = new Date()) {
  if (!query || Object.keys(query).some(key => !QUERY_KEYS.has(key)) || Object.values(query).some(value => typeof value !== 'string')) return null;
  const customers = localPreviewCustomers().slice(0, 12);
  const customer = customers.find(item => item.id === (query.customerId || 'local-customer-01'));
  if (!customer) return null;
  const index = customers.indexOf(customer), routeNumber = Math.floor(index / 6) + 1;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const planId = query.planId || `local-field-plan-${routeNumber}-${today}`;
  const plan = /^local-field-plan-([12])-(\d{4}-\d{2}-\d{2})$/.exec(planId);
  if (!plan || Number(plan[1]) !== routeNumber) return null;
  const serviceDate = new Date(`${plan[2]}T12:00:00Z`);
  if (Number.isNaN(serviceDate.getTime()) || serviceDate.toISOString().slice(0, 10) !== plan[2]) return null;
  const minutes = query.minutes || '15';
  if (!ETA_OPTIONS.has(minutes)) return null;
  const services = [{ title: customer.frequency === 'every_other_week' ? 'Biweekly yard cleanup' : 'Weekly yard cleanup', detail: 'A fresh yard, fence line to fence line', icon: 'yard' }];
  if (customer.addOnIds.some(id => id.startsWith('kitty_litter'))) services.push({ title: customer.addOnIds.includes('kitty_litter_changeout') ? 'Kitty litter change-out' : 'Kitty litter service', detail: 'Included with this visit', icon: 'litter' });
  if (customer.addOnIds.includes('deodorize')) services.push({ title: 'Yard deodorization', detail: 'Included with this visit', icon: 'sparkle' });
  if (customer.addOnIds.includes('haul_away')) services.push({ title: 'Waste haul-away', detail: 'Included with this visit', icon: 'bag' });
  if (customer.addOnIds.includes('sani_monthly')) services.push({ title: 'Yard sanitization', detail: 'Included with this visit', icon: 'sparkle' });
  if (customer.foodDelivery) services.push({ title: 'Dog food delivery', detail: `${customer.foodDelivery.quantity} × ${customer.foodDelivery.name}, ${customer.foodDelivery.weightLb} lb`, icon: 'bag' });
  return {
    firstName: customer.name.split(' ')[0], city: customer.city,
    technician: TECHNICIANS[routeNumber - 1], stopNumber: index % 6 + 1,
    minutes: Number(minutes),
    arrivalTime: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(now.getTime() + Number(minutes) * 60000)),
    serviceDate: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(serviceDate),
    services,
  };
}
