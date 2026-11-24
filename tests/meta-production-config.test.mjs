import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production Meta test mode or automation requires an allowed Page', () => {
  const { vars } = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(vars.APP_ENV, 'production');
  if (vars.META_TEST_MODE !== 'true' && vars.META_AUTOMATION_ENABLED !== 'true') return;
  const pages = String(vars.META_ALLOWED_PAGE_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  assert.ok(pages.length, 'Production Meta modes require nonempty META_ALLOWED_PAGE_IDS.');
});

test('production Meta verification permits only Craig while cadence and win-back stay off', () => {
  const { vars } = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(vars.META_TEST_MODE, 'true');
  assert.equal(vars.META_AUTOMATION_ENABLED, 'false');
  assert.equal(vars.META_TEST_RECIPIENTS, '+14192620424');
  assert.equal(vars.META_TEST_FORM_IDS, '1725121795904553');
  assert.equal(vars.META_TEST_APPROVAL_ID, 'meta-test-conversation-2-2026-11-23-craig');
  assert.equal(vars.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY, 'true');
  assert.equal(vars.LEAD_PLAYBOOK_NOTIFY_ENABLED, 'true');
  assert.equal(vars.LEAD_PLAYBOOK_NOTIFY_CHANNELS, 'sms');
  assert.equal(vars.LEAD_CONVERSATION_V2_ENABLED, 'true');
  assert.equal(vars.LEAD_CLASSIFIER_ENABLED, 'true');
  assert.equal(vars.LEAD_CLASSIFIER_KILL_SWITCH, 'false');
  assert.equal(vars.LEAD_CLASSIFIER_PROVIDER, 'workers_ai');
  assert.equal(vars.LEAD_CLASSIFIER_MODEL, '@cf/openai/gpt-oss-120b');
  assert.equal(vars.LEAD_CLASSIFIER_DAILY_CAP, '100');
  assert.equal(vars.LEAD_REPLY_WATCHDOG_ENABLED, 'true');
  assert.equal(vars.LEAD_REPLY_WATCHDOG_SECONDS, '60');
  assert.equal(vars.META_CADENCE_ENABLED, 'false');
  assert.equal(vars.WINBACK_ENABLED, 'false');
  assert.equal(vars.WINBACK_SEND_ENABLED, 'false');
  assert.equal(vars.WINBACK_AUTOREPLY_ENABLED, 'false');
  assert.equal(vars.WINBACK_KILL_SWITCH, 'true');
  assert.equal(vars.WINBACK_STORAGE_READY, 'false');
  assert.equal(vars.WINBACK_CAMPAIGN_ID, '');
  assert.equal(vars.WINBACK_SNG_PAUSED_PATH, '');
  assert.equal(vars.META_AUTOMATION_APPROVAL_ID, 'meta-live-2026-11-18');
  assert.equal(Object.hasOwn(vars, 'META_CADENCE_APPROVAL_ID'), false);
  assert.equal(vars.META_ALLOWED_PAGE_IDS, '617929208074485');
});
