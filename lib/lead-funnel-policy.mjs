import { PRICING, YARD_TIERS, isInArea, haulAwayPrice } from '../app/free-quote/pricing.js';

export const FUNNEL_SETTINGS_KEY = 'lead_funnel_settings:org-opwp';
export const FUNNEL_META_POLICY = 'lead-funnel-initial-v1';
export const funnelJobKey = id => 'lead_funnel_job:org-opwp:' + id;
export const parseFunnelJson = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
export const funnelTime = value => {
  if (!value) return NaN;
  const s = String(value).replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + 'Z');
};
export async function funnelDigest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export function funnelPhone(value) {
  if (!/^[+\d(). -]+$/.test(String(value || '').trim())) return '';
  const digits = String(value).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) && !/^\d{3}55501\d{2}$/.test(digits) ? '+1' + digits : '';
}
export function funnelQuiet(now, settings = {}) {
  const local = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
  if (local >= '20:00' || local < '08:00') return true;
  if (!settings.quiet_hours_enabled) return false;
  const start = settings.quiet_hours_start, end = settings.quiet_hours_end;
  if (!/^\d{2}:\d{2}$/.test(start || '') || !/^\d{2}:\d{2}$/.test(end || '') || start === end) return true;
  return start > end ? local >= start || local < end : local >= start && local < end;
}
export function nextFunnelSendAt(now, settings = {}) {
  if (!funnelQuiet(now, settings)) return new Date(now).toISOString();
  // Iterate UTC minutes so both Eastern DST transitions are handled correctly.
  for (let at = Math.ceil(now / 60000) * 60000; at <= now + 48 * 3600000; at += 60000) {
    if (!funnelQuiet(at, settings)) return new Date(at).toISOString();
  }
  return null;
}
const frequencyIds = {Weekly:'once_a_week',Biweekly:'every_other_week',Monthly:'once_a_month','Twice Weekly':'twice_a_week','One Time':'one_time'};
export function funnelDetails(body = {}) {
  const q = body.quote_context || {};
  return {dogs:Number(q.dogs || body.number_of_dogs),frequency:frequencyIds[body.clean_up_frequency] || q.frequency || body.clean_up_frequency || '',
    yard:q.yard_size || body.yard_size_tier || '',lastCleaned:q.last_cleaned || body.last_time_yard_was_thoroughly_cleaned || '',
    addons:q.selected_addons || body.selected_addons || [],zip:body.zip || body.zip_code || '',address:body.home_address || body.address || '',city:body.city || '',state:body.state || 'OH'};
}
export function funnelQuote(body) {
  const d = funnelDetails(body), frequency = PRICING.frequencies.find(f => f.id === d.frequency), yard = YARD_TIERS.find(y => y.id === d.yard);
  // Never trust a browser-supplied monthly total or infer missing yard/cleanup facts.
  const range = (d.frequency === 'one_time' ? PRICING.oneTimeCleanup : PRICING.initialCleanup)[d.lastCleaned]?.[d.dogs];
  const base = PRICING.monthly[d.frequency]?.[d.dogs];
  const addons = Array.isArray(d.addons) ? d.addons.map(id => PRICING.addons.find(a => a.id === id)) : [null];
  if (!isInArea(d.zip) || !Number.isInteger(d.dogs) || !frequency || d.dogs > frequency.maxDogs || !yard || ['unsure','xlarge'].includes(yard.id) || !range ||
      (d.frequency !== 'one_time' && base == null) || addons.some(a => !a || a.charge === 'product' || d.frequency === 'one_time' && a.charge === 'monthly')) return {custom:true};
  return {custom:false,monthly:d.frequency === 'one_time' ? null : base + yard.upcharge + addons.filter(a => a.charge === 'monthly').reduce((sum,a) => sum + (a.id === 'haul_away' ? haulAwayPrice(d.dogs) : a.price),0),cleanupRange:range};
}
export function buildFunnelInitialText(body, route = {}) {
  const d = funnelDetails(body), q = funnelQuote(body);
  const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
  const price = q.custom ? '' : q.monthly === null ? ` Your one-time cleanup estimate is ${q.cleanupRange.map(money).join(' to ')}.` :
    ` Your service quote is ${money(q.monthly)} per month, plus an initial cleanup estimate of ${q.cleanupRange.map(money).join(' to ')}. The cleanup amount is confirmed after seeing the yard.`;
  const day = route.day && !route.stale ? ` The recommended recurring service day is ${route.day}, subject to final availability.` : '';
  const next = !d.address ? ' Please reply with the service address so we can check your route.' : !d.dogs ? ' How many dogs should we plan for?' :
    ' Please reply with gate or access instructions and your preferred start date, or continue signup at https://www.ohiopetwastepros.com/free-quote/ .';
  return `Hello, this is Craig with Ohio Pet Waste Pros. Thank you for reaching out for a quote.${price}${day}${next} Reply STOP to opt out.`.replace(/[\u2013\u2014]/g,'-');
}
export function sonaHandoffBrief(body, route = {}) {
  const d = funnelDetails(body), q = funnelQuote(body);
  return `Continue this requested quote after Craig's initial text. Collect the full service address, exact dog count, gate/access instructions and preferred start. Ask for missing yard size, cleanup history and frequency before quoting. ${q.custom ? 'Price needs clarification using the website pricing chart.' : `Verified website quote: ${q.monthly === null ? 'one-time cleanup' : '$' + q.monthly + '/month'}; cleanup estimate $${q.cleanupRange.join(' to $')}.`} ${route.day && !route.stale ? 'Recommended recurring day: ' + route.day + ', subject to availability.' : 'Service day is pending address and fresh route evidence.'} Do not promise capacity, accept terms, take payment or create a customer. Send the customer to https://www.ohiopetwastepros.com/free-quote/ to complete their own signup. Honor STOP and human takeover. Use no en dash or em dash.`;
}
