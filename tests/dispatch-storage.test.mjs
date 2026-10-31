import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { sngFieldSnapshot, identityConflicts, parseMetadata } from "../lib/field-policy.mjs";
import { DatabaseSync } from "node:sqlite";
import { dispatchSelection, validDispatchDate, DAILY_ROUTE_ALGORITHM } from "../lib/daily-route-optimizer.mjs";

const source=fs.readFileSync(new URL("../lib/route-partner.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function fixture() {
  const sql=new DatabaseSync(":memory:");
  sql.exec(fs.readFileSync(new URL("../tmp/test-migrations/0020_route_partner_foundation.sql",import.meta.url),"utf8"));
  sql.exec("PRAGMA foreign_keys=OFF; CREATE TABLE route_partner_field_shifts(id TEXT,organization_id TEXT,service_date TEXT,status TEXT);");
  const db={prepare(query){return {bind(...args){return {query,args,
    async all(){if(query.includes("FROM dog_food_deliveries"))return {results:[]};return {results:sql.prepare(query).all(...args)};},
    async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);},
  };}};},async batch(statements){sql.exec("BEGIN");try{for(const s of statements)sql.prepare(s.query).run(...s.args);sql.exec("COMMIT");}catch(e){sql.exec("ROLLBACK");throw e;}}};
  const context={sngFieldSnapshot,identityConflicts,parseMetadata,crypto,TextEncoder,validDispatchDate,dispatchSelection,DAILY_ROUTE_ALGORITHM,
    normalizeSngDispatchJobs:rows=>rows,addressHash:async address=>address,
    optimizeDispatchLocations:async(db,locations)=>({locations,optimization:{status:"optimized"}}),
  };
  return {sql,db,...runPrivateInNewContext(`${source}\n({importRoutePartnerDay,finalizeRoutePartnerPlan})`,context)};
}
const job={id:"one",jobId:"one",address:"123 Main St",customerName:"Client",technicianId:staffPrivate.providerIds.primary,technicianName:staffPrivate.primaryShort,routeId:staffPrivate.providerIds.primary,sequence:1,sourceIndex:0,sourceStatus:"dispatched",serviceName:"Sanitization",estimatedServiceMinutes:8};
test("immutable imports retain service details and time; estimate-only changes create a new version",async()=>{
  const h=fixture();const input={db:h.db,date:"2026-10-06",sourceRows:[job],actor:"owner"};
  assert.equal((await h.importRoutePartnerDay(input)).createdCount,1);
  assert.equal((await h.importRoutePartnerDay(input)).unchangedCount,1);
  let task=h.sql.prepare("SELECT product_summary,estimated_minutes FROM route_partner_tasks").get();assert.equal(task.product_summary,"Sanitization");assert.equal(task.estimated_minutes,8);
  assert.equal((await h.importRoutePartnerDay({...input,sourceRows:[{...job,estimatedServiceMinutes:12}]})).createdCount,1);
  assert.equal(h.sql.prepare("SELECT status FROM route_partner_route_plans WHERE version=1").get().status,"superseded");
  h.sql.close();
});
test("release enforces tenant, date and optimization readiness",async()=>{
  const h=fixture();await h.importRoutePartnerDay({db:h.db,date:"2026-10-06",sourceRows:[job],actor:"owner"});
  const planId=h.sql.prepare("SELECT id FROM route_partner_route_plans").get().id;
  for(const extra of [{organizationId:"other"},{date:"2026-10-07"}])await assert.rejects(()=>h.finalizeRoutePartnerPlan({db:h.db,planId,date:"2026-10-06",actor:"owner",...extra}),/not found/);
  h.sql.prepare("UPDATE route_partner_plan_events SET details='{}'").run();
  await assert.rejects(()=>h.finalizeRoutePartnerPlan({db:h.db,planId,date:"2026-10-06",actor:"owner"}),/optimization review/);
  assert.equal(h.sql.prepare("SELECT status FROM route_partner_route_plans").get().status,"draft");h.sql.close();
});
test("started routes cannot be rebuilt",async()=>{
  const h=fixture();h.sql.prepare("INSERT INTO route_partner_field_shifts VALUES ('shift','org-opwp','2026-10-06','in_progress')").run();
  await assert.rejects(()=>h.importRoutePartnerDay({db:h.db,date:"2026-10-06",sourceRows:[job],actor:"owner"}),/already started/);h.sql.close();
});
