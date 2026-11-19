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
import { ROUTING_CONFIGURATION, optionalRouteCapacity } from '../lib/route-configuration.mjs';

const source = fs.readFileSync(new URL('../lib/route-intelligence.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\} from .*;\r?\n/gm, '').replace(/^export /gm, '');
async function fixture({ status = 'partial', ageHours = 0, failed = false, fallback = false, missingPlan = false, roadMatch = false, customersPerDay = 1, unplannedOtherTechnician = false, routeMinutes = 100, routeRevenue = 100, routingConfiguration = ROUTING_CONFIGURATION, shortTechnicianName = false, failFirstRoadCall = false } = {}) {
  let roadCalls = 0;
  const roadTargets = [];
  const api = runPrivateInNewContext(`${source}\n({recommendOnboardingRoute,addressHash});`, { routingPrivate,
    crypto: webcrypto, TextEncoder, compareRouteDensity, resolvedStopRegion, evaluateRouteInsertion, allowedOperationalDays, onboardingRouteTechnician, ROUTING_CONFIGURATION, optionalRouteCapacity,
    readRouteAssignmentAudit: async () => ({ status: 'verified' }),
    calculateCandidateRoadMatches: async (_, targets) => { roadTargets.push(targets); const minutes = ++roadCalls === 1 ? 12 : 1; return failed || (failFirstRoadCall && roadCalls === 1) ? null : [{ index: 0, roadMinutes: minutes, roadMiles: minutes / 3 }]; },
    calculateRouteMatrix: async () => { assert.fail('automatic recommendations must never fetch a full route matrix'); },
  });
  const technicianName = shortTechnicianName ? staffPrivate.primaryShort : staffPrivate.primaryName;
  const rows = ['Monday', 'Friday'].flatMap(day => Array.from({length: customersPerDay}, (_, index) => ({ id: `${day}-${index}`, day, index, fields: { Status: 'Active', 'Client Name': `${day} fixture ${index}`, Address: `${day} Street ${index}`, City: 'Perrysburg', State: 'OH', ZIP: '43551', Frequency: 'Weekly', 'Service Day': day, 'Assigned Tech': technicianName, 'Est. Service Minutes': 10, 'MRR ($)': 100 } })));
  const customers = unplannedOtherTechnician ? [...rows, { id: 'unplanned-other-tech', day: 'Monday', index: -0.1,
    fields: { ...rows[0].fields, 'Client Name': 'Unplanned other technician', Address: 'Different fixture Street', 'Assigned Tech': staffPrivate.reliefName } }] : rows;
  const snapshot = { payload: JSON.stringify({ opwp: { customers } }), status: 'success', captured_at: new Date().toISOString() };
  const plan = { status, created_at: new Date(Date.now() - ageHours * 3600000).toISOString(), payload: JSON.stringify({ officeTransitionScenario: { routes: ['Monday', 'Friday'].map(day => ({ routeId: day, technicianName, routeStatus: status, plannedMinutes: status === 'complete' ? routeMinutes : null, routeRevenue: status === 'complete' ? routeRevenue : null, depotIncluded: true, stopCount: customersPerDay, stopSequence: rows.filter(row => row.day === day).reverse().map(row => ({ customer: row.fields['Client Name'] })) })) } }) };
  const coords = { latitude: 41.6, longitude: -83.6, confidence: 1, formatted_address: 'Fixture, Perrysburg, OH 43551', match_type: 'building' };
  const cache = await Promise.all(customers.map(async row => ({ address_hash: await api.addressHash(`${row.fields.Address}, Perrysburg, OH, 43551`), ...coords, longitude: coords.longitude + row.index / 10000 })));
  const queries = [];
  const db = { prepare(sql) {
    assert.ok(/^SELECT/.test(sql), 'recommendation must not write customer data'); queries.push(sql);
    return { bind() { return this; }, async first() { return sql.includes('business_cockpit') ? snapshot : sql.includes('route_subscription_plans') ? (missingPlan ? null : plan) : coords; }, async all() { return { results: cache }; } };
  } };
  const result = await api.recommendOnboardingRoute(db, { address: '123 Example Lane', city: 'Perrysburg', state: 'OH', zip: '43551', frequency: 'every_other_week', monthly_revenue: 87 }, { allowGeographicFallback: fallback, closestRoadMatch: roadMatch, routingConfiguration });
  return { result, queries, roadCalls, roadTargets };
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

test('default daily caps stay OFF and preserve recommendations above the soft 480-minute target', async () => {
  const { result } = await fixture({ status: 'complete', routeMinutes: 700 });
  assert.equal(result.recommendedDay, 'Friday');
  for (const row of result.rankedDays.filter(day => day.available)) {
    assert.equal(row.capacityLimitEnabled, false);
    assert.equal(row.capacityStatus, 'not_configured');
    assert.ok(row.projectedMinutes > 700);
    assert.ok(row.remainingCapacityMinutes < 0);
  }
});

test('explicit configured flags apply to short source names without rejecting or reranking recommendations', async () => {
  const routingConfiguration = { ...ROUTING_CONFIGURATION, technicians: ROUTING_CONFIGURATION.technicians.map(technician => ({ ...technician, maxDailyMinutes: technician.role === 'primary' ? 480 : null })) };
  const { result } = await fixture({ status: 'complete', routeMinutes: 470, shortTechnicianName: true, routingConfiguration });
  assert.equal(result.recommendedDay, 'Friday');
  assert.equal(result.rankedDays[0].capacityStatus, 'over_limit');
  assert.equal(result.rankedDays[0].capacityExceeded, true);
  assert.equal(result.rankedDays[0].maxDailyMinutes, 480);
  assert.ok(result.rankedDays[0].available);
});

test('future configured time flags remain verified when route revenue is unavailable', async () => {
  const routingConfiguration = { ...ROUTING_CONFIGURATION, maxDailyMinutes: 480 };
  const { result } = await fixture({ status: 'complete', routeMinutes: 470, routeRevenue: null, routingConfiguration });
  const day = result.rankedDays.find(row => row.day === 'Friday');
  assert.equal(day.capacityStatus, 'over_limit');
  assert.equal(day.capacityExceeded, true);
  assert.equal(day.capacityProjectedMinutes, 482);
  assert.equal(day.projectedMinutes, null);
  assert.equal(day.projectedRevenuePerHour, null);
});

test('geographic fallback clears computed configured capacity flags to unverified', async () => {
  const routingConfiguration = { ...ROUTING_CONFIGURATION, maxDailyMinutes: 480 };
  const { result } = await fixture({ status: 'complete', routeMinutes: 470, failFirstRoadCall: true, fallback: true, routingConfiguration });
  assert.ok(result.recommendedDay);
  assert.equal(result.recommendationBasis, 'current_route_geography');
  for (const row of result.rankedDays.filter(day => day.available)) {
    assert.equal(row.capacityLimitEnabled, true);
    assert.equal(row.capacityStatus, 'unverified');
    assert.equal(row.capacityExceeded, null);
    assert.equal(row.capacityProjectedMinutes, undefined);
    assert.equal(row.capacityRemainingMinutes, undefined);
  }
});

test('one-time scheduling returns the existing operational result without a route or capacity lookup', async () => {
  const recommend = runPrivateInNewContext(`${source}\nrecommendOnboardingRoute;`, { ROUTING_CONFIGURATION, routingPrivate });
  const result = await recommend({ prepare() { assert.fail('one-time scheduling must not query recurring routes'); } }, { frequency: 'one_time' });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'One-time cleanups are scheduled operationally and do not receive a recurring route assignment.');
});

test('large saved routes check only five nearest same-day and same-technician stops once per eligible day', async () => {
  const { result, roadCalls, roadTargets } = await fixture({ status: 'complete', customersPerDay: 60, unplannedOtherTechnician: true });
  assert.equal(roadCalls, 2);
  assert.equal(result.method, 'nearest_neighbor_estimate');
  for (const targets of roadTargets) {
    assert.equal(targets.length, 5);
    assert.deepEqual(Array.from(targets, row => Math.round((row.longitude + 83.6) * 10000)), [0, 1, 2, 3, 4]);
  }
  for (const row of result.rankedDays.filter(day => day.available)) {
    assert.equal(row.method, 'nearest_neighbor_estimate');
    assert.equal(row.insertionMinutes, row.nearestRoadMinutes * 2);
    assert.equal(row.nearest[0].customer, `${row.day} fixture 0`);
    assert.ok(row.projectedMinutes > 100);
  }
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
  assert.equal(result.rankedDays[0].projectedMinutes, null);
  assert.equal(result.rankedDays[0].capacityLimitEnabled, false);
  assert.equal(result.rankedDays[0].method, 'nearest_neighbor_estimate');
});
