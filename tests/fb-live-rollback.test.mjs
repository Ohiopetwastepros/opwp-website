import test from 'node:test';
import assert from 'node:assert/strict';
import {rollbackPlan, validateRollbackApproval, LIVE_RELEASE_ID, TEST_VARS} from '../scripts/fb-live-rollback.mjs';

test('rollback plan preserves other vars, revokes only its release and uses the guarded runner', () => {
  const plan = rollbackPlan({UNRELATED:'keep'});
  assert.equal(plan.vars.UNRELATED, 'keep');
  assert.equal(plan.vars.META_TEST_RECIPIENTS, '+14192620424');
  assert.equal(plan.vars.META_CADENCE_ENABLED, 'false');
  assert.equal(plan.vars.LEAD_PLAYBOOK_AUTO_SEND_ENABLED, 'false');
  assert.match(plan.sql, /UPDATE meta_automation_releases SET revoked_at=CURRENT_TIMESTAMP WHERE id='meta-live-2026-11-23-golive'/);
  assert.doesNotMatch(plan.sql, /DELETE|DROP|INSERT/i);
  assert.deepEqual(plan.deploy.slice(0,4), ['npm','run','deploy','--']);
});
test('rollback refuses missing, stale, placeholder, wrong-commit or partial approvals', () => {
  const head = 'a'.repeat(40), approval = {approvedBy:'Craig Bridgman', action:'fb-live-rollback', releaseId:LIVE_RELEASE_ID, expectedCommit:head, approveProductionD1Write:true, approveProductionDeploy:true, approvalText:'approved both exact rollback actions', approvedAt:new Date().toISOString()};
  assert.doesNotThrow(() => validateRollbackApproval(approval, head));
  for (const changed of [{}, {...approval, approveProductionD1Write:false}, {...approval, expectedCommit:'b'.repeat(40)}, {...approval, approvalText:'<approved placeholder>'}, {...approval, approvedAt:'2000-01-01T00:00:00Z'}]) assert.throws(() => validateRollbackApproval(changed, head));
  assert.deepEqual(Object.keys(TEST_VARS).sort(), ['LEAD_AUTOMATION_CONTROLLED_TEST_ONLY','LEAD_PLAYBOOK_AUTO_SEND_ENABLED','META_AUTOMATION_ENABLED','META_CADENCE_ENABLED','META_TEST_FORM_IDS','META_TEST_MODE','META_TEST_RECIPIENTS'].sort());
});
