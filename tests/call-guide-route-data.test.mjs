import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { compareRouteDensity, resolvedStopRegion, evaluateRouteInsertion } from '../lib/route-density-policy.mjs';
import { allowedOperationalDays } from '../lib/route-day-policy.mjs';
import { onboardingRouteTechnician } from '../lib/staffing-policy.mjs';

const source = fs.readFileSync(new URL('../lib/route-intelligence.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\} from .*;\r?\n/gm, '').replace(/^export /gm, '');
async function fixture({ status = 'partial', ageHours = 0, failed = false, fallback = false, missingPlan = false, roadMatch = false } = {}) {
  let roadCalls = 0;
  const api = runPrivateInNewContext(`${source}\n({recommendOnboardingRoute,addressHash});`, { routingPrivate,
    crypto: webcrypto, TextEncoder, compareRouteDensity, resolvedStopRegion, evaluateRouteInsertion, allowedOperationalDays, onboardingRouteTechnician,
    readRouteAssignmentAudit: async () => ({ status: 'verified' }),
    calculateCandidateRoadMatches: async () => { const minutes = ++roadCalls === 1 ? 12 : 1; return failed ? null : [{ index: 0, roadMinutes: minutes, roadMiles: minutes / 3 }]; },
    calculateRouteMatrix: async points => failed ? { ok: false } : ({ ok: true, data: { matrix: points.map((_, i) => points.map((_, j) => ({ time: i === j ? 0 : 60, distance: i === j ? 0 : 100 }))) } }),
  });
  const rows = ['Monday', 'Friday'].map(day => ({ id: day, fields: { Status: 'Active', 'Client Name': `${day} fixture`, Address: `${day} Street`, City: 'Perrysburg', State: 'OH', ZIP: '43551', Frequency: 'Weekly', 'Service Day': day, 'Assigned Tech': staffPrivate.primaryName, 'Est. Service Minutes': 10, 'MRR ($)': 100 } }));
  const snapshot = { payload: JSON.stringify({ opwp: { customers: rows } }), status: 'success', captured_at: new Date().toISOString() };
  const plan = { status, created_at: new Date(Date.now() - ageHours * 3600000).toISOString(), payload: JSON.stringify({ officeTransitionScenario: { routes: rows.map(row => ({ routeId: row.id, technicianName: staffPrivate.primaryName, routeStatus: status, plannedMinutes: status === 'complete' ? 100 : null, routeRevenue: status === 'complete' ? 100 : null, stopCount: 1, stopSequence: [{ customer: row.fields['Client Name'] }] })) } }) };
  const coords = { latitude: 41.6, longitude: -83.6, confidence: 1, formatted_address: 'Fixture, Perrysburg, OH 43551', match_type: 'building' };
  const cache = await Promise.all(rows.map(async row => ({ address_hash: await api.addressHash(`${row.fields.Address}, Perrysburg, OH, 43551`), ...coords })));
  const queries = [];
  const db = { prepare(sql) {
    assert.ok(/^SELECT/.test(sql), 'recommendation must not write customer data'); queries.push(sql);
    return { bind() { return this; }, async first() { return sql.includes('business_cockpit') ? snapshot : sql.includes('route_subscription_plans') ? (missingPlan ? null : plan) : coords; }, async all() { return { results: cache }; } };
  } };
  const result = await api.recommendOnboardingRoute(db, { address: '123 Example Lane', city: 'Perrysburg', state: 'OH', zip: '43551', frequency: 'every_other_week', monthly_revenue: 87 }, { allowGeographicFallback: fallback, closestRoadMatch: roadMatch });
  return { result, queries };
}

test('biweekly guide uses newest partial membership without treating unavailable capacity as zero', async () => {
  const { result, queries } = await fixture();
  assert.equal(result.frequency, 'Biweekly');
  assert.ok(result.recommendedDay);
  assert.equal(result.routePlanStatus, 'partial');
  assert.ok(queries.find(sql => sql.includes("status IN ('complete','partial')")));
  assert.ok(result.routeWarnings.some(warning => warning.includes('incomplete road')));
  assert.equal(result.confidence, 'review');
  for (const row of result.rankedDays.filter(row => row.available)) {
    assert.equal(row.projectedMinutes, null);
    assert.equal(row.remainingCapacityMinutes, null);
    assert.equal(row.projectedRevenuePerHour, null);
  }
});

test('failed road checks explain that Airtable loaded and leave recommendations unassigned', async () => {
  const { result } = await fixture({ failed: true });
  assert.equal(result.recommendedDay, null);
  assert.ok(result.routeWarnings.some(warning => warning.includes('Airtable customer data loaded')));
  assert.ok(result.rankedDays.filter(row => row.allowed).every(row => !row.available && row.reason.includes('Road travel data')));
});

test('old completed plan is disclosed and cannot provide current capacity or high confidence', async () => {
  const { result } = await fixture({ status: 'complete', ageHours: 48 });
  assert.ok(result.routeWarnings.some(warning => warning.includes('24 hours old')));
  assert.equal(result.confidence, 'review');
  assert.ok(result.rankedDays.filter(row => row.available).every(row => row.projectedMinutes === null));
});

test('fresh complete plan retains finite capacity estimates', async () => {
  const { result } = await fixture({ status: 'complete' });
  assert.equal(result.routeWarnings.length, 0);
  assert.ok(result.rankedDays.filter(row => row.available).every(row => row.projectedMinutes > 100));
});


test('office guide remains useful during provider outages without inventing road metrics or confirming a day', async () => {
  const { result } = await fixture({ failed: true, fallback: true });
  assert.ok(result.recommendedDay);
  assert.equal(result.recommendationBasis, 'current_route_geography');
  assert.equal(result.requiresOwnerConfirmation, true);
  assert.equal(result.confidence, 'review');
  assert.ok(result.routeWarnings.some(w => w.includes('provisional')));
  assert.doesNotMatch(result.guidance, /null extra|approximately/);
  for (const row of result.rankedDays.filter(r => r.available)) {
    assert.equal(row.insertionMinutes, null);
    assert.equal(row.insertionMiles, null);
    assert.equal(row.projectedMinutes, null);
    assert.equal(row.projectedRevenuePerHour, null);
  }
});

test('current active memberships provide a provisional day even without a saved road plan', async () => {
  const { result } = await fixture({ failed: true, fallback: true, missingPlan: true });
  assert.ok(result.recommendedDay);
  assert.equal(result.routePlanStatus, 'unavailable');
  assert.equal(result.requiresOwnerConfirmation, true);
});


test('street-connected matching ranks actual directional road access instead of nearest straight-line ties', async () => {
  const { result } = await fixture({ roadMatch: true, fallback: true });
  assert.equal(result.recommendedDay, 'Friday');
  assert.equal(result.recommendationBasis, 'nearest_road_match');
  assert.match(result.guidance, /street-connected/);
  assert.equal(result.rankedDays[0].nearestRoadMinutes, 1);
  assert.equal(result.rankedDays[0].insertionMinutes, null);
});
