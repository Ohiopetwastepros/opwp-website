import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildRouteProfitabilityFacts, summarizeRouteProfit } from "../lib/route-profitability.mjs";
import { applyQuickBooksRouteCosts } from "../lib/quickbooks-route-costs.mjs";
import { routeRevenueCategory, subscriptionAsOf, summarizeRevenueMix, validRevenueCategory } from "../lib/route-revenue.mjs";
import { applyRouteDecisions } from "../lib/route-data-quality.mjs";
import { classifyChurnEligibility } from "../lib/churn-eligibility.js";
const job=(id,type,revenue)=>({fields:{"Job ID":id,"Customer Name":"Example",Date:"2026-09-15",Status:"Completed","Tech Name":staffPrivate.primaryName,"Service Type":type,"Revenue ($)":revenue}});

test("initial and one-time charges count on the service day and hourly totals without becoming recurring revenue",()=>{
  const records={jobs:[job("r","recurring",25),job("i","initial",150),job("o","one_time",100),job("f","dog_food",59)],time:[{fields:{"Record ID":"shift",Date:"2026-09-15","Tech Name":staffPrivate.primaryName,"Minutes Clocked":120}}]};
  const facts=buildRouteProfitabilityFacts(records,{throughDate:"2026-09-19"});
  const daily=applyQuickBooksRouteCosts(facts,null);
  const summary=summarizeRouteProfit(daily);
  assert.equal(summary.revenue,334);assert.equal(summary.revenuePerHour,167);
  assert.equal(summary.revenueMix.recurring.revenue,25);
  assert.equal(summary.revenueMix.initial.revenue,150);
  assert.equal(summary.revenueMix.one_time.revenue,100);
  assert.equal(summary.revenueMix.dog_food.revenue,59);
  assert.equal(Object.values(summary.revenueMix).reduce((sum,b)=>sum+b.revenue,0),summary.revenue);
  assert.equal(Object.values(summary.revenueMix).reduce((sum,b)=>sum+b.jobs,0),summary.jobs);
});
test("legacy cadence labels are recurring but unknown and old cached facts remain unclassified",()=>{
  for(const type of ["1d-1xW","2d-bW","3d-2xW","1d-1xM","Monthly","1xW","2xM","bW"])assert.equal(routeRevenueCategory({"Service Type":type}),"recurring");
  assert.equal(routeRevenueCategory({"Service Type":"Unrecognized"}),"other");
  assert.equal(summarizeRevenueMix([{jobs:3,revenue:60}]).other.revenue,60);
  assert.equal(validRevenueCategory("__proto__"),false);
});
test("MRR is a point-in-time subscription snapshot, never a sum of visits or a future snapshot",()=>{
  const snapshots=[{snapshot_date:"2026-09-15",total_mrr:900},{snapshot_date:"2026-09-18",total_mrr:1000}];
  assert.equal(subscriptionAsOf(snapshots,"2026-09-16").total_mrr,900);
  assert.equal(subscriptionAsOf(snapshots,"2026-09-14"),null);
});
test("reviewed invoice evidence classifies legacy food deliveries and initial cleanups without changing amounts",()=>{
  for(const [description,amount,expected] of [["Extreme Dog Fuel Green Bag",59,"dog_food"],["Initial Cleanup- 09/15/26",90,"initial"]]){
    const source=job("x","one_time",0);
    const records=applyRouteDecisions({jobs:[source]},{x:{date:"2026-09-15",customer:"Example",recordedRevenue:0,action:"confirm",revenue:amount,evidence:[{customer:"Example",date:"2026-09-14",id:"invoice",lines:[{description,amount}]}]}});
    const facts=buildRouteProfitabilityFacts(records,{throughDate:"2026-09-19"});
    assert.equal(facts[0].revenueMix[expected].revenue,amount);
    assert.equal(facts[0].revenueMix.one_time.revenue,0);
  }
});
test("a standalone cleanup cannot become customer churn even when a generic plan prefix and payment evidence exist",()=>{
  const source=fs.readFileSync(new URL("../lib/airtable.js",import.meta.url),"utf8");
  const functionText=source.slice(source.indexOf("export function classifySngSubscriptionPlan"),source.indexOf("export async function updateSngCustomerLifecycle")).replace("export ","");
  const classify=runPrivateInNewContext(`${functionText}\nclassifySngSubscriptionPlan`);
  for(const plan of ["Regular Plan - One Time","Initial Cleanup","Single cleanup","one_time"]){
    assert.equal(classifyChurnEligibility({businessLine:classify(plan),completedServiceBefore:true,paidInvoiceBefore:true}).isChurn,false);
  }
  assert.equal(classifyChurnEligibility({businessLine:classify("1d-1xW"),paidInvoiceBefore:true}).isChurn,true);
});
test("revenue category input is checked on the server before a review writes",async()=>{
  const source=fs.readFileSync(new URL("../lib/route-data-quality.js",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("export async function saveRouteDecision")).replace("export ","");
  const save=runPrivateInNewContext(`${body}\nsaveRouteDecision`,{validRevenueCategory,readRouteReview:async()=>({issues:[{jobId:"123"}],decisions:{version:0,byJob:{}}})});
  const result=await save({}, {jobId:"123",action:"confirm",revenue:25,category:"invalid",reason:"test"},"admin");
  assert.equal(result.status,400);
});
