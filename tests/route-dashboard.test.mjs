import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ROUTE_DAYS, validRouteDate, routeDay, uniqueRouteRecords, buildRouteProfitabilityFacts, selectRouteWindow, summarizeRouteProfit } from '../lib/route-profitability.mjs';
import { ROUTE_REVENUE_CATEGORIES, routeRevenueCategory, routeServiceValue } from '../lib/route-revenue.mjs';
import { applyQuickBooksRouteCosts } from '../lib/quickbooks-route-costs.mjs';
import { applyRouteDecisions, routePriceIssues, reviewResolved, validRevenueCategory } from '../lib/route-data-quality.mjs';
const job=(id,date,type,price)=>({id,fields:{'Job ID':id,Date:date,'Customer Name':'Example','Tech Name':staffPrivate.primaryName,Status:'Completed','Service Type':type,'Revenue ($)':price}});

test('August 3–7 revenue remains available without hours and date/weekday windows are inclusive',()=>{
 const jobs=[job('before','2026-08-02','recurring',500),...Array.from({length:5},(_,i)=>job(String(i),`2026-08-0${i+3}`,'recurring',20+i)),job('after','2026-08-08','recurring',500)];
 const rows=applyQuickBooksRouteCosts(buildRouteProfitabilityFacts({jobs},{throughDate:'2026-08-10'}),null);
 const selected=selectRouteWindow(rows,'2026-08-03','2026-08-07');
 assert.equal(summarizeRouteProfit(selected).revenue,110);
 assert.equal(summarizeRouteProfit(selected).revenuePerHour,null);
 assert.deepEqual(ROUTE_DAYS.slice(0,5).map(day=>summarizeRouteProfit(selectRouteWindow(rows,'2026-08-03','2026-08-07',day)).revenue),[20,21,22,23,24]);
 assert.equal(selectRouteWindow(rows,'2026-08-03','2026-08-07','Friday').length,1);
 assert.equal(selectRouteWindow(rows,'2026-08-10','2026-08-14').length,0);
});

test('custom labels require classification even with a valid price; add-ons are separate',()=>{
 assert.equal(routeRevenueCategory({'Service Type':'sanitization'}),'addon');
 for(const price of [0,35]) {
  const record=job('1','2026-08-03','custom',price),issue=routePriceIssues({jobs:[record]})[0];
  assert.equal(issue.requiresClassification,true);
  assert.match(routeServiceValue(record.fields).classificationReason,/does not identify/);
  assert.equal(reviewResolved(issue,{...issue,action:'confirm',revenue:price}),false);
  const decision={...issue,action:'confirm',revenue:price,category:'addon',reason:'Verified dated sanitization invoice'};
  assert.equal(reviewResolved(issue,decision),true);
  const updated=applyRouteDecisions({jobs:[record]},{1:decision});
  assert.equal(routeServiceValue(updated.jobs[0].fields).category,'addon');
  assert.equal(routeServiceValue(updated.jobs[0].fields).classificationReason,decision.reason);
  const changed=job('1','2026-08-03','one_time',price);
  assert.equal(applyRouteDecisions({jobs:[changed]},{1:decision}).jobs[0].fields['Route Revenue Verified'],undefined);
 }
});

test('detail records reconcile with summaries after corrections, exclusions, estimates, deduplication and weekday filtering',async()=>{
 const jobs=[job('1','2026-08-03','custom',35),job('2','2026-08-03','recurring',0),job('3','2026-08-03','one_time',40),job('4','2026-08-04','recurring',25)];
 jobs.push({...jobs[1],fields:{...jobs[1].fields,'Job ID':'2.0'}});
 const customers=[{fields:{'Client Name':'Example','MRR ($)':104,'Weighted Stop':1}}];
 const byJob={1:{date:'2026-08-03',customer:'Example',recordedRevenue:35,serviceType:'custom',action:'confirm',revenue:45,category:'addon',reason:'Dated invoice'},3:{date:'2026-08-03',customer:'Example',recordedRevenue:40,action:'exclude'}};
 const source=fs.readFileSync(new URL('../lib/airtable.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export async function getRouteRevenueDetail'),source.indexOf('export async function refreshAirtableRouteProfitability')).replace('export ','');
 const get=runPrivateInNewContext(body+'\ngetRouteRevenueDetail',{validRouteDate,uniqueRouteRecords,routeDay,routeServiceValue,applyRouteDecisions,normalizedText:v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''),AIRTABLE_BASES:{opwp:{id:'base'}},TABLES:{opwp:{jobs:'jobs',customers:'customers'}},enrichRouteSourceEvidence:async(db,records)=>records,readRouteReview:async()=>({decisions:{byJob},issues:[]}),listRecords:async(base,table)=>table==='jobs'?jobs:customers});
 const records=await get({from:'2026-08-03',through:'2026-08-07',weekday:'Monday'},{DB:{},AIRTABLE_API_KEY:'fixture'});
 const facts=buildRouteProfitabilityFacts(applyRouteDecisions({jobs,customers},byJob),{throughDate:'2026-08-07'});
 const total=summarizeRouteProfit(selectRouteWindow(applyQuickBooksRouteCosts(facts,null),'2026-08-03','2026-08-07','Monday'));
 assert.equal(records.length,2);assert.equal(records.reduce((sum,r)=>sum+r.revenue,0),total.revenue);
 assert.equal(records.find(r=>r.id==='1').category,'addon');assert.equal(records.find(r=>r.id==='2').estimated,false);assert.equal(records.find(r=>r.id==='2').revenue,0);
 const addons=await get({from:'2026-08-03',through:'2026-08-07',weekday:'Monday',category:'addon'},{DB:{},AIRTABLE_API_KEY:'fixture'});
 assert.equal(addons.length,1);assert.equal(addons[0].revenue,total.revenueMix.addon.revenue);
 const otherTech=await get({from:'2026-08-03',through:'2026-08-07',technician:"Cody Example"},{DB:{},AIRTABLE_API_KEY:'fixture'});
 assert.equal(otherTech.length,0);
 const tony=await get({from:'2026-08-03',through:'2026-08-07',weekday:'Monday',technician:staffPrivate.primaryName},{DB:{},AIRTABLE_API_KEY:'fixture'});
 assert.equal(tony.reduce((sum,row)=>sum+row.revenue,0),total.revenue);
});

const apiSource=fs.readFileSync(new URL('../app/api/admin/route-profitability/revenue-details/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function api({authorized=true,allowed=true}={}) {
 let calls=0,args;
 const GET=runPrivateInNewContext(apiSource+'\nGET',{Response,URL,console,ROUTE_DAYS,validRouteDate,ROUTE_REVENUE_CATEGORIES,verifyAdminRequest:async()=>({authorized,email:'admin'}),checkRateLimit:async()=>({allowed}),rateLimitResponse:()=>Response.json({},{status:429}),getRouteRevenueDetail:async input=>{calls++;args=input;return [];}});
 return {GET,calls:()=>calls,args:()=>args};
}
const req=query=>new Request('https://example.test/api/admin/route-profitability/revenue-details/?'+query);

test('technician detail filter is bounded and passed only after admin authorization',async()=>{
 for(const value of ['x'.repeat(101),'Cody\u0000Sobczak']) {
  const a=api(); assert.equal((await a.GET(req('from=2026-03-02&through=2026-03-06&technician='+encodeURIComponent(value)))).status,400); assert.equal(a.calls(),0);
 }
 const a=api(); assert.equal((await a.GET(req("from=2026-03-02&through=2026-03-06&technician=Cody%20Example"))).status,200); assert.equal(a.args().technician,"Cody Example");
});
test('revenue details require admin and abuse controls; invalid dates, categories, weekdays and oversized ranges fail before provider access',async()=>{
 for(const [options,query,status] of [[{authorized:false},'from=2026-08-03&through=2026-08-07',401],[{allowed:false},'from=2026-08-03&through=2026-08-07',429],[{},'from=2026-02-30&through=2026-03-05',400],[{},'from=2026-08-07&through=2026-08-03',400],[{},'from=2024-08-03&through=2026-08-07',400],[{},'from=2026-08-03&through=2026-08-07&category=__proto__',400],[{},'from=2026-08-03&through=2026-08-07&weekday=invalid',400]]) {
  const a=api(options);assert.equal((await a.GET(req(query))).status,status);assert.equal(a.calls(),0);
 }
 const a=api();const response=await a.GET(req('from=2026-08-03&through=2026-08-07&weekday=Monday&category=addon'));
 assert.equal(response.status,200);assert.equal(a.args().weekday,'Monday');assert.match(response.headers.get('Cache-Control'),/no-store, private/);
});

test('server cannot close unknown category review without a concrete classification',async()=>{
 const source=fs.readFileSync(new URL('../lib/route-data-quality.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export async function saveRouteDecision')).replace('export ','');
 const save=runPrivateInNewContext(body+'\nsaveRouteDecision',{validRevenueCategory,readRouteReview:async()=>({issues:[{jobId:'1',requiresClassification:true}],decisions:{version:0,byJob:{}}})});
 for(const category of ['', 'other'])assert.equal((await save({}, {jobId:'1',action:'confirm',revenue:25,category,reason:'Verified invoice'},'admin')).status,400);
});

test('non-finite provider prices and subscription values cannot enter financial totals',()=>{
 for(const value of [Infinity,-Infinity,NaN,'Infinity']) {
  const fields={'Service Type':'recurring','Revenue ($)':value};
  assert.equal(routeServiceValue(fields).revenue,0);
  assert.equal(routeServiceValue(fields,{fields:{'MRR ($)':value,'Weighted Stop':1}}).revenue,0);
 }
});
