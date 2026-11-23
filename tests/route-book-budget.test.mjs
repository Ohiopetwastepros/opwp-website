import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
import { runPrivateInNewContext } from './helpers/private-vm.mjs';
import { routeBookFingerprint, routeBookSchedule } from '../lib/route-book-policy.mjs';

const customer={customerId:'fictional-1',customerName:'Example',address:'1 Example Street',serviceDays:['Monday'],technicianNames:['Example tech'],frequency:'Weekly',serviceMinutes:10,mrr:100};
test('route-book fingerprint ignores capture time, source ordering and equivalent completed-service cohorts',async()=>{
  const a={...customer,frequency:'Biweekly',latestServiceDate:'2026-10-05'};
  assert.equal(await routeBookFingerprint([a,{...customer,customerId:'fictional-2'}]),await routeBookFingerprint([{...customer,customerId:'fictional-2'},{...a,latestServiceDate:'2026-10-19'}]));
  for(const changed of [{address:'2 Example Street'},{serviceDays:['Tuesday']},{technicianNames:['Other tech']},{serviceMinutes:12}])assert.notEqual(await routeBookFingerprint([customer]),await routeBookFingerprint([{...customer,...changed}]));
});
test('overnight rebuild follows Eastern time and DST',()=>{
  assert.deepEqual(routeBookSchedule('2026-10-08T06:35:00Z'),{date:'2026-10-08',overnight:true});
  assert.deepEqual(routeBookSchedule('2026-12-08T07:35:00Z'),{date:'2026-12-08',overnight:true});
  assert.equal(routeBookSchedule('2026-12-08T06:35:00Z').overnight,false);
});
test('baseline preflight refuses the whole rebuild before any road calls',async()=>{
  const source=fs.readFileSync(new URL('../lib/route-intelligence.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{.*\} from .*;\r?\n/gm,'').replace(/^export /gm,'');
  let reads=0;
  const api=runPrivateInNewContext(source+'\npreflightRouteBookMatrices',{routingPrivate,estimateRouteMatrixCredits:async()=>{reads++;return 500;}});
  const visits=['Monday','Tuesday'].flatMap(routeId=>[1,2].map(sequence=>({technicianId:'fictional',technicianName:'fictional',routeId,sequence,scheduledTime:'',sourceIndex:sequence,location:{latitude:41.6,longitude:-83.6}})));
  await assert.rejects(()=>api(visits,new Map(),{remaining:800}),e=>e.code==='run_budget_exceeded');assert.equal(reads,2);
});
