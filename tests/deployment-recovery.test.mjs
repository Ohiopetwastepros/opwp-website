import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoveryDecision, retryTime, controllerHealth, canSupersedeDeployment } from '../lib/deployment-policy.mjs';
import { verifyLiveRelease } from '../scripts/deployment-verification.mjs';
import { runBoundedRecovery } from '../scripts/deployment-controller.mjs';
import { acquireLock, recoverAbandonedLock, acknowledgeSnapshot, requestRecovery, readRecoveryRequest, clearRecoveryRequest } from '../scripts/deployment-store.mjs';

const ready = { ready: true, status: 'retry_scheduled', sourceHash: 'abc', attempts: 1 };
test('publishing completed work preserves an unrelated unfinished deployment receipt',()=>{
  const current={id:'new',summary:'Live density map',createdAt:'2026-10-06T20:00:00Z'};
  const pending={id:'old',summary:'Native lock-screen app',ready:false,status:'in_progress',createdAt:'2026-10-06T19:00:00Z'};
  assert.equal(canSupersedeDeployment(pending,current),false);
  assert.equal(canSupersedeDeployment({...pending,summary:current.summary},current),true);
  assert.equal(canSupersedeDeployment({...pending,ready:true,status:'retry_scheduled'},current),true);
  assert.equal(canSupersedeDeployment({...pending,ready:true,target:'field_demo'},current),false);
  assert.equal(canSupersedeDeployment({...pending,ready:true,status:'verified'},current),false);
  assert.equal(canSupersedeDeployment({...pending,ready:true,createdAt:'2026-10-06T21:00:00Z'},current),false);
});
test('duplicate successful receipt acknowledgement is safe without hiding real filesystem errors',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'opwp-receipt-test-')),file=path.join(folder,'receipt.pending');
  try {fs.writeFileSync(file,'deployment:test');acknowledgeSnapshot(file);assert.doesNotThrow(()=>acknowledgeSnapshot(file));assert.throws(()=>acknowledgeSnapshot(folder));}finally{fs.rmdirSync(folder);}
});
test('ready failures retry immediately, but unfinished or changed source never deploys', () => {
  assert.equal(recoveryDecision(ready, { sourceHash: 'abc' }).action, 'retry');
  assert.equal(recoveryDecision({ ...ready, ready: false }, { sourceHash: 'abc' }).action, 'wait');
  assert.equal(recoveryDecision(ready, { sourceHash: 'other' }).action, 'source_changed');
  assert.equal(recoveryDecision(ready, { sourceHash: 'abc', busy: true }).action, 'wait');
});
test('retry backoff and ceiling stop unbounded rebuilds', () => {
  const now = Date.now();
  assert.equal(Date.parse(retryTime(1, now)), now);
  assert.equal(Date.parse(retryTime(2, now)), now + 300000);
  assert.equal(retryTime(3, now), null);
  assert.equal(recoveryDecision({ ...ready, attempts: 3 }, { sourceHash: 'abc' }).action, 'attention');
  assert.equal(recoveryDecision({ ...ready, nextRetryAt: retryTime(2, now) }, { now, sourceHash: 'abc' }).action, 'wait');
});
test('verified releases do not retry and stale controller is visibly offline', () => {
  assert.equal(recoveryDecision({ ...ready, status: 'verified' }).action, 'none');
  assert.equal(controllerHealth({ checkedAt: new Date(0).toISOString() }), 'Offline or delayed');
  assert.equal(controllerHealth({ checkedAt: new Date().toISOString() }), 'Monitoring');
  assert.equal(controllerHealth(null, Date.now(), { failureTriggered: true }), 'Standby (failure-triggered)');
  assert.equal(controllerHealth({ mode: 'failure_triggered', status: 'repairing', checkedAt: new Date().toISOString() }), 'Recovery running');
});
test('recorded failure requests the existing Windows task without adding a polling trigger', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opwp-recovery-request-'));
  const file = path.join(folder, 'request.json');
  const calls = [];
  const releaseId = '20000000-0000-4000-8000-000000000002';
  try {
    assert.equal(requestRecovery(releaseId, { file, platform: 'win32', spawn: (...args) => { calls.push(args); return { status: 0 }; } }), true);
    assert.equal(readRecoveryRequest(file).releaseId, releaseId);
    assert.deepEqual(calls[0][1], ['/Run', '/TN', 'OPWP Deployment Recovery']);
    assert.equal(calls[0][2].windowsHide, true);
    assert.equal(clearRecoveryRequest(releaseId, file), true);
    assert.equal(readRecoveryRequest(file), null);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(folder); }
});
test('a failed task start keeps the local recovery request for manual review', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opwp-recovery-request-failed-'));
  const file = path.join(folder, 'request.json');
  const releaseId = '20000000-0000-4000-8000-000000000003';
  try {
    assert.throws(() => requestRecovery(releaseId, { file, platform: 'win32', spawn: () => ({ status: 1 }) }), /could not be started/);
    assert.equal(readRecoveryRequest(file).releaseId, releaseId);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(folder); }
});
test('failure-triggered recovery runs only remaining bounded attempts and preserves backoff', async () => {
  let clock = Date.parse('2026-10-07T15:00:00Z');
  const sleeps = [], attempts = [];
  const release = { ...ready, id: 'test', nextRetryAt: new Date(clock).toISOString() };
  const outcome = await runBoundedRecovery(release, {
    currentSourceHash: () => 'abc',
    now: () => clock,
    sleep: async delay => { sleeps.push(delay); clock += delay; },
    attempt: async run => {
      run.attempts += 1; attempts.push(run.attempts);
      if (run.attempts === 2) {
        run.status = 'retry_scheduled';
        run.nextRetryAt = new Date(clock + 300000).toISOString();
        return false;
      }
      run.status = 'verified'; run.nextRetryAt = null; return true;
    },
  });
  assert.deepEqual(attempts, [2, 3]);
  assert.deepEqual(sleeps, [300000]);
  assert.equal(outcome.terminal, true);
  assert.equal(release.status, 'verified');
});
test('failure-triggered recovery never deploys changed source', async () => {
  let attempts = 0;
  const outcome = await runBoundedRecovery({ ...ready }, {
    currentSourceHash: () => 'other',
    attempt: async () => { attempts += 1; },
  });
  assert.equal(attempts, 0);
  assert.equal(outcome.decision.action, 'source_changed');
  assert.equal(outcome.terminal, true);
});
test('exclusive lock refuses live owner and recovers an abandoned owner only after grace period', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opwp-lock-test-'));
  const file = path.join(folder, 'lock');
  try {
    assert.equal(acquireLock(file, 'test'), true);
    assert.equal(acquireLock(file, 'test2'), false);
    assert.equal(recoverAbandonedLock(file, Date.now() + 3600000), false);
    fs.writeFileSync(file, JSON.stringify({ pid: 2147483647 }));
    assert.equal(recoverAbandonedLock(file), false);
    assert.equal(recoverAbandonedLock(file, Date.now() + 3600000), true);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(folder); }
});
function fakeFetch(id, adminStatus = 307) {
  return async url => url.includes('/api/release-status/') ? Response.json({ id }) : url.includes('/admin/') ? new Response(null, { status: adminStatus, headers: { location: '/admin/login/?next=deployments' } }) : new Response('OK');
}
test('deployment completion requires matching live release and protected admin route', async () => {
  const result = await verifyLiveRelease('expected', fakeFetch('expected'), { attempts: 1 });
  assert.equal(result.releaseMatched, true);
  await assert.rejects(verifyLiveRelease('expected', fakeFetch('old'), { attempts: 1 }), /verification failed/);
  await assert.rejects(verifyLiveRelease('expected', fakeFetch('expected', 200), { attempts: 1 }), /verification failed/);
});
test('propagation delay is rechecked before rebuilding a release', async () => {
  let calls = 0;
  const result = await verifyLiveRelease('expected', async url => {
    if (url.includes('/api/release-status/')) return Response.json({ id: ++calls === 1 ? 'old' : 'expected' });
    return fakeFetch('expected')(url);
  }, { attempts: 2, pause: async () => {} });
  assert.equal(result.releaseMatched, true); assert.equal(calls, 2);
});
