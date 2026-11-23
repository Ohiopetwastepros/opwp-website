import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runPrivateInNewContext } from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import { DAILY_ROUTE_ALGORITHM, MAX_DAILY_ROUTE_STOPS, optimizeDailyRoute, validRoadPoint, validateRoadMatrix } from '../lib/daily-route-optimizer.mjs';

const source=fs.readFileSync(new URL('../lib/dispatch-optimization.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function fixture({fail=false}={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);
    CREATE TABLE api_rate_limits(scope TEXT,client_key TEXT,window_start INTEGER,request_count INTEGER,expires_at TEXT,PRIMARY KEY(scope,client_key,window_start));`);
  const db={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);}};}};}};
  let calls=0;
  const api=runPrivateInNewContext(source+'\noptimizeDispatchLocations',{
    staffPrivate,crypto,TextEncoder,DAILY_ROUTE_ALGORITHM,MAX_DAILY_ROUTE_STOPS,optimizeDailyRoute,validRoadPoint,validateRoadMatrix,TONY_ROUTE_DEPOT_ADDRESS:'Example depot',
    resolveRouteStops:async()=>[{location:{latitude:41.6,longitude:-83.6}}],
    calculateDispatchMatrix:async points=>{calls++;return fail?{ok:false}:{ok:true,data:{matrix:points.map((_,i)=>points.map((_,j)=>({time:i===j?0:60,distance:i===j?0:100})))}};},
  });
  const locations=[{address:'Example stop',latitude:41.7,longitude:-83.7,locationKey:'example',estimatedMinutes:10,tasks:[{estimatedMinutes:10}]}];
  const group={technicianId:staffPrivate.providerIds.primary,routeId:'fictional-route',jobs:[]};
  return {sql,calls:()=>calls,run:(rows=locations)=>api(db,rows,group,'2026-10-08'),locations};
}
test('dispatch uses its cached 24 hour matrix without another provider request',async()=>{
  const h=fixture();assert.equal((await h.run()).optimization.status,'optimized');assert.equal((await h.run()).optimization.status,'optimized');assert.equal(h.calls(),1);h.sql.close();
});
test('a changed stop list cannot bypass the route daily matrix lease',async()=>{
  const h=fixture();await h.run();const result=await h.run(h.locations.map(row=>({...row,latitude:41.8})));assert.equal(result.optimization.status,'needs_review');assert.match(result.optimization.reason,/already attempted/);assert.equal(h.calls(),1);h.sql.close();
});
test('failed matrix requests cannot be repeated by hourly or manual reimports',async()=>{
  const h=fixture({fail:true});await h.run();const result=await h.run();assert.equal(result.optimization.status,'needs_review');assert.match(result.optimization.reason,/already attempted/);assert.equal(h.calls(),1);h.sql.close();
});
