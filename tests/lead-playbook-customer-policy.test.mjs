import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePlaybookCustomerAdmission} from '../lib/lead-playbook-customer-policy.mjs';
import {isCraigMetaTest} from '../lib/lead-rollout-policy.mjs';

const CRAIG = '+14192620424', OTHER = '+14195550100';
const existing = phone => async () => ({ok: true, complete: true, rows: [{cell_phone_number: phone}]});
const empty = async () => ({ok: true, complete: true, rows: []});
const evaluate = (env, lead, lookup) => evaluatePlaybookCustomerAdmission(null, env, {lead}, {loadCustomerDirectory: lookup});

test("Craig's explicit test-mode customer exception skips directory I/O", async () => {
  const lead = {phone: CRAIG, existing_customer: true, payload: JSON.stringify({is_existing_customer: true})};
  assert.deepEqual(await evaluate({META_TEST_MODE: 'true'}, lead, () => assert.fail('No directory read for the authorized test number')), {allowed: true, kind: 'controlled_test'});
});

test('formatted Craig phone normalizes to the same single authorized number', () => {
  assert.equal(isCraigMetaTest({META_TEST_MODE: 'true'}, '(419) 262-0424'), true);
  for (const phone of [OTHER, '+14192620425', '', null]) assert.equal(isCraigMetaTest({META_TEST_MODE: 'true'}, phone), false);
});

for (const mode of ['false', false, true, undefined, 'TRUE', '1']) test(`live/invalid test flag ${typeof mode} ${String(mode)} still blocks Craig's existing-customer directory match`, async () => {
  assert.deepEqual(await evaluate({META_TEST_MODE: mode, META_AUTOMATION_ENABLED: 'true'}, {phone: CRAIG, payload: '{}'}, existing(CRAIG)), {allowed: false, reason: 'existing_customer'});
});

test('test mode and a changed allowlist cannot exempt another existing customer', async () => {
  for (const recipients of [CRAIG, OTHER, CRAIG+','+OTHER]) {
    assert.deepEqual(await evaluate({META_TEST_MODE: 'true', META_TEST_RECIPIENTS: recipients}, {phone: OTHER, payload: '{}'}, existing(OTHER)), {allowed: false, reason: 'existing_customer'});
  }
});

test('legacy scoped JSON and customer-supplied booleans cannot grant live or other-number exceptions', async () => {
  for (const phone of [CRAIG, OTHER]) {
    for (const META_TEST_MODE of ['false', ...(phone === OTHER ? ['true'] : [])]) {
      const env = {META_TEST_MODE, LEAD_PLAYBOOK_CUSTOMER_TEST_EXCEPTION: JSON.stringify({phone, approvedBy: 'fixture', allowAll: true})};
      assert.deepEqual(await evaluate(env, {phone, payload: JSON.stringify({test_mode: true, allow_existing_customer: true})}, existing(phone)), {allowed: false, reason: 'existing_customer'});
    }
  }
});

test('nonexempt existing-customer flags hold before directory calls', async () => {
  for (const patch of [{existing_customer: true}, {is_existing_customer: true}, {payload: JSON.stringify({existing_customer: true})}]) {
    assert.deepEqual(await evaluate({META_TEST_MODE: 'true'}, {phone: OTHER, ...patch}, () => assert.fail('Known customers stay held')), {allowed: false, reason: 'existing_customer'});
  }
});

test('noncustomers require complete directory reads and outages remain fail closed', async () => {
  const paths = [];
  assert.deepEqual(await evaluate({}, {phone: OTHER}, async path => {paths.push(path); return empty();}), {allowed: true, kind: 'new_contact'});
  assert.deepEqual(paths, ['/api/v1/clients/active', '/api/v1/clients/active_no_subscription']);
  for (const lookup of [async () => {throw Error('fixture outage');}, async () => ({ok: true, complete: false, rows: []}), async () => ({ok: true, complete: true})]) {
    assert.deepEqual(await evaluate({META_TEST_MODE: 'true'}, {phone: OTHER}, lookup), {allowed: false, reason: 'customer_directory_unverified'});
  }
});
