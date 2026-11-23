import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { previewConfig, previewVars, wranglerArgs } from '../scripts/local-preview.mjs';

test('preview config and command builders can only address the dedicated local fixtures', () => {
  const config = previewConfig();
  assert.equal(config.vars.APP_ENV, 'development'); assert.equal(config.vars.CRM_PAYMENTS_PROVIDER, 'fake');
  assert.deepEqual(config.triggers.crons, []); assert.equal(config.routes, undefined);
  assert.equal(config.d1_databases[0].database_id, '00000000-0000-4000-8000-000000000071');
  for (const key of ['EMAIL_SENDING_ENABLED', 'FIELD_NOTIFICATIONS_ENABLED', 'META_AUTOMATION_ENABLED', 'DISPATCH_AUTOMATION_ENABLED']) assert.equal(config.vars[key], 'false');
  for (const mode of ['migrate', 'seed', 'serve']) {
    const args = wranglerArgs(mode); assert.ok(args.includes('--local')); assert.ok(args.includes('--persist-to')); assert.ok(!args.includes('--remote')); assert.ok(args.includes('wrangler.local-preview.json'));
  }
  assert.throws(() => wranglerArgs('deploy'));
});

test('local Worker blocks outbound fetch and deployment actions and never invokes scheduled application work', async () => {
  let applicationCalls = 0, scheduledCalls = 0, networkCalls = 0;
  const source = fs.readFileSync(new URL('../scripts/local-preview-worker.mjs', import.meta.url), 'utf8').replace("import application from './worker.js';", '').replace('export default', 'globalThis.worker =');
  const context = { Response, Request, URL, Headers, application: { async fetch() { applicationCalls++; await context.fetch('https://example.invalid'); }, async scheduled() { scheduledCalls++; } }, fetch: async () => { networkCalls++; }, console };
  vm.runInNewContext(source, context);
  const env = { ...previewVars(), DB: { prepare: () => ({ first: async () => ({ count: 25 }) }) } };
  assert.equal((await context.worker.fetch(new Request('https://example.test/local-preview/'), env, {})).status, 403);
  assert.equal((await context.worker.fetch(new Request('http://localhost:8787/local-preview/'), { ...env, APP_ENV: 'production' }, {})).status, 403);
  assert.equal((await context.worker.fetch(new Request('http://localhost:8787/api/admin/deployments/', { method: 'POST' }), env, {})).status, 403);
  const result = await (await context.worker.fetch(new Request('http://localhost:8787/local-preview/check-egress/'), env, {})).json();
  assert.equal(result.blocked, true); assert.equal(networkCalls, 0);
  await context.worker.scheduled({}, env, {}); assert.equal(scheduledCalls, 0);
  await assert.rejects(context.worker.fetch(new Request('http://localhost:8787/admin/crm/subscriptions/'), env, {}), /OUTBOUND_BLOCKED/);
  assert.equal(applicationCalls, 1); assert.equal(networkCalls, 0);
});
