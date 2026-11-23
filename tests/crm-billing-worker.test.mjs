import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledCrmBilling } from '../lib/crm-billing-worker.mjs';
import { patchQuoteFollowUpWorker } from '../scripts/patch-quote-follow-up-worker.mjs';

test('billing scheduler remains inert in production even with activation flags and a database', async () => {
  let queries = 0;
  const DB = { prepare() { queries++; throw new Error('Unexpected data access'); } };
  for (const env of [{ DB }, { DB, APP_ENV: 'production', ROUTE_OS_BILLING_ENABLED: 'true', CRM_PAYMENTS_ENV: 'uat' }]) assert.deepEqual(await runScheduledCrmBilling(env), { status: 'disabled' });
  assert.equal(queries, 0);
});

test('billing patch installs one independent scheduler and preserves all other processors', () => {
  const once = patchQuoteFollowUpWorker('export default { async scheduled(controller, env, ctx) {} };');
  assert.equal(patchQuoteFollowUpWorker(once), once);
  assert.equal((once.match(/runScheduledCrmBilling\(env,/g) || []).length, 1);
  for (const name of ['processDueCrmSubscriptions', 'runScheduledQuoteFollowUps', 'processFieldMessages', 'runFailedPaymentRecovery']) assert.ok(once.includes(`${name}(env`));
});
