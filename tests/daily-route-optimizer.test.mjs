import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { dispatchSelection, optimizeDailyRoute, routeCost, validDispatchDate, validateRoadMatrix, validRoadPoint } from "../lib/daily-route-optimizer.mjs";

const source = fs.readFileSync(new URL("../lib/route-intelligence.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export \{.*\} from .*;\r?\n/gm, "").replace(/^export /gm, "");
const { normalizeSngDispatchJobs } = runPrivateInNewContext(`${source}\n({normalizeSngDispatchJobs})`, {routingPrivate});
const job = (extra = {}) => ({ id: 1, full_name: "Client", address: "123 Main St", city: "Toledo", zip: "43615", assigned_to_id: Number(staffPrivate.providerIds.primary), assigned_to_name: staffPrivate.primaryName, status_name: "dispatched", order: 24, duration: "--:--", estimate_time: "00:10", service_label: "Haul Away", lat: 41.6, lng: -83.6, ...extra });
const matrix = values => values.map(row => row.map(time => ({ time, distance: time * 10 })));

test("SNG order, estimates, service labels and coordinates survive a blank actual duration", () => {
  const [normalized] = normalizeSngDispatchJobs([job()]);
  assert.equal(normalized.sequence, 24);
  assert.equal(normalized.serviceMinutes, 10);
  assert.equal(normalized.serviceName, "Haul Away");
  assert.equal(normalized.location.latitude, 41.6);
  assert.equal(normalized.sourceStatus, "dispatched");
  assert.equal(dispatchSelection(normalizeSngDispatchJobs([job({ duration: "00:00" })])).active[0].serviceMinutes, 10);
});
test("a missed fixture job is excluded without dropping its dispatched replacement or add-ons", () => {
  const selection = dispatchSelection(normalizeSngDispatchJobs([
    job({ id: 1, full_name: "Fixture Client", status_name: "missed", order: 0 }),
    job({ id: 2, full_name: "Fixture Client" }), job({ id: 3, full_name: "Fixture Client", service_label: "Sanitization" }),
  ]));
  assert.deepEqual(selection.active.map(x => x.jobId), ["2", "3"]);
  assert.equal(selection.excluded[0].status, "missed");
  assert.equal(selection.active[0].sequence, 24);
});
test("unknown or started jobs, duplicate IDs, missing assignment and impossible dates fail closed", () => {
  for (const extra of [{ status_name: "started" }, { status_name: "unknown" }, { assigned_to_id: "" }]) assert.throws(() => dispatchSelection(normalizeSngDispatchJobs([job(extra)])));
  assert.throws(() => dispatchSelection(normalizeSngDispatchJobs([job(), job()])));
  assert.equal(validDispatchDate("2026-02-30"), false);
  assert.equal(validDispatchDate("2026-10-06"), true);
  assert.equal(validRoadPoint({ latitude: 0, longitude: 0 }), false);
});
test("optimizer finds the small asymmetric optimum while preserving every stop and both depot legs", () => {
  const roads = matrix([[0,10,3,7,6],[2,0,12,2,8],[7,4,0,10,3],[9,1,8,0,2],[4,7,1,6,0]]);
  const permutations = values => values.length ? values.flatMap((v,i) => permutations(values.filter((_,j) => i!==j)).map(rest => [v,...rest])) : [[]];
  const optimum = Math.min(...permutations([1,2,3,4]).map(order => routeCost([0,...order,0],roads).timeSeconds));
  const result = optimizeDailyRoute(roads);
  assert.equal(result.timeSeconds, optimum);
  assert.equal(result.order[0],0); assert.equal(result.order.at(-1),0);
  assert.deepEqual(result.order.slice(1,-1).sort(),[1,2,3,4]);
  assert.ok(result.timeSeconds <= result.baseline.timeSeconds);
});
test("the source order is retained when already best; null road legs never become zero", () => {
  const roads = matrix([[0,1,50,50],[50,0,1,50],[50,50,0,1],[1,50,50,0]]);
  assert.deepEqual(optimizeDailyRoute(roads).order,[0,1,2,3,0]);
  roads[1][2].time=null;
  assert.equal(validateRoadMatrix(roads,4),false);
  assert.throws(() => optimizeDailyRoute(roads));
});
test("36-stop routes are optimized together, never truncated at the matrix request boundary", () => {
  const points = Array.from({length:37},(_,i)=>[Math.sin(i*2.399)*i,Math.cos(i*2.399)*i]);
  const roads = points.map(([x,y])=>points.map(([a,b])=>({time:Math.hypot(a-x,b-y),distance:Math.hypot(a-x,b-y)*10})));
  const result=optimizeDailyRoute(roads);
  assert.equal(result.order.length,38);
  assert.equal(new Set(result.order.slice(1,-1)).size,36);
  assert.ok(result.timeSeconds<result.baseline.timeSeconds);
});
