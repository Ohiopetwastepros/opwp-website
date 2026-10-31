import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { controlledRoutingRequest } from '../lib/routing-provider-control.mjs';
import { censusGeocode } from '../lib/census-geocode.mjs';
import vm from 'node:vm';
import { validRoadPoint } from '../lib/daily-route-optimizer.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0058_routing_provider_controls.sql', import.meta.url), 'utf8'));
  sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/0059_routing_provider_pacing.sql', import.meta.url), 'utf8'));
  const db = { prepare(query) { const stmt = sql.prepare(query); let args = []; return { bind(...values) { args = values; return this; }, async first() { return stmt.get(...args) || null; }, async run() { return stmt.run(...args); } }; } };
  let calls = 0;
  const request = async () => { calls++; return { ok: true, status: 200, data: { roads: [1, 2] } }; };
  const options = { db, key: 'matrix', cost: 310, ttl: 86400, request, wait: async () => {}, now: Date.parse('2026-10-27T18:00:00Z') };
  return { sql, options, calls: () => calls };
}

test('foreground and scheduled requests reuse persisted road results without spending credits', async () => {
  const h = fixture();
  assert.equal((await controlledRoutingRequest(h.options)).ok, true);
  assert.equal((await controlledRoutingRequest(h.options)).cached, true);
  assert.equal(h.calls(), 1);
  assert.equal(h.sql.prepare('SELECT credits FROM routing_provider_usage').get().credits, 310);
});

test('concurrent unique matrices cannot exceed the shared 2500-credit allowance', async () => {
  const h = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => controlledRoutingRequest({ ...h.options, key: String(i) })));
  assert.equal(results.filter(r => r.ok).length, 8);
  assert.equal(h.calls(), 8);
  assert.equal(h.sql.prepare('SELECT credits FROM routing_provider_usage').get().credits, 2480);
  assert.equal((await controlledRoutingRequest({ ...h.options, key: 'oversized', cost: 2501 })).ok, false);
});

test('provider quota errors stop all isolates for the rest of the UTC day; cached results still work', async () => {
  const h = fixture(); await controlledRoutingRequest(h.options);
  let failures = 0;
  const request = async () => { failures++; return { ok: false, status: 429, data: null }; };
  await controlledRoutingRequest({ ...h.options, key: 'failed', request });
  assert.equal((await controlledRoutingRequest({ ...h.options, key: 'other', request })).errorCode, 'quota_exceeded');
  assert.equal(failures, 1);
  assert.equal((await controlledRoutingRequest(h.options)).cached, true);
  assert.equal((await controlledRoutingRequest({ ...h.options, now: h.options.now + 86400000, key: 'tomorrow' })).ok, true);
});

test('missing or broken usage storage fails closed without a paid provider call', async () => {
  const h = fixture();
  assert.equal((await controlledRoutingRequest({ ...h.options, db: null })).ok, false);
  assert.equal((await controlledRoutingRequest({ ...h.options, db: { prepare() { throw Error('offline'); } } })).ok, false);
  assert.equal(h.calls(), 0);
});

test('parallel street checks are paced below the free-plan request rate', async () => {
  const h = fixture(), waits = [];
  await Promise.all(Array.from({ length: 5 }, (_, i) => controlledRoutingRequest({ ...h.options, key: String(i), cost: 5, wait: async ms => waits.push(ms) })));
  assert.deepEqual(waits, [250, 500, 750, 1000]);
});

test('temporary rate limiting does not disable street checks for the whole day', async () => {
  const h = fixture();
  await controlledRoutingRequest({ ...h.options, request: async () => ({ ok: false, status: 429, errorCode: 'rate_limited' }) });
  assert.equal((await controlledRoutingRequest({ ...h.options, now: h.options.now + 3000 })).ok, true);
});

const censusMatch = { matchedAddress: '5061 SANDRA DR, TOLEDO, OH, 43613', coordinates: { x: -83.615, y: 41.708 }, addressComponents: { city: 'TOLEDO', state: 'OH', zip: '43613' } };
test('free backup geocoder labels address-range accuracy and validates territory, ZIP and ambiguity', async () => {
  const lookup = matches => censusGeocode('1200 Example Lane, Toledo, OH 43613', async () => Response.json({ result: { addressMatches: matches } }));
  assert.equal((await lookup([censusMatch])).matchType, 'census_interpolated');
  assert.equal(await lookup([]), null);
  assert.equal(await lookup([censusMatch, censusMatch]), null);
  assert.equal(await lookup([{ ...censusMatch, coordinates: { x: -120, y: 41 } }]), null);
  assert.equal(await lookup([{ ...censusMatch, addressComponents: { ...censusMatch.addressComponents, zip: '43616' } }]), null);
  assert.equal(await lookup([{ ...censusMatch, coordinates: { x: null, y: null } }]), null);
});

test('street matching uses two small directional matrices instead of recalculating the route book', async () => {
  const source = fs.readFileSync(new URL('../lib/geoapify.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const calls = [];
  const scope = { URL, AbortController, setTimeout, clearTimeout, validRoadPoint, readBoundedProviderJson,
    getRuntimeEnv: () => ({ GEOAPIFY_API_KEY: 'test' }), routingRequestKey: async () => 'test',
    controlledRoutingRequest: async ({ request, cost }) => { assert.equal(cost, 5); return request(); },
    fetch: async (_, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return Response.json({ sources_to_targets: body.sources.map((__, i) => body.targets.map((___, j) => ({ time: body.sources.length === 1 ? (j + 1) * 60 : (5 - i) * 120, distance: 1609.344 }))) });
    } };
  const lookup = runPrivateInNewContext(source + '\ncalculateCandidateRoadMatches;', scope);
  const results = await lookup({ latitude: 41.7, longitude: -83.6 }, Array.from({ length: 5 }, (_, i) => ({ latitude: 41.7 + i / 1000, longitude: -83.6 })));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sources.length, 1); assert.equal(calls[0].targets.length, 5);
  assert.equal(calls[1].sources.length, 5); assert.equal(calls[1].targets.length, 1);
  // One-way access reverses the ranking suggested by the outbound leg alone.
  assert.equal(results[0].index, 4);
  assert.equal(results[0].roadMinutes, 3.5);
});
