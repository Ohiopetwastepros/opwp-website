import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import { ROUTE_BOOK_RUN_CREDITS, routeBookSchedule, routeBookFingerprint, claimRouteBookRebuild } from '../lib/route-book-policy.mjs';

const source=fs.readFileSync(new URL('../lib/route-intelligence.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{.*\} from .*;\r?\n/gm,'').replace(/^export /gm,'');
function fixture({planStatus='complete',auditStatus='verified',remaining=0,attempted=0,changed=true,cachedStatus='complete',fail=false,budgetFailure=false}={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT);
    CREATE TABLE route_subscription_plans(source_snapshot_at TEXT,payload TEXT,status TEXT,created_at TEXT);
    CREATE TABLE system_sync_runs(id TEXT,sync_name TEXT,status TEXT,snapshot_date TEXT,records_processed INTEGER,error TEXT,completed_at TEXT);`);
  sql.prepare('INSERT INTO route_subscription_plans VALUES (?,?,?,CURRENT_TIMESTAMP)').run('old-capture',JSON.stringify({rosterFingerprint:changed?'older':'same'}),cachedStatus);
  const db={prepare(query){const args=[];return {bind(...values){args.splice(0,args.length,...values);return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};}};
  const logs=[],calls=[];
  const context={routingPrivate,crypto:webcrypto,console:{log:value=>logs.push(JSON.parse(value)),error:value=>logs.push(JSON.parse(value))},
    ROUTE_BOOK_RUN_CREDITS,routeBookSchedule,routeBookFingerprint,claimRouteBookRebuild,
    runScheduledRouteAssignmentAudit:async()=>({status:auditStatus}),
    mockGeocode:async()=>({remaining,attempted,geocodedCustomers:208,sourceSnapshotAt:'new-capture',rosterFingerprint:'same'}),
    mockPlan:async(_,options)=>{calls.push(options);if(budgetFailure)throw Object.assign(Error('budget'),{code:'run_budget_exceeded'});if(fail)throw Error('provider unavailable');return {id:'new-plan',status:planStatus};},
  };
  const fn=runPrivateInNewContext(source+'\ngeocodeActiveSubscriptionRouteBook=mockGeocode; calculateActiveSubscriptionPlan=mockPlan; runScheduledRouteBookRefresh;',context);
  return {sql,logs,calls,run:(at='2026-10-08T19:35:00Z')=>fn({DB:db},at),health:()=>sql.prepare('SELECT * FROM system_sync_runs ORDER BY rowid DESC LIMIT 1').get()};
}

test('partial road plans remain partial when the assignment audit passes',async()=>{
  const h=fixture({planStatus:'partial'});await h.run();assert.equal(h.health().status,'partial');assert.match(h.health().error,/Route plan incomplete/);assert.equal(h.logs[0].planStatus,'partial');h.sql.close();
});

test('complete calculations and verified assignments record successful health and share the 800 credit budget',async()=>{
  const h=fixture();await h.run();assert.equal(h.health().status,'success');assert.equal(h.health().error,null);assert.equal(h.calls[0].budget.remaining,800);h.sql.close();
});

test('completed calculations do not mask an unverified assignment audit',async()=>{
  const h=fixture({auditStatus:'unverified'});await h.run();assert.equal(h.health().status,'partial');assert.match(h.health().error,/not verified/);h.sql.close();
});

test('pending geocoding never reports a complete route refresh',async()=>{
  const h=fixture({remaining:1});await h.run();assert.equal(h.health().status,'partial');assert.equal(h.logs[0].planStatus,'pending');assert.equal(h.calls.length,0);h.sql.close();
});

test('newly geocoded changed addresses may complete the same bounded rebuild',async()=>{
  const h=fixture({attempted:1});await h.run();assert.equal(h.calls.length,1);h.sql.close();
});

test('new snapshot timestamps never trigger an hourly rebuild of the same roster',async()=>{
  const h=fixture({changed:false});await h.run();await h.run();assert.equal(h.calls.length,0);assert.equal(h.health().status,'success');assert.equal(h.logs[0].planStatus,'unchanged_complete');h.sql.close();
});

test('unchanged partial plans wait overnight and daily leases prevent hourly retries',async()=>{
  const h=fixture({changed:false,cachedStatus:'partial'});await h.run();assert.equal(h.calls.length,0);
  await h.run('2026-10-09T06:35:00Z');await h.run('2026-10-09T06:35:00Z');assert.equal(h.calls.length,1);h.sql.close();
});

test('changed roster runs once and an exceeded budget preserves the last plan with a warning',async()=>{
  const h=fixture({budgetFailure:true});await h.run();await h.run();assert.equal(h.calls.length,1);assert.equal(h.logs[0].planStatus,'retained_budget');assert.equal(h.logs[1].planStatus,'retained_budget');assert.equal(h.health().status,'partial');
  const runs=h.sql.prepare('SELECT * FROM system_sync_runs ORDER BY rowid').all();assert.equal(runs[0].status,'partial');assert.match(runs[0].error,/800-credit.*last good plan/);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM route_subscription_plans').get().n,1);h.sql.close();
});

test('a thrown calculation failure records a failed run and remains an error',async()=>{
  const h=fixture({fail:true});await assert.rejects(h.run(),/provider unavailable/);assert.equal(h.health().status,'failed');assert.equal(h.logs[0].event,'active_route_book_refresh_failed');h.sql.close();
});

test('a failed changed-roster rebuild cannot report the old saved plan as current on the next hourly tick',async()=>{
  const h=fixture({fail:true});await assert.rejects(h.run(),/provider unavailable/);await h.run();
  assert.equal(h.calls.length,1);assert.equal(h.health().status,'partial');assert.equal(h.logs[1].planStatus,'pending');
  assert.match(h.health().error,/not complete/);h.sql.close();
});
