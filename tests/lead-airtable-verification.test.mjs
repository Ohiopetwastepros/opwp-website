import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {compareLeadAirtableFields, verifyLeadAirtableReadback} from '../lib/lead-airtable-verification.mjs';

test('lead read-back comparison handles cleared Airtable fields and equivalent dates without hiding actual changes', () => {
  const expected = {Name: 'Example', Email: '', Deleted: false, 'Monthly Quote': null, Dogs: 2, 'Last Synced': '2026-11-19T17:00:00.000Z'};
  assert.deepEqual(compareLeadAirtableFields(expected, {Name: 'Example', Dogs: 2, 'Last Synced': '2026-11-19T17:00:00Z'}), []);
  assert.deepEqual(compareLeadAirtableFields(expected, {Name: 'Changed', Email: 'old@example.test', Dogs: 3, Deleted: true, 'Monthly Quote': 90, 'Last Synced': '2026-11-19T17:01:00Z'}), Object.keys(expected));
});

const source = readFileSync(new URL('../lib/lead-assistant.js', import.meta.url), 'utf8');
function queueApi(fetcher) {
  const actual = source.slice(source.indexOf('async function syncAirtableLead('), source.indexOf('async function processFollowUps('))
    .replace('const { verifyLeadAirtableReadback } = await import("./lead-airtable-verification.mjs");', '')
    .replace('export async function processAirtableQueue', 'async function processAirtableQueue');
  return vm.runInNewContext(actual + '\n({processAirtableQueue});', {
    outboundFetch: fetcher, verifyLeadAirtableReadback, playbookEnabled: env => env.LEAD_PLAYBOOK_ENABLED === 'true',
    AIRTABLE_BASE_ID: 'appFake', AIRTABLE_LEADS_TABLE_ID: 'tblLeads', OPWP_ORGANIZATION_ID: 'org-opwp',
    airtableFields: row => ({'YardOps Lead ID': row.submission_id, Name: row.name, Email: row.email || '', Deleted: false}),
    console: {error() {}}, Date,
  });
}
function fixture() {
  const db = leadTestDatabase(), id = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,name,email,payload) VALUES (?,'question','website','Example Lead','example@example.test','{}')").run(id);
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,owner) VALUES (?,?,'org-opwp','backend')").run(crypto.randomUUID(), id);
  db.sqlite.prepare("INSERT INTO lead_airtable_sync(submission_id,organization_id) VALUES (?,'org-opwp')").run(id);
  return {db, id, env: {DB: db, LEAD_PLAYBOOK_ENABLED: 'true', AIRTABLE_API_KEY: 'fake-test-key'}};
}
test('actual existing lead queue persists D1 claim before PATCH, GETs the same record, and flags mismatch', async () => {
  for (const mismatch of [false, true]) {
    const {db, id, env} = fixture(), calls = []; let fields;
    const api = queueApi(async (url, options) => {
      calls.push(options.method);
      assert.equal(db.sqlite.prepare('SELECT status FROM lead_airtable_sync WHERE submission_id=?').get(id).status, 'syncing');
      if (options.method === 'PATCH') { fields = JSON.parse(options.body).records[0].fields; return Response.json({records: [{id: 'recFake'}]}); }
      assert.equal(url, 'https://api.airtable.com/v0/appFake/tblLeads/recFake');
      return Response.json({id: 'recFake', fields: {...fields, ...(mismatch ? {Name: 'Changed in provider'} : {})}});
    });
    const result = await api.processAirtableQueue(env, 10);
    assert.deepEqual(calls, ['PATCH', 'GET']);
    const record = db.sqlite.prepare('SELECT * FROM lead_airtable_sync WHERE submission_id=?').get(id);
    assert.equal(record.verification_status, mismatch ? 'mismatch' : 'matched');
    assert.equal(record.status, mismatch ? 'failed' : 'synced');
    assert.ok(record.verified_at); assert.equal(result.mismatches, mismatch ? 1 : 0);
    if (mismatch) { assert.deepEqual(JSON.parse(record.mismatch_json), {fields: ['Name']}); assert.doesNotMatch(record.mismatch_json, /Changed in provider|Example Lead/); }
  }
});
test('disabled playbook preserves legacy PATCH-only sync and does not depend on verification columns', async () => {
  const {db, env} = fixture(), calls = [];
  const api = queueApi(async (_url, options) => { calls.push(options.method); return Response.json({records: [{id: 'legacy-record-id'}]}); });
  const result = await api.processAirtableQueue({...env, LEAD_PLAYBOOK_ENABLED: undefined}, 10);
  assert.deepEqual(calls, ['PATCH']); assert.equal(result.synced, 1);
  assert.equal(db.sqlite.prepare('SELECT verification_status FROM lead_airtable_sync').get().verification_status, 'pending');
});
test('a newer D1 queue revision cannot be marked verified by a stale read-back', async () => {
  const {db, id, env} = fixture(); let fields;
  const api = queueApi(async (_url, options) => {
    if (options.method === 'PATCH') { fields = JSON.parse(options.body).records[0].fields; return Response.json({records: [{id: 'recFake'}]}); }
    db.sqlite.prepare("UPDATE lead_airtable_sync SET revision=revision+1,status='queued' WHERE submission_id=?").run(id);
    return Response.json({id: 'recFake', fields});
  });
  await api.processAirtableQueue(env, 10);
  const record = db.sqlite.prepare('SELECT * FROM lead_airtable_sync').get();
  assert.equal(record.status, 'queued'); assert.equal(record.verification_status, 'pending'); assert.equal(record.verified_at, null);
});
