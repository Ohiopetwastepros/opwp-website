import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../lib/route-subscriptions.mjs",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
const now=new Date("2026-09-24T02:00:00Z");
function setup(fetch,prior=null){const writes=[];const db={prepare:()=>({bind:(...args)=>({first:async()=>prior,run:async()=>writes.push(args)})})};return {writes,db,refresh:runPrivateInNewContext(source+"\nrefreshRouteSubscriptions",{fetchSngBillingCollection:fetch,TextEncoder,Date})};}
test("subscription capture omits contact information and caches complete provider results",async()=>{
 const s=setup(async()=>[{id:1,status:"active",price:100,category:"prepaid",email:"private@example.com",address:"private",service_plan:"1d-1xW"}]);
 await s.refresh(s.db,{SNG_API_KEY:"test"},now);
 assert.equal(s.writes.length,2);const saved=JSON.parse(s.writes[0][1]);assert.equal(saved.rows[0].price,100);assert.equal(saved.rows[0].email,undefined);assert.equal(saved.rows[0].address,undefined);
});
test("provider errors preserve prior subscription capture; recent captures and missing configuration make no requests",async()=>{
 let calls=0;const fetch=async()=>{calls++;throw Error("Incomplete result");};
 const s=setup(fetch);await assert.rejects(s.refresh(s.db,{SNG_API_KEY:"test"},now));assert.equal(s.writes.length,0);
 await s.refresh(s.db,{},now);const cached=setup(fetch,{captured_at:"2026-09-24T01:30:00Z",payload:JSON.stringify({capturedAt:"2026-09-24T01:30:00Z",rows:[]})});await cached.refresh(cached.db,{SNG_API_KEY:"test"},now);assert.equal(calls,1);
});

const summarize=runPrivateInNewContext(source+"\nsubscriptionCaptureSummary",{Date,Intl});
test("MRR uses the local capture date and excludes paused, future and canceled plans",()=>{
 const base={status:"active",category:"prepaid",price:100,billing_interval:"monthly",start_date:"2026-01-01"};
 const result=summarize([base,{...base,status:"paused",price:25},{...base,status:"canceled"},{...base,start_date:"2026-09-24"},{...base,end_date:"2026-09-23"}],now.toISOString());
 assert.equal(result.snapshot_date,"2026-09-23");assert.equal(result.total_mrr,100);assert.equal(result.paused_mrr,25);assert.equal(result.active_plans,1);assert.equal(result.verified,true);
});
test("unsupported billing terms withhold MRR instead of presenting a partial total",()=>{
 for(const override of [{category:"postpaid"},{price:null},{price:"not a price"},{price:-1},{coupon_total:10},{billing_interval:"daily"},{status:"unknown"}]){
 const result=summarize([{status:"active",category:"prepaid",price:100,billing_interval:"monthly",...override}],now.toISOString());assert.equal(result.verified,false);assert.equal(result.total_mrr,null);
 }
});
