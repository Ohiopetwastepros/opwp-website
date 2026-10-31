import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRouteAssignments, collectRouteAssignmentAudit, readRouteAssignmentAudit, runScheduledRouteAssignmentAudit } from '../lib/route-assignment-audit.mjs';

const now = '2026-09-30T00:00:00Z';
const client = { client_id: '1', client_name: 'Example', cleanup_frequency: 'weekly', service_days: 'Monday', assigned_to: staffPrivate.primaryShort, address: '1 Main St', city: 'Toledo', zip: '43601' };
const record = { id: 'rec1', fields: { 'SNG Client ID': '1', Status: 'Active', Frequency: 'Weekly', 'Service Day': 'Monday', 'Assigned Tech': staffPrivate.primaryShort, Address: '1 Main St', City: 'Toledo', ZIP: '43601' } };
const input = () => ({ clients: [structuredClone(client)], airtable: [structuredClone(record)], snapshot: [structuredClone(record)], capturedAt: now, snapshotAt: now, sourceComplete: true });

test('verification requires independent source agreement, complete coverage and freshness', () => {
  assert.equal(auditRouteAssignments(input()).status, 'verified');
  for (const change of [data => { data.sourceComplete = false; }, data => { data.snapshotAt = '2026-09-28'; }, data => { data.clients = []; }, data => { data.clients[0].service_days = ''; }, data => { delete data.clients[0].address; }]) {
    const data = input(); change(data); assert.notEqual(auditRouteAssignments(data).status, 'verified');
  }
});
test('matching D1 and Airtable cannot validate a wrong day or technician', () => {
  const data = input();
  for (const rows of [data.airtable, data.snapshot]) rows[0].fields['Service Day'] = 'Tuesday';
  const audit = auditRouteAssignments(data);
  assert.equal(audit.issueCounts.airtable_source_mismatch, 1);
  assert.equal(audit.issueCounts.d1_source_mismatch, 1);
  assert.equal(audit.counts.matched, 0);
});
test('duplicates, unmatched identities and removed customers are findings', () => {
  const data = input();
  data.airtable.push(structuredClone(record));
  data.snapshot.push({ fields: { 'SNG Client ID': 'extra', Status: 'Active' } });
  const audit = auditRouteAssignments(data);
  assert.equal(audit.issueCounts.duplicate_identity, 1);
  assert.equal(audit.issueCounts.d1_active_not_in_source, 1);
});
test('two technicians listed independently of two days cannot be certified per-day', () => {
  const data = input();
  Object.assign(data.clients[0], { cleanup_frequency: 'two_times_a_week', service_days: 'Monday, Friday', assigned_to: `${staffPrivate.reliefShort}, ${staffPrivate.primaryShort}` });
  const audit = auditRouteAssignments(data);
  assert.equal(audit.issueCounts.day_technician_mapping_unverified, 1);
});
test('fresh audit invalidates when the planning snapshot changes', async () => {
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ payload: JSON.stringify(auditRouteAssignments(input())) }) }) }) };
  assert.equal((await readRouteAssignmentAudit(db, now, new Date(now))).status, 'verified');
  assert.equal((await readRouteAssignmentAudit(db, now, new Date(now), 'failed')).status, 'unverified');
  assert.equal((await readRouteAssignmentAudit(db, 'new-snapshot', new Date(now))).status, 'stale');
  assert.equal((await readRouteAssignmentAudit(db, now, new Date('2026-09-30T02:00:00Z'))).status, 'stale');
});
test('provider errors and malformed/pagination-limited sources never pass', async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [() => new Response('', { status: 429 }), () => Response.json({ error: 'bad' }), () => Response.json({ data: [client], last_page: 51 })]) {
      globalThis.fetch = async () => response();
      await assert.rejects(collectRouteAssignmentAudit({ SNG_API_KEY: 'test', AIRTABLE_API_KEY: 'test' }, {}, new Date(now)));
    }
  } finally { globalThis.fetch = original; }
});
test('failed provider checks are persisted and throttled without changing business records', async () => {
  let saved, calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
  const db = { prepare: sql => ({ first: async () => ({ payload: '{}', captured_at: now, status: 'success' }), bind: (...args) => ({ first: async () => saved ? { payload: saved } : null, run: async () => { assert.match(sql, /airtable_cockpit_snapshots/); saved = args[1]; } }) }) };
  try {
    const env = { DB: db, SNG_API_KEY: 'test', AIRTABLE_API_KEY: 'test' };
    assert.equal((await runScheduledRouteAssignmentAudit(env, new Date(now))).status, 'unavailable');
    assert.equal((await runScheduledRouteAssignmentAudit(env, new Date(now))).status, 'unavailable');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
