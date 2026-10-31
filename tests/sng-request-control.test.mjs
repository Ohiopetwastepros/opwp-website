import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { controlledSngFetch, retryAtFrom } from '../lib/sng-request-control.mjs';
import { outboundFetch } from '../lib/outbound-request.js';
import fs from 'node:fs';
import vm from 'node:vm';

test('Retry-After seconds and dates are honored, absent headers get a conservative cooldown', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  assert.equal(retryAtFrom(new Response('', { headers: { 'retry-after': '120' } }), now), now + 120000);
  assert.equal(retryAtFrom(new Response('', { headers: { 'retry-after': 'Wed, 30 Sep 2026 00:04:00 GMT' } }), now), now + 240000);
  assert.equal(retryAtFrom(new Response(''), now), now + 900000);
});
test('429 persists cooldown and prevents another integration from sending a request', async () => {
  let state, calls = 0;
  const db = { prepare: () => ({ bind: (...args) => ({ first: async () => state ? { payload: state } : null, run: async () => { state = args[1]; } }) }) };
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '180' } }); };
  try {
    assert.equal((await controlledSngFetch({ DB: db }, 'https://openapi.sweepandgo.com/api/v1/clients/active')).status, 429);
    await assert.rejects(controlledSngFetch({ DB: db }, 'https://openapi.sweepandgo.com/api/v2/subscriptions'), error => error.status === 429);
    assert.equal(calls, 1);
    await assert.rejects(controlledSngFetch({}, 'https://example.com/'), /Invalid SNG origin/);
  } finally { globalThis.fetch = original; }
});
test('generic retry helper never immediately retries a 429', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
  try { await outboundFetch('https://example.com', {}, { retryable: true, retries: 2 }); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test('historical recovery checkpoints each successful day and does not restart completed history', async () => {
  const source = fs.readFileSync(new URL('../lib/sng-operational-recovery.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  let state = null, calls = 0;
  const db = { prepare: () => ({ bind: (...args) => ({ first: async () => state ? { payload: JSON.stringify(state) } : null, run: async () => { state = JSON.parse(args[1]); } }) }) };
  const run = runPrivateInNewContext(source + '\nrunSngDispatchBackfillBatch', { Date, Intl, console,
    sngRequest: async () => ({ ok: ++calls !== 2, status: calls === 2 ? 429 : 200, data: [] }),
    sngRows: () => [], upsertSngDispatchJobs: async () => ({ verified: 0 }),
  });
  const env = { DB: db, AIRTABLE_API_KEY: 'test', SNG_API_KEY: 'test' };
  await assert.rejects(run(env), /429/);
  assert.equal(state.lastRun.dates.length, 1);
  const next = state.nextDate;
  await run(env, { days: 1 });
  assert.equal(state.lastRun.dates[0], next);
  state.complete = true;
  const before = calls;
  assert.equal((await run(env)).reason, 'history_complete');
  assert.equal(calls, before);
});
