import {compareLeadAirtableFields} from './lead-airtable-verification.mjs';
import {normalizePhone} from './lead-assistant.mjs';
import {readBoundedProviderJson} from './bounded-body.mjs';
import {CRAIG_READY_LABEL} from './lead-craig-signup.mjs';

const BASE = 'appcAWPBQB8GmOrcT';
const TABLE = 'tblxniDSLBZdba6Z7';
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const text = (value, limit = 200) => String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, limit);
const quote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const day = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; };

async function requireMirrorResponse(response, stage) {
  if (response.ok) return;
  await response.body?.cancel();
  // Do not retain provider bodies: they can echo contact details or credentials.
  throw new Error(`meta_airtable_${stage}_failed_http_${response.status}`);
}

// This table has its own source key and schema. The website Leads mirror is
// deliberately unchanged; Facebook data never uses its YardOps Lead ID fields.
export function metaAirtableFields(row, previous = {}) {
  const source = parse(row.payload), id = text(row.meta_lead_id || source.meta_lead_id, 120);
  if (!id) throw new Error('meta_airtable_source_id_missing');
  const fields = {'Meta Lead ID': id};
  if (!previous.Source) fields.Source = 'Facebook lead form';
  const identity = {Name: text(row.name), Phone: normalizePhone(row.phone), Email: text(row.email, 254), ZIP: text(row.zip, 10), Town: text(source.city || source.town, 120)};
  for (const [key, value] of Object.entries(identity)) if (value && !previous[key]) fields[key] = value;
  const captured = day(row.created_at);
  if (captured && !previous['Lead Date']) fields['Lead Date'] = captured;
  if (String(row.form_id || source.meta_form_id) === '1725121795904553' && !previous.Form) fields.Form = 'v2';
  const desired = row.growth_stage === 'won' || row.status === 'converted' ? 'Signed up'
    : row.growth_stage === 'quoted' ? 'Quoted' : row.last_inbound_at ? 'Replied' : row.last_outbound_at ? 'Texted' : 'New';
  const order = ['New','Texted','Replied','Quoted','Signed up'];
  if (!previous['Lead Status'] || order.includes(previous['Lead Status']) && order.indexOf(desired) > order.indexOf(previous['Lead Status'])) fields['Lead Status'] = desired;
  if (desired === 'Signed up') fields.Converted = true;
  // Meta Leads has no ready-for-setup select choice. Preserve staff notes and
  // use an explicit, idempotent marker without marking the lead converted.
  if (row.next_action === CRAIG_READY_LABEL && desired !== 'Signed up' && row.outcome_reason !== 'opted_out') {
    const notes=String(previous.Notes || '');
    if (!notes.split(/\r?\n/).includes(CRAIG_READY_LABEL)) fields.Notes=[notes,CRAIG_READY_LABEL].filter(Boolean).join('\n');
  }
  if (row.outcome_reason === 'opted_out') {
    fields['Do Not Text'] = true;
    if (previous['Text Status'] !== 'Opted out in Quo') fields['Text Status'] = 'Asked to stop';
  }
  const contact = day(row.last_inbound_at || row.last_outbound_at);
  if (contact && (!previous['Last Contact'] || contact > previous['Last Contact'])) fields['Last Contact'] = contact;
  // Do not clear an existing opt-out, rewrite human Notes, create Customers, or
  // coalesce different form leads simply because they share a phone number.
  return fields;
}

export async function syncMetaAirtableLead(env, row, {fetcher = fetch} = {}) {
  const baseId = env.AIRTABLE_BASE_ID || BASE, tableId = env.AIRTABLE_META_LEADS_TABLE_ID || TABLE;
  if (!env.AIRTABLE_API_KEY || baseId !== BASE || tableId !== TABLE) throw new Error('meta_airtable_configuration_missing');
  const source = metaAirtableFields(row), endpoint = `https://api.airtable.com/v0/${baseId}/${tableId}`;
  const headers = {Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json'};
  const lookup = new URL(endpoint);
  lookup.searchParams.set('filterByFormula', `{Meta Lead ID}='${quote(source['Meta Lead ID'])}'`);
  lookup.searchParams.set('maxRecords', '2');
  // Workers supports only manual/follow. Manual also prevents credentials from
  // following a provider redirect; every non-2xx response is rejected below.
  const find = await fetcher(lookup, {method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(12000)});
  await requireMirrorResponse(find, 'lookup');
  const existing = await readBoundedProviderJson(find, 128 * 1024);
  if (!Array.isArray(existing.records) || existing.records.length > 1 || existing.offset) throw new Error('meta_airtable_source_key_unverified');
  const fields = metaAirtableFields(row, existing.records[0]?.fields);
  const response = await fetcher(endpoint, {method: 'PATCH', headers, redirect: 'manual', signal: AbortSignal.timeout(12000),
    body: JSON.stringify({performUpsert: {fieldsToMergeOn: ['Meta Lead ID']}, records: [{fields}], typecast: false})});
  await requireMirrorResponse(response, 'upsert');
  const saved = await readBoundedProviderJson(response, 128 * 1024), recordId = saved.records?.[0]?.id;
  if (!/^rec[A-Za-z0-9]+$/.test(recordId || '')) throw new Error('meta_airtable_receipt_missing');
  const readback = await fetcher(`${endpoint}/${recordId}`, {method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(12000)});
  await requireMirrorResponse(readback, 'readback');
  const record = await readBoundedProviderJson(readback, 128 * 1024);
  const differences = compareLeadAirtableFields(fields, record.fields);
  if (record.id !== recordId) differences.push('record_id');
  return {recordId, differences};
}
