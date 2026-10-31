import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source=fs.readFileSync(new URL('../lib/route-intelligence.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{.*\} from .*;\r?\n/gm,'').replace(/^export /gm,'');
async function refresh({planStatus='complete',auditStatus='verified',remaining=0,attempted=0,unchanged=false,cachedStatus='complete',fail=false}={}) {
  const writes=[],logs=[];
  const capturedAt='2026-10-08T23:00:00Z';
  const db={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){assert.doesNotMatch(sql,/WHERE status='complete'/);return {status:cachedStatus,source_snapshot_at:unchanged?capturedAt:'older',payload:JSON.stringify({planningWeekStart:'2026-10-05',routeModelVersion:11})};},async run(){writes.push({sql,args:this.args});return {meta:{changes:1}};}};}};
  const context={routingPrivate,crypto:webcrypto,console:{log:value=>logs.push(JSON.parse(value)),error:value=>logs.push(JSON.parse(value))},
    runScheduledRouteAssignmentAudit:async()=>({status:auditStatus}),
    mockGeocode:async()=>({remaining,attempted,geocodedCustomers:208,sourceSnapshotAt:capturedAt}),
    mockPlan:async()=>{if(fail)throw Error('provider unavailable');return {id:'new-plan',status:planStatus};},
    mockMonday:()=>new Date('2026-10-05T00:00:00Z'),
  };
  const fn=runPrivateInNewContext(source+'\ngeocodeActiveSubscriptionRouteBook=mockGeocode; calculateActiveSubscriptionPlan=mockPlan; mondayStart=mockMonday; runScheduledRouteBookRefresh;',context);
  let error;try{await fn({DB:db});}catch(e){error=e;}
  return {writes,logs,error};
}
test('partial road plans remain partial when the assignment audit passes',async()=>{
  const r=await refresh({planStatus:'partial'});assert.equal(r.writes[0].args[1],'partial');assert.match(r.writes[0].args[4],/Route plan incomplete/);assert.equal(r.logs[0].planStatus,'partial');assert.equal(r.logs[0].status,'partial');
});
test('complete calculations and verified assignments record successful health',async()=>{
  const r=await refresh();assert.equal(r.writes[0].args[1],'success');assert.equal(r.writes[0].args[4],null);assert.equal(r.logs[0].planStatus,'complete');
});
test('completed calculations do not mask an unverified assignment audit',async()=>{
  const r=await refresh({auditStatus:'unverified'});assert.equal(r.writes[0].args[1],'partial');assert.match(r.writes[0].args[4],/not verified/);
});
test('pending geocoding never reports a complete route refresh',async()=>{
  for(const options of [{remaining:1},{attempted:1}]) {const r=await refresh(options);assert.equal(r.writes[0].args[1],'partial');assert.equal(r.logs[0].planStatus,'pending');}
});
test('reusing the matching complete plan is successful without another calculation',async()=>{
  const r=await refresh({unchanged:true});assert.equal(r.writes[0].args[1],'success');assert.equal(r.logs[0].planStatus,'unchanged_complete');assert.equal(r.logs[0].planId,null);
});
test('a newer partial plan is recalculated rather than hidden behind a completed cache',async()=>{
  const r=await refresh({unchanged:true,cachedStatus:'partial'});assert.equal(r.logs[0].planStatus,'complete');assert.equal(r.logs[0].planId,'new-plan');
});
test('a thrown calculation failure records a failed run and remains an error',async()=>{
  const r=await refresh({fail:true});assert.match(r.writes[0].sql,/'failed'/);assert.match(r.error.message,/provider unavailable/);assert.equal(r.logs[0].event,'active_route_book_refresh_failed');
});
