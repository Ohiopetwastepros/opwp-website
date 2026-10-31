import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readBoundedProviderJson } from "../lib/bounded-body.mjs";
const source=fs.readFileSync(new URL("../app/api/admin/stop-travel/route.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function api({authorized=true,allowed=true,unavailable=false}={}) {
  let reads=0,refreshes=0;
  const context={Response,URL,readBoundedProviderJson,verifyAdminRequest:async()=>({authorized,email:"owner"}),validTravelDate:d=>typeof d==="string"&&/^2026-09-(1[0-9]|20)$/.test(d),checkRateLimit:async()=>({allowed,unavailable}),rateLimitResponse:r=>Response.json({},{status:r.unavailable?503:429}),readStopTravel:async()=>{reads++;return {rows:[]};},refreshStopTravelDate:async()=>{refreshes++;return {};}};
  return {...runPrivateInNewContext(`${source}\n({GET,POST})`,context),calls:()=>reads+refreshes};
}
const request=(method="POST",extra={})=>new Request("https://example.com/api/admin/stop-travel/?from=2026-09-16&through=2026-09-20",{method,...(method==="POST"?{headers:{origin:"https://example.com","content-type":"application/json"},body:'{"date":"2026-09-16"}'}:{}),...extra});
test("unauthenticated, expired or wrong-role requests stop before travel data access",async()=>{
  for(const method of ["GET","POST"]){const h=api({authorized:false});const r=await h[method](request(method));assert.equal(r.status,401);assert.equal(h.calls(),0);assert.match(r.headers.get("cache-control"),/private/);}
});
test("cross-site and missing origins cannot refresh",async()=>{
  for(const headers of [{},{origin:"https://evil.test"},{origin:"https://example.com","sec-fetch-site":"cross-site"}]){const h=api();assert.equal((await h.POST(request("POST",{headers}))).status,403);assert.equal(h.calls(),0);}
});
test("bounded refresh rejects oversize streams, invalid dates and query overrides",async()=>{
  for(const body of [JSON.stringify({date:"2026-09-16",padding:"x".repeat(2000)}),'{"date":"not-a-date"}','{"date":"2026-09-16","employeeId":"other"}','null','[]']){
    const h=api();assert.equal((await h.POST(request("POST",{body}))).status,400);assert.equal(h.calls(),0);
  }
  const h=api();const r=await h.GET(new Request("https://example.com/api/admin/stop-travel/?from=2026-09-20&through=2026-09-16"));assert.equal(r.status,400);assert.equal(h.calls(),0);
});
test("read and paid refresh fail closed when quotas are unavailable or exhausted",async()=>{
  for(const unavailable of [false,true])for(const method of ["GET","POST"]){const h=api({allowed:false,unavailable});assert.equal((await h[method](request(method))).status,unavailable?503:429);assert.equal(h.calls(),0);}
});
test("authorized range reads and same-origin date refreshes return private records",async()=>{
  const h=api();for(const method of ["GET","POST"]){const r=await h[method](request(method));assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);}assert.equal(h.calls(),2);
});
