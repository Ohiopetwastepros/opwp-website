import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import * as logic from "../lib/stop-travel.mjs";
import { shiftRouteDate } from "../lib/route-profitability-calculations.mjs";
const source=fs.readFileSync(new URL("../lib/stop-travel.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function fixture({configured=true,providerOk=true}={}) {
  const sql=new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);
    CREATE TABLE api_rate_limits(scope TEXT,client_key TEXT,window_start INTEGER,request_count INTEGER,expires_at TEXT,UNIQUE(scope,client_key,window_start));
    CREATE TABLE sng_events(id TEXT,event_type TEXT,source TEXT,external_id TEXT,payload TEXT,received_at TEXT);`);
  const db={prepare:query=>({bind:(...args)=>({first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})})})};
  let calls=0;
  const context={...logic,shiftRouteDate,crypto,TextEncoder,console,getDb:()=>db,geoapifyConfigured:()=>configured,calculateTravelLegs:async points=>{calls++;return {ok:providerOk,data:Array.from({length:points.length-1},(_,i)=>({minutes:i%2?900:10,miles:i%2?900:2}))};}};
  const service=runPrivateInNewContext(`${source}\n({refreshStopTravelDate,readStopTravel,validTravelDate})`,context);
  const date=shiftRouteDate(logic.travelDate(),-1);
  function addJobs(count=3){for(let i=0;i<count;i++)sql.prepare("INSERT INTO sng_events VALUES (?,?,?,?,?,?)").run(String(i),"job:completed","sweep_and_go",`${i}.0`,JSON.stringify({data:{job_id:i,employee_id:Number(staffPrivate.providerIds.primary),employee_name:staffPrivate.primaryShort,client_name:`Stop ${i}`,start_time:`${date} ${String(9+i).padStart(2,"0")}:00:00`,end_time:`${date} ${String(9+i).padStart(2,"0")}:10:00`,start_latitude:41+i/100,start_longitude:-83}}),`${date} 20:00:00`);}
  return {sql,db,service,date,addJobs,calls:()=>calls,unlock:()=>sql.prepare("DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'stop_travel_lock:%'").run()};
}
test("real SQL persists transitions, discards connector legs and reuses road estimates",async()=>{
  const f=fixture();f.addJobs();const r=await f.service.refreshStopTravelDate(f.date);assert.equal(r.transitions,2);assert.equal(f.calls(),1);
  const read=await f.service.readStopTravel(f.date,f.date);assert.equal(read.rows.length,2);assert.ok(read.rows.every(r=>r.expectedDriveMinutes===10&&r.roadMiles===2&&r.flagged));assert.ok(!("baselines" in read.days[0]));assert.ok(!("fromPoint" in read.rows[0]));
  assert.equal((await f.service.refreshStopTravelDate(f.date)).skipped,true);assert.equal(f.calls(),1);
  f.unlock();await f.service.refreshStopTravelDate(f.date);assert.equal(f.calls(),1);
  // Corrected job timing recomputes flags without another paid map call.
  f.sql.prepare("UPDATE sng_events SET payload=json_set(payload,'$.data.start_time',?) WHERE id='1'").run(`${f.date} 09:24:00`);
  f.unlock();await f.service.refreshStopTravelDate(f.date);const corrected=await f.service.readStopTravel(f.date,f.date);assert.equal(corrected.rows[0].flagged,false);assert.equal(f.calls(),1);
});
test("unconfigured or failed mapping persists gaps as pending, never fabricated flags",async()=>{
  for(const options of [{configured:false},{providerOk:false}]){const f=fixture(options);f.addJobs();const r=await f.service.refreshStopTravelDate(f.date);assert.equal(r.pending,2);assert.equal(r.flagged,0);const data=await f.service.readStopTravel(f.date,f.date);assert.equal(data.rows[0].elapsedMinutes,50);assert.equal(data.rows[0].roadMiles,null);}
});
test("global daily provider cap applies before network calls",async()=>{
  const f=fixture();f.addJobs();f.sql.prepare("INSERT INTO api_rate_limits VALUES ('stop_travel_geo','global',?,120,'2099-01-01')").run(Math.floor(Date.now()/86400000)*86400);
  const r=await f.service.refreshStopTravelDate(f.date);assert.equal(f.calls(),0);assert.equal(r.pending,2);
});
test("oversized source scans preserve prior records and do no paid work",async()=>{
  const f=fixture();f.addJobs();await f.service.refreshStopTravelDate(f.date);f.unlock();
  f.sql.exec("INSERT INTO sng_events SELECT * FROM sng_events");
  for(let i=0;i<8;i++)f.sql.exec("INSERT INTO sng_events SELECT * FROM sng_events");
  await assert.rejects(f.service.refreshStopTravelDate(f.date),/coverage exceeded/);assert.equal((await f.service.readStopTravel(f.date,f.date)).rows.length,2);assert.equal(f.calls(),1);
});
test("date validation rejects rollover, future dates and old history",()=>{
  const f=fixture();for(const d of ["2026-02-30","2099-01-01","2000-01-01","2026-9-1",null])assert.equal(f.service.validTravelDate(d),false);
});
