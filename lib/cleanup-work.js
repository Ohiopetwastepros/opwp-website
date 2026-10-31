import { getDb } from './db';
import { getQuickBooksCleanupDataset } from './quickbooks-cleanup';
import { closedRouteDate, shiftRouteDate } from './route-profitability-calculations.mjs';
import { CLEANUP_BILLING_KEY, cleanupWorkKey, validCleanupJobId, validateCleanupWorkInput, normalizeCleanupBillingInvoices } from './cleanup-work.mjs';

export async function readCleanupWork(db, ids) {
  const keys = [...new Set(ids.filter(validCleanupJobId).map(cleanupWorkKey))];
  const saved = new Map();
  for (let index = 0; index < keys.length; index += 80) {
    const batch = keys.slice(index, index + 80);
    const result = await db.prepare(`SELECT snapshot_key,payload FROM airtable_cockpit_snapshots WHERE snapshot_key IN (${batch.map(() => '?').join(',')})`).bind(...batch).all();
    for (const row of result.results || []) {
      const value = JSON.parse(row.payload);
      if (value.organizationId === 'org-opwp' && row.snapshot_key === cleanupWorkKey(value.jobId)) saved.set(value.jobId, value);
    }
  }
  return saved;
}

export async function readCleanupBilling(db) {
  const row = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(CLEANUP_BILLING_KEY).first();
  if (!row) return null;
  const value = JSON.parse(row.payload);
  return value.organizationId === 'org-opwp' && value.schemaVersion === 1 && Array.isArray(value.invoices) ? value : null;
}

export async function refreshCleanupBilling({ force = false } = {}, db = getDb()) {
  if (!db) throw new Error('Cleanup billing storage is unavailable.');
  const prior = await readCleanupBilling(db);
  if (!force && prior && Date.now() - Date.parse(prior.checkedAt) < 6 * 3600000) return { cached: true };
  const through = closedRouteDate(), from = shiftRouteDate(through, -399);
  const data = await getQuickBooksCleanupDataset({ dataset: 'entity', entity: 'Invoice', start: from, end: through, accountingMethod: 'Accrual' });
  if (String(data.meta?.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '') !== 'ohiopetwastepros') throw new Error('QuickBooks company could not be verified.');
  const invoices = await normalizeCleanupBillingInvoices(data.rows);
  const payload = JSON.stringify({ schemaVersion: 1, organizationId: 'org-opwp', checkedAt: new Date().toISOString(), from, through, invoices });
  if (new TextEncoder().encode(payload).length > 1500000) throw new Error('Cleanup billing evidence exceeds its storage budget.');
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',error=NULL,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(CLEANUP_BILLING_KEY, payload, new Date().toISOString()).run();
  return { cached: false, invoices: invoices.length };
}

export async function saveCleanupWork(db, input, source, actor) {
  const clean = validateCleanupWorkInput(input);
  if (!source || source.id !== clean.jobId || source.date !== clean.date || !['initial', 'one_time'].includes(source.category)) return { ok: false, status: 404, error: 'This completed cleanup could not be verified.' };
  const key = cleanupWorkKey(clean.jobId);
  const current = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(key).first();
  const prior = current ? JSON.parse(current.payload) : null;
  if ((prior?.revision || 0) !== clean.revision || (prior && (prior.organizationId !== 'org-opwp' || prior.jobId !== source.id || prior.date !== source.date || prior.customer !== source.customer))) return { ok: false, status: 409, error: 'This job changed. Reload it before saving.' };
  const updatedAt = new Date().toISOString();
  const value = { ...clean, schemaVersion: 1, organizationId: 'org-opwp', customer: source.customer, revision: clean.revision + 1, updatedAt, updatedBy: actor,
    history: [...(prior?.history || []), ...(prior ? [{ revision: prior.revision, crew: prior.crew, crewConfirmed: prior.crewConfirmed, reportedMinutes: prior.reportedMinutes, note: prior.note, updatedAt: prior.updatedAt, updatedBy: prior.updatedBy }] : [])].slice(-50) };
  const payload = JSON.stringify(value);
  if (new TextEncoder().encode(payload).length > 128000) return { ok: false, status: 409, error: 'This job review has reached its storage limit.' };
  const result = current
    ? await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?").bind(payload, updatedAt, key, current.payload).run()
    : await db.prepare("INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)").bind(key, payload, updatedAt).run();
  return Number(result.meta?.changes) === 1 ? { ok: true, revision: value.revision } : { ok: false, status: 409, error: 'Another review was saved first. Reload this job.' };
}
