import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import {validateLeadInput} from '../lib/public-input.js';
import {websiteQuestionHoldStatements, normalizedQuestionPhone, questionPhoneSql, WebsiteQuestionIdentityConflict} from '../lib/website-question-hold.mjs';
import {PARTIAL_QUOTE_FOLLOW_UP_DELAY_MINUTES} from '../lib/quote-funnel.mjs';

const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const funnel = 'fixture_question_funnel_0001';
const phone = '4195550100';
const email = 'casey@example.test';
const question = 'Can you explain how you would handle a locked gate?';

function fixture(playbook = true) {
  const db = leadTestDatabase(), notifications = [], waits = [], syncs = [];
  const env = {DB: db, LEAD_PLAYBOOK_ENABLED: playbook ? 'true' : 'false'};
  const store = runPrivateInNewContext(source('lib/db.js') + '\n({saveSubmission,upsertPartialQuoteSubmission,queuePartialQuoteFollowUp});', {
    crypto, getRuntimeEnv: () => env, websiteQuestionHoldStatements, normalizedQuestionPhone, questionPhoneSql, WebsiteQuestionIdentityConflict, PARTIAL_QUOTE_FOLLOW_UP_DELAY_MINUTES,
    queueLeadSync: async (_db, id) => {syncs.push(id);},
  });
  const api = runPrivateInNewContext(source('app/api/lead/route.js') + '\n({POST});', {
    Response, console, validateLeadInput, ...store,
    protectJsonRequest: async request => ({body: await request.json()}), verifyTurnstile: async () => ({ok: true}),
    queueSubmissionNotificationSafe: async options => {notifications.push(options); return {status: 'queued'};},
    getCloudflareContext: () => ({env, ctx: {waitUntil: task => waits.push(task)}}),
    runScheduledQuoteFollowUps: () => {throw new Error('Question-first must not invoke any provider queue');},
  });
  const post = extra => api.POST(new Request('https://example.test/api/lead/', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({source: 'question', funnel_id: funnel, name: 'Casey Example', phone: '+1 (419) 555-0100', email,
      question, dogs: 2, frequency: 'once_a_week', follow_up_consent: false, ...extra})}));
  async function partial(extra = {}) {
    const body = {email, phone, zip: '43615', follow_up_consent: true, quote_context: {dogs: 2, frequency: 'once_a_week', yard_size: 'tiny', last_cleaned: 'two_weeks'}, ...extra};
    const saved = await store.upsertPartialQuoteSubmission({body, funnelId: extra.funnelId || funnel, lifecycleStage: 'quote_viewed'});
    db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode) VALUES (?,?,'org-opwp','website','backend','approved')").run('conv-' + saved.id, saved.id);
    await store.queuePartialQuoteFollowUp({submissionId: saved.id, phone: body.phone, consentAt: new Date().toISOString(), delayMinutes: 0});
    db.sqlite.prepare("INSERT INTO lead_follow_up_jobs(id,submission_id,conversation_id,organization_id,sequence_step,due_at,message_body) VALUES (?,?,?,'org-opwp',1,CURRENT_TIMESTAMP,'Generic follow-up')").run('legacy-' + saved.id, saved.id, 'conv-' + saved.id);
    db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,intent,confidence,body,policy_version,template_key) VALUES (?,?,?,'confirm_yes',1,'Generic quote intro','fixture-policy','intro_form')").run('draft-' + saved.id, 'conv-' + saved.id, saved.id);
    return saved.id;
  }
  return {db, env, store, post, partial, notifications, waits, syncs};
}

test('actual question POST atomically holds the matching earlier partial quote and surfaces its source question', async t => {
  const f = fixture(); t.after(() => f.db.sqlite.close());
  const partialId = await f.partial();
  const response = await f.post();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.smsFollowup, null);
  assert.equal(f.waits.length, 0);
  const original = f.db.sqlite.prepare('SELECT * FROM submissions WHERE id=?').get(result.id);
  assert.equal(original.kind, 'question'); assert.equal(original.source, 'website'); assert.equal(original.status, 'new');
  assert.equal(original.funnel_id, funnel);
  const payload = JSON.parse(original.payload);
  assert.equal(payload.question, question); assert.equal(payload.follow_up_consent, false); assert.equal(payload.marketing_consent, false);
  assert.equal(payload.phone, '+1 (419) 555-0100'); assert.equal(payload.email, email);
  const held = f.db.sqlite.prepare('SELECT * FROM submissions WHERE id=?').get(partialId);
  assert.equal(held.status, 'needs_attention');
  assert.equal(JSON.parse(held.payload).pending_quote_question, question);
  assert.equal(JSON.parse(held.payload).pending_quote_question_submission_id, result.id);
  for (const id of [partialId, result.id]) {
    const conversation = f.db.sqlite.prepare('SELECT * FROM lead_conversations WHERE submission_id=?').get(id);
    assert.equal(conversation.automation_mode, 'paused'); assert.equal(conversation.owner, 'craig');
    assert.equal(conversation.last_inbound_at, null, 'a website note is not inbound SMS permission');
    assert.equal(f.db.sqlite.prepare("SELECT body FROM lead_messages WHERE conversation_id=? AND channel='website'").get(conversation.id).body, question);
    assert.match(f.db.sqlite.prepare('SELECT next_action FROM growth_leads WHERE submission_id=?').get(id).next_action, /answer the submitted website question/);
  }
  assert.ok(f.db.sqlite.prepare('SELECT status FROM quote_follow_up_deliveries WHERE submission_id=?').all(partialId).every(row => row.status === 'cancelled'));
  assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_follow_up_jobs WHERE submission_id=?').get(partialId).status, 'cancelled');
  assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE submission_id=?').get(partialId).status, 'superseded');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM quote_follow_ups WHERE submission_id=?').get(result.id).n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM meta_sms_jobs WHERE submission_id=?').get(result.id).n, 0);
  assert.equal(f.notifications.length, 1); assert.equal(f.notifications[0].type, 'question'); assert.equal(f.notifications[0].body.question, question);
});

test('a shared funnel, name, email or phone alone cannot hold another contact', async t => {
  for (const change of [{phone: '4195550102'}, {phone: '+99914195550100'}, {email: 'other@example.test'}, {funnel_id: 'fixture_other_funnel_0002'}, {phone: ''}]) {
    const f = fixture(); t.after(() => f.db.sqlite.close()); const partialId = await f.partial();
    assert.equal((await f.post(change)).status, 200);
    assert.equal(f.db.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(partialId).status, 'follow_up_pending');
    assert.equal(f.db.sqlite.prepare('SELECT automation_mode FROM lead_conversations WHERE submission_id=?').get(partialId).automation_mode, 'approved');
    assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE submission_id=?').get(partialId).status, 'pending');
    assert.ok(f.db.sqlite.prepare('SELECT status FROM quote_follow_up_deliveries WHERE submission_id=?').all(partialId).every(row => row.status === 'queued'));
  }
});

test('phone normalization and absent email permit a match without transferring consent', async t => {
  const f = fixture(); t.after(() => f.db.sqlite.close()); const partialId = await f.partial({phone: '+1 419.555.0100', email: 'CASEY@EXAMPLE.TEST'});
  const result = await (await f.post({email: ''})).json();
  assert.equal(f.db.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(partialId).status, 'needs_attention');
  assert.equal(JSON.parse(f.db.sqlite.prepare('SELECT payload FROM submissions WHERE id=?').get(result.id).payload).follow_up_consent, false);
  const other = fixture(); t.after(() => other.db.sqlite.close());
  const otherId = await other.partial({phone: '+999 4195550100'});
  await other.post({phone: '+9994195550100', email: ''});
  assert.equal(other.db.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(otherId).status, 'needs_attention');
});

test('sent, sending and uncertain delivery evidence is preserved while unclaimed generic work is held', async t => {
  const f = fixture(); t.after(() => f.db.sqlite.close()); const id = await f.partial();
  f.db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET status='sent',provider_message_id='fixture-sent' WHERE submission_id=? AND channel='customer_email'").run(id);
  f.db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET status='sending',sending_at=CURRENT_TIMESTAMP WHERE submission_id=? AND channel='sng_lead'").run(id);
  f.db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET status='failed',attempt_count=5,error_message='Acceptance unconfirmed' WHERE submission_id=? AND channel='customer_sms'").run(id);
  await f.post();
  const rows = f.db.sqlite.prepare('SELECT channel,status,error_message,provider_message_id FROM quote_follow_up_deliveries WHERE submission_id=?').all(id);
  assert.equal(rows.find(row => row.channel === 'customer_email').status, 'sent');
  assert.equal(rows.find(row => row.channel === 'customer_email').provider_message_id, 'fixture-sent');
  assert.equal(rows.find(row => row.channel === 'sng_lead').status, 'sending');
  assert.equal(rows.find(row => row.channel === 'customer_sms').status, 'failed');
  assert.equal(rows.find(row => row.channel === 'customer_sms').error_message, 'Acceptance unconfirmed');
});

test('partial-quote autosaves cannot erase the pending question or restart cancelled outreach', async t => {
  const f = fixture(); t.after(() => f.db.sqlite.close()); const id = await f.partial();
  const result = await (await f.post()).json();
  await f.store.upsertPartialQuoteSubmission({body: {email, phone, follow_up_consent: true, quote_context: {dogs: 3}}, funnelId: funnel, lifecycleStage: 'details_started'});
  await f.store.queuePartialQuoteFollowUp({submissionId: id, phone, consentAt: new Date().toISOString(), delayMinutes: 0});
  const row = f.db.sqlite.prepare('SELECT status,payload FROM submissions WHERE id=?').get(id);
  assert.equal(row.status, 'needs_attention');
  assert.equal(JSON.parse(row.payload).pending_quote_question, question);
  assert.equal(JSON.parse(row.payload).pending_quote_question_submission_id, result.id);
  assert.ok(f.db.sqlite.prepare('SELECT status FROM quote_follow_up_deliveries WHERE submission_id=?').all(id).every(row => row.status === 'cancelled'));
  assert.equal(f.db.sqlite.prepare('SELECT automation_mode FROM lead_conversations WHERE submission_id=?').get(id).automation_mode, 'paused');
});

test('a failed transaction rolls back both question insertion and all holds without a false success', async t => {
  const f = fixture(); t.after(() => f.db.sqlite.close()); const id = await f.partial();
  f.db.sqlite.exec("CREATE TRIGGER fixture_question_failure BEFORE INSERT ON lead_messages WHEN NEW.created_by='website-question' BEGIN SELECT RAISE(ABORT,'fixture_atomic_failure'); END;");
  await assert.rejects(() => f.post(), /fixture_atomic_failure/);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM submissions WHERE kind='question'").get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM submissions WHERE id=?').get(id).status, 'follow_up_pending');
  assert.equal(f.db.sqlite.prepare('SELECT owner,automation_mode FROM lead_conversations WHERE submission_id=?').get(id).owner, 'backend');
  assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE submission_id=?').get(id).status, 'pending');
  assert.ok(f.db.sqlite.prepare('SELECT status FROM quote_follow_up_deliveries WHERE submission_id=?').all(id).every(row => row.status === 'queued'));
  assert.equal(f.notifications.length, 0); assert.equal(f.waits.length, 0);
});

test('actual partial POST returns 409 for identity-changing autosaves on a held question and preserves the original contact', async t => {
  for (const changed of [{phone: '4195550102'}, {email: 'other@example.test'}]) {
    const f = fixture(); t.after(() => f.db.sqlite.close()); const id = await f.partial();
    const originalQuestion = await (await f.post()).json();
    const before = f.db.sqlite.prepare('SELECT phone,email,payload FROM submissions WHERE id=?').get(id);
    const notifications = f.notifications.length, syncs = f.syncs.length;
    const response = await f.post({source: 'partial_quote', phone, email, follow_up_consent: true, ...changed});
    assert.equal(response.status, 409);
    const result = await response.json(); assert.equal(result.ok, false); assert.match(result.error, /question is awaiting review/);
    const after = f.db.sqlite.prepare('SELECT phone,email,payload FROM submissions WHERE id=?').get(id);
    assert.deepEqual(after, before);
    assert.equal(JSON.parse(after.payload).pending_quote_question_submission_id, originalQuestion.id);
    assert.equal(f.notifications.length, notifications); assert.equal(f.syncs.length, syncs); assert.equal(f.waits.length, 0);
    assert.ok(f.db.sqlite.prepare('SELECT status FROM quote_follow_up_deliveries WHERE submission_id=?').all(id).every(row => row.status === 'cancelled'));
  }
});

test('a held question accepts normalized same-contact POST edits without discarding its review hold', async t => {
  const f = fixture(); t.after(() => f.db.sqlite.close()); const id = await f.partial();
  const originalQuestion = await (await f.post()).json();
  const response = await f.post({source: 'partial_quote', phone: '+1 419.555.0100', email: 'CASEY@EXAMPLE.TEST', dogs: 3, follow_up_consent: true});
  assert.equal(response.status, 200);
  const row = f.db.sqlite.prepare('SELECT status,payload FROM submissions WHERE id=?').get(id), payload = JSON.parse(row.payload);
  assert.equal(row.status, 'needs_attention'); assert.equal(payload.quote_context.dogs, 3);
  assert.equal(payload.pending_quote_question_submission_id, originalQuestion.id);
  assert.equal(f.db.sqlite.prepare('SELECT automation_mode FROM lead_conversations WHERE submission_id=?').get(id).automation_mode, 'paused');
  assert.equal(f.waits.length, 0);
});

test('standalone email-only questions remain visible without playbook activation or SMS eligibility', async t => {
  const f = fixture(false); t.after(() => f.db.sqlite.close());
  const result = await (await f.post({phone: '', funnel_id: ''})).json();
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM submissions').get().n, 1);
  const conversation = f.db.sqlite.prepare('SELECT * FROM lead_conversations WHERE submission_id=?').get(result.id);
  assert.equal(conversation.automation_mode, 'paused'); assert.equal(conversation.last_inbound_at, null);
  assert.match(f.db.sqlite.prepare('SELECT next_action FROM growth_leads WHERE submission_id=?').get(result.id).next_action, /submitted website question/);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM quote_follow_ups').get().n, 0);
  assert.equal(f.notifications.length, 1); assert.equal(f.waits.length, 0);
});
