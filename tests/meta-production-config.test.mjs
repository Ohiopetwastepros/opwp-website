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

test('production Meta first confirmation is live while follow-up cadence stays off', () => {
  const { vars } = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(vars.META_TEST_MODE, 'false');
  assert.equal(vars.META_AUTOMATION_ENABLED, 'true');
  assert.equal(vars.META_AUTOMATION_APPROVAL_ID, 'meta-live-2026-11-18');
  assert.equal(Object.hasOwn(vars, 'META_CADENCE_APPROVAL_ID'), false);
  assert.equal(vars.META_ALLOWED_PAGE_IDS, '617929208074485');
});
