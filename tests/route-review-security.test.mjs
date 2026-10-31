import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../app/api/admin/route-profitability/review/route.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function api({authorized=true,blocked=false,input={jobId:"123",action:"confirm",revenue:20,reason:"Invoice reviewed"}}={}){
  let writes=0;
  const handler=runPrivateInNewContext(`${source}\nPOST`,{Response,URL,verifyAdminRequest:async()=>({authorized,email:"admin"}),getDb:()=>({}),getRuntimeEnv:()=>({}),protectJsonRequest:async()=>blocked?{response:Response.json({},{status:429})}:{body:input},saveRouteDecision:async()=>{writes++;return {ok:true,date:"2026-09-01"};},refreshAirtableRouteProfitability:async()=>{},getRouteProfitabilityData:async()=>({})});
  return {handler,writes:()=>writes};
}
const req=(origin="https://example.com")=>new Request("https://example.com/api/admin/route-profitability/review/",{method:"POST",headers:{origin}});
test("route corrections require admin, same origin, bounded input and abuse checks",async()=>{
  for(const [settings,request,status] of [[{authorized:false},req(),401],[{},req("https://evil.test"),403],[{blocked:true},req(),429],[{input:{jobId:"../../other"}},req(),400]]){
    const a=api(settings);assert.equal((await a.handler(request)).status,status);assert.equal(a.writes(),0);
  }
});
test("authorized review stores a decision and refreshes private summaries",async()=>{
  const a=api();const result=await a.handler(req());assert.equal(result.status,200);assert.equal(a.writes(),1);assert.match(result.headers.get("Cache-Control"),/no-store/);
});
