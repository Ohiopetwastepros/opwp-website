import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readBoundedProviderJson } from "../lib/bounded-body.mjs";
import { validDispatchDate } from "../lib/daily-route-optimizer.mjs";

const source = fs.readFileSync(new URL("../app/api/admin/route-partner/route.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function api({ authorized=true, limited=false, lease=true, accountCount=1, latestId="plan-a" }={}) {
  const calls=[];
  const db={prepare(sql){return {bind(...args){return {
    async first(){calls.push(sql);if(sql.includes("api_rate_limits"))return {request_count:accountCount};return lease?{snapshot_key:args[0]}:null;},
    async run(){calls.push(sql);return {};},
  };}};}};
  const context={Response,URL,crypto,console:{log(){},error(){}},readBoundedProviderJson,validDispatchDate,
    verifyAdminRequest:async()=>({authorized,email:"owner"}),getDb:()=>db,
    checkRateLimit:async()=>({allowed:!limited}),rateLimitResponse:()=>Response.json({},{status:429}),
    sngRequest:async()=>{calls.push("provider");return {configured:true,ok:true,data:[]};},sngRows:r=>r.data,
    importRoutePartnerDay:async()=>{calls.push("import");return {createdCount:1,planIds:[latestId]};},
    getRoutePartnerDay:async()=>{calls.push("read");return {plans:[{id:latestId}]};},
    finalizeRoutePartnerPlan:async()=>{calls.push("finalize");return {};},prepareFieldRelease:async()=>{calls.push("release");return {};},
  };
  return {...runPrivateInNewContext(`${source}\n({GET,POST})`,context),calls};
}
function request(body={action:"import",date:"2026-10-06"},headers={origin:"https://example.com"}) {
  return new Request("https://example.com/api/admin/route-partner/",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
}
test("unauthenticated, expired-session and wrong-role dispatch requests cannot access data",async()=>{
  for(const method of ["GET","POST"]){const h=api({authorized:false});const r=await h[method](method==="POST"?request():new Request("https://example.com/api/admin/route-partner/?date=2026-10-06"));assert.equal(r.status,401);assert.equal(h.calls.length,0);assert.match(r.headers.get("cache-control"),/private/);}
});
test("missing origin and cross-site dispatch mutations are blocked",async()=>{
  for(const headers of [{},{origin:"https://evil.test"},{origin:"https://example.com","sec-fetch-site":"cross-site"}]){const h=api();assert.equal((await h.POST(request(undefined,headers))).status,403);assert.equal(h.calls.length,0);}
});
test("bounds, impossible dates, injected organization/coordinates and prototype actions fail before access",async()=>{
  for(const body of [null,[],{action:"toString",date:"2026-10-06"},{action:"import",date:"2026-02-30"},{action:"import",date:"2026-10-06",organizationId:"other"},{action:"import",date:"2026-10-06",points:[]},{action:"import",date:"x".repeat(3000)}]){const h=api();assert.equal((await h.POST(request(body))).status,400);assert.equal(h.calls.length,0);}
});
test("IP quota, per-account quota and date lease prevent expensive duplicate work",async()=>{
  for(const [options,status] of [[{limited:true},429],[{accountCount:9},429],[{lease:false},409]]){const h=api(options);assert.equal((await h.POST(request())).status,status);assert.ok(!h.calls.includes("provider"));assert.ok(!h.calls.includes("import"));}
});
test("authorized imports return private data and release only their own lease",async()=>{
  const h=api();const r=await h.POST(request());assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);assert.ok(h.calls.includes("import"));assert.match(h.calls.at(-1),/snapshot_key=\? AND payload=\?/);
});
test("stale, cross-date or foreign plan identifiers cannot reach field release",async()=>{
  const h=api();const r=await h.POST(request({action:"finalize",date:"2026-10-06",planId:"foreign-plan"}));assert.equal(r.status,409);assert.ok(!h.calls.includes("release"));assert.ok(!h.calls.includes("finalize"));
});
