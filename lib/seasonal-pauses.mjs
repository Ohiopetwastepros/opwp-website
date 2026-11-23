import { controlledSngFetch } from './sng-request-control.mjs';
import { fetchSngBillingCollection } from './subscription-reconciliation.mjs';
import { sngClientEmail, sngClientPhone } from './sng-client-email.mjs';
import { syncSeasonalPauseAirtable, lookupSeasonalPauseCustomer } from './seasonal-pause-airtable.mjs';
import { withRecordLease } from './admin-record-store.mjs';

const text = value => String(value ?? '').trim();
const first = (...values) => values.find(value => value !== undefined && value !== null && text(value) !== '') ?? '';
const PAUSE_TYPES = new Set(['paused', 'canceled_seasonal']);
const WEBHOOK_TYPES = new Map([
  ['client:subscription_paused', 'paused'], ['client:subscription_unpaused', 'unpaused'],
  ['commercial:subscription_paused', 'paused'], ['commercial:subscription_unpaused', 'unpaused'],
  ['client:subscription_canceled', 'canceled_seasonal'], ['commercial:subscription_canceled', 'canceled_seasonal'],
]);

export function seasonalBusinessDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}

// Office convention (2026-11-23): Seasonal - winter / spring/fall / summer.
// Legacy Seasonal is deliberately unknown; a 90-day cap does not identify a season.
export function seasonalPattern(reason, notes = '') {
  const primary = text(reason).toLowerCase();
  const value = !primary || /^seasonal\s*$/i.test(primary) ? `${primary} ${text(notes).toLowerCase()}` : primary;
  if (!/\bseasonal\b/.test(value)) return 'unknown';
  if (/\bwinter\b/.test(value)) return 'winter';
  if (/\bspring\b|\bfall\b|\bautumn\b/.test(value)) return 'spring_fall';
  if (/\bsummer\b/.test(value)) return 'summer';
  return /\bother\b/.test(value) ? 'other' : 'unknown';
}

export function nextPauseAction({ pause_end_date, planned_restart_date }) {
  const end = seasonalBusinessDate(pause_end_date || ''), restart = seasonalBusinessDate(planned_restart_date || '');
  return end && (!restart || end < restart) ? end : restart || null;
}

function identity(row) {
  const nested = row?.client && typeof row.client === 'object' ? row.client : {};
  return {
    sng_client_id: text(first(row?.client_id, typeof row?.client !== 'object' ? row?.client : '', nested.client_id, nested.id)),
    sng_subscription_id: text(first(row?.subscription_id, row?.subscription_item_id, row?.id)),
    client_name: text(first(row?.client_name, row?.full_name, nested.client_name, nested.full_name,
      `${row?.first_name || nested.first_name || ''} ${row?.last_name || nested.last_name || ''}`)),
    email: sngClientEmail(row), phone: sngClientPhone(row),
  };
}

const normalized = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const plan = row => normalized(first(row?.service_plan, row?.service_name, row?.subscription_name, row?.name)).replace(/^regularplan/, '');
const address = row => normalized(first(row?.client_address, row?.address));
function contactMatch(left, right) {
  const a = identity(left), b = identity(right);
  if (!a.client_name || normalized(a.client_name) !== normalized(b.client_name)) return false;
  const email = a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase();
  const phone = a.phone && b.phone && normalized(a.phone).replace(/^1(?=\d{10}$)/, '') === normalized(b.phone).replace(/^1(?=\d{10}$)/, '');
  return Boolean(email || phone || (address(left) && address(left) === address(right)));
}
function subscriptionDescriptor(row, person, kind) {
  // Plan descriptors are an internal matching key, never a fabricated provider ID.
  const descriptor = plan(row);
  return `${kind}|${person.sng_client_id}|${descriptor ? `plan:${descriptor}:${normalized(row.pricing_plan)}:${normalized(row.billing_interval)}:${normalized(row.commercial_location)}` : `id:${person.sng_subscription_id}`}`;
}
function subscriptionKey(row, person, kind) {
  return person.sng_subscription_id ? `${kind}|${person.sng_client_id}|id:${person.sng_subscription_id}` : subscriptionDescriptor(row, person, kind);
}

async function resolveSubscriptionId(env, row, kind) {
  const person = identity(row);
  if (person.sng_subscription_id) return row;
  const descriptor = subscriptionDescriptor(row, person, kind), start = seasonalBusinessDate(row.pause_start_date || '');
  const known = (await clientEvents(env.DB, person.sng_client_id)).filter(event => event.subscription_descriptor === descriptor && event.sng_subscription_id && (!start || event.pause_start_date === start));
  const ids = [...new Set(known.map(event => event.sng_subscription_id))];
  if (ids.length > 1) return null;
  return ids.length ? { ...row, subscription_id: ids[0] } : row;
}

async function bindSubscription(env, row, kind, options) {
  const person = identity(row);
  if (person.sng_client_id) return resolveSubscriptionId(env, row, kind);
  // Already received authenticated webhooks provide a durable provider-ID binding.
  const archived = (await env.DB.prepare(`SELECT payload FROM sng_events WHERE json_valid(payload)
    AND (lower(json_extract(payload,'$.data.client_email'))=? OR lower(json_extract(payload,'$.data.client_name'))=?)
    ORDER BY received_at DESC LIMIT 500`).bind(person.email.toLowerCase() || '__absent__', person.client_name.toLowerCase() || '__absent__').all()).results || [];
  const matches = archived.flatMap(event => { try { return [JSON.parse(event.payload).data]; } catch { return []; } })
    .filter(data => data && identity(data).sng_client_id && contactMatch(row, data));
  const ids = [...new Set(matches.map(data => identity(data).sng_client_id))];
  if (ids.length === 1) return resolveSubscriptionId(env, { ...row, client_id: ids[0] }, kind);
  if (ids.length > 1) return null;
  const match = await (options.lookupCustomer || lookupSeasonalPauseCustomer)(env, row);
  return match.status === 'matched' && match.clientId ? resolveSubscriptionId(env, { ...row, client_id: match.clientId }, kind) : null;
}

function sourceDate(...values) {
  for (const value of values) {
    if (!text(value)) continue;
    if (typeof value === 'number' || /^\d{10,13}$/.test(text(value))) {
      const number = Number(value), date = new Date(number < 1e12 ? number * 1000 : number);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
    // Official date-only fields remain business dates. Noon UTC is unambiguous in Eastern time.
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? `${value}T12:00:00Z` : value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return '';
}

function canceledSeasonally(row) {
  return /\bseasonal\b/i.test([row?.termination_reason, row?.termination_comment, row?.termination_note].filter(Boolean).join(' '));
}

async function eventId(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function seasonalSchemaReady(db) {
  if (!db) return false;
  const row = await db.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('seasonal_pause_events','seasonal_pause_clients')").first();
  return Number(row?.total) === 2;
}

async function clientEvents(db, id) {
  return (await db.prepare('SELECT * FROM seasonal_pause_events WHERE sng_client_id=? ORDER BY created_at,event_at,id').bind(id).all()).results || [];
}

function latestPeriods(events) {
  // An initial sync can precede a webhook that supplies the real subscription ID.
  // Associate that no-ID window only when exactly one provider subscription is known.
  events = events.map(event => {
    if (event.sng_subscription_id) return event;
    const known = events.filter(row => row.sng_subscription_id && row.subscription_descriptor === event.subscription_descriptor && row.pause_start_date === event.pause_start_date);
    const ids = [...new Set(known.map(row => row.sng_subscription_id))];
    return ids.length === 1 ? { ...event, subscription_key: known[0].subscription_key, period_key: known[0].period_key } : event;
  });
  const periods = new Map();
  for (const event of events) {
    if (!periods.has(event.period_key)) periods.set(event.period_key, []);
    periods.get(event.period_key).push(event);
  }
  return [...periods.values()].map(rows => {
    const pauses = rows.filter(row => PAUSE_TYPES.has(row.event_type));
    const latest = pauses.at(-1) || rows.at(-1);
    return { ...latest, resumed: rows.some(row => row.event_type === 'unpaused') || events.some(row =>
      row.event_type === 'unpaused' && !row.pause_start_date && row.subscription_key === latest.subscription_key && row.event_at >= latest.event_at) };
  }).sort((a, b) => (a.pause_start_date || a.event_at).localeCompare(b.pause_start_date || b.event_at));
}

function deriveClient(events, prior = {}) {
  const periods = latestPeriods(events);
  const latestBySubscription = new Map();
  for (const period of periods.sort((a, b) => (a.pause_start_date || a.event_at).localeCompare(b.pause_start_date || b.event_at))) {
    latestBySubscription.set(period.subscription_key, period);
  }
  const open = [...latestBySubscription.values()].filter(row => PAUSE_TYPES.has(row.event_type) && !row.resumed);
  const latest = open.at(-1) || periods.at(-1) || events.at(-1);
  const last = [...events].sort((a, b) => a.event_at.localeCompare(b.event_at)).at(-1);
  const restart = prior.planned_restart_date || latest.planned_restart_date || null;
  const pattern = prior.seasonal_pattern && prior.seasonal_pattern !== 'unknown' ? prior.seasonal_pattern : latest.seasonal_pattern;
  const pauseCount = new Set(events.filter(row => PAUSE_TYPES.has(row.event_type)).map(row => row.pause_start_date || row.period_key)).size;
  const next = nextPauseAction({ pause_end_date: latest.pause_end_date, planned_restart_date: restart });
  return {
    sng_client_id: latest.sng_client_id, client_name: last.client_name || prior.client_name || latest.client_name || '',
    email: last.email || prior.email || '', phone: last.phone || prior.phone || '', seasonal_pattern: pattern || 'unknown',
    pause_start_date: latest.pause_start_date || prior.pause_start_date || null,
    pause_end_date: latest.pause_end_date || null, planned_restart_date: restart,
    pause_reason: latest.pause_reason || prior.pause_reason || '', pause_count: Math.max(pauseCount, Number(prior.pause_count) || 0),
    // An early/lapsed unpause with a later human restart still needs office review.
    next_action_date: open.length || (restart && restart > seasonalBusinessDate(last.event_at)) ? next : null,
    is_paused: open.length ? 1 : 0, last_event_at: last.event_at,
  };
}

async function refreshClient(db, id) {
  const prior = await db.prepare('SELECT * FROM seasonal_pause_clients WHERE sng_client_id=?').bind(id).first() || {};
  const events = await clientEvents(db, id);
  const state = deriveClient(events, prior);
  const keys = Object.keys(state);
  await db.prepare(`INSERT INTO seasonal_pause_clients (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
    ON CONFLICT(sng_client_id) DO UPDATE SET ${keys.filter(key => key !== 'sng_client_id').map(key => `${key}=excluded.${key}`).join(',')},
    airtable_sync_status='pending',updated_at=CURRENT_TIMESTAMP`).bind(...Object.values(state)).run();
  return state;
}

async function syncClient(env, id, syncAirtable) {
  const db = env.DB;
  let state = await db.prepare('SELECT * FROM seasonal_pause_clients WHERE sng_client_id=?').bind(id).first();
  const events = await clientEvents(db, id);
  const decode = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
  const input = () => ({ client: state, events, state: { ...state, baseline_period_keys: decode(state.baseline_period_keys), baseline_review_period_keys: decode(state.baseline_review_period_keys) } });
  try {
    let result = await syncAirtable(env, input());
    if (result.status === 'baseline_required') {
      await db.prepare(`UPDATE seasonal_pause_clients SET baseline_pause_count=?,baseline_period_keys=?,baseline_review_period_keys=?,airtable_record_id=?
        WHERE sng_client_id=? AND baseline_pause_count IS NULL`).bind(result.baseline.pause_count, JSON.stringify(result.baseline.period_keys || []), JSON.stringify(result.baseline.review_period_keys || []), result.recordId, id).run();
      state = await db.prepare('SELECT * FROM seasonal_pause_clients WHERE sng_client_id=?').bind(id).first();
      result = await syncAirtable(env, input());
    }
    if (result.status !== 'synced') {
      await db.prepare('UPDATE seasonal_pause_clients SET airtable_sync_status=? WHERE sng_client_id=?').bind(result.status === 'unmatched' ? 'unmatched' : 'failed', id).run();
      return result;
    }
    const mirror = result.mirror || {};
    await db.prepare(`UPDATE seasonal_pause_clients SET airtable_record_id=?,airtable_sync_status='synced',airtable_synced_at=?,
      seasonal_pattern=COALESCE(?,seasonal_pattern),planned_restart_date=COALESCE(?,planned_restart_date),
      pause_count=MAX(pause_count,?),pause_history=COALESCE(?,pause_history),next_action_date=?,updated_at=CURRENT_TIMESTAMP WHERE sng_client_id=?`)
      .bind(result.recordId, new Date().toISOString(), mirror.seasonal_pattern || null, mirror.planned_restart_date || null,
        Number(mirror.pause_count) || 0, mirror.pause_history ?? null,
        nextPauseAction({ pause_end_date: state.pause_end_date, planned_restart_date: mirror.planned_restart_date || state.planned_restart_date }) && (state.is_paused || (mirror.planned_restart_date || state.planned_restart_date) > seasonalBusinessDate(state.last_event_at))
          ? nextPauseAction({ pause_end_date: state.pause_end_date, planned_restart_date: mirror.planned_restart_date || state.planned_restart_date }) : null, id).run();
    await db.prepare('UPDATE seasonal_pause_events SET airtable_record_id=? WHERE sng_client_id=? AND airtable_record_id IS NULL').bind(result.recordId, id).run();
    return result;
  } catch {
    await db.prepare("UPDATE seasonal_pause_clients SET airtable_sync_status='failed' WHERE sng_client_id=?").bind(id).run();
    console.warn(JSON.stringify({ event: 'seasonal_pause_airtable_sync_failed' }));
    return { status: 'failed' };
  }
}

export async function persistSeasonalPause(env, event, { syncAirtable = syncSeasonalPauseAirtable } = {}) {
  return withRecordLease(env.DB, `seasonal-client:${event.sng_client_id}`, async () => {
  const values = { ...event, id: await eventId(`${event.period_key}|${event.event_type}|${event.event_type === 'unpaused' ? '' : `${event.pause_end_date || ''}|${event.pause_reason || ''}|${event.planned_restart_date || ''}`}`) };
  const keys = Object.keys(values);
  const result = await env.DB.prepare(`INSERT INTO seasonal_pause_events (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO NOTHING`).bind(...Object.values(values)).run();
  // Rebuilding also repairs a delivery interrupted after INSERT but before state/sync.
  await refreshClient(env.DB, event.sng_client_id);
  const airtable = await syncClient(env, event.sng_client_id, syncAirtable);
    return { inserted: Number(result.meta?.changes) > 0, airtable };
  });
}

export async function fetchSeasonalSubscriptions(env, { commercial = false } = {}) {
  if (!commercial) return fetchSngBillingCollection(env, 'subscriptions');
  const rows = [];
  for (let page = 1; page <= 40; page++) {
    const url = new URL('https://openapi.sweepandgo.com/api/v2/commercial/subscriptions');
    url.searchParams.set('page', String(page)); url.searchParams.set('length', '50');
    const response = await controlledSngFetch(env, url, { headers: { Authorization: `Bearer ${env.SNG_API_KEY}`, Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`SNG commercial subscriptions returned ${response.status}.`);
    const data = (await response.json()).subscriptions;
    if (!Array.isArray(data?.data) || data.current_page !== page || !Number.isInteger(data.last_page) || data.last_page < page || data.data.length > 50) throw new Error('SNG commercial subscription pagination could not be verified.');
    rows.push(...data.data);
    if (page === data.last_page) {
      if (!Number.isInteger(data.total) || rows.length !== data.total) throw new Error('SNG commercial subscription count is incomplete.');
      return rows;
    }
  }
  throw new Error('SNG commercial subscriptions exceeded the reconciliation limit.');
}

async function makeEvent(env, { row, type, kind, source, body = {}, now = new Date() }) {
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  const person = identity({ ...data, ...row });
  if (!person.sng_client_id) throw new Error('Seasonal pause is missing an authoritative SNG client ID.');
  const existing = await clientEvents(env.DB, person.sng_client_id);
  const stamp = sourceDate(data.event_at, data.created_at, body.created_at, body.created, body.timestamp, data.timestamp,
    type === 'canceled_seasonal' ? first(row.canceled_at, data.canceled_at, row.end_date, data.end_date) : '',
    source === 'subscription_sync' && type === 'paused' ? row.pause_start_date : '', now);
  const businessDate = seasonalBusinessDate(stamp);
  const key = subscriptionKey(row, person, kind);
  const prior = latestPeriods(existing).filter(event => event.subscription_key === key &&
    (!event.pause_start_date || event.pause_start_date <= businessDate)).at(-1);
  const start = seasonalBusinessDate(first(data.pause_start_date, row.pause_start_date, type === 'canceled_seasonal' ? first(row.canceled_at, data.canceled_at, row.end_date, data.end_date) : '', type === 'unpaused' ? prior?.pause_start_date : ''));
  if (!start && type !== 'unpaused') throw new Error('Seasonal pause start could not be verified from Sweep & Go.');
  const reason = text(first(data.pause_reason, row.pause_reason, data.termination_reason, row.termination_reason, prior?.pause_reason));
  const notes = [data.termination_comment, row.termination_comment, data.termination_note, row.termination_note].filter(Boolean).join(' ');
  return {
    ...person, sng_subscription_id: person.sng_subscription_id || null, subscription_key: key, subscription_descriptor: subscriptionDescriptor(row, person, kind), subscription_kind: kind, event_type: type, event_at: stamp,
    pause_start_date: start || null, pause_end_date: seasonalBusinessDate(first(data.pause_end_date, row.pause_end_date, prior?.pause_end_date)) || null,
    planned_restart_date: seasonalBusinessDate(first(data.planned_restart_date, data.planned_resume_date, prior?.planned_restart_date)) || null,
    pause_reason: reason, seasonal_pattern: seasonalPattern(reason, notes), source,
    period_key: type === 'unpaused' && prior ? prior.period_key : `${key}|${start || `unresolved:${stamp}`}`,
    raw_payload: JSON.stringify(source === 'webhook' ? { webhook: body, subscription: row } : row),
    created_at: new Date(now).toISOString(),
  };
}

export async function captureSeasonalPauseWebhook(env, { eventType, body }, options = {}) {
  const type = WEBHOOK_TYPES.get(eventType);
  if (!type) return { skipped: true, reason: 'unrelated_event' };
  if (!await seasonalSchemaReady(env?.DB)) return { skipped: true, reason: 'migration_pending' };
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  if (type === 'canceled_seasonal' && text(data.termination_reason) && !canceledSeasonally(data)) return { skipped: true, reason: 'nonseasonal_cancel' };
  const kind = eventType.startsWith('commercial:') ? 'commercial' : 'residential';
  const fetchSubscriptions = options.fetchSubscriptions || fetchSeasonalSubscriptions;
  // Always enrich using the official collection, including unpauses whose live dates cleared.
  const rows = await fetchSubscriptions(env, { commercial: kind === 'commercial' });
  const target = identity(data);
  if (!target.sng_client_id) throw new Error('Seasonal webhook is missing client_id.');
  let matches = rows.filter(row => {
    const candidate = identity(row);
    if (candidate.sng_client_id && candidate.sng_client_id !== target.sng_client_id) return false;
    if (candidate.sng_subscription_id && target.sng_subscription_id && candidate.sng_subscription_id !== target.sng_subscription_id) return false;
    return (candidate.sng_client_id === target.sng_client_id || contactMatch(row, data)) && (!plan(data) || plan(row) === plan(data));
  });
  if (matches.length > 1 && !matches.some(row => identity(row).sng_subscription_id === target.sng_subscription_id)) {
    const expected = type === 'paused' ? 'paused' : type === 'unpaused' ? 'active' : 'canceled';
    const current = matches.filter(row => text(row.status).toLowerCase() === expected);
    if (current.length === 1) matches = current;
  }
  if (matches.length !== 1) throw new Error('Seasonal webhook subscription enrichment is ambiguous or missing.');
  const row = { ...matches[0], client_id: target.sng_client_id, subscription_id: target.sng_subscription_id || identity(matches[0]).sng_subscription_id };
  if (type === 'canceled_seasonal' && !canceledSeasonally({ ...row, ...data })) return { skipped: true, reason: 'nonseasonal_cancel' };
  const event = await makeEvent(env, { row, type, kind, source: 'webhook', body, now: options.now });
  return persistSeasonalPause(env, event, options);
}

export async function reconcileSeasonalPauses(env, residentialSubscriptions, options = {}) {
  if (!await seasonalSchemaReady(env?.DB)) return { skipped: true, reason: 'migration_pending' };
  let inserted = 0, failed = 0;
  let commercial = [];
  try { commercial = await (options.fetchSubscriptions || fetchSeasonalSubscriptions)(env, { commercial: true }); }
  catch { failed++; }
  for (const [kind, rows] of [['residential', residentialSubscriptions], ['commercial', commercial]]) {
    const descriptors = rows.map(row => `${normalized(identity(row).client_name)}|${identity(row).email.toLowerCase()}|${plan(row)}|${normalized(row.pricing_plan)}|${normalized(row.billing_interval)}|${normalized(row.commercial_location)}|${row.pause_start_date || ''}|${row.status || ''}`);
    for (const raw of rows) {
      let row = raw;
      const status = text(row.status).toLowerCase();
      // Avoid resolving every unrelated historical subscription/customer.
      const mightPause = status === 'paused' || Boolean(row.pause_start_date) || (status === 'canceled' && canceledSeasonally(row));
      const descriptor = `${normalized(identity(row).client_name)}|${identity(row).email.toLowerCase()}|${plan(row)}|${normalized(row.pricing_plan)}|${normalized(row.billing_interval)}|${normalized(row.commercial_location)}|${row.pause_start_date || ''}|${row.status || ''}`;
      if (!identity(row).sng_subscription_id && descriptors.filter(value => value === descriptor).length > 1) { if (mightPause) failed++; continue; }
      if (!identity(row).sng_client_id && !mightPause) {
        const names = (await env.DB.prepare('SELECT client_name,email FROM seasonal_pause_clients').all()).results || [];
        if (!names.some(client => (client.email && client.email.toLowerCase() === identity(row).email.toLowerCase()) || normalized(client.client_name) === normalized(identity(row).client_name))) continue;
      }
      try { row = await bindSubscription(env, row, kind, options); } catch { failed++; continue; }
      if (!row) { if (mightPause) failed++; continue; }
      const person = identity(row);
      const start = seasonalBusinessDate(row.pause_start_date || '');
      const today = seasonalBusinessDate(options.now || new Date());
      let type = status === 'paused' || (status === 'active' && start && start > today) ? 'paused'
        : status === 'canceled' && canceledSeasonally(row) ? 'canceled_seasonal' : '';
      if (!type && status === 'active') {
        const prior = latestPeriods(await clientEvents(env.DB, person.sng_client_id)).filter(event =>
          event.subscription_key === subscriptionKey(row, person, kind)).at(-1);
        if (prior && !prior.resumed) type = 'unpaused';
      }
      if (!type) continue;
      try {
        const result = await persistSeasonalPause(env, await makeEvent(env, { row, type, kind, source: 'subscription_sync', now: options.now }), options);
        if (result.inserted) inserted++;
        if (result.airtable?.status === 'failed') failed++;
      } catch { failed++; }
    }
  }
  // Previously unmatched or failed clients retry through this same scheduled sync.
  const pending = (await env.DB.prepare("SELECT sng_client_id FROM seasonal_pause_clients WHERE airtable_sync_status<>'synced' LIMIT 100").all()).results || [];
  for (const row of pending) await withRecordLease(env.DB, `seasonal-client:${row.sng_client_id}`, () => syncClient(env, row.sng_client_id, options.syncAirtable || syncSeasonalPauseAirtable));
  if (failed) console.warn(JSON.stringify({ event: 'seasonal_pause_reconciliation_incomplete', failed }));
  return { inserted, failed };
}
