import {validateBuildInputs} from './prepare-build-inputs.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MAX_DEPLOYMENT_ATTEMPTS, retryTime, canSupersedeDeployment } from '../lib/deployment-policy.mjs';
import { root, receiptDir, lockPath, run, fingerprint, readRuns, record, acquireLock, recoverAbandonedLock, requestRecovery } from './deployment-store.mjs';
import { verifyLiveRelease } from './deployment-verification.mjs';
import { attemptDemoRelease } from './deploy-field-demo.mjs';
import { demoFingerprint } from './field-demo-project.mjs';

export async function attemptRelease(release) {
  if(release.target==='field_demo')return attemptDemoRelease(release);
  validateBuildInputs({production:true});
  recoverAbandonedLock(lockPath);
  if (!acquireLock(lockPath, release.id)) {
    release.status = 'blocked'; release.reason = 'Waiting for another production deployment to finish.'; release.nextRetryAt = new Date().toISOString(); record(release); return false;
  }
  try {
    const latest = readRuns().find(item => item.id === release.id);
    if (latest) Object.assign(release, latest);
    if (release.status === 'verified' || release.status === 'superseded') return true;
    if ((release.attempts || 0) >= MAX_DEPLOYMENT_ATTEMPTS) return false;
    if (fingerprint() !== release.sourceHash) {
      release.status = 'blocked'; release.reason = 'Source changed; waiting for the owning session to submit current source.'; record(release); return false;
    }
    release.attempts = (release.attempts || 0) + 1;
    release.reason = ''; release.nextRetryAt = null; release.status = 'validating';
    release.lastAction = release.attempts > 1 ? 'Automatic recovery: rerun checks and rebuild from source.' : 'Validate ready source and deploy.';
    record(release);
    const logFile = path.join(receiptDir, `${release.id}-attempt-${release.attempts}.log`);
    for (const [stage, command, args] of [
      ['Tests', 'npm', ['test']], ['Dependency audit', 'npm', ['audit', '--audit-level=high']], ['Diff validation', 'git', ['diff', '--check']],
    ]) { release.stage = stage; record(release); console.log(stage); run(command, args, { logFile }); }
    if (fingerprint() !== release.sourceHash) { release.status = 'blocked'; throw new Error('Source changed during validation. Waiting for the owning session.'); }
    fs.writeFileSync(path.join(root, 'lib/deployment-release.json'), JSON.stringify({ id: release.id, sourceHash: release.sourceHash, summary: release.summary, updatedAt: new Date().toISOString() }, null, 2) + '\n');
    release.stage = 'Production build'; record(release); console.log(release.stage); run('npm', ['run', 'build:cloudflare'], { logFile });
    if (fingerprint() !== release.sourceHash) { release.status = 'blocked'; throw new Error('Source changed during build. Waiting for the owning session.'); }
    validateBuildInputs({production:true});
    release.status = 'deploying'; release.stage = 'Cloudflare deployment'; record(release); console.log(release.stage); run('opennext', ['deploy'], { logFile });
    release.status = 'verifying'; release.stage = 'Verify live release and access protection'; record(release);
    release.verification = await verifyLiveRelease(release.id);
    release.status = 'verified'; release.stage = 'Live release verified'; release.verifiedAt = new Date().toISOString(); release.reason = ''; record(release);
    for (const old of readRuns()) {
      if (canSupersedeDeployment(old,release)) {
        old.status = 'superseded'; old.resolvedBy = release.id; old.reason = 'Replaced by the verified release from this workspace.'; record(old);
      }
    }
    console.log('VERIFIED', release.id); return true;
  } catch (error) {
    if (release.status !== 'verified' && release.status !== 'blocked') release.status = release.attempts >= MAX_DEPLOYMENT_ATTEMPTS ? 'attention_required' : 'retry_scheduled';
    release.reason = ['Command failed', 'Command timed out'].includes(error.message) ? `${error.message} at ${release.stage}. Details are in the private local attempt log.` : error.message;
    release.nextRetryAt = retryTime(release.attempts);
    try { record(release); } catch { console.error('Remote receipt unavailable; local receipt retained.'); }
    console.error(release.status, release.reason); return release.status === 'verified';
  } finally { fs.unlinkSync(lockPath); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = key => args.includes(key) ? args[args.indexOf(key) + 1] || '' : '';
  const now = new Date().toISOString();
  const pending = args.includes('--pending');
  const requestedTarget=value('--target');if(requestedTarget && requestedTarget!=='field-demo')throw new Error('Unknown deployment target');
  const release = { id: randomUUID(), ...(requestedTarget?{target:'field_demo'}:{}), summary: (value('--summary') || 'OPWP website update').slice(0, 240), sourceHash: requestedTarget?demoFingerprint():fingerprint(), commit: run('git', ['rev-parse', 'HEAD'], { capture: true }).trim(), createdAt: now, status: pending ? 'in_progress' : 'ready', ready: !pending, attempts: 0, stage: pending ? 'Waiting for owning session to finish edits' : 'Ready for automatic deployment', reason: value('--reason').slice(0, 500) };
  record(release);
  if (pending) console.log('Work registered; deployment waits until the session submits ready source.');
  else {
    const ok = await attemptRelease(release);
    if (!ok && release.status === 'retry_scheduled') {
      try {
        requestRecovery(release.id);
        console.log('Deployment failed; bounded automatic recovery was requested.');
      } catch (error) {
        release.status = 'attention_required';
        release.nextRetryAt = null;
        release.reason = `${release.reason} Automatic recovery could not be started; run npm run deployment:check after reviewing the failure.`;
        try { record(release); } catch { console.error('Automatic recovery and remote receipt updates are unavailable; the local receipt was retained.'); }
        console.error(error.message);
      }
    }
    process.exitCode = ok ? 0 : 1;
  }
}
