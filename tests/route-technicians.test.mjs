import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as facts from "../lib/route-profitability.mjs";
import { applyTechnicianRouteCosts, combineTechnicianDays, COST_GROUPS } from "../lib/quickbooks-route-costs.mjs";
import { technicianStatus } from "../lib/route-technicians.mjs";
import { ROUTE_REVENUE_VERSION } from "../lib/route-revenue.mjs";
import { applyRouteDecisions } from "../lib/route-data-quality.mjs";

const job = (id, name, date, revenue) => ({ fields: { "Job ID": id, "Tech Name": name, Date: date, Status: "Completed", "Service Type": "recurring", "Source Price Confirmed": true, "Revenue ($)": revenue } });
const shift = (id, name, date, minutes) => ({ fields: { "Record ID": id, "Tech Name": name, Date: date, "Minutes Clocked": minutes } });
const coverage = { coveredFrom: "2026-03-01", coveredThrough: "2026-03-31" };
const costs = { months: [{ month: "2026-03", start: coverage.coveredFrom, end: coverage.coveredThrough, reconciled: true, totalCosts: 300, groups: Object.fromEntries(COST_GROUPS.map((name, i) => [name, i ? 0 : 300])) }] };
function example(time = [shift("1", "Cody Example", "2026-03-02", 120), shift("2", staffPrivate.inactiveNames[0], "2026-03-02", 180), shift("3", staffPrivate.inactiveNames[0], "2026-03-03", 60)]) {
  return facts.buildRouteProfitabilityFacts({ jobs: [job("1", "Cody Example", "2026-03-02", 400), job("2", staffPrivate.inactiveNames[0], "2026-03-02", 300), job("3", staffPrivate.inactiveNames[0], "2026-03-03", 200)], time }, { throughDate: coverage.coveredThrough });
}

test("historical technician revenue, hours and allocated costs follow each recorded assignment", () => {
  const rows = applyTechnicianRouteCosts(example(), costs, coverage);
  const cody = rows.find(row => row.name === "Cody Example");
  assert.equal(cody.hours, 2); assert.equal(cody.revenue, 400); assert.equal(cody.revenuePerHour, 200);
  assert.equal(cody.totalCost, 100); assert.equal(cody.profit, 300);
  const bria = facts.summarizeRouteProfit(rows.filter(row => row.name === staffPrivate.inactiveNames[0]));
  assert.equal(bria.hours, 4); assert.equal(bria.revenue, 500); assert.equal(bria.revenuePerHour, 125);
  assert.equal(bria.totalCost, 200); assert.equal(bria.profit, 300);
  const all = facts.summarizeRouteProfit(combineTechnicianDays(rows));
  assert.equal(all.routeDays, 2); assert.equal(all.averageRevenue, 450);
  assert.equal(all.totalCost, 300); assert.equal(all.revenuePerHour, 150);
  assert.equal(facts.summarizeRouteProfit(facts.selectRouteWindow(rows,"2026-03-02","2026-03-02","Monday").filter(row=>row.name===staffPrivate.inactiveNames[0])).totalCost,100);
});

test("another technician's hours cannot fill missing shift coverage", () => {
  const rows = applyTechnicianRouteCosts(example([shift("1", "Cody Example", "2026-03-02", 120)]), costs, coverage);
  assert.equal(rows.find(row => row.name === "Cody Example").revenuePerHour, 200);
  assert.equal(facts.summarizeRouteProfit(combineTechnicianDays(rows)).revenuePerHour, null);
  assert.equal(combineTechnicianDays(rows)[0].revenuePerHour, null);
});

test("legacy SHIFT prefixes do not double count the same payroll shift", () => {
  const rows = example([shift("SHIFT-123", "Cody Example", "2026-03-02", 120), shift("123", "Cody Example", "2026-03-02", 120)]);
  const cody = rows.find(row => row.name === "Cody Example");
  assert.equal(cody.minutes, 120); assert.equal(cody.shifts, 1);
});

test("original SNG jobs replace legacy customer-day imports and their stale assignments", () => {
  const record = (id, name, amount, customer = "Example") => ({ ...job(id, name, "2026-03-02", amount), fields: { ...job(id, name, "2026-03-02", amount).fields, "Customer Name": customer } });
  const records = [record("HIST-2026-03-02-example", staffPrivate.inactiveNames[0], 30), record("LIVE-2026-03-02-example", staffPrivate.primaryName, 30), record("100", "Cody Example", 25), record("101", "Cody Example", 5), record("HIST-2026-03-02-unmatched", staffPrivate.inactiveNames[0], 15, "Unmatched")];
  const unique = facts.uniqueRouteRecords(records, "Job ID");
  assert.deepEqual(unique.map(r=>r.fields["Job ID"]), ["100", "101", "HIST-2026-03-02-unmatched"]);
  const rows = facts.buildRouteProfitabilityFacts({ jobs: records }, { throughDate: "2026-03-02" });
  assert.equal(rows.find(r=>r.name==="Cody Example").revenue,30);
  assert.equal(rows.find(r=>r.name==="Cody Example").jobs,2);
  assert.equal(rows.find(r=>r.name===staffPrivate.inactiveNames[0]).revenue,15);
  assert.equal(rows.some(r=>r.name===staffPrivate.primaryName),false);
  assert.equal(facts.uniqueRouteRecords([record("100","Cody Example",25,""),record("HIST-2026-03-02-empty",staffPrivate.inactiveNames[0],25,"")],"Job ID").length,2);
  const excluded=applyRouteDecisions({jobs:records},{"100":{date:"2026-03-02",customer:"Example",recordedRevenue:25,action:"exclude"},"101":{date:"2026-03-02",customer:"Example",recordedRevenue:5,action:"exclude"}});
  assert.deepEqual(excluded.jobs.map(r=>r.fields["Job ID"]),["HIST-2026-03-02-unmatched"]);
});

test("owner time remains excluded and incomplete prices never become complete profit", () => {
  const raw = facts.buildRouteProfitabilityFacts({jobs:[job("1",staffPrivate.reliefName,"2026-03-02",200),job("2","Cody Example","2026-03-02",0)],time:[shift("1",staffPrivate.reliefName,"2026-03-02",300),shift("2","Cody Example","2026-03-02",300)]},{throughDate:"2026-03-31"});
  const rows=applyTechnicianRouteCosts(raw,costs,coverage);
  assert.equal(rows.find(row=>row.name===staffPrivate.reliefName).hours,0);
  assert.equal(rows.find(row=>row.name===staffPrivate.reliefName).profit,50);
  assert.equal(rows.find(row=>row.name==="Cody Example").profit,null);
  assert.equal(facts.summarizeRouteProfit(combineTechnicianDays(rows)).revenuePerHour,null);
});

test("staff status comes from verified roster, never inferred from recent jobs", () => {
  const roster={records:[{name:"Cody Example",status:"inactive"},{name:staffPrivate.primaryName,status:"active"}]};
  assert.equal(technicianStatus("Cody Example",roster),"Inactive");
  assert.equal(technicianStatus(staffPrivate.primaryName,roster),"Active");
  assert.equal(technicianStatus("New tech",roster),"Status unknown");
});

test("shift-only days contribute labor hours without inflating completed service-day counts", () => {
  const rows=applyTechnicianRouteCosts(example([shift("1","Cody Example","2026-03-02",120),shift("2","Cody Example","2026-03-04",60)]),costs,coverage).filter(row=>row.name==="Cody Example");
  const total=facts.summarizeRouteProfit(rows);
  assert.equal(total.hours,3); assert.equal(total.routeDays,1); assert.equal(total.averageRevenue,400); assert.equal(total.revenuePerHour,400/3);
});

test("upgrading primary technician-only history rebuilds every retained month exactly once", async () => {
  const source=fs.readFileSync(new URL("../lib/route-profitability-history.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
  let prior={backfilled:true,revenueVersion:ROUTE_REVENUE_VERSION,rows:[],fromDate:"2025-09-01"};
  const starts=[];
  const db={prepare:query=>({bind:(...args)=>({first:async()=>({payload:JSON.stringify(prior)}),run:async()=>{if(query.startsWith("INSERT"))prior=JSON.parse(args[1]);return {};}})})};
  const refresh=runPrivateInNewContext(source+"\nrefreshRouteHistory",{...facts,ROUTE_REVENUE_VERSION,TextEncoder,enrichRouteSourceEvidence:async(db,r)=>r,reconcileRouteRecords:async(db,r)=>r});
  const load=async from=>{starts.push(from);return {jobs:[],time:[]};};
  await refresh(db,load,new Date("2026-09-23T12:00:00Z"));
  await refresh(db,load,new Date("2026-09-23T12:00:00Z"));
  assert.deepEqual(starts,["2025-09-01","2026-06-17","2025-09-01"]);
  assert.equal(prior.historyVersion,facts.ROUTE_HISTORY_VERSION);
  assert.equal(prior.nextAuditMonth,"2025-10-01");
});

test("routine refresh retains older years and rotates a bounded historical month", async()=>{
  const source=fs.readFileSync(new URL("../lib/route-profitability-history.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
  let prior={backfilled:true,historyVersion:facts.ROUTE_HISTORY_VERSION,revenueVersion:ROUTE_REVENUE_VERSION,rows:[{date:"2025-09-22",techName:"Cody Example",revenue:100}],fromDate:"2025-09-01",nextAuditMonth:"2025-10-01"};
  const ranges=[];
  const db={prepare:query=>({bind:(...args)=>({first:async()=>({payload:JSON.stringify(prior)}),run:async()=>{if(query.startsWith("INSERT"))prior=JSON.parse(args[1]);return {};}})})};
  const refresh=runPrivateInNewContext(source+"\nrefreshRouteHistory",{...facts,ROUTE_REVENUE_VERSION,TextEncoder,enrichRouteSourceEvidence:async(db,r)=>r,reconcileRouteRecords:async(db,r)=>r});
  await refresh(db,async(from,through)=>{ranges.push([from,through]);return {jobs:[],time:[]};},new Date("2027-09-23T12:00:00Z"));
  assert.equal(prior.fromDate,"2025-09-01");assert.equal(prior.rows[0].revenue,100);
  assert.deepEqual(ranges,[["2027-06-17","2027-09-22"],["2025-09-01","2025-12-04"]]);
  assert.equal(prior.nextAuditMonth,"2025-11-01");
});
