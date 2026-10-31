export const MAX_DEPLOYMENT_ATTEMPTS = 3;
export function canSupersedeDeployment(previous,current) {
  return previous.id!==current.id && (previous.target||'website')===(current.target||'website') &&
    !['verified','superseded'].includes(previous.status) &&
    (previous.createdAt||previous.updatedAt)<current.createdAt &&
    (previous.ready===true || previous.summary===current.summary);
}
export function recoveryDecision(run, { now = Date.now(), sourceHash, busy = false } = {}) {
  if (['verified', 'superseded'].includes(run.status)) return { action: 'none' };
  if (!run.ready) return { action: 'wait', reason: 'Work is still in progress; the owning session must mark it ready.' };
  if (busy) return { action: 'wait', reason: 'Another release owns the production lock.' };
  if (run.sourceHash !== sourceHash) return { action: 'source_changed', reason: 'Workspace changed after this release was submitted; waiting for the owning session to submit current source.' };
  if ((run.attempts || 0) >= MAX_DEPLOYMENT_ATTEMPTS) return { action: 'attention', reason: 'Three automatic attempts failed. A code or configuration repair is required; release checks remain enforced.' };
  if (Date.parse(run.nextRetryAt || '') > now) return { action: 'wait', reason: `Automatic retry scheduled for ${run.nextRetryAt}.` };
  return { action: 'retry', reason: 'Retry release checks, rebuild, deploy, and verify the live release.' };
}
export function retryTime(attempts, now = Date.now()) {
  return attempts >= MAX_DEPLOYMENT_ATTEMPTS ? null : new Date(now + (attempts <= 1 ? 0 : 5 * 60_000)).toISOString();
}
export function controllerHealth(controller, now = Date.now(), { failureTriggered = false } = {}) {
  if (failureTriggered || controller?.mode === 'failure_triggered') {
    if (controller?.status === 'repairing') return now - Date.parse(controller.checkedAt || '') > 30 * 60_000 ? 'Recovery interrupted' : 'Recovery running';
    if (controller?.status === 'attention_required') return 'Attention required';
    if (controller?.status === 'blocked') return 'Blocked';
    return 'Standby (failure-triggered)';
  }
  if (!controller?.checkedAt) return 'Not reporting';
  const limit = controller.status === 'repairing' ? 30 * 60_000 : 3 * 60_000;
  return now - Date.parse(controller.checkedAt) > limit ? 'Offline or delayed' : controller.status === 'repairing' ? 'Recovery running' : 'Monitoring';
}
