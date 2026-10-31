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
test('bounded matrices inspect the end of a long route without artificial depot edges', async () => {
  const candidate = { n: 100 }, depot = { n: 0 };
  const stops = Array.from({length:60}, (_,i) => ({n:i+1}));
  let calls = 0;
  const result = await evaluateRouteInsertion(candidate, stops, depot, async points => {
    calls++;
    assert.ok(points.length <= 29);
    return {ok:true, data:{matrix:points.map(from => points.map(to => {
      const cost = from.n === 100 || to.n === 100 ? ([59,60].includes(from.n === 100 ? to.n : from.n) ? 6 : 100) : 10;
      return {time:cost, distance:cost};
    }))}};
  });
  assert.equal(calls, 3);
  assert.equal(result.seconds, 2);
  assert.ok(result.nearest.some(row => row.index === 59));
});
test('one failed matrix withholds a partial route recommendation', async () => {
  assert.equal(await evaluateRouteInsertion({}, [{},{}], {}, async () => ({ok:false})), null);
});
