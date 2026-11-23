import test from 'node:test';
import assert from 'node:assert/strict';
import { patchQuoteFollowUpWorker } from '../scripts/patch-quote-follow-up-worker.mjs';
import { processDueCrmSubscriptions } from '../lib/crm-subscription-store.mjs';

test('the local Worker patch installs one independent subscription scheduler and preserves existing processors', () => {
  const original = 'export default { async scheduled(controller, env, ctx) {} };';
  const once = patchQuoteFollowUpWorker(original), twice = patchQuoteFollowUpWorker(once);
  assert.equal(once, twice);
  assert.equal((once.match(/processDueCrmSubscriptions\(env,/g) || []).length, 1);
  for (const name of ['runScheduledQuoteFollowUps', 'runScheduledYardOps', 'runFailedPaymentRecovery', 'processFieldMessages', 'runScheduledReviewRequests']) assert.ok(once.includes(`${name}(env)`));
  assert.ok(once.includes('now: controller.scheduledTime'));
});

test('the new scheduler remains inert without explicit activation even if a database binding exists', async () => {
  let queries = 0;
  const result = await processDueCrmSubscriptions({ DB: { prepare() { queries++; throw new Error('Not authorized to access data'); } }, APP_ENV: 'production' });
  assert.deepEqual(result, { status: 'disabled', updated: 0 }); assert.equal(queries, 0);
});
