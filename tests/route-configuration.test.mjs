import test from 'node:test';
import assert from 'node:assert/strict';
import staffPrivate from '../lib/staff-private.json' with { type: 'json' };
import { ROUTING_CONFIGURATION, optionalRouteCapacity, routingTechnicianConfiguration } from '../lib/route-configuration.mjs';

const complete = { technician: staffPrivate.primaryName, plannedMinutes: 450, serviceMinutes: 10, insertionMinutes: 25, metricsVerified: true, depotIncluded: true };
const configured = (maxDailyMinutes, perTechnician = null) => ({ ...ROUTING_CONFIGURATION, maxDailyMinutes,
  technicians: ROUTING_CONFIGURATION.technicians.map(technician => ({ ...technician, maxDailyMinutes: perTechnician })) });

test('central roster binds identities privately and keeps daily caps OFF by default', () => {
  assert.equal(ROUTING_CONFIGURATION.maxDailyMinutes, null);
  assert.ok(ROUTING_CONFIGURATION.technicians.every(technician => technician.maxDailyMinutes === null));
  const primary = routingTechnicianConfiguration(staffPrivate.primaryName);
  const relief = routingTechnicianConfiguration(staffPrivate.reliefName);
  const future = ROUTING_CONFIGURATION.technicians.find(technician => technician.role === 'future');
  assert.equal(primary.employment, 'full_time'); assert.equal(primary.active, true);
  assert.equal(primary.depotReference, 'depotAddress');
  assert.equal(relief.employment, 'part_time'); assert.equal(relief.active, true);
  assert.deepEqual(relief.availableDays, ['Monday']);
  assert.equal(future.employment, 'part_time'); assert.equal(future.active, false);
  assert.equal(optionalRouteCapacity({ ...complete, plannedMinutes: 700 }).capacityLimitEnabled, false);
  assert.equal(optionalRouteCapacity({ ...complete, plannedMinutes: null, metricsVerified: false }).capacityStatus, 'not_configured');
});

test('private full and short source identities resolve the same per-technician configuration', () => {
  assert.equal(routingTechnicianConfiguration(staffPrivate.primaryShort), routingTechnicianConfiguration(staffPrivate.primaryName));
  assert.equal(routingTechnicianConfiguration(staffPrivate.reliefShort), routingTechnicianConfiguration(staffPrivate.reliefName));
  const result = optionalRouteCapacity({ ...complete, technician: staffPrivate.primaryShort }, configured(null, 480));
  assert.equal(result.capacityLimitEnabled, true); assert.equal(result.capacityStatus, 'over_limit');
  assert.equal(routingTechnicianConfiguration(''), null);
});

test('future configured capacity flags respect editable limits and include all service and drive minutes', () => {
  const within = optionalRouteCapacity(complete, configured(600));
  assert.equal(within.maxDailyMinutes, 600); assert.equal(within.capacityStatus, 'within_limit');
  assert.equal(within.capacityProjectedMinutes, 485);
  assert.equal(optionalRouteCapacity(complete, configured(480)).capacityStatus, 'over_limit');
  assert.equal(optionalRouteCapacity({ ...complete, insertionMinutes: 20 }, configured(600)).capacityStatus, 'within_limit');
  assert.equal(optionalRouteCapacity({ ...complete, plannedMinutes: 200 }, configured(480, 240)).capacityStatus, 'within_limit');
  assert.equal(optionalRouteCapacity({ ...complete, plannedMinutes: 210 }, configured(480, 240)).capacityStatus, 'over_limit');
});

test('future enabled checks flag unknown capacity or missing known-depot travel rather than treating it as zero', () => {
  for (const change of [{ metricsVerified: false }, { depotIncluded: false }, { plannedMinutes: null }, { insertionMinutes: null }]) {
    const result = optionalRouteCapacity({ ...complete, ...change }, configured(480));
    assert.equal(result.capacityStatus, 'unverified'); assert.equal(result.capacityExceeded, null);
  }
  assert.equal(optionalRouteCapacity({ ...complete, technician: staffPrivate.reliefName, depotIncluded: false }, configured(480)).capacityStatus, 'over_limit');
});
