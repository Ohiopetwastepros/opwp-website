import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadPlaybookServiceAreaFacts} from '../lib/lead-playbook-service-area.mjs';
import {patchQuoteFollowUpWorker} from '../scripts/patch-quote-follow-up-worker.mjs';
import {checkLeadReplyWatchdogWorker} from '../scripts/check-quote-follow-up-worker.mjs';

const now=new Date('2026-11-23T18:00:00Z');
const dbFor=row=>({prepare(sql){assert.match(sql,/WHERE snapshot_key='business_cockpit'/);return{async first(){return row;}};}});
const row={status:'success',captured_at:'2026-11-23 17:00:00',payload:JSON.stringify({opwp:{customers:[
  {id:'fictional-one',fields:{Status:'Active',City:'Perrysburg',ZIP:'43551',Name:'Private name must not escape'}},
  {id:'fictional-two',fields:{Status:'Inactive',City:'Elmore',ZIP:'43416'}},
  {id:'fictional-three',fields:{Status:'Paused',City:'Other place',ZIP:'00000'}},
  {id:'fictional-four',fields:{Status:'active',City:' Perrysburg ',ZIP:'43551-1234'}},
]}})};

test('service coverage exposes only fresh active-client town/ZIP facts, never customer identities',async()=>{
  const facts=await loadPlaybookServiceAreaFacts(dbFor(row),{now});
  assert.deepEqual(facts,{statusHealthy:true,sourceSnapshotAt:'2026-11-23T17:00:00.000Z',activeClientTowns:['Perrysburg'],activeClientZips:['43551']});
  assert.doesNotMatch(JSON.stringify(facts),/Private name|fictional|Elmore/);
});

test('stale, failed, future, malformed and unavailable source snapshots cannot approve coverage',async()=>{
  for(const source of [null,{...row,status:'failed'},{...row,captured_at:'2026-11-21 17:00:00'},{...row,captured_at:'2026-11-23 19:00:00'},{...row,payload:'{broken'}]){
    const facts=await loadPlaybookServiceAreaFacts(dbFor(source),{now});
    assert.equal(facts.statusHealthy,false);assert.deepEqual(facts.activeClientTowns,[]);
  }
  const missing=await loadPlaybookServiceAreaFacts({prepare(){throw Error('unavailable');}},{now});assert.equal(missing.statusHealthy,false);
});

test('the executable minute handler invokes only the reply watchdog and preserves all other schedules',async()=>{
  const source=patchQuoteFollowUpWorker('export default { async scheduled(controller, env, ctx) {} };');
  checkLeadReplyWatchdogWorker(source);
  assert.equal(patchQuoteFollowUpWorker(source),source,'patch remains idempotent');
  const calls=[],waits=[],env={fixture:true};
  const scope={Request,console,runWithCloudflareRequestContext(request,actualEnv,ctx,run){assert.equal(actualEnv,env);assert.equal(new URL(request.url).pathname,'/lead-reply-watchdog');return run();},async runLeadReplyWatchdog(actualEnv,options){assert.equal(actualEnv,env);assert.equal(options.now.toISOString(),'2026-11-23T18:00:00.000Z');calls.push('watchdog');}};
  vm.createContext(scope);
  vm.runInContext(source.replace(/^import[^\n]+\n/gm,'').replace('export default','globalThis.worker ='),scope);
  await scope.worker.scheduled({cron:'* * * * *',scheduledTime:now.getTime()},env,{waitUntil(task){waits.push(task);}});
  await Promise.all(waits);assert.deepEqual(calls,['watchdog']);
});

test('worker gate rejects a missing, commented-out, wrong-schedule or uninvoked watchdog',()=>{
  const source=patchQuoteFollowUpWorker('export default { async scheduled(controller, env, ctx) {} };');
  assert.throws(()=>checkLeadReplyWatchdogWorker(source.replace('() => runLeadReplyWatchdog(env','() => notTheWatchdog(env')),/not invoked/);
  assert.throws(()=>checkLeadReplyWatchdogWorker(source.replace('controller.cron === "* * * * *"','controller.cron === "0 * * * *"')),/not invoked/);
  assert.throws(()=>checkLeadReplyWatchdogWorker(source.replace('() => runLeadReplyWatchdog(env, {now: new Date(controller.scheduledTime)})','() => /* runLeadReplyWatchdog(env) */ Promise.resolve()')),/not invoked/);
});
