import { outboundFetch } from './outbound-request.js';
import { readBoundedProviderJson } from './bounded-body.mjs';
import { sngClientEmail, sngClientPhone } from './sng-client-email.mjs';
import { withRecordLease } from './admin-record-store.mjs';

const BASE = 'appcAWPBQB8GmOrcT', TABLE = 'tblhi8MGUOsWNmd37';
const API = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
export const SEASONAL_FIELDS = Object.freeze({
  seasonal_pattern: 'fldLldeK79dcsxb3a',
  pause_start_date: 'fldQYYm95n5I8LE2l',
  planned_restart_date: 'fldHNohkYnTXO6nbM',
  pause_count: 'fldxtazFGZ10xDxoK',
  pause_history: 'fldb8PCSi3fOERasJ',
  next_action_date: 'fldGdHopCo6UzOAC0',
});
const MATCH_FIELDS = { client_name: 'fldHkCp7DG7Ic5j8f', sng_client_id: 'fldi918YuxMiQMHWn', phone: 'fld6ZCwqkM4KOK1oA', email: 'fldvPD16o3KFGl9gS' };
const LABELS = { year_round: 'Year-round', winter: 'Winter pauser', spring_fall: 'Spring/Fall pauser', summer: 'Summer pauser', other: 'Other' };
const PATTERNS = Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [label, key]));
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const normalized = value => text(value).toLowerCase().replace(/\s+/g, ' ');
const phone = value => { const digits = text(value).replace(/\D/g, ''); return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits; };
const literal = value => text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : '';
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const field = (record, key) => record.fields?.[SEASONAL_FIELDS[key] || MATCH_FIELDS[key]] ?? record.fields?.[({ client_name: 'Client Name', sng_client_id: 'SNG Client ID', phone: 'Phone', email: 'Email', seasonal_pattern: 'Seasonal Pattern', pause_start_date: 'Pause Start', planned_restart_date: 'Planned Restart', pause_count: 'Pause Count', pause_history: 'Pause History', next_action_date: 'Next Pause Action' })[key]];
const marker = event => `[seasonal:${encodeURIComponent(text(event.id))}]`;
const pauseEvent = event => ['paused', 'canceled_seasonal'].includes(event.event_type);
function businessDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}
function periodKey(event) {
  return date(event.pause_start_date) ? `date:${event.pause_start_date}` : text(event.period_key) ? `period:${event.period_key}` : `event:${event.id}`;
}
function identity(client, state) {
  return { id: text(state.sng_client_id || client.sng_client_id || client.client_id || (typeof client.client !== 'object' ? client.client : '')), email: normalized(state.email || sngClientEmail(client)), name: normalized(state.client_name || client.client_name || client.full_name), phone: phone(state.phone || sngClientPhone(client)) };
}
function compatible(record, who) { return !text(field(record, 'sng_client_id')) || !who.id || text(field(record, 'sng_client_id')) === who.id; }
function matches(record, who, method) {
  if (!compatible(record, who)) return false;
  return method === 'id' ? text(field(record, 'sng_client_id')) === who.id : method === 'email' ? normalized(field(record, 'email')) === who.email : normalized(field(record, 'client_name')) === who.name && phone(field(record, 'phone')) === who.phone;
}
async function request(env, path, options = {}) {
  const response = await outboundFetch(API + path, { ...options, cache: 'no-store', headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } }, { provider: 'airtable', operation: 'seasonal_pause', timeoutMs: 20000, retryable: !options.method, retries: 1 });
  const data = await readBoundedProviderJson(response, 2 * 1024 * 1024);
  if (!response.ok) throw new Error(`Airtable seasonal pause request failed (${response.status}).`);
  return data;
}
async function lookup(env, formula, maxRecords = 2) {
  const params = new URLSearchParams({ pageSize: '100', maxRecords: String(maxRecords), returnFieldsByFieldId: 'true', filterByFormula: formula });
  for (const id of [...Object.values(MATCH_FIELDS), ...Object.values(SEASONAL_FIELDS)]) params.append('fields[]', id);
  const result = [];
  for (let page = 0; page < 2; page++) {
    const data = await request(env, `?${params}`);
    if (!Array.isArray(data.records)) throw new Error('Airtable seasonal lookup returned invalid records.');
    result.push(...data.records);
    if (!data.offset) return result;
    params.set('offset', data.offset);
  }
  throw new Error('Airtable seasonal identity lookup exceeded its bound.');
}
async function matchCustomer(env, who) {
  const attempts = [
    who.id && ['id', `TRIM({SNG Client ID}&'')='${literal(who.id)}'`, 2],
    who.email && ['email', `LOWER(TRIM({Email}&''))='${literal(who.email)}'`, 2],
    who.name && who.phone && ['name_phone', `LOWER(TRIM({Client Name}&''))='${literal(who.name)}'`, 101],
  ].filter(Boolean);
  for (const [method, formula, maximum] of attempts) {
    const rows = await lookup(env, formula, maximum);
    const candidates = method === 'name_phone' ? rows.filter(row => normalized(field(row, 'client_name')) === who.name && phone(field(row, 'phone')) === who.phone) : rows;
    if (!candidates.length) continue;
    if (candidates.length !== 1 || rows.length >= 101) return { reason: 'ambiguous_match' };
    if (!compatible(candidates[0], who)) return { reason: 'conflicting_client_id' };
    if (!/^rec[A-Za-z0-9]{10,}$/.test(candidates[0].id || '')) throw new Error('Airtable seasonal lookup returned an invalid record identifier.');
    return { record: candidates[0], method };
  }
  return { reason: 'no_match' };
}

// Subscription GET rows do not promise a client ID. A unique existing Airtable
// identity link is evidence; a client name is never converted into a new ID.
export async function lookupSeasonalPauseCustomer(env, client, { requireClientId = true } = {}) {
  if (!env?.AIRTABLE_API_KEY) return { status: 'unconfigured' };
  const who = identity(client || {}, {}), matched = await matchCustomer(env, who);
  if (!matched.record) return { status: 'unmatched', reason: matched.reason };
  const current = await request(env, `/${matched.record.id}?returnFieldsByFieldId=true`);
  if (current.id !== matched.record.id || !matches(current, who, matched.method)) return { status: 'unmatched', reason: 'identity_changed' };
  const clientId = text(field(current, 'sng_client_id'));
  if (requireClientId && !clientId) return { status: 'unmatched', reason: 'missing_client_id' };
  return { status: 'matched', recordId: current.id, fields: current.fields || {}, clientId, method: matched.method };
}
function initialBaseline(record, events) {
  const history = String(field(record, 'pause_history') || ''), latest = date(field(record, 'pause_start_date'));
  const dates = new Set([...history.matchAll(/(?:^|\n)\s*(\d{4}-\d{2}-\d{2})\s+(?:paused\b|seasonal[- ]canceled\b|canceled_seasonal\b)/gi)].map(match => match[1]));
  if (latest) dates.add(latest);
  const periods = [...new Map(events.filter(pauseEvent).map(event => [periodKey(event), event])).entries()];
  const existingCount = count(field(record, 'pause_count'));
  const represented = existingCount ? periods.filter(([, event]) => dates.has(date(event.pause_start_date) || businessDate(event.event_at)) || history.includes(marker(event))).map(([key]) => key) : [];
  const review = existingCount > represented.length && latest ? periods.filter(([key, event]) => !represented.includes(key) && date(event.pause_start_date) && event.pause_start_date < latest).map(([key]) => key) : [];
  return { pause_count: existingCount, period_keys: represented, review_period_keys: review };
}
function line(event, notes) {
  const reason = text(event.pause_reason).replace(/[\r\n]+/g, ' ').slice(0, 1500) || 'Reason not supplied';
  const kind = event.event_type === 'unpaused' ? 'resumed' : event.event_type === 'canceled_seasonal' ? 'paused (seasonal cancellation)' : event.event_type;
  return `${businessDate(event.event_at) || date(event.pause_start_date) || 'Date unknown'} ${kind} ${reason} ${text(event.source).replace(/[\r\n]+/g, ' ')} ${marker(event)}${notes.length ? `; ${notes.join('; ')}` : ''}`;
}
function desiredFields(record, events, state) {
  const fields = {}, preserved = {}, notes = [];
  const currentPattern = text(field(record, 'seasonal_pattern')), proposedPattern = LABELS[state.seasonal_pattern] || '';
  if (currentPattern && currentPattern !== proposedPattern) {
    preserved.seasonal_pattern = PATTERNS[currentPattern] || 'unknown';
    preserved.seasonal_pattern_label = currentPattern;
    if (proposedPattern) notes.push(`kept existing Seasonal Pattern ${currentPattern}; event suggests ${proposedPattern}`);
  } else if (proposedPattern) fields[SEASONAL_FIELDS.seasonal_pattern] = proposedPattern;
  const currentRestart = date(field(record, 'planned_restart_date')), proposedRestart = date(state.planned_restart_date);
  const restart = currentRestart || proposedRestart;
  if (currentRestart && currentRestart !== proposedRestart) {
    preserved.planned_restart_date = currentRestart;
    if (proposedRestart) notes.push(`kept existing Planned Restart ${currentRestart}; event suggests ${proposedRestart}`);
  } else if (proposedRestart) fields[SEASONAL_FIELDS.planned_restart_date] = proposedRestart;
  const start = date(state.pause_start_date);
  if (start) fields[SEASONAL_FIELDS.pause_start_date] = start;
  const represented = new Set(state.baseline_period_keys || []), review = new Set(state.baseline_review_period_keys || []);
  const newPeriods = new Set(events.filter(pauseEvent).map(periodKey).filter(key => !represented.has(key) && !review.has(key)));
  fields[SEASONAL_FIELDS.pause_count] = Math.max(count(field(record, 'pause_count')), count(state.baseline_pause_count) + newPeriods.size);
  if (review.size) notes.push('historical pause count needs review; existing backfill count retained');
  let nextAction = date(state.next_action_date);
  const lastEvent = [...events].sort((a, b) => text(a.event_at).localeCompare(text(b.event_at))).at(-1);
  const lastEventDate = businessDate(state.last_event_at || lastEvent?.event_at);
  const actionStillNeeded = state.is_paused === true || Number(state.is_paused) === 1 || Boolean(restart && lastEventDate && restart > lastEventDate);
  if (currentRestart && currentRestart !== proposedRestart) {
    const latestPause = [...events].filter(pauseEvent).sort((a, b) => text(b.event_at).localeCompare(text(a.event_at)))[0];
    const end = date(state.pause_end_date) || date(latestPause?.pause_end_date);
    nextAction = actionStillNeeded ? end && end < restart ? end : restart : '';
  }
  if (!actionStillNeeded) nextAction = '';
  fields[SEASONAL_FIELDS.next_action_date] = nextAction || null;
  let history = String(field(record, 'pause_history') || '');
  for (const event of [...events].sort((a, b) => text(a.event_at).localeCompare(text(b.event_at)) || text(a.id).localeCompare(text(b.id)))) {
    if (!text(event.id) || text(event.id).length > 200) throw new Error('A seasonal event is missing a stable identifier.');
    if (!history.includes(marker(event))) history += (history && !history.endsWith('\n') ? '\n' : '') + line(event, notes);
  }
  if (history.length > 100000) throw new Error('Airtable pause history reached its text limit; existing history retained.');
  fields[SEASONAL_FIELDS.pause_history] = history;
  const mirror = { seasonal_pattern: preserved.seasonal_pattern || state.seasonal_pattern || 'unknown', planned_restart_date: restart || null, pause_count: fields[SEASONAL_FIELDS.pause_count], pause_history: history, next_action_date: nextAction || null };
  for (const [id, value] of Object.entries(fields)) if ((record.fields?.[id] ?? field(record, Object.keys(SEASONAL_FIELDS).find(key => SEASONAL_FIELDS[key] === id)) ?? null) === value) delete fields[id];
  return { fields, preserved, mirror, notes };
}

// A baseline is returned before the first mutation. The caller must persist it
// in D1 before calling again, so a lost PATCH response cannot recount backfill.
// Pass all documented events for this client, including already-synced events.
export async function syncSeasonalPauseAirtable(env, { client = {}, events = [], state = {} }) {
  if (!env?.AIRTABLE_API_KEY || !env.DB) return { status: 'unconfigured' };
  const who = identity(client, state);
  const matched = await lookupSeasonalPauseCustomer(env, { ...client, sng_client_id: who.id, email: who.email, client_name: who.name, phone: who.phone }, { requireClientId: false });
  if (matched.status !== 'matched') {
    console.warn(JSON.stringify({ event: 'seasonal_pause_airtable_skipped', reason: matched.reason }));
    return { status: 'unmatched', reason: matched.reason };
  }
  const recordId = matched.recordId;
  return withRecordLease(env.DB, `${BASE}:${TABLE}:${recordId}`, async () => {
    const current = await request(env, `/${recordId}?returnFieldsByFieldId=true`);
    if (current.id !== recordId || !matches(current, who, matched.method)) return { status: 'unmatched', reason: 'identity_changed', recordId };
    if (!Number.isSafeInteger(state.baseline_pause_count) || !Array.isArray(state.baseline_period_keys)) return { status: 'baseline_required', recordId, baseline: initialBaseline(current, events) };
    const result = desiredFields(current, events, state);
    if (!Object.keys(result.fields).length) return { status: 'synced', unchanged: true, recordId, ...result };
    await request(env, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: recordId, fields: result.fields }], typecast: false }) });
    const saved = await request(env, `/${recordId}?returnFieldsByFieldId=true`);
    if (saved.id !== recordId || !Object.entries(result.fields).every(([id, value]) => (saved.fields?.[id] ?? null) === value)) throw new Error('Airtable seasonal pause update was not verified; retry required.');
    return { status: 'synced', recordId, ...result };
  });
}
