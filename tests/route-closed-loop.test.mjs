import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import {readRouteInvoiceEvidence} from "../lib/route-invoice-archive.mjs";
import {allocateDatedRouteInvoices} from "../lib/route-invoice-allocation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {applyRouteSourceEvidence} from "../lib/route-source-evidence.mjs";
import {routeServiceValue} from "../lib/route-revenue.mjs";
import {buildRouteProfitabilityFacts,shiftRouteDate,uniqueRouteRecords} from "../lib/route-profitability.mjs";
import * as quality from "../lib/route-data-quality.mjs";
import {buildInvoiceRevenueFacts,summarizeInvoiceRevenue,readInvoiceRevenue} from "../lib/revenue-report.mjs";

const job=(id="1",type="custom",price=23.09)=>({fields:{"Job ID":id,Date:"2026-09-18","Customer Name":"Example",Status:"Completed","Service Type":type,"Revenue ($)":price}});
const evidence=(overrides={})=>({job_id:"1",date:"2026-09-18",customer:"Example",type:"custom",label:"Regular Plan Cleanup",plan:"2d-1xW",price:"23.09",...overrides});

test("custom recurring cleanup resolves from original job identity, date, label and plan",()=>{
 const records=applyRouteSourceEvidence({jobs:[job()]},[evidence()]);
 assert.equal(routeServiceValue(records.jobs[0].fields).category,"recurring");
 assert.equal(quality.routePriceIssues(records).length,0);
 for(const source of [evidence({job_id:"2"}),evidence({customer:"Other"}),evidence({date:"2026-09-17"})])assert.equal(routeServiceValue(applyRouteSourceEvidence({jobs:[job()]},[source]).jobs[0].fields).category,"other");
});
test("SNG recurring labels distinguish food and add-ons; an initial visit does not inherit MRR",()=>{
 for(const [label,plan,type,category] of [["Haul Away $21/mo","1xW","recurring","addon_recurring"],["Dog Food Delivery Green Bag","1xM","recurring","dog_food_recurring"],["Dog Food Delivery Green Bag","1xM","one_time","dog_food"],["Sanitization","1xM","one_time","addon"],["Regular Plan Cleanup","1d-1xW","initial","initial"]]){
  const records=applyRouteSourceEvidence({jobs:[job("1",type,30)]},[evidence({label,plan,type,price:30})]);
  assert.equal(routeServiceValue(records.jobs[0].fields).category,category);
 }
});
test("mixed invoices quantify all six combinations, exclude tips, and reconcile to pre-tax subtotal",()=>{
 const descriptions=["One Dog - Once a week (at $100 monthly)","Sanitization (at $30 monthly)","Dog Food Green Bag (at $59 monthly)","Initial Cleanup- 09/18/26","One Time Sanitization","One Time Job: Dog Food Delivery"];
 const amounts=[100,30,59,55,35,59];
 const invoice={source:"SNG",id:"1",date:"2026-09-18",type:"subscription",subtotal:348,lines:descriptions.map((description,i)=>({description,amount:amounts[i]})).concat({description:"Tip: $10",amount:10})};
 const total=summarizeInvoiceRevenue(buildInvoiceRevenueFacts([invoice,invoice]),"2026-09-01","2026-09-30");
 assert.deepEqual(total.matrix,{scooping:{subscription:100,one_time:0},initial:{subscription:0,one_time:55},addon:{subscription:30,one_time:35},dog_food:{subscription:59,one_time:59}});
 assert.equal(total.tips,10);assert.equal(total.invoices,1);assert.equal(total.subtotal,348);assert.equal(total.unclassified,0);
 const broken=buildInvoiceRevenueFacts([{...invoice,subtotal:400}])[0];assert.equal(broken.unclassified,400);assert.equal(broken.matrix.scooping.subscription,0);
});
test("mixed visit correction splits dollars without adding a visit or duplicating revenue",()=>{
 const issue=quality.routePriceIssues({jobs:[job("1","one_time",0)]})[0];
 const candidate=quality.invoiceProposal(issue,[{id:"1",customer:"Example",date:issue.date,lines:[{description:"Initial Cleanup- 09/18/26",amount:55},{description:"One Time Sanitization- 09/18/26",amount:35}]}]).proposal;
 const corrected=quality.applyRouteDecisions({jobs:[job("1","one_time",0)]},{1:{...issue,action:"confirm",revenue:90,category:candidate.category,components:candidate.components}});
 const fact=buildRouteProfitabilityFacts(corrected,{throughDate:"2026-09-19"})[0];
 assert.equal(fact.jobs,1);assert.equal(fact.revenue,90);assert.equal(fact.revenueMix.initial.revenue,55);assert.equal(fact.revenueMix.addon.revenue,35);
});
test("incomplete provider checks never become owner classification questions",async()=>{
 const source=fs.readFileSync(new URL("../lib/route-data-quality.js",import.meta.url),"utf8");
 const body=source.slice(source.indexOf("export async function readRouteReview"),source.indexOf("async function saveSnapshot")).replace("export ","");
 const read=runPrivateInNewContext(body+"\nreadRouteReview",quality);
 const db={prepare:()=>({bind:()=>({all:async()=>({results:[{snapshot_key:quality.REVIEW_KEY,payload:JSON.stringify({issues:[{jobId:"1",requiresClassification:true,evidencePending:true,ownerActionRequired:true}]})}]})})})};
 const review=await read(db);assert.equal(review.issues.length,0);assert.equal(review.deferredCount,1);
});
test("unique invoice evidence auto-closes, ambiguous duplicate visits do not, and writes survive re-run",async()=>{
 const source=fs.readFileSync(new URL("../lib/route-data-quality.js",import.meta.url),"utf8");
 const body=source.slice(source.indexOf("export async function reconcileRouteRecords"),source.indexOf("export async function saveRouteDecision")).replace("export ","");
 for(const variant of ["single","distinct","legacy"]){
  const duplicate=variant==="distinct";
  let decisions={version:0,byJob:{}},saved;
  const rows=[job("1","one_time",0)];if(duplicate)rows.push(job("2","one_time",0));
  if(variant==="legacy") rows.push(job("HIST-2026-09-18-example","one_time",0));
  const db={prepare:sql=>({bind:(...args)=>({all:async()=>({results:[{invoice_id:"invoice",client_name:"Example",invoice_date:"2026-09-17",subtotal:59,items:JSON.stringify([{description:"One Time Job: Dog Food Delivery Green Bag",amount:59}])}]}),run:async()=>{if(sql.startsWith("UPDATE")){decisions=JSON.parse(args[0]);return {meta:{changes:1}};}return {};}})})};
  const reconcile=runPrivateInNewContext(body+"\nreconcileRouteRecords",{...quality,readRouteInvoiceEvidence,readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,TextEncoder,shiftRouteDate,uniqueRouteRecords,console,readRouteReview:async()=>({issues:[],allIssues:[],decisions}),saveSnapshot:async(db,key,value)=>{saved=value;},getQuickBooksCleanupDataset:async()=>({rows:[]})});
  const result=await reconcile(db,{jobs:rows,customers:[{fields:{"Client Name":"Example"}}]},"2026-09-01","2026-09-22");
  assert.equal(result.jobs[0].fields["Revenue ($)"],duplicate?0:59);
  assert.equal(saved.issues[0].ownerActionRequired,duplicate);
  if(!duplicate){const again=await reconcile(db,{jobs:rows,customers:[{fields:{"Client Name":"Example"}}]},"2026-09-01","2026-09-22");assert.equal(again.jobs[0].fields["Revenue ($)"],59);assert.equal(Object.keys(decisions.byJob).length,1);}
 }
});


test("SNG is the only billing source for all products, including subscriptions and one-time food",async()=>{
 const queries=[];
 const db={prepare:sql=>{queries.push(sql);assert.match(sql,/sng_invoices/);return {bind:(...dates)=>({all:async()=>({results:[{invoice_id:"1",invoice_type:"subscription",invoice_date:dates[0],subtotal:118,items:JSON.stringify([{description:"Dog food at $59 monthly",amount:59},{description:"One time dog food",amount:59}])}]})}),first:async()=>({first_invoice:"2026-09-01",last_invoice:"2026-09-30"})};}};
 const report=await readInvoiceRevenue(db,"2026-09-01","2026-09-30");
 assert.deepEqual(report.sources,["Sweep & Go finalized invoices"]);
 assert.equal(queries.length,2);assert.deepEqual(report.facts[0].matrix.dog_food,{subscription:59,one_time:59});
});

test("owner-confirmed regular first visit and duplicate exclusion survive refresh without changing subscription MRR",()=>{
 const records={customers:[{fields:{"Client Name":"Example","MRR ($)":90,"Weighted Stop":1}}],jobs:[job("first","initial",0),job("real","recurring",20.79),job("duplicate","recurring",20.79)]};
 const decisions={first:{jobId:"first",date:"2026-09-18",customer:"Example",serviceType:"initial",recordedRevenue:0,action:"confirm",category:"recurring",revenue:20.79,reason:"Owner confirmed no initial cleanup; SNG regular visit rate."},duplicate:{jobId:"duplicate",date:"2026-09-18",customer:"Example",serviceType:"recurring",recordedRevenue:20.79,action:"exclude",reason:"Owner confirmed duplicate completion."}};
 for(let run=0;run<2;run++){
  const corrected=quality.applyRouteDecisions(records,decisions);
  const facts=buildRouteProfitabilityFacts(corrected,{throughDate:"2026-09-19"});
  assert.equal(facts[0].jobs,2);assert.equal(facts[0].revenue,41.58);assert.equal(facts[0].revenueMix.initial.revenue,0);
  assert.equal(corrected.customers[0].fields["MRR ($)"],90);
 }
 const changed={...records,jobs:[job("first","initial",55)]};
 assert.equal(quality.applyRouteDecisions(changed,decisions).jobs[0].fields["Revenue ($)"],55);
});

test("rechecking invoice allocation removes obsolete automatic results while preserving concurrent owner corrections",async()=>{
 const source=fs.readFileSync(new URL("../lib/route-data-quality.js",import.meta.url),"utf8");
 const body=source.slice(source.indexOf("async function saveAutomaticRouteDecisions"),source.indexOf("export async function saveRouteDecision"));
 const obsolete={jobId:"1",date:"2026-02-28",customer:"Example",recordedRevenue:0,revenue:35,action:"confirm",category:"addon",automatic:true,reviewer:"Automatic invoice allocation"};
 for(const owner of [false,true]){
  let current={version:1,byJob:{1:owner?{...obsolete,automatic:false,reviewer:"Owner",revenue:40}:obsolete}};
  const db={prepare:sql=>({bind:(...args)=>({run:async()=>{if(sql.startsWith("UPDATE")){current=JSON.parse(args[0]);return {meta:{changes:1}};}return {};}})})};
  const save=runPrivateInNewContext(body+"\nsaveAutomaticRouteDecisions",{...quality,TextEncoder,readRouteReview:async()=>({decisions:current})});
  const result=await save(db,[],[obsolete]);
  assert.equal(result['1']?.revenue,owner?40:undefined);
 }
});
