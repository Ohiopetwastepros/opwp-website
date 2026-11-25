import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { vars } = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('production keeps Meta in test mode', () => {
  assert.equal(vars?.META_TEST_MODE, 'true');
});

test('production keeps win-back disabled', () => {
  assert.equal(vars?.WINBACK_ENABLED, 'false');
});
