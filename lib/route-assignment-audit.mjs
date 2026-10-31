import { sngScheduleValues } from './sng-service-schedule.mjs';
import { controlledSngFetch } from './sng-request-control.mjs';

export const ROUTE_AUDIT_KEY = 'route_assignment_audit_v1';
const text = value => String(value ?? '').trim();
const norm = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const id = value => text(value).replace(/\.0+$/, '');
const fields = ['Status', 'Frequency', 'Service Day', 'Service Day 2', 'Assigned Tech', 'Assigned Tech 2', 'Address', 'City', 'ZIP'];
const sourceId = row => id(row.client_id ?? row.id ?? row.user_id);

// Missing/ambiguous identities are findings, never name-based silent matches.
export function auditRouteAssignments({ clients, airtable, snapshot, capturedAt = new Date().toISOString(), snapshotAt, sourceComplete = false }) {
  const issues = [];
  const add = (code, clientId = '', field = '', expected = '', actual = '') => issues.push({ code, clientId, field, expected: text(expected).slice(0, 200), actual: text(actual).slice(0, 200) });
  const index = (rows, getId, source) => {
    const map = new Map();
    for (const row of rows) {
      const key = getId(row);
      if (!key) { if (source === 'sng' || norm(row.fields?.Status) === 'active') add('missing_identity', '', source); continue; }
      if (map.has(key)) { add('duplicate_identity', key, source); map.set(key, null); }
      else map.set(key, row);
    }
    return map;
  };
  const sng = index(clients, sourceId, 'sng');
  const air = index(airtable, row => id(row.fields?.['SNG Client ID']), 'airtable');
  const d1 = index(snapshot, row => id(row.fields?.['SNG Client ID']), 'd1');
  if (!sourceComplete || !clients.length) add('source_incomplete');
  const age = Date.parse(capturedAt) - Date.parse(snapshotAt);
  if (!Number.isFinite(age) || age < -60000 || age > 60 * 60000) add('snapshot_stale');
  let matched = 0;
  for (const [key, client] of sng) {
    if (!client) continue;
    const before = issues.length;
    const schedule = sngScheduleValues(client);
    const expected = { Status: 'Active', Frequency: schedule.frequency, 'Service Day': schedule.days[0] || '', 'Service Day 2': schedule.days[1] || '', 'Assigned Tech': schedule.assignedTech, 'Assigned Tech 2': schedule.assignedTech2 };
    const expectedDays = schedule.frequency === 'Twice Weekly' ? 2 : 1;
    if (!schedule.frequency || schedule.days.length !== expectedDays || !schedule.technicians.length) add('source_schedule_incomplete', key);
    // The active-client API lists days and people separately. Their positional
    // relationship is not evidence of who serves which day.
    if (schedule.technicians.length > 1) add('day_technician_mapping_unverified', key);
    for (const [field, value] of [['Address', client.address ?? client.client_address], ['City', client.city], ['ZIP', client.zip ?? client.zip_code]]) {
      if ((typeof value === 'string' || typeof value === 'number') && text(value)) expected[field] = text(value);
      else add('source_location_unverified', key, field);
    }
    for (const [label, rows] of [['airtable', air], ['d1', d1]]) {
      const row = rows.get(key);
      if (!row) { add('missing_customer', key, label); continue; }
      for (const [field, value] of Object.entries(expected)) {
        const actual = row.fields?.[field];
        if (norm(actual) !== norm(value)) add(`${label}_source_mismatch`, key, field, value, actual);
      }
    }
    if (issues.length === before) matched++;
  }
  for (const [key, row] of air) {
    if (!row) continue;
    if (norm(row.fields?.Status) === 'active' && !sng.has(key)) add('airtable_active_not_in_source', key);
    const stored = d1.get(key);
    if (!stored) { if (norm(row.fields?.Status) === 'active') add('d1_missing_airtable_customer', key); continue; }
    for (const field of fields) if (norm(row.fields?.[field]) !== norm(stored.fields?.[field])) add('d1_airtable_mismatch', key, field, row.fields?.[field], stored.fields?.[field]);
  }
  for (const [key, row] of d1) if (row && norm(row.fields?.Status) === 'active' && !sng.has(key)) add('d1_active_not_in_source', key);
  const counts = {};
  for (const issue of issues) counts[issue.code] = (counts[issue.code] || 0) + 1;
  return { version: 1, status: issues.length ? 'needs_review' : 'verified', capturedAt, snapshotAt, sourceComplete, scope: 'Current recurring residential roster, frequency, service days, technician fields and address; daily dispatch exceptions and stop order require dispatch evidence.', counts: { source: clients.length, airtable: airtable.length, d1: snapshot.length, matched, issues: issues.length }, issueCounts: counts, issues: issues.slice(0, 1000), truncated: issues.length > 1000 };
}

async function collection(url, token, kind, env) {
  const rows = [];
  let offset = '';
  for (let page = 1; page <= 50; page++) {
    const next = new URL(url);
    next.searchParams.set(kind === 'airtable' ? 'pageSize' : 'length', kind === 'airtable' ? '100' : '50');
    if (kind === 'airtable') { if (offset) next.searchParams.set('offset', offset); }
    else next.searchParams.set('page', String(page));
    const options = { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) };
    const response = kind === 'sng' ? await controlledSngFetch(env, next, options) : await fetch(next, options);
    if (!response.ok) throw new Error(`${kind} returned ${response.status}`);
    // Provider responses are untrusted, including HTTP-200 error pages.
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`${kind} returned no response body`);
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2000000) { await reader.cancel(); throw new Error(`${kind} response exceeded size limit`); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) { data.set(chunk, position); position += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(data));
    const items = kind === 'airtable' ? body.records : [body, body.data, body.results, body.items].find(Array.isArray);
    if (!Array.isArray(items)) throw new Error(`${kind} returned an unsupported collection`);
    rows.push(...items);
    if (rows.length > 5000) throw new Error(`${kind} exceeded record limit`);
    if (kind === 'airtable') { offset = body.offset; if (!offset) return rows; }
    else {
      const total = body.last_page ?? body.meta?.last_page ?? body.pagination?.total_pages ?? body.paginate?.total_pages;
      if (total != null) {
        if (!Number.isInteger(Number(total)) || Number(total) < 1 || Number(total) > 50 || (!items.length && page < Number(total))) throw new Error('sng pagination incomplete');
        if (page >= Number(total)) return rows;
      } else if (items.length < 50) return rows;
    }
  }
  throw new Error(`${kind} pagination incomplete`);
}

export async function collectRouteAssignmentAudit(env, snapshotRow, now = new Date()) {
  if (!env.SNG_API_KEY || !env.AIRTABLE_API_KEY) throw new Error('Route audit source credentials are unavailable');
  // Sequential provider reads avoid a burst against the shared SNG quota.
  const active = await collection('https://openapi.sweepandgo.com/api/v1/clients/active', env.SNG_API_KEY, 'sng', env);
  const oneTime = await collection('https://openapi.sweepandgo.com/api/v1/clients/active_no_subscription', env.SNG_API_KEY, 'sng', env);
  if (oneTime.some(row => !sourceId(row))) throw new Error('SNG non-subscription identities are incomplete');
  const excluded = new Set(oneTime.map(sourceId));
  const clients = active.filter(row => !excluded.has(sourceId(row)) && norm(row.client_name ?? row.full_name) !== 'testtest');
  const airtable = await collection('https://api.airtable.com/v0/appcAWPBQB8GmOrcT/tblhi8MGUOsWNmd37', env.AIRTABLE_API_KEY, 'airtable');
  const snapshot = JSON.parse(snapshotRow?.payload || '{}')?.opwp?.customers;
  return auditRouteAssignments({ clients, airtable, snapshot: Array.isArray(snapshot) ? snapshot : [], capturedAt: now.toISOString(), snapshotAt: snapshotRow?.captured_at, sourceComplete: snapshotRow?.status === 'success' && Array.isArray(snapshot) });
}

export async function readRouteAssignmentAudit(db, snapshotAt, now = new Date(), snapshotStatus = 'success') {
  const row = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(ROUTE_AUDIT_KEY).first();
  let audit;
  try { audit = JSON.parse(row?.payload || 'null'); } catch { audit = null; }
  if (!audit) return { status: 'unverified', issues: [], reason: 'No three-way route audit has completed.' };
  if (snapshotStatus !== 'success') return { ...audit, status: 'unverified', reason: 'The planning snapshot refresh is incomplete or failed.' };
  const age = now.getTime() - Date.parse(audit.capturedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 60 * 60000 || audit.snapshotAt !== snapshotAt) return { ...audit, status: 'stale', reason: 'The source data changed or the audit is over an hour old.' };
  return audit;
}

export async function runScheduledRouteAssignmentAudit(env, now = new Date()) {
  const snapshot = await env.DB.prepare("SELECT payload,status,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first();
  const prior = await readRouteAssignmentAudit(env.DB, snapshot?.captured_at, now, snapshot?.status);
  // Even a failed audit is cached for an hour, preventing 429 retry storms.
  const age = now.getTime() - Date.parse(prior.capturedAt);
  if (age >= 0 && age < 60 * 60000) return prior;
  let audit;
  try { audit = await collectRouteAssignmentAudit(env, snapshot, now); }
  catch (error) { audit = { status: 'unavailable', capturedAt: now.toISOString(), snapshotAt: snapshot?.captured_at || null, reason: String(error.message).slice(0, 200), issues: [] }; }
  const payload = JSON.stringify(audit);
  if (new TextEncoder().encode(payload).length > 1000000) throw new Error('Route audit exceeds storage budget');
  await env.DB.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(ROUTE_AUDIT_KEY, payload, audit.status === 'verified' ? 'success' : 'partial', now.toISOString()).run();
  return audit;
}
