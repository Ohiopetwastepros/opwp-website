import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRouteDensity, resolvedStopRegion, evaluateRouteInsertion } from '../lib/route-density-policy.mjs';

test('Monday relief preserves the closest route even when Monday exceeds capacity', () => {
  const days = [
    { day: 'Tuesday', insertionMinutes: 20, insertionMiles: 8, projectedMinutes: 200, regionDensity: 1 },
    { day: 'Monday', insertionMinutes: 2, insertionMiles: 0.5, projectedMinutes: 650, regionDensity: 8 },
  ];
  assert.equal(days.sort(compareRouteDensity)[0].day, 'Monday');
});
test('Kenwood incorrect Oregon ZIP cannot create Tuesday Oregon density', () => {
  const stop = { region: 'East Toledo / Oregon', location: { formattedAddress: '1201 Example Lane, Toledo, OH 43606, United States of America' } };
  assert.equal(resolvedStopRegion(stop, (city, zip) => zip === '43606' ? 'West Toledo' : 'East Toledo / Oregon'), 'West Toledo');
});
test('Census comma-separated state and ZIP correct a stale source region', () => {
  const stop = { region: 'East Toledo / Oregon', location: { formattedAddress: '1201 EXAMPLE LANE, TOLEDO, OH, 43606' } };
  assert.equal(resolvedStopRegion(stop, (_city, zip) => zip === '43606' ? 'West Toledo' : 'East Toledo / Oregon'), 'West Toledo');
});
test('insertion uses one bounded neighbor check and a conservative out-and-back road estimate', async () => {
  const candidate = { latitude: 41.6, longitude: -83.6 };
  const stops = Array.from({length:5}, (_,i) => ({latitude:41.6, longitude:-83.6 + i / 100}));
  let calls = 0;
  const result = await evaluateRouteInsertion(candidate, stops, async (point, neighbors) => {
    calls++;
    assert.equal(point, candidate);
    assert.equal(neighbors, stops);
    return [{ index: 0, roadMinutes: 10, roadMiles: 4 }, { index: 4, roadMinutes: 2, roadMiles: 1 }];
  });
  assert.equal(calls, 1);
  assert.equal(result.seconds, 240);
  assert.equal(result.meters, 3218.688);
  assert.equal(result.nearest[0].index, 4);
  assert.equal(result.method, 'nearest_neighbor_estimate');
});
test('failed or unusable neighbor checks withhold a route recommendation', async () => {
  assert.equal(await evaluateRouteInsertion({}, [{},{}], async () => null), null);
  assert.equal(await evaluateRouteInsertion({}, [{}], async () => [{ index: 5, roadMinutes: 1, roadMiles: 1 }, { index: 0, roadMinutes: NaN, roadMiles: 1 }]), null);
});
test('insertion refuses unbounded neighbor sets before any provider work', async () => {
  let calls = 0;
  const check = async () => { calls++; return []; };
  assert.equal(await evaluateRouteInsertion({}, [], check), null);
  assert.equal(await evaluateRouteInsertion({}, Array(6).fill({}), check), null);
  assert.equal(calls, 0);
});
