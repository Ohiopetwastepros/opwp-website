import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import {readRouteInvoiceEvidence} from "../lib/route-invoice-archive.mjs";
import {allocateDatedRouteInvoices} from "../lib/route-invoice-allocation.mjs";
﻿import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as quality from "../lib/route-data-quality.mjs";
import {shiftRouteDate,uniqueRouteRecords} from "../lib/route-profitability-calculations.mjs";
const text=fs.readFileSync(new URL("../lib/route-data-quality.js",import.meta.url),"utf8");
const body=text.slice(text.indexOf("export async function reconcileRouteRecords"),text.indexOf("export async function saveRouteDecision")).replace("export ","");
test("large backlogs do not block history and invoice requests use a bounded focused period",async()=>{
  let saved,range,queryNames;
  const records={jobs:Array.from({length:600},(_,i)=>({fields:{"Job ID":String(i+1),Date:"2026-09-15","Customer Name":`Client ${i}`,Status:"Completed","Service Type":"one_time","Revenue ($)":0}}))};
  const context={...quality,readRouteInvoiceEvidence,readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,shiftRouteDate,uniqueRouteRecords,console,readRouteReview:async()=>({issues:[],decisions:{byJob:{}}}),getQuickBooksCleanupDataset:async args=>{range=args;return {rows:[]};},saveSnapshot:async(db,key,value)=>{saved=value;}};
  const reconcile=runPrivateInNewContext(`${body}\nreconcileRouteRecords`,context);
  const db={prepare:()=>({bind:(...names)=>{queryNames=names;return {all:async()=>({results:[]})};}})};
  const result=await reconcile(db,records,"2025-09-01","2026-09-19");
  assert.equal(result.jobs.length,600);assert.equal(saved.issues.length,600);assert.equal(queryNames.length,40);
  assert.equal(saved.issues.filter(issue=>issue.quickBooksChecked).length,40);
  assert.equal(saved.issues.filter(issue=>issue.evidencePending).length,560);
  assert.equal(range.start,"2026-08-15");assert.equal(range.end,"2026-09-19");
});

test("a new current-period issue is checked without waiting behind historical backlog",async()=>{
  let saved;
  const old=Array.from({length:100},(_,i)=>({jobId:String(i),date:"2026-01-01",customer:`Old ${i}`,serviceType:"initial",recordedRevenue:0}));
  const records={jobs:[{fields:{"Job ID":"new",Date:"2026-09-18","Customer Name":"Recent",Status:"Completed","Service Type":"initial","Revenue ($)":0}}]};
  const context={...quality,readRouteInvoiceEvidence,readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,shiftRouteDate,uniqueRouteRecords,console,readRouteReview:async()=>({allIssues:old,issues:[],decisions:{byJob:{}}}),getQuickBooksCleanupDataset:async()=>({rows:[]}),saveSnapshot:async(db,key,value)=>{saved=value;}};
  const reconcile=runPrivateInNewContext(`${body}\nreconcileRouteRecords`,context);
  const db={prepare:()=>({bind:()=>({all:async()=>({results:[]})})})};
  await reconcile(db,records,"2026-09-01","2026-09-22");
  assert.equal(saved.issues.find(row=>row.jobId==="new").quickBooksChecked,true);
  assert.equal(saved.issues.filter(row=>row.quickBooksChecked).length,40);
});


test("short refresh preserves a prior unique initial allocation outside full uniqueness coverage",async()=>{
 const d={jobId:"boundary",date:"2026-09-02",customer:"Boundary",serviceType:"initial",recordedRevenue:0,action:"confirm",revenue:75,category:"initial",automatic:true,reviewer:"Automatic invoice allocation",reason:"Unique initial-cleanup SNG invoice 1",evidence:[{id:"1",date:"2026-09-01"}]};
 const records={jobs:[{fields:{"Job ID":"boundary",Date:d.date,"Customer Name":d.customer,Status:"Completed","Service Type":"initial","Revenue ($)":0}}]};
 const context={...quality,readRouteInvoiceEvidence,readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,shiftRouteDate,uniqueRouteRecords,console,readRouteReview:async()=>({issues:[],decisions:{byJob:{boundary:d}}}),getQuickBooksCleanupDataset:async()=>({rows:[]}),saveSnapshot:async()=>{}};
 const reconcile=runPrivateInNewContext(`${body}\nreconcileRouteRecords`,context);
 const db={prepare:()=>{throw Error("Existing decision must not be removed without sufficient coverage");}};
 const result=await reconcile(db,records,"2026-09-01","2026-09-22");
 assert.equal(result.jobs[0].fields["Revenue ($)"],75); assert.equal(result.jobs[0].fields["Route Revenue Verified"],true);
});

test("a source-checked ambiguous proposal stays in the owner queue outside the next provider batch",async()=>{
 let saved;const old=Array.from({length:41},(_,i)=>({jobId:String(i).padStart(3,'0'),date:"2026-01-02",customer:`Past ${i}`,serviceType:"initial",recordedRevenue:0,sourcesComplete:true,quickBooksChecked:true,evidenceCheckedAt:"2026-09-22",proposal:{amount:75,category:"initial"},ownerActionRequired:true}));
 const context={...quality,readRouteInvoiceEvidence,readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,shiftRouteDate,uniqueRouteRecords,console,readRouteReview:async()=>({issues:old,decisions:{byJob:{}}}),getQuickBooksCleanupDataset:async()=>({rows:[]}),saveSnapshot:async(db,key,value)=>{saved=value;}};
 const reconcile=runPrivateInNewContext(`${body}\nreconcileRouteRecords`,context);
 const db={prepare:()=>({bind:()=>({all:async()=>({results:[]})})})};
 await reconcile(db,{jobs:[]},"2026-09-01","2026-09-22");
 const deferred=saved.issues.find(i=>i.jobId==='040');assert.equal(deferred.proposal.amount,75);assert.equal(deferred.ownerActionRequired,true);assert.equal(deferred.evidencePending,false);
});

test("the owner can review a checked ambiguous proposal even from an older cached queue",async()=>{
 const source=text.slice(text.indexOf('export async function readRouteReview'),text.indexOf('async function saveSnapshot')).replace('export ','');
 const read=runPrivateInNewContext(source+'\nreadRouteReview',{...quality});
 const issues=[{jobId:'checked',sourcesComplete:true,ownerActionRequired:false,evidencePending:false,proposal:{amount:75}},{jobId:'pending',sourcesComplete:false,evidencePending:true}];
 const db={prepare:()=>({bind:()=>({all:async()=>({results:[{snapshot_key:quality.REVIEW_KEY,payload:JSON.stringify({issues})}]})})})};
 const review=await read(db);assert.equal(review.issues.length,1);assert.equal(review.issues[0].jobId,'checked');assert.equal(review.deferredCount,1);
});

test("failed provider rechecks preserve completed owner questions and their evidence",async()=>{
 let saved;
 const issue={jobId:'retry',clientId:'',date:'2026-03-03',customer:'Example',serviceType:'initial',category:'initial',recordedRevenue:0,sourcesComplete:true,quickBooksChecked:true,evidenceCheckedAt:'2026-09-23T00:00:00Z',evidence:[{source:'QuickBooks',id:'qb1',customer:'Example',date:'2026-03-01',lines:[]}],ownerActionRequired:true};
 const records={jobs:[{fields:{'Job ID':'retry',Date:issue.date,'Customer Name':issue.customer,Status:'Completed','Service Type':'initial','Revenue ($)':0}}]};
 const context={...quality,readRouteInvoiceEvidence:async()=>({complete:true,invoices:[]}),readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,shiftRouteDate,uniqueRouteRecords,console:{error(){}},readRouteReview:async()=>({issues:[issue],decisions:{byJob:{}}}),getQuickBooksCleanupDataset:async()=>{throw Error('Unavailable');},saveSnapshot:async(db,key,value)=>{saved=value;}};
 const reconcile=runPrivateInNewContext(`${body}\nreconcileRouteRecords`,context);
 await reconcile({},records,'2026-03-01','2026-03-31');
 const result=saved.issues[0];assert.equal(result.sourcesComplete,true);assert.equal(result.ownerActionRequired,true);assert.equal(result.evidencePending,false);assert.equal(result.evidenceRefreshPending,true);assert.equal(result.evidenceCheckedAt,issue.evidenceCheckedAt);assert.ok(result.evidenceAttemptedAt);assert.equal(result.evidence[0].id,'qb1');
 // A changed source record must undergo its own checks.
 records.jobs[0].fields['Revenue ($)']=-1;
 await reconcile({},records,'2026-03-01','2026-03-31');
 assert.equal(saved.issues[0].sourcesComplete,false);assert.equal(saved.issues[0].evidencePending,true);assert.equal(saved.issues[0].evidence.length,0);
});

test("failed checks advance through the backlog instead of retrying the same forty forever",async()=>{
 let saved;
 const issues=Array.from({length:45},(_,i)=>({jobId:String(i),date:'2026-03-03',customer:`Client ${i}`,serviceType:'initial',recordedRevenue:0,evidencePending:true}));
 const context={...quality,readRouteInvoiceEvidence:async()=>({complete:true,invoices:[]}),readDatedRouteInvoices:async()=>[],allocateDatedRouteInvoices,shiftRouteDate,uniqueRouteRecords,console:{error(){}},readRouteReview:async()=>({issues:saved?.issues||issues,decisions:{byJob:{}}}),getQuickBooksCleanupDataset:async()=>{throw Error('Unavailable');},saveSnapshot:async(db,key,value)=>{saved=value;}};
 const reconcile=runPrivateInNewContext(`${body}\nreconcileRouteRecords`,context);
 await reconcile({},{jobs:[]},'2026-09-01','2026-09-29');
 assert.equal(saved.issues.filter(i=>i.evidenceAttemptedAt).length,40);
 await reconcile({},{jobs:[]},'2026-09-01','2026-09-29');
 assert.equal(saved.issues.filter(i=>i.evidenceAttemptedAt).length,45);
});
