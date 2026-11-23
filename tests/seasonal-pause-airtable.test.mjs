import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SEASONAL_FIELDS as F, lookupSeasonalPauseCustomer, syncSeasonalPauseAirtable } from '../lib/seasonal-pause-airtable.mjs';

const ID = 'rec12345678901234';
const M = { name: 'fldHkCp7DG7Ic5j8f', id: 'fldi918YuxMiQMHWn', phone: 'fld6ZCwqkM4KOK1oA', email: 'fldvPD16o3KFGl9gS' };
const event = (changes = {}) => ({ id: 'pause-1', event_type: 'paused', event_at: '2026-11-24T02:00:00Z', pause_start_date: '2026-11-23', pause_end_date: '2027-02-21', planned_restart_date: '2027-03-15', pause_reason: 'Seasonal - winter', source: 'webhook', period_key: 'subscription-1:2026-11-23', ...changes });
function fixture(extra = {}, options = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT)');
  const db = { prepare(query) { let values = []; return { bind(...next) { values = next; return this; }, async run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } }; } }; } };
  const record = { id: ID, fields: { [M.name]: 'Casey Example', [M.id]: '123', [M.email]: 'casey@example.test', [M.phone]: '(419) 555-0100', ...extra } };
  const records = options.records || [record], calls = [], patches = [];
  const state = { sng_client_id: '123', client_name: 'Casey Example', email: 'casey@example.test', phone: '4195550100', seasonal_pattern: 'winter', pause_start_date: '2026-11-23', planned_restart_date: '2027-03-15', pause_count: 1, next_action_date: '2027-02-21', is_paused: 1 };
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'api.airtable.com');
    assert.equal(init.cache, 'no-store');
    calls.push({ url, init });
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      assert.equal(body.typecast, false);
      assert.equal(body.records.length, 1);
      assert.equal(body.records[0].id, ID);
      assert.ok(Object.keys(body.records[0].fields).every(key => Object.values(F).includes(key)));
      patches.push(body.records[0].fields);
      Object.assign(record.fields, body.records[0].fields);
      if (options.afterPatch) options.afterPatch(record);
      if (options.loseResponse && patches.length === 1) throw new Error('Response lost after provider applied PATCH');
      return Response.json({ records: [record] });
    }
    if (url.pathname.endsWith('/' + ID)) {
      if (options.beforeFresh && !patches.length) options.beforeFresh(record);
      return Response.json(record);
    }
    const formula = url.searchParams.get('filterByFormula') || '';
    let found;
    if (formula.includes('{SNG Client ID}')) found = records.filter(row => String(row.fields[M.id] || '') === state.sng_client_id);
    else if (formula.includes('{Email}')) found = records.filter(row => String(row.fields[M.email] || '').toLowerCase() === state.email.toLowerCase());
    else found = records.filter(row => row.fields[M.name]?.toLowerCase() === state.client_name.toLowerCase());
    return Response.json({ records: found });
  };
  const env = { DB: db, AIRTABLE_API_KEY: 'test-only' };
  return { env, state, record, calls, patches, async sync(events = [event()]) { return syncSeasonalPauseAirtable(env, { client: {}, events, state }); }, async baseline(events = [event()]) { const result = await this.sync(events); assert.equal(result.status, 'baseline_required'); state.baseline_pause_count = result.baseline.pause_count; state.baseline_period_keys = result.baseline.period_keys; state.baseline_review_period_keys = result.baseline.review_period_keys; return result; }, close() { globalThis.fetch = previous; sql.close(); } };
}

test('first sync requests a persisted baseline before any Airtable mutation', async t => {
  const f = fixture({ [F.pause_count]: 3, [F.pause_start_date]: '2026-11-23' }); t.after(() => f.close());
  const result = await f.baseline();
  assert.equal(f.patches.length, 0);
  assert.deepEqual(result.baseline, { pause_count: 3, period_keys: ['date:2026-11-23'], review_period_keys: [] });
  await f.sync();
  assert.equal(f.record.fields[F.pause_count], 3);
});

test('pause sync writes only the six IDs, appends history and deduplicates retries and same-day subscriptions', async t => {
  const f = fixture(); t.after(() => f.close());
  const events = [event(), event({ id: 'pause-2', period_key: 'subscription-2:2026-11-23', source: 'subscription_sync' })];
  await f.baseline(events);
  const saved = await f.sync(events);
  assert.equal(saved.status, 'synced');
  assert.equal(f.record.fields[F.pause_count], 1);
  assert.equal(f.record.fields[F.seasonal_pattern], 'Winter pauser');
  assert.equal(f.record.fields[F.next_action_date], '2027-02-21');
  assert.match(f.record.fields[F.pause_history], /^2026-11-23 paused Seasonal - winter webhook \[seasonal:pause-1\]/);
  const history = f.record.fields[F.pause_history], writes = f.patches.length;
  assert.equal((await f.sync(events)).unchanged, true);
  assert.equal(f.patches.length, writes);
  assert.equal(f.record.fields[F.pause_history], history);
});

test('existing backfill is an exact prefix and resumed lines do not count as pauses', async t => {
  const history = '2025-10-15 paused Seasonal - winter Airtable backfill\n2026-03-01 resumed Spring return manual';
  const f = fixture({ [F.pause_count]: 1, [F.pause_history]: history, [F.pause_start_date]: '2025-10-15' }); t.after(() => f.close());
  const events = [event({ id: 'older', pause_start_date: '2025-10-15', event_at: '2025-10-15T15:00:00Z' }), event({ id: 'resumed', event_type: 'unpaused', pause_start_date: '2026-03-01', event_at: '2026-03-01T15:00:00Z' }), event()];
  const baseline = await f.baseline(events);
  assert.deepEqual(baseline.baseline.period_keys, ['date:2025-10-15']);
  await f.sync(events);
  assert.equal(f.record.fields[F.pause_count], 2);
  assert.ok(f.record.fields[F.pause_history].startsWith(history + '\n'));
  assert.match(f.record.fields[F.pause_history], /2026-03-01 resumed/);
});

test('unpause appends resumed history and preserves human pattern and planned restart', async t => {
  const f = fixture({ [F.pause_count]: 1, [F.pause_start_date]: '2026-11-23', [F.pause_history]: 'Original backfill\n', [F.seasonal_pattern]: 'Spring/Fall pauser', [F.planned_restart_date]: '2027-03-01' }); t.after(() => f.close());
  const events = [event(), event({ id: 'resume-1', event_type: 'unpaused', event_at: '2027-02-22T01:00:00Z', pause_reason: 'Pause lapsed' })];
  await f.baseline(events);
  f.state.planned_restart_date = null;
  const result = await f.sync(events);
  assert.equal(f.record.fields[F.seasonal_pattern], 'Spring/Fall pauser');
  assert.equal(f.record.fields[F.planned_restart_date], '2027-03-01');
  assert.equal(f.record.fields[F.next_action_date], '2027-02-21');
  assert.deepEqual(result.preserved, { seasonal_pattern: 'spring_fall', seasonal_pattern_label: 'Spring/Fall pauser', planned_restart_date: '2027-03-01' });
  assert.match(f.record.fields[F.pause_history], /^Original backfill\n2026/);
  assert.match(f.record.fields[F.pause_history], /2027-02-21 resumed Pause lapsed/);
  assert.match(f.record.fields[F.pause_history], /kept existing Seasonal Pattern/);
});

test('fresh record read preserves a human edit made after lookup', async t => {
  const f = fixture({}, { beforeFresh(record) { record.fields[F.pause_history] = 'Latest human note'; record.fields[F.planned_restart_date] = '2027-03-07'; } }); t.after(() => f.close());
  await f.baseline();
  await f.sync();
  assert.ok(f.record.fields[F.pause_history].startsWith('Latest human note\n'));
  assert.equal(f.record.fields[F.planned_restart_date], '2027-03-07');
});

test('lost PATCH response is safe to retry after the baseline was persisted', async t => {
  const f = fixture({ [F.pause_count]: 2 }, { loseResponse: true }); t.after(() => f.close());
  await f.baseline();
  await assert.rejects(f.sync(), /failed/);
  const history = f.record.fields[F.pause_history];
  assert.equal(f.record.fields[F.pause_count], 3);
  const replay = await f.sync();
  assert.equal(replay.status, 'synced');
  assert.equal(replay.unchanged, true);
  assert.equal(f.patches.length, 1);
  assert.equal(f.record.fields[F.pause_history], history);
});

test('seasonal cancellation increments one new period and uncertain historical counts request review', async t => {
  const f = fixture({ [F.pause_count]: 4, [F.pause_start_date]: '2026-10-01' }); t.after(() => f.close());
  const events = [event({ id: 'old-unknown', pause_start_date: '2025-10-01' }), event({ id: 'cancel', event_type: 'canceled_seasonal', pause_reason: 'Seasonal' })];
  const result = await f.baseline(events);
  assert.deepEqual(result.baseline.review_period_keys, ['date:2025-10-01']);
  await f.sync(events);
  assert.equal(f.record.fields[F.pause_count], 5);
  assert.match(f.record.fields[F.pause_history], /historical pause count needs review/);
  assert.match(f.record.fields[F.pause_history], /paused \(seasonal cancellation\) Seasonal/);
});

test('email fallback never writes a record with a conflicting populated SNG ID', async t => {
  const f = fixture({ [M.id]: 'different' }); t.after(() => f.close());
  const result = await f.sync();
  assert.equal(result.status, 'unmatched');
  assert.equal(result.reason, 'conflicting_client_id');
  assert.equal(f.patches.length, 0);
});

test('name plus normalized phone fallback matches only one customer and never creates', async t => {
  const f = fixture({ [M.id]: '', [M.email]: '' }); t.after(() => f.close());
  await f.baseline(); await f.sync();
  assert.equal(f.patches.length, 1);
  assert.ok(f.calls.some(call => call.url.searchParams.get('filterByFormula')?.includes('{Client Name}')));
  assert.ok(f.calls.every(call => !call.init.method || call.init.method === 'PATCH'));
});

test('duplicate matching customers and missing matches fail closed', async t => {
  const duplicate = { id: 'rec23456789012345', fields: { [M.id]: '123' } };
  const f = fixture({}, { records: [duplicate, duplicate] }); t.after(() => f.close());
  assert.equal((await f.sync()).reason, 'ambiguous_match');
  assert.equal(f.patches.length, 0);
});

test('failed provider readback remains retryable and never reports success', async t => {
  const f = fixture({}, { afterPatch(record) { record.fields[F.pause_count] = 99; } }); t.after(() => f.close());
  await f.baseline();
  await assert.rejects(f.sync(), /not verified/);
});

test('subscription rows without an ID bind to one existing nonempty customer ID by email', async t => {
  const f = fixture(); t.after(() => f.close());
  const result = await lookupSeasonalPauseCustomer(f.env, { client_name: 'Casey Example', email: 'casey@example.test' });
  assert.equal(result.status, 'matched');
  assert.equal(result.recordId, ID);
  assert.equal(result.clientId, '123');
  assert.equal(result.fields[M.email], 'casey@example.test');
  assert.equal(f.patches.length, 0);
});

test('subscription lookup falls back to name plus phone and refuses to invent a missing ID', async t => {
  const f = fixture({ [M.email]: '', [M.id]: '' }); t.after(() => f.close());
  const result = await lookupSeasonalPauseCustomer(f.env, { client_name: 'Casey Example', phone: '+1 419-555-0100' });
  assert.equal(result.status, 'unmatched');
  assert.equal(result.reason, 'missing_client_id');
  assert.equal(f.patches.length, 0);
});

test('subscription lookup never binds by name alone', async t => {
  const f = fixture(); t.after(() => f.close());
  const result = await lookupSeasonalPauseCustomer(f.env, { client_name: 'Casey Example' });
  assert.equal(result.status, 'unmatched');
  assert.equal(result.reason, 'no_match');
  assert.equal(f.calls.length, 0);
});

test('human Year-round classification remains Year-round in the D1 mirror', async t => {
  const f = fixture({ [F.seasonal_pattern]: 'Year-round' }); t.after(() => f.close());
  await f.baseline();
  const result = await f.sync();
  assert.equal(f.record.fields[F.seasonal_pattern], 'Year-round');
  assert.equal(result.preserved.seasonal_pattern, 'year_round');
  assert.equal(result.mirror.seasonal_pattern, 'year_round');
});

test('completed restart retains the human date and clears its past next action after unpause', async t => {
  const f = fixture({ [F.planned_restart_date]: '2027-03-01', [F.next_action_date]: '2027-02-21' }); t.after(() => f.close());
  const events = [event(), event({ id: 'returned', event_type: 'unpaused', event_at: '2027-03-01T15:00:00Z' })];
  await f.baseline(events);
  f.state.is_paused = 0;
  f.state.last_event_at = '2027-03-01T15:00:00Z';
  f.state.next_action_date = null;
  f.state.planned_restart_date = null;
  const result = await f.sync(events);
  assert.equal(f.record.fields[F.planned_restart_date], '2027-03-01');
  assert.equal(f.record.fields[F.next_action_date], null);
  assert.equal(result.mirror.next_action_date, null);
});

test('early unpause keeps the re-pause action when the human restart is still later', async t => {
  const f = fixture({ [F.planned_restart_date]: '2027-03-01' }); t.after(() => f.close());
  const events = [event(), event({ id: 'lapsed', event_type: 'unpaused', event_at: '2027-02-21T15:00:00Z' })];
  await f.baseline(events);
  f.state.is_paused = 0;
  f.state.last_event_at = '2027-02-21T15:00:00Z';
  f.state.planned_restart_date = null;
  const result = await f.sync(events);
  assert.equal(result.mirror.next_action_date, '2027-02-21');
});
