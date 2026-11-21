import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {evaluatePlaybookCustomerAdmission} from '../lib/lead-playbook-customer-policy.mjs';

const PHONE = '+14195550100';
const NOW = new Date('2026-11-21T17:00:00Z');
const existing = async () => ({ok: true, complete: true, rows: [{cell_phone_number: '419-555-0100'}, {cell_phone_number: '419-555-0101'}]});
const empty = async () => ({ok: true, complete: true, rows: []});
function fixture(t) {
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  const evidence = {valid: true, formId: 'fixture-form', pageId: 'fixture-page', field: 'sms_consent', answer: 'yes', version: 'fixture-v1', disclosure: 'Fixture quote consent', capturedAt: '2026-11-21T15:00:00Z'};
  db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,name,phone,payload)
    VALUES ('scoped-lead','question','facebook_lead','new','Fictional Contact',?,?)`)
    .run(PHONE, JSON.stringify({follow_up_consent: true, number_of_dogs: 1, clean_up_frequency: 'Weekly', zip: '43528', sms_consent_evidence: evidence}));
  db.sqlite.exec(`INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode,last_outbound_at)
    VALUES ('scoped-conversation','scoped-lead','org-opwp','facebook_lead','backend','approved',CURRENT_TIMESTAMP);
    INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,review_reason)
    VALUES ('scoped-lead','org-opwp','fixture-meta-lead','fixture-form','fixture-page','fixture://meta','fixture');`);
  const scope = {approvalId: 'fixture-craig-approved-test', approvedBy: 'fixture-owner', approvedAt: '2026-11-21T16:00:00Z', expiresAt: '2026-11-21T18:00:00Z',
    organizationId: 'org-opwp', submissionId: 'scoped-lead', conversationId: 'scoped-conversation', phone: PHONE, formId: 'fixture-form', metaLeadId: 'fixture-meta-lead'};
  const env = {LEAD_PLAYBOOK_ENABLED: 'true', LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: PHONE, LEAD_PLAYBOOK_CRAIG_CELL: PHONE, META_TEST_FORM_IDS: 'fixture-form'};
  const lead = () => db.sqlite.prepare("SELECT * FROM submissions WHERE id='scoped-lead'").get();
  const conversation = () => db.sqlite.prepare("SELECT * FROM lead_conversations WHERE id='scoped-conversation'").get();
  const evaluate = (config = env, authorization = scope, options = {}) => evaluatePlaybookCustomerAdmission(db,
    {...config, ...(authorization === undefined ? {} : {LEAD_PLAYBOOK_CUSTOMER_TEST_EXCEPTION: JSON.stringify(authorization)})},
    {lead: lead(), conversation: conversation()}, {now: NOW, loadCustomerDirectory: existing, ...options});
  return {db, scope, env, lead, conversation, evaluate};
}

test('ordinary existing customers remain held despite forms, buying intent or customer-supplied admission booleans', async t => {
  const f = fixture(t);
  for (const patch of [{}, {existing_customer_inquiry_approved: true}, {allow_existing_customer: true}, {test_mode: true}, {question: 'I want a new quote for a different property'}]) {
    const payload = {...JSON.parse(f.lead().payload), ...patch};
    f.db.sqlite.prepare("UPDATE submissions SET payload=? WHERE id='scoped-lead'").run(JSON.stringify(payload));
    const result = await evaluatePlaybookCustomerAdmission(f.db, {...f.env}, {lead: f.lead(), conversation: f.conversation()}, {now: NOW, loadCustomerDirectory: existing});
    assert.deepEqual(result, {allowed: false, reason: 'existing_customer'});
  }
});

test('a verified noncustomer is admitted after both customer directories return complete results', async t => {
  const f = fixture(t), paths = [];
  const result = await f.evaluate({}, undefined, {loadCustomerDirectory: async path => {paths.push(path); return empty();}});
  assert.deepEqual(result, {allowed: true, kind: 'new_contact'});
  assert.deepEqual(paths, ['/api/v1/clients/active', '/api/v1/clients/active_no_subscription']);
});

test('directory matches, malformed lists, incomplete data and outages retain protection', async t => {
  const f = fixture(t);
  for (const matched of ['/api/v1/clients/active', '/api/v1/clients/active_no_subscription']) {
    const result = await f.evaluate({}, undefined, {loadCustomerDirectory: async path => path === matched ? existing() : empty()});
    assert.deepEqual(result, {allowed: false, reason: 'existing_customer'});
  }
  for (const lookup of [async () => ({ok: false, complete: false, rows: []}), async () => ({ok: true, complete: false, rows: []}), async () => ({ok: true, complete: true}), async () => {throw new Error('Fixture unavailable');}]) {
    assert.deepEqual(await f.evaluate({}, undefined, {loadCustomerDirectory: lookup}), {allowed: false, reason: 'customer_directory_unverified'});
  }
});

test('the approved exception admits only its canonical controlled-test conversation without reading customer directories', async t => {
  const f = fixture(t);
  const result = await f.evaluate(f.env, f.scope, {loadCustomerDirectory() {assert.fail('An exact authorized fixture need not query the live directory');}});
  assert.deepEqual(result, {allowed: true, kind: 'controlled_test'});
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM lead_messages').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n, 0);
});

test('test approval starts at its explicit timestamp, expires strictly, and never lasts longer than 24 hours', async t => {
  const f = fixture(t);
  const duration = {...f.scope, approvedAt: '2026-11-20T18:00:00Z', expiresAt: '2026-11-21T18:00:00Z'};
  assert.deepEqual(await f.evaluate(f.env, duration), {allowed: true, kind: 'controlled_test'});
  assert.deepEqual(await f.evaluate(f.env, {...f.scope, approvedAt: '2026-11-21T17:00:00Z'}), {allowed: true, kind: 'controlled_test'});
  assert.deepEqual(await f.evaluate(f.env, duration, {now: new Date('2026-11-21T18:00:00Z')}), {allowed: false, reason: 'existing_customer'});
});

test('missing, malformed, extended or incorrectly scoped test authorizations never bypass an existing-customer match', async t => {
  const f = fixture(t);
  for (const [label, authorization] of [
    ['wrong organization', {...f.scope, organizationId: 'other-org'}],
    ['wrong submission', {...f.scope, submissionId: 'other-lead'}],
    ['wrong conversation', {...f.scope, conversationId: 'other-conversation'}],
    ['wrong phone', {...f.scope, phone: '+14195550101'}],
    ['wrong form', {...f.scope, formId: 'other-form'}],
    ['wrong Meta lead', {...f.scope, metaLeadId: 'other-meta-lead'}],
    ['missing approval ID', {...f.scope, approvalId: ''}],
    ['missing approver', {...f.scope, approvedBy: ''}],
    ['future approval', {...f.scope, approvedAt: '2026-11-21T17:00:01Z'}],
    ['expired', {...f.scope, expiresAt: '2026-11-21T17:00:00Z'}],
    ['reversed dates', {...f.scope, approvedAt: '2026-11-21T18:00:00Z'}],
    ['over 24 hours', {...f.scope, expiresAt: '2026-11-22T16:00:01Z'}],
    ['invalid date', {...f.scope, approvedAt: 'not-a-date'}],
    ['unknown authorization key', {...f.scope, bypassAllCustomers: true}],
  ]) assert.deepEqual(await f.evaluate(f.env, authorization), {allowed: false, reason: 'existing_customer'}, label);
  for (const value of ['', 'not-json', 'null', '[]', 'true']) {
    const config = {...f.env, LEAD_PLAYBOOK_CUSTOMER_TEST_EXCEPTION: value};
    assert.deepEqual(await evaluatePlaybookCustomerAdmission(f.db, config, {lead: f.lead(), conversation: f.conversation()}, {now: NOW, loadCustomerDirectory: existing}), {allowed: false, reason: 'existing_customer'}, value);
  }
});

test('controlled-recipient and owner/test-form configuration are all required for the exception', async t => {
  const f = fixture(t);
  for (const [label, patch] of [
    ['playbook disabled', {LEAD_PLAYBOOK_ENABLED: 'false'}],
    ['controlled mode absent', {LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: undefined}],
    ['controlled mode false', {LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'false'}],
    ['recipient absent', {META_TEST_RECIPIENTS: ''}],
    ['recipient different', {META_TEST_RECIPIENTS: '+14195550101'}],
    ['multiple recipients', {META_TEST_RECIPIENTS: PHONE+',+14195550101'}],
    ['owner absent', {LEAD_PLAYBOOK_CRAIG_CELL: ''}],
    ['owner different', {LEAD_PLAYBOOK_CRAIG_CELL: '+14195550101'}],
    ['form absent', {META_TEST_FORM_IDS: ''}],
    ['form different', {META_TEST_FORM_IDS: 'other-form'}],
    ['multiple forms', {META_TEST_FORM_IDS: 'fixture-form,other-form'}],
  ]) assert.deepEqual(await f.evaluate({...f.env, ...patch}), {allowed: false, reason: 'existing_customer'}, label);
});

test('canonical Meta intake and consent evidence cannot be replaced by a different contact or duplicate', async t => {
  for (const change of [
    "UPDATE lead_conversations SET organization_id='other-org' WHERE id='scoped-conversation'",
    "UPDATE lead_conversations SET owner='craig' WHERE id='scoped-conversation'",
    "UPDATE lead_conversations SET status='deleted' WHERE id='scoped-conversation'",
    "UPDATE submissions SET phone='+14195550101' WHERE id='scoped-lead'",
    "UPDATE submissions SET status='converted' WHERE id='scoped-lead'",
    "UPDATE submissions SET lifecycle_stage='converted' WHERE id='scoped-lead'",
    "UPDATE meta_lead_intakes SET form_id='other-form' WHERE submission_id='scoped-lead'",
    "UPDATE meta_lead_intakes SET meta_lead_id='other-meta-lead' WHERE submission_id='scoped-lead'",
    "UPDATE meta_lead_intakes SET organization_id='other-org' WHERE submission_id='scoped-lead'",
    "DELETE FROM meta_lead_intakes WHERE submission_id='scoped-lead'",
    "UPDATE submissions SET payload=json_set(payload,'$.sms_consent_evidence.valid',json('false')) WHERE id='scoped-lead'",
    "UPDATE submissions SET payload=json_set(payload,'$.sms_consent_evidence.formId','other-form') WHERE id='scoped-lead'",
    "UPDATE submissions SET payload=json_set(payload,'$.sms_consent_evidence.pageId','other-page') WHERE id='scoped-lead'",
  ]) {
    const f = fixture(t); f.db.sqlite.exec(change);
    assert.deepEqual(await f.evaluate(), {allowed: false, reason: 'existing_customer'}, change);
  }
  const f = fixture(t);
  f.db.sqlite.exec("INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES ('prior-lead','question','facebook_lead','new','+14195550100','{}'); UPDATE meta_lead_intakes SET duplicate_of='prior-lead' WHERE submission_id='scoped-lead'");
  assert.deepEqual(await f.evaluate(), {allowed: false, reason: 'existing_customer'});
});
