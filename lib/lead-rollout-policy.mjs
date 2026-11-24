import { normalizePhone } from './lead-assistant.mjs';

// A configured allowlist cannot grant this test-only exception to another number.
export function isCraigMetaTest(env = {}, phone) {
  return env.META_TEST_MODE === 'true'
    && normalizePhone(phone) === '+14192620424';
}

// A controlled live verification can run with the real Meta release policy while
// holding every other lead recipient. An invalid or multi-number scope fails shut.
export function controlledLeadTestRecipient(env = {}) {
  const values = String(env.META_TEST_RECIPIENTS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (values.length !== 1) return null;
  const phone = normalizePhone(values[0]);
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone) ? phone : null;
}

export function controlledLeadRecipientAllowed(env = {}, phone) {
  if (env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY !== true && env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY !== 'true') return true;
  const approved = controlledLeadTestRecipient(env);
  return Boolean(approved && normalizePhone(phone) === approved);
}
