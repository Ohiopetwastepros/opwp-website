import assert from "node:assert/strict";
import test from "node:test";
import { closedRouteInsertion, optimizeClosedRoute } from "../lib/route-depot-policy.mjs";

function matrix(times) {
  return times.map((row) => row.map((time) => ({ time, distance: time * 10 })));
}

test("closed route starts and ends at the configured depot", () => {
  const result = optimizeClosedRoute(matrix([
    [0, 5, 9, 6],
    [5, 0, 2, 4],
    [9, 2, 0, 2],
    [6, 4, 2, 0],
  ]));

  assert.equal(result.order[0], 0);
  assert.equal(result.order.at(-1), 0);
  assert.deepEqual([...new Set(result.order.slice(1, -1))].sort(), [1, 2, 3]);
  assert.equal(result.timeSeconds, 15);
  assert.equal(result.distanceMeters, 150);
});

test("closed-route quote insertion accounts for replacing both depot-adjacent legs", () => {
  // Index 0 is the candidate, index 1 is the depot, and indexes 2-3 are the route stops.
  const result = closedRouteInsertion(matrix([
    [0, 4, 2, 7],
    [4, 0, 5, 8],
    [2, 5, 0, 3],
    [7, 8, 3, 0],
  ]));

  assert.equal(result.position, "start");
  assert.equal(result.seconds, 1);
  assert.equal(result.meters, 10);
});
