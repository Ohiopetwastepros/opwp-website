import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readBoundedProviderJson } from "../lib/bounded-body.mjs";
import { validateRoadMatrix,validRoadPoint,MAX_DAILY_ROUTE_STOPS } from "../lib/daily-route-optimizer.mjs";
const source=fs.readFileSync(new URL("../lib/geoapify.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function api(broken=false){const calls=[];const context={controlledRoutingRequest:async ({request})=>request(),routingRequestKey:async()=>"test",URL,AbortController,setTimeout,clearTimeout,readBoundedProviderJson,validateRoadMatrix,validRoadPoint,MAX_DAILY_ROUTE_STOPS,getRuntimeEnv:()=>({GEOAPIFY_API_KEY:"test"}),fetch:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  return Response.json({sources_to_targets:body.sources.map(s=>body.targets.map(t=>({time:broken?null:Math.abs(s.location[0]-t.location[0])*1000,distance:100})))});
}};return {...runPrivateInNewContext(`${source}\n({calculateDispatchMatrix,calculateRouteMatrix})`,context),calls};}
test("37-point depot matrix is assembled from four bounded requests with cross-block legs intact",async()=>{
  const h=api();const points=Array.from({length:37},(_,i)=>({latitude:41.6,longitude:-83.9+i/100}));const result=await h.calculateDispatchMatrix(points);
  assert.equal(result.ok,true);assert.equal(h.calls.length,4);assert.ok(h.calls.every(c=>c.sources.length*c.targets.length<=1000));
  assert.ok(Math.abs(result.data.matrix[0][36].time-360)<0.001);assert.equal(result.data.matrix.length,37);
});
test("unreachable road legs and oversized routes cannot be published as optimized",async()=>{
  const h=api(true);assert.equal((await h.calculateDispatchMatrix([{latitude:41.6,longitude:-83.6},{latitude:41.7,longitude:-83.7}])).ok,false);
  const big=api();assert.equal((await big.calculateDispatchMatrix(Array.from({length:62},()=>({latitude:41.6,longitude:-83.6})))).ok,false);assert.equal(big.calls.length,0);
});

test("44-point subscription plan preserves all cells within provider limits", async () => {
  const h = api();
  const result = await h.calculateRouteMatrix(Array.from({ length: 44 }, (_, i) => ({ latitude: 41.6, longitude: -83.9 + i / 100 })));
  assert.equal(result.ok, true);
  assert.equal(result.data.requests, 4);
  assert.ok(h.calls.every(call => call.sources.length * call.targets.length <= 1000));
  assert.equal(result.data.matrix.length, 44);
  assert.ok(Math.abs(result.data.matrix[0][43].time - 430) < 0.001);
  assert.ok(Math.abs(result.data.matrix[43][0].time - 430) < 0.001);
});

test("subscription plan rejects incomplete road cells and bounds provider spend", async () => {
  assert.equal((await api(true).calculateRouteMatrix([{ latitude: 41.6, longitude: -83.6 }, { latitude: 41.7, longitude: -83.7 }])).ok, false);
  const h = api();
  assert.equal((await h.calculateRouteMatrix(Array.from({ length: 202 }, () => ({ latitude: 41.6, longitude: -83.6 })))).ok, false);
  assert.equal(h.calls.length, 0);
});

test("the guide's 29-point insertion chunks still need only one provider request", async () => {
  const h = api();
  assert.equal((await h.calculateRouteMatrix(Array.from({ length: 29 }, (_, i) => ({ latitude: 41.6, longitude: -83.9 + i / 100 })))).ok, true);
  assert.equal(h.calls.length, 1);
});
