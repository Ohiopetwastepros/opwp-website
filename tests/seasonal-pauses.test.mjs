import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { captureSeasonalPauseWebhook as capture, reconcileSeasonalPauses as reconcile, seasonalPattern, nextPauseAction, seasonalBusinessDate, seasonalSchemaReady } from '../lib/seasonal-pauses.mjs';
import { SEASONAL_FIELDS as F } from '../lib/seasonal-pause-airtable.mjs';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['../schema-proposals/0070_seasonal_pauses.sql', '../tmp/test-migrations/0002_sng_events.sql', '../tmp/test-migrations/0018_airtable_cockpit_snapshot.sql']) sqlite.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const statement = sqlite.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, async all() { return { results: statement.all(...args) }; },
    async first() { return statement.get(...args) || null; }, async run() { return { meta: statement.run(...args) }; },
  }; } };
  return { DB, sqlite, state: () => sqlite.prepare('SELECT * FROM seasonal_pause_clients').get(), events: () => sqlite.prepare('SELECT * FROM seasonal_pause_events ORDER BY event_at').all() };
}
const now = new Date('2026-11-23T18:00:00Z');
const body = { object: 'event', type: 'client:subscription_paused', created: 1795453200, data: {
  client: 'rcl_example', subscription_id: 234, subscription_name: 'Regular Plan - 2d-1xW', client_name: 'Example Customer',
  client_email: 'customer@example.test', client_address: '100 Example Street', cell_phone: '4195550100',
} };
const subscription = { status: 'paused', client_name: 'Example Customer', client_email: 'customer@example.test', client_address: '100 Example Street',
  service_plan: '2d-1xW', pricing_plan: 'Regular Plan', billing_interval: 'monthly', pause_start_date: '2026-11-22', pause_end_date: '2027-02-20', pause_reason: 'Seasonal - winter' };
const syncAirtable = async () => ({ status: 'unmatched' });
const options = (row = subscription) => ({ now, fetchSubscriptions: async (_env, { commercial } = {}) => commercial ? [] : [row], syncAirtable });
const paused = (env, opts = options()) => capture(env, { eventType: 'client:subscription_paused', body }, opts);

test('seasonal reasons classify explicit seasons but never infer them from dates or financial language', () => {
  for (const [reason, expected] of [['Seasonal - winter', 'winter'], ['Seasonal - spring/fall', 'spring_fall'], ['Seasonal - summer', 'summer'], ['Seasonal', 'unknown'], ['Financial', 'unknown']]) assert.equal(seasonalPattern(reason), expected);
  assert.equal(seasonalPattern('Seasonal', 'Seasonal winter restart requested'), 'winter');
  assert.equal(seasonalPattern('Financial', 'winter'), 'unknown');
  assert.equal(seasonalBusinessDate('2026-03-01T02:00:00Z'), '2026-02-28');
});

test('pause cap before requested March restart is the next action', () => {
  assert.equal(nextPauseAction({ pause_end_date: '2027-02-20', planned_restart_date: '2027-03-15' }), '2027-02-20');
  assert.equal(nextPauseAction({ pause_end_date: '2027-04-01', planned_restart_date: '2027-03-15' }), '2027-03-15');
  assert.equal(nextPauseAction({ planned_restart_date: '2027-03-15' }), '2027-03-15');
});

test('real thin webhook enriches a no-ID subscription and keeps provider timestamp and raw facts', async () => {
  const db = database(); let enriched = 0;
  await paused({ DB: db.DB }, { ...options(), fetchSubscriptions: async () => { enriched++; return [subscription]; } });
  assert.equal(enriched, 1); assert.equal(db.events().length, 1);
  const event = db.events()[0];
  assert.equal(event.sng_client_id, 'rcl_example'); assert.equal(event.sng_subscription_id, '234');
  assert.equal(event.pause_start_date, subscription.pause_start_date); assert.equal(event.pause_reason, 'Seasonal - winter');
  assert.equal(event.event_at, new Date(body.created * 1000).toISOString());
  assert.equal(JSON.parse(event.raw_payload).subscription.pause_end_date, '2027-02-20');
  assert.equal(db.state().pause_count, 1); assert.equal(db.state().seasonal_pattern, 'winter');
});

test('duplicate delivery and existing sync fallback share a period without recounting it', async () => {
  const db = database(), env = { DB: db.DB };
  await paused(env); await paused(env);
  const result = await reconcile(env, [{ ...subscription, client_id: 'rcl_example' }], options());
  assert.equal(result.inserted, 0); assert.equal(db.events().length, 1); assert.equal(db.state().pause_count, 1);
});

test('unpause with cleared live dates appends resumed evidence without deleting prior period', async () => {
  const db = database(), env = { DB: db.DB };
  await paused(env);
  const resumed = { ...body, created: body.created + 86400, data: { ...body.data } };
  await capture(env, { eventType: 'client:subscription_unpaused', body: resumed }, options({ ...subscription, status: 'active', pause_start_date: null, pause_end_date: null, pause_reason: null }));
  assert.equal(db.events().length, 2); assert.equal(db.events()[1].event_type, 'unpaused');
  assert.equal(db.events()[1].pause_start_date, subscription.pause_start_date);
  assert.equal(db.state().pause_count, 1); assert.equal(db.state().is_paused, 0);
});

test('first observed unpause remains durable even when no earlier pause dates survive', async () => {
  const db = database();
  await capture({ DB: db.DB }, { eventType: 'client:subscription_unpaused', body }, options({ ...subscription, status: 'active', pause_start_date: null, pause_end_date: null, pause_reason: null }));
  assert.equal(db.events()[0].event_type, 'unpaused'); assert.equal(db.events()[0].pause_start_date, null);
  assert.equal(db.state().pause_count, 0); assert.equal(db.state().is_paused, 0);
});

test('seasonal canceled_at-only subscription is recorded; Financial cancellation is excluded', async () => {
  const db = database(), env = { DB: db.DB };
  const canceled = { ...subscription, status: 'canceled', pause_start_date: null, pause_end_date: null, pause_reason: null, canceled_at: '2026-11-20T15:00:00Z', termination_reason: 'Seasonal' };
  await capture(env, { eventType: 'client:subscription_canceled', body }, options(canceled));
  assert.equal(db.events()[0].event_type, 'canceled_seasonal'); assert.equal(db.events()[0].pause_start_date, '2026-11-20');
  assert.equal(db.events()[0].seasonal_pattern, 'unknown');
  await capture(env, { eventType: 'client:subscription_canceled', body }, options({ ...canceled, termination_reason: 'Financial' }));
  assert.equal(db.events().length, 1);
});

test('fallback binds no-ID rows from authenticated archive without requiring Airtable', async () => {
  const db = database();
  db.sqlite.prepare('INSERT INTO sng_events(id,event_type,payload) VALUES (?,?,?)').run('event-1', 'client:subscription_paused', JSON.stringify(body));
  await reconcile({ DB: db.DB }, [subscription], { ...options(), lookupCustomer: async () => { throw Error('must not call Airtable'); } });
  assert.equal(db.state().sng_client_id, 'rcl_example'); assert.equal(db.state().pause_count, 1);
});

test('fallback binds a missed webhook by unique saved contact ID, never from a name alone', async () => {
  const db = database();
  await reconcile({ DB: db.DB }, [subscription], { ...options(), lookupCustomer: async () => ({ status: 'matched', clientId: 'rcl_saved' }) });
  assert.equal(db.state().sng_client_id, 'rcl_saved');
  const other = database();
  const result = await reconcile({ DB: other.DB }, [subscription], { ...options(), lookupCustomer: async () => ({ status: 'unmatched' }) });
  assert.equal(result.failed, 1); assert.equal(other.events().length, 0);
});

test('ambiguous enrichment fails without storing guessed client or subscription facts', async () => {
  const db = database();
  await assert.rejects(paused({ DB: db.DB }, { ...options(), fetchSubscriptions: async () => [subscription, subscription] }), /ambiguous/);
  assert.equal(db.events().length, 0);
});

test('no-ID enrichment distinguishes the current pause from an old canceled same-plan row', async () => {
  const db = database();
  await paused({ DB: db.DB }, { ...options(), fetchSubscriptions: async () => [
    { ...subscription, status: 'canceled', pause_start_date: null, canceled_at: '2025-02-01', termination_reason: 'Other' }, subscription,
  ] });
  assert.equal(db.events().length, 1); assert.equal(db.events()[0].pause_start_date, '2026-11-22');
});

test('real subscription IDs distinguish identical plans and unpausing one leaves the other paused', async () => {
  const db = database(), env = { DB: db.DB };
  const rows = [234, 235].map(subscription_id => ({ ...subscription, client_id: 'rcl_example', subscription_id }));
  for (const id of [234, 235]) await capture(env, { eventType: 'client:subscription_paused', body: { ...body, data: { ...body.data, subscription_id: id } } }, { ...options(), fetchSubscriptions: async () => rows });
  assert.equal(db.events().length, 2); assert.equal(db.state().pause_count, 1);
  await capture(env, { eventType: 'client:subscription_unpaused', body: { ...body, created: body.created + 86400 } }, { ...options(), fetchSubscriptions: async () => rows.map(row => row.subscription_id === 234 ? { ...row, status: 'active', pause_start_date: null, pause_end_date: null } : row) });
  assert.equal(db.state().is_paused, 1);
});

test('no-ID duplicate subscription descriptors cannot merge unrelated subscriptions', async () => {
  const db = database();
  const result = await reconcile({ DB: db.DB }, [subscription, subscription], { ...options(), lookupCustomer: async () => ({ status: 'matched', clientId: 'rcl_saved' }) });
  assert.equal(result.failed, 2); assert.equal(db.events().length, 0);
});

test('late historical pause cannot steal the current unpause window', async () => {
  const db = database(), env = { DB: db.DB };
  await paused(env);
  await capture(env, { eventType: 'client:subscription_paused', body: { ...body, created: body.created - 90 * 86400 } },
    { ...options({ ...subscription, pause_start_date: '2026-08-22', pause_end_date: '2026-09-01' }), now: new Date(now.getTime() + 1000) });
  await capture(env, { eventType: 'client:subscription_unpaused', body: { ...body, created: body.created + 86400 } },
    { ...options({ ...subscription, status: 'active', pause_start_date: null, pause_end_date: null }), now: new Date(now.getTime() + 2000) });
  assert.equal(db.events().find(event => event.event_type === 'unpaused').pause_start_date, '2026-11-22');
  assert.equal(db.state().is_paused, 0);
});

test('commercial provider outage cannot suppress residential fallback capture', async () => {
  const db = database();
  const result = await reconcile({ DB: db.DB }, [{ ...subscription, client_id: 'rcl_example' }], {
    ...options(), fetchSubscriptions: async () => { throw new Error('commercial unavailable'); },
  });
  assert.equal(result.failed, 1); assert.equal(db.events().length, 1); assert.equal(db.state().is_paused, 1);
});

test('same-client lease prevents racing deliveries from losing an appended history entry', async () => {
  const db = database(), env = { DB: db.DB }; let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const first = paused(env, { ...options(), syncAirtable: async () => { entered(); await held; return { status: 'unmatched' }; } });
  await started;
  await assert.rejects(paused(env), /Another save is in progress/);
  release(); await first; await paused(env);
  assert.equal(db.events().length, 1); assert.equal(db.state().pause_count, 1);
});

test('migration remains a proposal and missing tables leave legacy processing available', async () => {
  const sql = readFileSync(new URL('../schema-proposals/0070_seasonal_pauses.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRIGGER)\b/);
  assert.equal(await seasonalSchemaReady({ prepare: () => ({ first: async () => ({ total: 0 }) }) }), false);
  assert.deepEqual(await capture({}, { eventType: 'client:subscription_paused', body }), { skipped: true, reason: 'migration_pending' });
});

test('webhook through mocked Airtable appends six-field facts, preserves backfill and human March restart', async () => {
  const db = database(), originalFetch = globalThis.fetch;
  let record = { id: 'recExample12345678', fields: { fldi918YuxMiQMHWn: 'rcl_example', fldHkCp7DG7Ic5j8f: 'Example Customer',
    [F.pause_count]: 2, [F.pause_history]: '2026-10-01 paused earlier backfill source', [F.seasonal_pattern]: 'Spring/Fall pauser', [F.planned_restart_date]: '2027-03-15' } };
  const writes = [];
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === 'PATCH') {
      const value = JSON.parse(init.body); writes.push(value);
      record = { ...record, fields: { ...record.fields, ...value.records[0].fields } };
      return Response.json({ records: [record] });
    }
    return Response.json(String(_url).includes('/recExample') ? record : { records: [record] });
  };
  try {
    const env = { DB: db.DB, AIRTABLE_API_KEY: 'fake-test-key' };
    const actualOptions = { now, fetchSubscriptions: async () => [subscription] };
    await paused(env, actualOptions); await paused(env, actualOptions);
    assert.equal(writes.length, 1); assert.equal(writes[0].typecast, false);
    assert.ok(Object.keys(writes[0].records[0].fields).every(id => Object.values(F).includes(id)));
    assert.equal(record.fields[F.pause_count], 3); assert.ok(record.fields[F.pause_history].startsWith('2026-10-01 paused earlier backfill source'));
    assert.equal(db.state().seasonal_pattern, 'spring_fall'); assert.equal(db.state().planned_restart_date, '2027-03-15');
    assert.equal(db.state().next_action_date, '2027-02-20'); assert.equal(db.state().airtable_sync_status, 'synced');
  } finally { globalThis.fetch = originalFetch; }
});
