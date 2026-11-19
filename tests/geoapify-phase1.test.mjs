import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import {controlledRoutingRequest,routingRequestKey} from '../lib/routing-provider-control.mjs';
import {censusGeocode} from '../lib/census-geocode.mjs';
import {readBoundedProviderJson} from '../lib/bounded-body.mjs';
import {validRoadPoint,validateRoadMatrix,MAX_DAILY_ROUTE_STOPS} from '../lib/daily-route-optimizer.mjs';
const source=fs.readFileSync(new URL('../lib/geoapify.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function api(extra={}) {return runPrivateInNewContext(source+'\n({geocodeAddress,calculateRouteMatrix,estimateRouteMatrixCredits,calculateOrderedRoute})',{URL,AbortController,setTimeout,clearTimeout,readBoundedProviderJson,validRoadPoint,validateRoadMatrix,MAX_DAILY_ROUTE_STOPS,routingRequestKey,controlledRoutingRequest,getRuntimeEnv:()=>({}),...extra});}
const location={latitude:41.7,longitude:-83.6,formattedAddress:'Example',confidence:null,matchType:'census_interpolated',placeId:'',city:'Toledo',postcode:'43613',stateCode:'OH'};
test('Census success works without a paid key and never reaches Geoapify',async()=>{
 let paid=0;const h=api({censusGeocode:async()=>location,fetch:async()=>{paid++;throw Error('paid');}});
 const result=await h.geocodeAddress('Example');assert.equal(result.ok,true);assert.equal(result.source,'census');assert.equal(result.data.source,'census');assert.equal(result.data.latitude,41.7);assert.equal(paid,0);
});
test('an unusable Census result falls back once and retains the geocode output shape',async()=>{
 const order=[];const h=api({censusGeocode:async()=>{order.push('census');return null;},getRuntimeEnv:()=>({GEOAPIFY_API_KEY:'test'}),controlledRoutingRequest:async({request})=>request(),fetch:async()=>{order.push('geoapify');return Response.json({results:[{lat:41.7,lon:-83.6,formatted:'Example',rank:{confidence:0.9},state_code:'OH'}]});}});
 const result=await h.geocodeAddress('Example');assert.deepEqual(order,['census','geoapify']);assert.equal(result.ok,true);assert.equal(result.data.source,'geoapify');assert.equal(result.data.confidence,0.9);
});
test('Census bulk lookups have at most two concurrent requests',async()=>{
 let active=0,maximum=0;const fetcher=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return Response.json({result:{addressMatches:[]}});};
 await Promise.all(Array.from({length:8},()=>censusGeocode('Example',fetcher)));assert.equal(maximum,2);
});
function database(){const sql=new DatabaseSync(':memory:');for(const name of ['0058_routing_provider_controls.sql','0059_routing_provider_pacing.sql'])sql.exec(fs.readFileSync(new URL('../tmp/test-migrations/'+name,import.meta.url),'utf8'));const db={prepare(query){const statement=sql.prepare(query);let args=[];return{bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return{results:statement.all(...args)};},async run(){return statement.run(...args);}};}};return{db,sql};}
function matrixApi(){const h=database();let calls=0;const apiValue=api({getRuntimeEnv:()=>({DB:h.db,GEOAPIFY_API_KEY:'test'}),fetch:async(_url,options)=>{calls++;const body=JSON.parse(options.body);return Response.json({sources_to_targets:body.sources.map(s=>body.targets.map(t=>({time:Math.abs(s.location[0]-t.location[0])*1000,distance:Math.abs(s.location[0]-t.location[0])*10000})))});}});return{...h,...apiValue,calls:()=>calls};}
const points=Array.from({length:3},(_,i)=>({latitude:41.7,longitude:-83.6+i/100}));
test('routebook preflight rejects an over-budget matrix without a paid call',async()=>{
 const h=matrixApi();assert.equal(await h.estimateRouteMatrixCredits(points),6);const budget={remaining:5};const result=await h.calculateRouteMatrix(points,{budget});assert.equal(result.errorCode,'run_budget_exceeded');assert.equal(h.calls(),0);assert.equal(budget.remaining,5);
});
test('roster reordering costs zero and a changed stop reuses all unchanged directed legs',async()=>{
 const h=matrixApi();const first={remaining:6};assert.equal((await h.calculateRouteMatrix(points,{budget:first})).ok,true);assert.equal(first.remaining,0);assert.equal(h.calls(),3);
 const reordered=[points[2],points[0],points[1]];assert.equal(await h.estimateRouteMatrixCredits(reordered),0);assert.equal((await h.calculateRouteMatrix(reordered,{budget:{remaining:0}})).ok,true);assert.equal(h.calls(),3);
 const changed=[points[0],points[1],{latitude:41.7,longitude:-83.5}];assert.equal(await h.estimateRouteMatrixCredits(changed),4);const budget={remaining:4};const result=await h.calculateRouteMatrix(changed,{budget});assert.equal(result.ok,true);assert.equal(budget.remaining,0);assert.ok(Math.abs(result.data.matrix[0][2].time-100)<0.001);assert.equal(h.sql.prepare('SELECT credits FROM routing_provider_usage').get().credits,10);
});
test('shared per-run budget charges cache misses and permits a zero-budget cache hit',async()=>{
 const h=database();let calls=0;const options={db:h.db,key:'first',cost:5,ttl:86400,request:async()=>{calls++;return{ok:true,status:200,data:{value:1}};},wait:async()=>{}};
 const budget={remaining:5};assert.equal((await controlledRoutingRequest({...options,budget})).ok,true);assert.equal(budget.remaining,0);assert.equal((await controlledRoutingRequest({...options,budget})).cached,true);assert.equal((await controlledRoutingRequest({...options,key:'second',budget})).errorCode,'run_budget_exceeded');assert.equal(calls,1);
});

test('reusing an old full matrix preserves its original road-leg expiry',async()=>{
 const h=matrixApi(),seconds=Math.floor(Date.now()/1000),expires=seconds+120;
 const locations=points.map(point=>({location:[point.longitude,point.latitude]}));
 const body={mode:'drive',traffic:'approximated',sources:locations,targets:locations};
 const key=await routingRequestKey('/v1/routematrix',{},body);
 const data={sources_to_targets:points.map((_,i)=>points.map((__,j)=>({time:i===j?0:60,distance:i===j?0:100})))};
 h.sql.prepare('INSERT INTO routing_provider_cache(cache_key,payload,expires_at) VALUES (?,?,?)').run(key,JSON.stringify(data),expires);
 assert.equal((await h.calculateRouteMatrix(points,{budget:{remaining:0}})).ok,true);assert.equal(h.calls(),0);
 const rows=h.sql.prepare("SELECT payload FROM routing_provider_cache WHERE cache_key LIKE 'route_legs_v1:%'").all();
 assert.equal(rows.length,3);for(const row of rows)for(const leg of Object.values(JSON.parse(row.payload).legs))assert.equal(leg.expiresAt,expires);
});


test('a cached sparse request keeps its original expiry when promoted to reusable legs',async()=>{
 const h=matrixApi(),seconds=Math.floor(Date.now()/1000),expires=seconds+120;
 const body={mode:'drive',traffic:'approximated',sources:[{location:[points[0].longitude,points[0].latitude]}],targets:points.slice(1).map(point=>({location:[point.longitude,point.latitude]}))};
 const key=await routingRequestKey('/v1/routematrix',{},body);
 h.sql.prepare('INSERT INTO routing_provider_cache(cache_key,payload,expires_at) VALUES (?,?,?)').run(key,JSON.stringify({sources_to_targets:[[{time:60,distance:100},{time:120,distance:200}]]}),expires);
 assert.equal((await h.calculateRouteMatrix(points,{budget:{remaining:6}})).ok,true);
 const row=h.sql.prepare('SELECT payload FROM routing_provider_cache WHERE cache_key=?').get('route_legs_v1:'+points[0].longitude+','+points[0].latitude);
 const legs=JSON.parse(row.payload).legs;assert.equal(legs[points[1].longitude+','+points[1].latitude].expiresAt,expires);
});

test('ordered road calculations share the rebuild credit budget too',async()=>{
 const h=matrixApi();assert.equal((await h.calculateOrderedRoute(points.slice(0,2),{budget:{remaining:0}})).errorCode,'run_budget_exceeded');assert.equal(h.calls(),0);
});
