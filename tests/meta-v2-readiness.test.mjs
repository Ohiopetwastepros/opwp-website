import test from 'node:test';
import assert from 'node:assert/strict';
import { leadTestDatabase } from './helpers/lead-inbox-fixture.mjs';
import { normalizeMetaLead } from '../lib/meta-leads.mjs';
import { mapMetaAnswers } from '../lib/meta-lead-policy.mjs';
import { storeMetaLead, processMetaConfirmations, queueMetaCadence } from '../lib/meta-lead-workflow.mjs';
import { controlledLeadRecipientAllowed, controlledLeadTestRecipient } from '../lib/lead-rollout-policy.mjs';
import { formatCustomerSms } from '../lib/customer-sms.mjs';

const approvedPhone = '+14195550100';
const otherPhone = '+14195550102';
const overnight = new Date('2026-11-21T06:00:00Z');
function fixture() {
  const db = leadTestDatabase();
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('fixture-live','org-opwp','meta-confirmation-v2','fixture-owner','fixture-only approval',datetime('now','-1 minute'),NULL);
    INSERT INTO meta_automation_releases VALUES ('fixture-cadence','org-opwp','meta-nurture-1-3-7-v1','fixture-owner','fixture-only approval',datetime('now','-1 minute'),NULL);
    UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0,quiet_hours_enabled=1,quiet_hours_start='20:00',quiet_hours_end='08:00';`);
  const env = { DB: db, LEAD_PLAYBOOK_ENABLED: 'true', LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: approvedPhone,
    META_AUTOMATION_ENABLED: 'true', META_TEST_MODE: 'false', META_AUTOMATION_APPROVAL_ID: 'fixture-live', META_CADENCE_APPROVAL_ID: 'fixture-cadence', META_CADENCE_ENABLED: 'false',
    QUO_API_KEY: 'fixture-only-key', QUO_FROM_NUMBER: '+14192622371',
    META_APPROVED_SMS_FORMS: JSON.stringify({ 'fixture-form': { pageId: 'fixture-page', consentField: 'sms_consent', version: 'fixture-v1', disclosure: 'Fixture consent to automated quote texts. Reply STOP to opt out.' } }) };
  return { db, env };
}
async function lead(db, env, id = 'fixture-lead', phone = approvedPhone, extra = {}) {
  const data = { id, form_id: 'fixture-form', created_time: new Date().toISOString(), field_data: Object.entries({ full_name: 'Casey Example', phone_number: phone, zip_code: '43615', number_of_dogs: '2', service_frequency: 'weekly', contact_preference: 'text', sms_consent: 'yes', ...extra }).map(([name, value]) => ({ name, values: [value] })) };
  return storeMetaLead(db, env, data, { leadId: id, formId: 'fixture-form', pageId: 'fixture-page' });
}

test('optional Meta yard and cleanup answers survive normalization while conflicting fields need clarification', () => {
  const answers = mapMetaAnswers({ yard_size: '1/4 acre', last_cleaned: 'about two weeks', dog_count: '2' });
  assert.equal(answers.yard_size_answer, '1/4 acre');
  assert.equal(answers.last_cleaned_answer, 'about two weeks');
  assert.equal(answers.mapping.yard.conflict, false);
  assert.equal(mapMetaAnswers({ yard_size: '1/4 acre', how_big_is_your_yard: '3/4 acre' }).yard_size_answer, '');
  const normalized = normalizeMetaLead({ field_data: [{ name: 'yard_size', values: ['3/4 acre'] }, { name: 'last_cleaned', values: ['one month'] }] });
  assert.equal(normalized.yard_size_answer, '3/4 acre');
  assert.equal(normalized.last_cleaned_answer, 'one month');
});

test('controlled rollout accepts exactly one configured recipient and fails closed on malformed scope', () => {
  assert.equal(controlledLeadRecipientAllowed({}, otherPhone), true);
  for (const value of ['', 'bad', `${approvedPhone},${otherPhone}`]) {
    const env = { LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: value };
    assert.equal(controlledLeadTestRecipient(env), null);
    assert.equal(controlledLeadRecipientAllowed(env, approvedPhone), false);
  }
  assert.equal(controlledLeadRecipientAllowed({ LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: approvedPhone }, '(419) 555-0100'), true);
});

test('SMS punctuation is ASCII and STOP appears once after exactly one blank line', () => {
  const body = formatCustomerSms('It\u2019s \u201cCraig\u201d \u2014 a quote\u2026 Reply STOP to opt out.');
  assert.equal(body, 'It\'s "Craig" - a quote...\n\nReply STOP to opt out');
  assert.equal((body.match(/Reply STOP to opt out/g) || []).length, 1);
});

test('Meta v2 confirms instantly overnight with playbook on, records backend authorship and seeds the conversation', async () => {
  const { db, env } = fixture();
  const saved = await lead(db, env);
  const calls = [];
  const result = await processMetaConfirmations(env, { now: overnight, fetcher: async (_url, request) => {
    calls.push(JSON.parse(request.body)); return Response.json({ data: { id: 'AC-fixture-confirmation' } });
  } });
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, '+14192622371');
  assert.deepEqual(calls[0].to, [approvedPhone]);
  assert.match(calls[0].content, /I have you down for 2 dogs.*Did I get that right\?\n\nReply STOP to opt out$/);
  const state = db.sqlite.prepare('SELECT * FROM lead_playbook_state WHERE submission_id=?').get(saved.id);
  assert.equal(state.stage, 'confirm_details_sent');
  assert.equal(JSON.parse(state.state_json).meta_confirmation_sent, true);
  assert.equal(db.sqlite.prepare("SELECT author FROM lead_messages WHERE provider_message_id='AC-fixture-confirmation'").get().author, 'backend');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM lead_reply_drafts').get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM meta_sms_jobs WHERE purpose='follow_up'").get().n, 0);
  assert.equal(await queueMetaCadence(db, { ...env, META_CADENCE_ENABLED: 'true' }, saved.id), false, 'playbook ownership also holds old cadence');
});

test('controlled Meta selection does not consume or cancel another recipient ahead of the approved test', async () => {
  const { db, env } = fixture();
  const other = await lead(db, env, 'fixture-other', otherPhone);
  await lead(db, env);
  let calls = 0;
  const result = await processMetaConfirmations(env, { now: overnight, limit: 1, fetcher: async (_url, request) => {
    calls++; assert.deepEqual(JSON.parse(request.body).to, [approvedPhone]); return Response.json({ data: { id: 'AC-fixture-only-test' } });
  } });
  assert.equal(result.sent, 1); assert.equal(calls, 1);
  const held = db.sqlite.prepare('SELECT status,attempted_at FROM meta_sms_jobs WHERE submission_id=?').get(other.id);
  assert.equal(held.status, 'queued'); assert.equal(held.attempted_at, null);
});

test('an existing unadvanced intro can accept confirmation with the exact prior-state transition guard', async () => {
  const { db, env } = fixture(); const saved = await lead(db, env);
  const conversation = db.sqlite.prepare('SELECT id FROM lead_conversations WHERE submission_id=?').get(saved.id);
  const oldState = JSON.stringify({ stage: 'intro_sent', details_confirmed: false });
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id,state_json,stage) VALUES (?,?,?,'intro_sent')").run(conversation.id, saved.id, oldState);
  const result = await processMetaConfirmations(env, { now: overnight, fetcher: async () => Response.json({ data: { id: 'AC-fixture-existing-intro' } }) });
  assert.equal(result.sent, 1);
  const state = db.sqlite.prepare('SELECT stage,prior_state_json,revision FROM lead_playbook_state WHERE conversation_id=?').get(conversation.id);
  assert.equal(state.stage, 'confirm_details_sent');
  assert.equal(state.prior_state_json, oldState);
  assert.equal(state.revision, 2);
  assert.equal(db.sqlite.prepare("SELECT status FROM meta_sms_jobs WHERE provider_message_id='AC-fixture-existing-intro'").get().status, 'sent');
});

test('Sona ownership blocks even the approved test confirmation before a provider call', async () => {
  const { db, env } = fixture(); const saved = await lead(db, env);
  db.sqlite.prepare("UPDATE lead_conversations SET owner='sona' WHERE submission_id=?").run(saved.id);
  let calls = 0;
  await processMetaConfirmations(env, { now: overnight, fetcher: async () => { calls++; throw Error('must not send'); } });
  assert.equal(calls, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM lead_playbook_state').get().n, 0);
});

test('uncertain instant confirmation is never retried or treated as a confirmed playbook prompt', async () => {
  const { db, env } = fixture(); await lead(db, env); let calls = 0;
  const fetcher = async () => { calls++; throw Error('fixture transport outcome unknown'); };
  await processMetaConfirmations(env, { now: overnight, fetcher });
  await processMetaConfirmations(env, { now: overnight, fetcher });
  assert.equal(calls, 1);
  assert.equal(db.sqlite.prepare('SELECT status FROM meta_sms_jobs').get().status, 'unknown');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM lead_playbook_state').get().n, 0);
});

test('a concurrent human takeover is not overwritten by successful confirmation persistence', async () => {
  const { db, env } = fixture(); const saved = await lead(db, env);
  await processMetaConfirmations(env, { now: overnight, fetcher: async () => {
    db.sqlite.prepare("UPDATE lead_conversations SET owner='craig' WHERE submission_id=?").run(saved.id);
    return Response.json({ data: { id: 'AC-fixture-takeover' } });
  } });
  assert.equal(db.sqlite.prepare('SELECT owner FROM lead_conversations WHERE submission_id=?').get(saved.id).owner, 'craig');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM lead_playbook_state').get().n, 0);
});
