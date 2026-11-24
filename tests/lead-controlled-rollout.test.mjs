import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { controlledLeadRecipientAllowed } from '../lib/lead-rollout-policy.mjs';
import { normalizePhone } from '../lib/lead-assistant.mjs';
import { leadTestDatabase } from './helpers/lead-inbox-fixture.mjs';

const APPROVED = '+14195550100';
const OTHER = '+14195550101';
const controlled = { LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: APPROVED };
const source = file => readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

test('lead sender blocks an unapproved recipient before database work or provider calls', async () => {
  let providerCalls = 0;
  const api = vm.runInNewContext(source('lead-assistant.js') + '\n({sendLeadMessage,sendQuoSms});', {
    URL, controlledLeadRecipientAllowed, normalizePhone,
    readAirtableTextSafety: async () => { throw new Error('Text safety must not run before the controlled-recipient gate.'); },
    outboundFetch: async () => { providerCalls++; return Response.json({data: {id: 'fixture-receipt'}}); },
  });
  const db = {prepare() { throw new Error('Database must not be touched before the recipient gate.'); }};
  const configured = {...controlled, QUO_API_KEY: 'fixture-only', QUO_FROM_NUMBER: '+14195550199'};
  for (const actor of ['owner', 'playbook-approved:owner', 'yardops-automation']) {
    await assert.rejects(() => api.sendLeadMessage(db, configured, {phone: OTHER}, 'Fixture text', actor), error => error.code === 'controlled_test_recipient_blocked');
  }
  for (const env of [configured, {...configured, META_TEST_RECIPIENTS: ''}, {...configured, META_TEST_RECIPIENTS: `${APPROVED},${OTHER}`}]) {
    await assert.rejects(() => api.sendQuoSms(env, OTHER, 'Fixture text'), error => error.code === 'controlled_test_recipient_blocked');
  }
  assert.equal(providerCalls, 0);
  assert.equal(await api.sendQuoSms(configured, '(419) 555-0100', 'Fixture text'), 'fixture-receipt');
  assert.equal(providerCalls, 1);
  assert.equal(await api.sendQuoSms({...configured, LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'false'}, OTHER, 'Fixture text'), 'fixture-receipt');
  assert.equal(providerCalls, 2);
});

test('manual inbox preflight rejects an unapproved lead before reserving a send or marking uncertainty', async () => {
  class LeadInboxError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  let reads = 0, sends = 0;
  const send = vm.runInNewContext(source('lead-manual-message.js') + '\nsendInboxText;', {
    controlledLeadRecipientAllowed, LeadInboxError,
    readInboxRow: async () => ({phone: OTHER}),
    sendLeadMessage: async () => { sends++; },
  });
  const db = {prepare() { reads++; throw new Error('No send reservation or state read expected.'); }};
  await assert.rejects(() => send(db, controlled, 'fixture-lead', {message: 'Fixture text', commandId: crypto.randomUUID()}, 'owner'), error => error.status === 409 && /controlled-test/.test(error.message));
  assert.equal(reads, 0);
  assert.equal(sends, 0);
});

function quoteFixture(t, playbook = false) {
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  const requests = [];
  const run = vm.runInNewContext(source('quote-follow-up-delivery.js') + '\nrunScheduledQuoteFollowUps;', {
    URL, controlledLeadRecipientAllowed,
    console: {log() {}, error() {}},
    transactionalEmailConfig: () => ({configured: true}),
    buildCustomerQuoteFollowUpSms: () => 'Fixture quote text',
    buildCustomerQuoteFollowUpEmail: () => ({subject: 'Fixture', text: 'Fixture', html: 'Fixture'}),
    sendTransactionalEmail: async () => { requests.push('email'); return 'fixture-email'; },
    outboundFetch: async () => { requests.push('sms'); return Response.json({data: {id: 'fixture-sms'}}); },
  });
  function seed(id, phone, channels) {
    db.sqlite.prepare("INSERT INTO submissions(id,kind,status,phone,email,payload) VALUES (?,'partial_quote','follow_up_pending',?,'fixture@example.test','{}')").run(id, phone);
    db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at) VALUES (?,?,?,'Fixture consent','fixture',CURRENT_TIMESTAMP,datetime('now','-20 minutes'))").run(id, id, phone);
    for (const channel of channels) db.sqlite.prepare("INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status) VALUES (?,?,?,?,'queued')").run(`${id}-${channel}`, id, id, channel);
  }
  const row = id => db.sqlite.prepare('SELECT * FROM quote_follow_up_deliveries WHERE id=?').get(id);
  return {db, run, seed, row, requests, env: {...controlled, DB: db, LEAD_PLAYBOOK_ENABLED: String(playbook), SMS_PROVIDER: 'quo', QUO_API_KEY: 'fixture-only', QUO_FROM_NUMBER: '+14195550199'}};
}

test('controlled verification holds other SMS and all customer email/SNG intake unchanged before claims or transports', async t => {
  const f = quoteFixture(t, true);
  f.seed('other', OTHER, ['customer_sms', 'customer_email', 'sng_lead']);
  f.seed('approved', APPROVED, ['customer_email', 'sng_lead']);
  const ids = ['other-customer_sms', 'other-customer_email', 'other-sng_lead', 'approved-customer_email', 'approved-sng_lead'];
  const before = ids.map(f.row);
  const result = await f.run(f.env);
  assert.deepEqual(ids.map(f.row), before);
  assert.equal(result.pending, 5);
  assert.equal(result.sent, 0);
  assert.deepEqual(f.requests, []);
});

test('controlled customer email and SNG intake hold retry-eligible failures without configuration reads or new attempts', async t => {
  const f = quoteFixture(t);
  f.seed('approved', APPROVED, ['customer_email', 'sng_lead']);
  f.db.sqlite.exec("UPDATE quote_follow_up_deliveries SET status='failed',attempt_count=1,failed_at=CURRENT_TIMESTAMP,error_message='Fixture explicit rejection' WHERE submission_id='approved'");
  const ids = ['approved-customer_email', 'approved-sng_lead'];
  const before = ids.map(f.row);
  // Missing transports must not matter: the hold happens before configuration,
  // send claims, retry state or any provider operation.
  const run = vm.runInNewContext(source('quote-follow-up-delivery.js') + '\nrunScheduledQuoteFollowUps;', {
    controlledLeadRecipientAllowed,
    console: {log() {}, error() {}},
    transactionalEmailConfig() { throw new Error('Customer email configuration must not be read during controlled verification.'); },
    outboundFetch() { throw new Error('No SNG or SMS transport is authorized for this email row.'); },
    sendTransactionalEmail() { throw new Error('No customer Resend request is authorized.'); },
  });
  const result = await run({...f.env, LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: true});
  assert.equal(result.pending, 2);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(ids.map(f.row), before);
});

test('the legacy quote sender sends only the approved recipient and does not consume other queued attempts', async t => {
  const f = quoteFixture(t);
  f.seed('other', OTHER, ['customer_sms']);
  f.seed('approved', APPROVED, ['customer_sms']);
  const before = f.row('other-customer_sms');
  const result = await f.run(f.env);
  assert.deepEqual(f.row('other-customer_sms'), before);
  assert.equal(f.row('approved-customer_sms').status, 'sent');
  assert.equal(result.pending, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(f.requests, ['sms']);
});

test('a queued YardOps follow-up for another recipient remains unchanged even with playbook disabled', async t => {
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES ('fixture-lead','partial_quote','website','follow_up_pending',?,'{}')").run(OTHER);
  db.sqlite.exec("INSERT INTO lead_conversations(id,submission_id,organization_id,status,automation_mode) VALUES ('fixture-thread','fixture-lead','org-opwp','waiting','approved')");
  db.sqlite.exec("INSERT INTO lead_follow_up_jobs(id,submission_id,conversation_id,organization_id,sequence_step,message_body,due_at,status) VALUES ('fixture-follow-up','fixture-lead','fixture-thread','org-opwp',1,'Fixture text',datetime('now','-1 hour'),'queued')");
  const before = db.sqlite.prepare("SELECT * FROM lead_follow_up_jobs WHERE id='fixture-follow-up'").get();
  const run = vm.runInNewContext(source('lead-assistant.js') + '\nprocessFollowUps;', {controlledLeadRecipientAllowed, OPWP_ORGANIZATION_ID: 'org-opwp'});
  const result = await run({...controlled, DB: db}, 10);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM lead_follow_up_jobs WHERE id='fixture-follow-up'").get(), before);
});
