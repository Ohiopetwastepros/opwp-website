import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { cleanupWorkEvidence, validateCleanupWorkInput, cleanupWorkKey, invoiceServiceSignature, normalizeCleanupBillingInvoices, cleanupBillingEvidence, durationEvidence } from '../lib/cleanup-work.mjs';
import { applyRouteSourceEvidence } from '../lib/route-source-evidence.mjs';

const fields = { 'Job ID': '123', Date: '2026-02-16', 'Customer Name': 'Example Customer', 'Tech Name': staffPrivate.primaryName, 'Actual Minutes': 55, 'Est. Minutes': 40,
  'Source Work': { startedAt: '2026-02-16 12:00:00', endedAt: '2026-02-16 13:00:00', duration: '00:55:00' } };
const input = { jobId: '123', date: fields.Date, revision: 0, crewConfirmed: true, reportedMinutes: 50,
  crew: [{ name: staffPrivate.primaryName, reportedMinutes: 50 }, { name: staffPrivate.reliefName, reportedMinutes: 30 }], note: 'Both technicians reported their time to the office.' };

test('elapsed, SNG duration, estimate, reported job time, and total crew labor stay distinct', () => {
  const saved = { ...input, customer: fields['Customer Name'], revision: 1 };
  const work = cleanupWorkEvidence(fields, saved);
  assert.equal(work.elapsedMinutes, 60); assert.equal(work.sourceDurationMinutes, 55); assert.equal(work.estimatedMinutes, 40);
  assert.equal(work.reportedMinutes, 50); assert.equal(work.varianceMinutes, -10); assert.equal(work.reportedLaborMinutes, 80);
  assert.equal(cleanupWorkEvidence(fields, { ...saved, crewConfirmed: false }).reportedLaborMinutes, null);
  assert.equal(cleanupWorkEvidence(fields, { ...saved, crew: [{ name: staffPrivate.primaryShort, reportedMinutes: null }] }).reportedLaborMinutes, null);
});

test('a primary technician or legacy duration cannot establish full crew, measured time, or technician-reported time', () => {
  const work = cleanupWorkEvidence({ ...fields, 'Source Work': null });
  assert.equal(work.elapsedMinutes, null); assert.equal(work.legacyMinutes, 55); assert.equal(work.crewConfirmed, false);
  assert.equal(work.reportedMinutes, null); assert.equal(work.reportedLaborMinutes, null);
  for (const other of [{ jobId: '456' }, { date: '2026-02-17' }, { customer: 'Other Person' }]) assert.equal(cleanupWorkEvidence(fields, { ...input, customer: fields['Customer Name'], ...other }).reportedMinutes, null);
  assert.equal(cleanupWorkEvidence({ ...fields, 'Est. Minutes': 0, 'Actual Minutes': 0 }).legacyMinutes, null);
  assert.equal(durationEvidence('99:99'), null); assert.equal(durationEvidence(-1), null);
  assert.equal(cleanupWorkEvidence({ ...fields, 'Source Work': { startedAt: '2026-02-17 12:00:00', endedAt: '2026-02-16 12:00:00' } }).elapsedMinutes, null);
});

test('only original job identity can receive timer evidence', () => {
  const source = { job_id: '123', customer: fields['Customer Name'], date: fields.Date, started_at: '2026-02-16 12:00:00', ended_at: '2026-02-16 13:00:00' };
  const original = { ...fields }; delete original['Source Work'];
  assert.equal(cleanupWorkEvidence(applyRouteSourceEvidence({ jobs: [{ fields: original }] }, [source]).jobs[0].fields).elapsedMinutes, 60);
  assert.equal(applyRouteSourceEvidence({ jobs: [{ fields: original }] }, [{ ...source, customer: 'Other' }]).jobs[0].fields['Source Work'], undefined);
});

test('work input bounds reject forged identity, duplicate crew, invalid duration, and missing provenance', () => {
  assert.equal(validateCleanupWorkInput({ ...input, reportedMinutes: 1.1 }).reportedMinutes, 1.1);
  for (const bad of [{ jobId: '../../other' }, { date: '2026-02-30' }, { revision: -1 }, { reportedMinutes: 1441 }, { reportedMinutes: '60' }, { note: '' }, { crew: [] }, { crew: [input.crew[0], input.crew[0]] }, { crewConfirmed: 'true' }]) assert.throws(() => validateCleanupWorkInput({ ...input, ...bad }));
});

const invoice = { id: '456', clientId: '789', customer: fields['Customer Name'], date: '2026-02-15', status: 'Paid', type: 'one_time',
  lines: [{ description: 'Initial Cleanup - 2/16', amount: 109 }, { description: 'Sanitization - 2/16', amount: 30 }, { description: 'Regular Weekly Cleanup - 2/23', amount: 26.56 }] };
const value = { category: 'initial', revenue: 109, missing: false };
test('QBO matching uses exact provider reference, all service lines, dated cleanup allocation, and excludes tips', async () => {
  const rows = await normalizeCleanupBillingInvoices([{ referenceNumber: 'S&G-456', id: 'qbo1', date: invoice.date, balance: 0, lines: [...invoice.lines, { description: 'Tip: $20.00', amount: 20 }] }]);
  const snapshot = { from: '2026-02-01', through: '2026-03-31', checkedAt: '2026-10-13T00:00:00Z', invoices: rows };
  const record = { ...fields, 'Source Client ID': '789' };
  assert.equal((await cleanupBillingEvidence(record, value, null, [invoice], snapshot)).status, 'matched');
  assert.equal((await cleanupBillingEvidence(record, { ...value, revenue: 165.56 }, null, [invoice], snapshot)).status, 'service_difference');
  assert.equal((await cleanupBillingEvidence(record, value, null, [{ ...invoice, clientId: 'other' }], snapshot)).status, 'unlinked');
  assert.equal((await cleanupBillingEvidence(record, value, null, [{ ...invoice, status: 'Voided' }], snapshot)).status, 'unlinked');
  assert.equal((await cleanupBillingEvidence(record, value, null, [invoice, { ...invoice, id: 'another' }], snapshot)).status, 'ambiguous');
  assert.equal((await cleanupBillingEvidence(record, value, null, [invoice], { ...snapshot, invoices: [...rows, ...rows] })).status, 'ambiguous');
  assert.equal((await cleanupBillingEvidence(record, value, null, [invoice], { ...snapshot, invoices: [{ ...rows[0], signature: 'different' }] })).status, 'invoice_difference');
  const differentDate = await cleanupBillingEvidence(record, value, null, [invoice], { ...snapshot, invoices: [{ ...rows[0], date: '2026-02-16' }] });
  assert.equal(differentDate.status, 'invoice_date_difference'); assert.equal(differentDate.sngInvoiceDate, '2026-02-15'); assert.equal(differentDate.qboInvoiceDate, '2026-02-16');
  assert.equal((await cleanupBillingEvidence(record, value, null, [invoice], null)).status, 'not_checked');
  assert.equal(await invoiceServiceSignature([{ description: 'Cleanup', amount: null }]), null);
  assert.equal(await invoiceServiceSignature([{ description: 'Tips collected from clients to be paid out to employees.', amount: 10 }]), null);
});

test('crew edits use source identity, compare-and-swap, and retain prior reported times', async () => {
  const source = fs.readFileSync(new URL('../lib/cleanup-work.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function saveCleanupWork')).replace('export ', '');
  const save = runPrivateInNewContext(`${body}\nsaveCleanupWork`, { validateCleanupWorkInput, cleanupWorkKey, TextEncoder });
  let payload = null;
  const db = { prepare: sql => ({ bind: (...args) => ({ first: async () => payload ? { payload } : null, run: async () => {
    if (sql.startsWith('INSERT') && payload || sql.startsWith('UPDATE') && args[3] !== payload) return { meta: { changes: 0 } };
    payload = sql.startsWith('INSERT') ? args[1] : args[0]; return { meta: { changes: 1 } };
  } }) }) };
  const record = { id: '123', date: fields.Date, customer: fields['Customer Name'], category: 'initial' };
  assert.equal((await save(db, input, { ...record, id: '999' }, 'admin')).status, 404);
  assert.equal(payload, null);
  assert.equal((await save(db, input, record, 'admin')).ok, true);
  assert.equal((await save(db, input, record, 'admin')).status, 409);
  assert.equal((await save(db, { ...input, revision: 1, reportedMinutes: 70 }, record, 'admin2')).ok, true);
  const saved = JSON.parse(payload); assert.equal(saved.history[0].reportedMinutes, 50); assert.equal(saved.reportedMinutes, 70); assert.equal(saved.updatedBy, 'admin2');
});

test('job-work endpoint rejects unauthorized, cross-site, unbounded, and unrelated-record writes', async () => {
  const source = fs.readFileSync(new URL('../app/api/admin/route-profitability/job-work/route.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  for (const settings of [{ authorized: false, status: 401 }, { origin: 'https://evil.test', status: 403 }, { blocked: true, status: 429 }, { input: { ...input, jobId: '../../other' }, status: 400 }, { source: null, status: 404 }]) {
    let writes = 0;
    const handler = runPrivateInNewContext(`${source}\nPOST`, { Response, URL, validateCleanupWorkInput,
      verifyAdminRequest: async () => ({ authorized: settings.authorized !== false, email: 'admin' }),
      protectJsonRequest: async () => settings.blocked ? { response: Response.json({}, { status: 429 }) } : { body: settings.input || input },
      getDb: () => ({}), getRouteRevenueDetail: async () => [], saveCleanupWork: async (db, data, record) => { if (record) writes++; return { ok: false, status: 404 }; },
    });
    const result = await handler(new Request('https://example.test/api/admin/route-profitability/job-work/', { method: 'POST', headers: { origin: settings.origin || 'https://example.test' } }));
    assert.equal(result.status, settings.status); assert.equal(writes, 0); assert.match(result.headers.get('Cache-Control'), /private/);
  }
});
