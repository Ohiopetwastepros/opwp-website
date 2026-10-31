import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { recoveryDecision } from '../lib/deployment-policy.mjs';
import {
  receiptDir,
  controllerLockPath,
  lockPath,
  fingerprint,
  readRuns,
  record,
  heartbeat,
  acquireLock,
  recoverAbandonedLock,
  flushReceipts,
  readRecoveryRequest,
  clearRecoveryRequest,
} from './deployment-store.mjs';
import { attemptRelease } from './deploy.mjs';
import { demoFingerprint } from './field-demo-project.mjs';

export const MAX_TRIGGERED_WAIT_MS = 6 * 60_000;

export async function runBoundedRecovery(release, {
  currentSourceHash,
  isBusy = () => false,
  attempt = attemptRelease,
  sleep = sleepFor,
  now = () => Date.now(),
  onDecision = () => {},
} = {}) {
  while (true) {
    const decision = recoveryDecision(release, { now: now(), sourceHash: currentSourceHash(), busy: isBusy() });
    await onDecision(decision, release);
    if (decision.action === 'retry') {
      await attempt(release);
      continue;
    }
    if (decision.action === 'wait') {
      const delay = Date.parse(release.nextRetryAt || '') - now();
      if (!isBusy() && Number.isFinite(delay) && delay > 0 && delay <= MAX_TRIGGERED_WAIT_MS) {
        await sleep(delay);
        continue;
      }
    }
    return { decision, terminal: ['none', 'source_changed', 'attention'].includes(decision.action) };
  }
}

export async function runController() {
  recoverAbandonedLock(controllerLockPath);
  if (!acquireLock(controllerLockPath, 'controller')) return;
  try {
    const recovered = recoverAbandonedLock(lockPath);
    if (!fs.existsSync(lockPath)) flushReceipts();
    const request = readRecoveryRequest();
    const runs = readRuns();
    const candidate = request
      ? runs.find(run => run.id === request.releaseId)
      : runs.find(run => run.ready && !['verified', 'superseded'].includes(run.status));

    if (!candidate) {
      heartbeat({
        status: request ? 'attention_required' : 'standby',
        action: request ? 'missing_receipt' : 'none',
        reason: request ? 'The requested failed release receipt is unavailable; manual review is required.' : 'No failed release requested recovery.',
        releaseId: request?.releaseId || null,
        recoveredLock: recovered,
      });
      if (request) clearRecoveryRequest(request.releaseId);
      return;
    }

    const outcome = await runBoundedRecovery(candidate, {
      currentSourceHash: () => candidate.target === 'field_demo' ? demoFingerprint() : fingerprint(),
      isBusy: () => fs.existsSync(lockPath),
      onDecision: decision => heartbeat({
        status: ['retry', 'wait'].includes(decision.action) ? 'repairing' : decision.action === 'attention' ? 'attention_required' : decision.action === 'source_changed' ? 'blocked' : 'standby',
        action: decision.action,
        reason: decision.reason || candidate.reason || 'Recovery completed.',
        releaseId: candidate.id,
        nextRetryAt: candidate.nextRetryAt || null,
        recoveredLock: recovered,
      }),
    });

    if (outcome.decision.action === 'source_changed' || outcome.decision.action === 'attention') {
      candidate.status = outcome.decision.action === 'attention' ? 'attention_required' : 'blocked';
      candidate.reason = outcome.decision.reason;
      candidate.nextRetryAt = null;
      record(candidate);
    }
    if (!outcome.terminal) throw new Error(`Recovery deferred: ${outcome.decision.reason}`);

    heartbeat({
      status: candidate.status === 'attention_required' ? 'attention_required' : candidate.status === 'blocked' ? 'blocked' : 'standby',
      action: candidate.status,
      reason: candidate.reason || 'Live deployment verified.',
      releaseId: candidate.id,
      nextRetryAt: candidate.nextRetryAt || null,
      recoveredLock: recovered,
    });
    if (request?.releaseId === candidate.id) clearRecoveryRequest(candidate.id);
  } catch (error) {
    fs.appendFileSync(`${receiptDir}/controller-errors.log`, `${new Date().toISOString()} Failure-triggered recovery stopped; inspect the requested release and private attempt logs.\n`);
    throw error;
  } finally {
    fs.unlinkSync(controllerLockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runController(); }
  catch { process.exitCode = 1; }
}
