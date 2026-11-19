import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import { densityAddressHash, localReliableGeocode } from '../lib/live-density-calculations.mjs';

const source = fs.readFileSync(new URL('../lib/dog-food-routing.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const address = { line1: '123 Fixture Lane', city: 'Toledo', state: 'OH', postal_code: '43614' };

function setup(data) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE route_geocode_cache(address_hash TEXT PRIMARY KEY,normalized_address TEXT,latitude REAL,longitude REAL,formatted_address TEXT,confidence REAL,match_type TEXT,provider_place_id TEXT);');
  const db = { prepare(query) { return { bind(...args) { return {
    async first() { return sql.prepare(query).get(...args) || null; },
    async run() { return { meta: sql.prepare(query).run(...args) }; },
  }; } }; } };
  let geocodeCalls = 0, quotaCalls = 0;
  const locate = vm.runInNewContext(source + '\nlocateFoodAddress;', {
    crypto: webcrypto, TextEncoder, densityAddressHash, localReliableGeocode,
    fieldQuota: async () => { quotaCalls++; return true; },
    geocodeAddress: async () => { geocodeCalls++; return { ok: true, data }; },
  });
  return { sql, locate: () => locate(db, { id: 'fixture-account' }, address), calls: () => ({ geocodeCalls, quotaCalls }) };
}

const census = { latitude: 41.6, longitude: -83.6, formattedAddress: '123 FIXTURE LANE, TOLEDO, OH, 43614',
  confidence: null, matchType: 'census_interpolated', stateCode: 'OH', postcode: '43614', placeId: '', source: 'census' };

test('food address routing accepts a Census match and reuses its persisted interpolation marker', async () => {
  const f = setup(census);
  const first = await f.locate();
  assert.equal(first.latitude, 41.6); assert.equal(first.longitude, -83.6);
  const cached = f.sql.prepare('SELECT confidence,match_type,provider_place_id FROM route_geocode_cache').get();
  assert.equal(cached.confidence, null); assert.equal(cached.match_type, 'census_interpolated'); assert.equal(cached.provider_place_id, '');
  const second = await f.locate();
  assert.equal(second.latitude, 41.6); assert.deepEqual(f.calls(), { geocodeCalls: 1, quotaCalls: 2 });
  f.sql.close();
});

test('food routing rejects invalid or out-of-territory Census coordinates and never caches them', async () => {
  for (const patch of [{ latitude: 40.9 }, { longitude: -84.7 }, { latitude: null }, { longitude: null }, { latitude: NaN }, { longitude: Infinity }]) {
    const f = setup({ ...census, ...patch }), result = await f.locate();
    assert.equal(result.latitude, null); assert.equal(result.longitude, null);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_geocode_cache').get().n, 0);
    f.sql.close();
  }
});
