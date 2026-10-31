export const RECORD_BASES = [
  { id: 'appcAWPBQB8GmOrcT', label: 'Service business' },
  { id: 'appc40e3mlfOt2HoA', label: 'Dog food' },
];
export const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
export const TABLE_ID = /^tbl[A-Za-z0-9]{14}$/;
export const FIELD_ID = /^fld[A-Za-z0-9]{14}$/;
export const RECORD_TABLE_PATHS = {
  tblhi8MGUOsWNmd37: ['opwp', 'customers'], tbls15v5OYexAIULc: ['opwp', 'jobs'],
  tbl7mHSMWYsYc8f6S: ['opwp', 'time'], tblWd5FNDgvOfQJW8: ['opwp', 'targets'],
  tblyhWKl99rwpiIRI: ['opwp', 'churn'], tblGLypXMPxEZQb6B: ['opwp', 'oneTime'],
  tblCrdvGKkGobRWxL: ['opwp', 'leads'], tblzRg9DZKdIRQDrn: ['opwp', 'reviewTracker'],
  tblpEYQ3qpfcKLmdo: ['dogFood', 'sales'], tblR7qUUiVhQvZuHr: ['dogFood', 'products'],
  tblAXBVAMlcwoWM8J: ['dogFood', 'subscriptions'], tbl9WHrBHdS2GBuQF: ['dogFood', 'customers'],
  tblkphHkGNisP7UJ6: ['dogFood', 'deliveries'],
};
const NATIVE_TABLES = {
  tblCrdvGKkGobRWxL: { href: '/admin/quote-funnel/', label: 'Manage leads', reason: 'Lead workflow and consent are managed in YardOps. This table is its synchronized copy.' },
  tbln6XXZzoubixUC8: { href: '/admin/failed-payments/', label: 'Manage payment recovery', reason: 'Payment and message states come from verified recovery events.' },
  tblEPfSqB2StlDXDU: { href: '/admin/dog-food/', label: 'Manage website orders', reason: 'Website workflow is a synchronized copy of website orders, payments and delivery decisions.' },
};
const SUPPORTED = new Set(['singleLineText','multilineText','richText','email','phoneNumber','url','number','currency','percent','duration','rating','checkbox','singleSelect','multipleSelects','date','dateTime','multipleRecordLinks','multipleAttachments']);
export class RecordError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function recordDestination(base, table, record = '', search = '') {
  const params = new URLSearchParams({ base, table });
  if (record) params.set('record', record);
  if (search) params.set('search', search);
  return '/admin/records/?' + params;
}
export function nativeRecordWorkflow(tableId, record) {
  if (NATIVE_TABLES[tableId]) return NATIVE_TABLES[tableId];
  const fields = record?.fields || {};
  if (Object.entries(fields).some(([name,value]) => /^(Website (Order|Customer|PO|Line) ID|Stable ID)$/.test(name) && value)) {
    return { href: '/admin/dog-food/', label: 'Manage website record', reason: 'This website-owned record is synchronized from sales operations. Use its operating controls so billing, inventory and deliveries remain consistent.' };
  }
  return null;
}
export function fieldEditable(field, tableId, record) {
  if (nativeRecordWorkflow(tableId, record) || !SUPPORTED.has(field.type)) return false;
  return !/^(Website |.*\(Website\)$|Source Records$|Last Synced$|Captured At$)/.test(field.name) && !/(password|secret|access.?token|refresh.?token|api.?key)/i.test(field.name);
}
export function schemaForClient(table, record = null) {
  return { id: table.id, name: table.name, primaryFieldId: table.primaryFieldId,
    workflow: nativeRecordWorkflow(table.id, record),
    fields: table.fields.filter(f => !/(password|secret|access.?token|refresh.?token|api.?key)/i.test(f.name)).map(f => ({ id: f.id, name: f.name, type: f.type, description: f.description || '', editable: fieldEditable(f,table.id,record), options: { choices: f.options?.choices?.map(c=>({id:c.id,name:c.name})) || [], linkedTableId: f.options?.linkedTableId || '', precision: f.options?.precision, max: f.options?.max } })) };
}
function validDate(value, dateOnly) {
  if (typeof value !== 'string' || value.length > 35 || (dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(value))) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && (!dateOnly || new Date(time).toISOString().slice(0,10) === value);
}
export function validateRecordFields(table, record, supplied) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new RecordError('Choose the fields to save.');
  const entries = Object.entries(supplied);
  if (!entries.length || entries.length > 60) throw new RecordError('Save between 1 and 60 changed fields at a time.');
  const fields = {};
  for (const [id, value] of entries) {
    const field = table.fields.find(f => f.id === id);
    if (!field || !FIELD_ID.test(id) || !fieldEditable(field,table.id,record)) throw new RecordError('A selected field is calculated or managed by another website workflow.');
    if (value === null) { fields[id] = null; continue; }
    let valid = false;
    if (['singleLineText','multilineText','richText','email','phoneNumber','url'].includes(field.type)) {
      valid = typeof value === 'string' && value.length <= (['multilineText','richText'].includes(field.type) ? 12000 : 1000);
      if (valid && value && field.type === 'url') { try { valid = ['https:','http:'].includes(new URL(value).protocol); } catch { valid = false; } }
      if (valid && value && field.type === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    } else if (['number','currency','percent','duration','rating'].includes(field.type)) {
      valid = typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e10;
      if (field.type === 'rating') valid = valid && Number.isInteger(value) && value >= 0 && value <= (field.options?.max || 5);
    } else if (field.type === 'checkbox') valid = typeof value === 'boolean';
    else if (field.type === 'date' || field.type === 'dateTime') valid = validDate(value,field.type === 'date');
    else if (field.type === 'singleSelect') valid = typeof value === 'string' && (field.options?.choices || []).some(c=>c.name === value);
    else if (field.type === 'multipleSelects') valid = Array.isArray(value) && value.length <= 50 && value.every(v=>typeof v === 'string' && (field.options?.choices || []).some(c=>c.name === v));
    else if (field.type === 'multipleRecordLinks') valid = Array.isArray(value) && value.length <= 50 && value.every(v=>typeof v === 'string' && RECORD_ID.test(v));
    else if (field.type === 'multipleAttachments') {
      valid = Array.isArray(value) && value.length <= 10 && value.every(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        if (Object.keys(item).some(k=>!['id','url','filename'].includes(k))) return false;
        if (item.id) return /^att[A-Za-z0-9]{14}$/.test(item.id) && (record?.fields?.[field.name] || []).some(a=>a.id === item.id) && !item.url;
        try { const url = new URL(item.url); return url.protocol === 'https:' && url.href.length <= 2000 && !url.username && !url.password && (!item.filename || (typeof item.filename === 'string' && item.filename.length <= 200)); } catch { return false; }
      });
    }
    if (!valid) throw new RecordError(`Enter a valid value for ${field.name}.`);
    fields[id] = value;
  }
  return fields;
}
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
export async function recordVersion(record) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(record.fields || {})));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
