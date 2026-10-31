import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/route-intelligence.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*\} from .*;\r?\n/gm, "").replace(/^export /gm, "");
const context = runPrivateInNewContext(`${source}\n({metricTotals, dayEconomics, activeMetric, selectiveDensityVisits});`, {routingPrivate});
const complete = { routeId: "Monday", routeStatus: "complete", routeRevenue: 500, plannedMinutes: 300, stopCount: 20 };
const failed = { routeId: "Tuesday", routeStatus: "partial", routeRevenue: 1000, plannedMinutes: null, stopCount: 40 };

test("failed road-time calculations never produce an inflated team hourly rate", () => {
  const totals = context.metricTotals([complete, failed]);
  assert.equal(totals.revenue, 1500);
  assert.equal(totals.complete, false);
  assert.equal(totals.revenuePerPlannedHour, null);
  assert.equal(context.metricTotals([complete]).revenuePerPlannedHour, 100);
});
test("a partial day cannot be treated as a zero-dollar rate and recommended for a move", () => {
  const days = context.dayEconomics([complete, failed]);
  assert.equal(days.get("Tuesday").revenuePerHour, null);
  const result = context.selectiveDensityVisits([{ customerId: "x", routeId: "Tuesday" }], [{ customerId: "x", currentDay: "Tuesday", suggestedDay: "Monday" }], [complete, failed]);
  assert.equal(result.moves.length, 0);
});
