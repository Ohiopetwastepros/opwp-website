import {createAirtableContactFixture} from "./helpers/airtable-text-safety-fixture.mjs";
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {build} from 'esbuild';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {CRAIG_TEMPLATES} from '../lib/craig-voice.mjs';

const CUSTOMER = '+14195550100';
const OTHER = '+14195550101';
const BUSINESS = '+14195550188';
const OWNER_PHONE = '+14195550199';
const OWNER_EMAIL = 'owner@example.test';
const META_SECRET = 'fixture-meta-webhook-secret-never-production';
const QUO_SECRET = 'fixture-quo-webhook-secret-never-production';
const entry = `
export {POST as metaPost} from './app/api/webhooks/meta-leads/route.js';
export {POST as quoPost} from './app/api/webhooks/quo-messages/route.js';
export {getLeadRecord,setLeadAutomation,runScheduledYardOps} from './lib/lead-assistant.js';
export {readInboxRow,inboxVersion,saveInboxChange} from './lib/lead-inbox-store.js';
export {processMetaConfirmations} from './lib/meta-lead-workflow.mjs';
export {listPlaybookWorkspace} from './lib/lead-playbook-service.js';
export {readPlaybookLink} from './lib/lead-playbook-links.mjs';`;
const output = await build({stdin: {contents: entry, resolveDir: process.cwd()}, bundle: true, write: false,
  format: 'esm', platform: 'node', packages: 'external', alias: {'@': process.cwd()},
  plugins: [{name: 'fixture-runtime-only', setup(builder) {
    builder.onResolve({filter: /(?:^|\/)cloudflare(?:\.js)?$/}, () => ({path: 'runtime', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({loader: 'js', contents: `
      export function getRuntimeEnv(){return globalThis.__metaPlaybookE2E.env;}
      export function getCloudflareContext(){return {env:globalThis.__metaPlaybookE2E.env,ctx:{waitUntil(p){globalThis.__metaPlaybookE2E.background.push(p);}}};}` }));
  }}]});
const api = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));

function signedMeta(id) {
  const body = JSON.stringify({entry: [{id: 'fixture-page', changes: [{field: 'leadgen', value: {leadgen_id: id, form_id: 'fixture-form'}}]}]});
  return new Request('https://opwp.example/api/webhooks/meta-leads/', {method: 'POST', body,
    headers: {'x-hub-signature-256': 'sha256=' + createHmac('sha256', META_SECRET).update(body).digest('hex')}});
}
function signedInbound(text, id, phone = CUSTOMER) {
  const body = JSON.stringify({id: `fixture-event-${id}`, type: 'message.received', data: {object: {
    id, direction: 'incoming', text, from: phone, to: [BUSINESS], createdAt: new Date().toISOString(),
  }}});
  const timestamp = Date.now();
  return new Request('https://opwp.example/api/webhooks/quo-messages/', {method: 'POST', body,
    headers: {'openphone-signature': `hmac;1;${timestamp};${createHmac('sha256', QUO_SECRET).update(`${timestamp}.${body}`).digest('base64')}`}});
}
function signedDelivery(text, id, phone = CUSTOMER) {
  const body = JSON.stringify({id: `fixture-delivered-${id}`, type: 'message.delivered', data: {object: {
    id, direction: 'outgoing', text, from: BUSINESS, to: [phone], createdAt: new Date().toISOString(),
  }}});
  const timestamp = Date.now();
  return new Request('https://opwp.example/api/webhooks/quo-messages/', {method: 'POST', body,
    headers: {'openphone-signature': `hmac;1;${timestamp};${createHmac('sha256', QUO_SECRET).update(`${timestamp}.${body}`).digest('base64')}`}});
}

async function fixture(t, {confirmationUncertain = false, ownerPhone = OWNER_PHONE, existingCustomer = false} = {}) {
  const db = leadTestDatabase();
  db.sqlite.exec(`INSERT INTO meta_automation_releases VALUES ('fixture-live','org-opwp','meta-confirmation-v2','fixture-owner','Offline integration only',datetime('now','-1 minute'),NULL);
    UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;`);
  const env = {DB: db, META_APP_SECRET: META_SECRET, META_PAGE_ACCESS_TOKEN: 'fixture-meta-token', META_GRAPH_API_VERSION: 'v26.0', META_ALLOWED_PAGE_IDS: 'fixture-page',
    META_AUTOMATION_ENABLED: 'true', META_TEST_MODE: 'false', META_AUTOMATION_APPROVAL_ID: 'fixture-live', META_CADENCE_ENABLED: 'false',
    LEAD_PLAYBOOK_ENABLED: 'true', LEAD_PLAYBOOK_AUTO_SEND_ENABLED: 'true', LEAD_PLAYBOOK_NOTIFY_ENABLED: 'true',
    LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: CUSTOMER, LEAD_CLASSIFIER_ENABLED: 'false', LEAD_CLASSIFIER_KILL_SWITCH: 'true',
    LEAD_PLAYBOOK_LINK_SECRET: 'fixture-review-link-secret-never-production', LEAD_PLAYBOOK_HASH_KEY: 'fixture-learning-hash-key-never-production',
    LEAD_PLAYBOOK_CRAIG_CELL: ownerPhone, SITE_ORIGIN: 'https://opwp.example', LEAD_PLAYBOOK_ADMIN_ORIGIN: 'https://opwp.example',
    QUO_WEBHOOK_SIGNING_KEY: Buffer.from(QUO_SECRET).toString('base64'), QUO_API_KEY: 'fixture-quo-key', AIRTABLE_API_KEY: 'fixture-only', QUO_FROM_NUMBER: BUSINESS,
    SNG_API_KEY: 'fixture-sng-key', EMAIL_PROVIDER: 'resend', EMAIL_SENDING_ENABLED: 'true', EMAIL_FROM: OWNER_EMAIL, OWNER_NOTIFICATION_EMAIL: OWNER_EMAIL, RESEND_API_KEY: 'fixture-resend-key',
    META_APPROVED_SMS_FORMS: JSON.stringify({'fixture-form': {pageId: 'fixture-page', consentField: 'sms_consent', version: 'fixture-disclosure', disclosure: 'Fixture automated quote texts. Reply STOP to opt out.'}})};
  const forms = new Map(), customerSms = [], ownerSms = [], ownerEmails = [], directoryReads = [], background = [], unexpectedRequests = [];
  const airtable = createAirtableContactFixture();
  let mirrorFields = {};
  const previousFetch = globalThis.fetch;
  globalThis.__metaPlaybookE2E = {env, background};
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input)), method = options.method || 'GET';
    const safety = airtable.fetcher(input, options);
    if (safety) return safety;
    if (url.origin === 'https://api.airtable.com' && url.pathname === '/v0/appcAWPBQB8GmOrcT/tblCrdvGKkGobRWxL' && method === 'PATCH') {
      mirrorFields = JSON.parse(options.body).records[0].fields;
      return Response.json({records: [{id: 'recFixtureMirror', fields: mirrorFields}]});
    }
    if (url.origin === 'https://api.airtable.com' && url.pathname.endsWith('/recFixtureMirror') && method === 'GET') {
      return Response.json({id: 'recFixtureMirror', fields: mirrorFields});
    }
    if (url.origin === 'https://graph.facebook.com' && method === 'GET') {
      const form = forms.get(url.pathname.split('/').at(-1));
      assert.ok(form, 'Only an explicitly seeded fake Meta lead may be fetched');
      return Response.json(form);
    }
    if (url.origin === 'https://openapi.sweepandgo.com' && method === 'GET' && ['/api/v1/clients/active', '/api/v1/clients/active_no_subscription'].includes(url.pathname)) {
      directoryReads.push(url.pathname); return Response.json({data: existingCustomer && url.pathname === '/api/v1/clients/active' ? [{cell_phone_number: CUSTOMER}] : [], last_page: 1});
    }
    if (url.origin === 'https://api.openphone.com' && url.pathname === '/v1/messages' && method === 'POST') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.from, BUSINESS);
      assert.equal(payload.to.length, 1);
      if (payload.to[0] === ownerPhone && /^\[OPWP STAFF ALERT\] /.test(payload.content)) {
        assert.match(payload.content, /A lead .*https:\/\/opwp\.example\/admin\//);
        assert.match(payload.content, /Name: Casey Example\. Phone: \+1419555010[01]\./);
        assert.doesNotMatch(payload.content, /customer@example\.test/);
        assert.match(payload.content, /Reason:/);
        ownerSms.push(payload); return Response.json({data: {id: `fixture-owner-${ownerSms.length}`}});
      }
      assert.deepEqual(payload.to, [CUSTOMER], 'Customer sends are restricted to the controlled recipient');
      assert.doesNotMatch(payload.content, /\[OPWP STAFF ALERT\]|\/admin\/playbook\/d\//);
      if (customerSms.length === 0) assert.match(payload.content, /\n\nReply STOP to opt out$/);
      else assert.doesNotMatch(payload.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
      assert.doesNotMatch(payload.content, /\bpoop\b|[\u2013\u2014]/i);
      customerSms.push(payload);
      if (confirmationUncertain && customerSms.length === 1) throw new Error('Fixture provider outcome unknown');
      return Response.json({data: {id: `fixture-customer-${customerSms.length}`}});
    }
    if (url.origin === 'https://api.resend.com' && url.pathname === '/emails' && method === 'POST') {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, [OWNER_EMAIL], 'Only the owner notification role may receive email');
      ownerEmails.push(payload); return Response.json({id: `fixture-email-${ownerEmails.length}`});
    }
    unexpectedRequests.push({origin: url.origin, pathname: url.pathname, method});
    throw new Error('Unmocked network request forbidden in Meta/playbook integration');
  };
  t.after(async () => {
    await Promise.allSettled(background);
    globalThis.fetch = previousFetch;
    delete globalThis.__metaPlaybookE2E;
    db.sqlite.close();
    assert.deepEqual(unexpectedRequests, [], 'Every attempted provider request must use an explicitly allowlisted fake');
  });
  async function meta(id = 'fixture-lead', {phone = CUSTOMER, extra = {}} = {}) {
    const fields = {full_name: 'Casey Example', email: 'customer@example.test', phone_number: phone, zip_code: '43615', number_of_dogs: '2', service_frequency: 'weekly', contact_preference: 'text', sms_consent: 'yes', ...extra};
    forms.set(id, {id, form_id: 'fixture-form', created_time: new Date().toISOString(), field_data: Object.entries(fields).map(([name, value]) => ({name, values: [value]}))});
    const response = await api.metaPost(signedMeta(id));
    assert.equal(response.status, 200, 'Signed Meta intake must succeed');
    return db.sqlite.prepare('SELECT * FROM submissions WHERE phone=? ORDER BY rowid DESC LIMIT 1').get(phone);
  }
  async function inbound(text, id, phone = CUSTOMER) {
    const response = await api.quoPost(signedInbound(text, id, phone));
    assert.equal(response.status, 200, `Signed inbound ${id} must succeed`);
    return response.json();
  }
  const state = id => JSON.parse(db.sqlite.prepare('SELECT state_json FROM lead_playbook_state WHERE submission_id=?').get(id).state_json);
  return {db, env, customerSms, ownerSms, ownerEmails, directoryReads, meta, inbound, state};
}

test('signed Meta and Quo handlers drive the approved playbook once through owner route review, weekly quote and signup handoff', async t => {
  const f = await fixture(t);
  assert.ok(f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lead_playbook_owner_notifications'").get(), 'The actual 0069 schema must be present');
  const saved = await f.meta();
  assert.equal(f.customerSms.length, 1, 'The webhook itself sends the instant confirmation');
  assert.match(f.customerSms[0].content, /2 dogs.*Did I get that right\?/);
  assert.equal(f.state(saved.id).stage, 'confirm_details_sent');
  await f.meta();
  assert.equal(f.customerSms.length, 1, 'Meta retries cannot duplicate the confirmation');
  const conversation = f.db.sqlite.prepare('SELECT * FROM lead_conversations WHERE submission_id=?').get(saved.id);
  assert.equal(conversation.owner, 'backend');
  assert.equal(conversation.automation_mode, 'approved');
  for (const [text, id, pattern] of [
    ['yes', 'yes-missing-yard', /About how big/],
    ['A', 'yard-answer', /last thoroughly cleaned/],
    ['about 1 month', 'cleanup-answer', /Just to make sure.*about 1 month/],
    ['how much?', 'price-before-confirmation', /Did I get that right\?/],
    ['yes', 'confirmed-details', /address for the service/],
  ]) {
    const before = f.customerSms.length;
    await f.inbound(text, id);
    assert.equal(f.customerSms.length, before + 1, id);
    assert.match(f.customerSms.at(-1).content, pattern);
    assert.doesNotMatch(f.customerSms.at(-1).content, /\$/);
    await f.inbound(text, id);
    assert.equal(f.customerSms.length, before + 1, 'A repeated signed webhook is idempotent');
  }
  const beforeHold = f.customerSms.length;
  const address = '123 Fictional Avenue, Toledo';
  await f.inbound(address, 'address-needs-owner-route');
  assert.equal(f.customerSms.length, beforeHold, 'An unaudited property cannot receive an automatic quote');
  const hold = f.db.sqlite.prepare("SELECT * FROM lead_reply_drafts WHERE status='pending' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(hold.reason, 'route_day_requires_confirmation');
  assert.equal(JSON.parse(hold.state_json).details.address, address);
  assert.ok(f.ownerSms.length > 0 && f.ownerEmails.length > 0);
  const notice = f.ownerSms.find(row => row.content.includes('/admin/playbook/d/'));
  assert.ok(notice, 'The owner receives a real bounded draft-review link');
  assert.match(notice.content, /route_day_requires_confirmation/);
  assert.match(notice.content, /Customer said: "123 Fictional Avenue, Toledo"/);
  const token = notice.content.match(/\/admin\/playbook\/d\/([^/\s]+)\//)[1];
  assert.equal((await api.readPlaybookLink(f.db, f.env, token)).draft_id, hold.id);
  assert.equal(f.db.sqlite.prepare('SELECT used_at FROM lead_playbook_links WHERE draft_id=?').get(hold.id).used_at, null);

  // Use the supported owner intake/version and route-audit commands for this
  // exact collected property, then explicitly return automation to approved.
  let row = await api.readInboxRow(f.db, saved.id);
  const intake = {firstName: 'Casey', lastName: 'Example', email: 'customer@example.test', phone: CUSTOMER,
    address, city: 'Toledo', state: 'OH', zip: '43615', dogs: '2', frequency: 'once_a_week', lastCleaned: 'one_month', yardSize: 'tiny', serviceDay: 'Tuesday', areas: ['Back yard'], addons: []};
  await api.saveInboxChange(f.db, saved.id, {action: 'save_intake', intake, version: await api.inboxVersion(row)}, OWNER_EMAIL);
  row = await api.readInboxRow(f.db, saved.id);
  const workspace = JSON.parse(row.workspace_payload);
  await api.saveInboxChange(f.db, saved.id, {action: 'approve_day', version: await api.inboxVersion(row)}, OWNER_EMAIL,
    {routeAudit: {actor: OWNER_EMAIL, handoffKey: workspace.handoffKey, day: 'Tuesday', at: new Date().toISOString()}});
  await api.setLeadAutomation(f.db, await api.getLeadRecord(f.db, saved.id), 'approved', OWNER_EMAIL);
  await f.inbound(address, 'address-after-exact-owner-audit');
  assert.match(f.customerSms.at(-1).content, /2 dogs with weekly service is \$105 per month.*\$58 to \$70/);
  assert.equal(f.state(saved.id).stage, 'quote_sent');
  assert.equal(f.state(saved.id).quote.monthly, 105);
  assert.equal(f.state(saved.id).quote.day, 'Tuesday');
  assert.doesNotMatch(f.customerSms.at(-1).content, /\$15/);
  await f.inbound('yes', 'accept-quote');
  assert.match(f.customerSms.at(-1).content, /I have Casey Example and customer@example\.test for the account.*both right/);
  await f.inbound('yes', 'confirm-signup-identity');
  assert.match(f.customerSms.at(-1).content, /which side is the gate/);
  await f.inbound('left', 'gate-side');
  assert.match(f.customerSms.at(-1).content, /Where is the outdoor trash can/);
  await f.inbound('trash can is by the garage', 'trash-location');
  assert.equal(f.customerSms.at(-1).content,CRAIG_TEMPLATES.signup_handoff);
  assert.doesNotMatch(f.customerSms.at(-1).content,/\bCraig\b/);
  const done = f.state(saved.id);
  assert.equal(done.stage, 'handoff_signup');
  assert.equal(done.signup_identity_confirmed, true);
  assert.equal(done.details.frequency, 'once_a_week');
  assert.equal(done.quote.monthly, 105);
  assert.notEqual(done.discount_offered, true);
  assert.equal(done.details.gateSide, 'left');
  assert.equal(done.details.trashLocation, 'by the garage');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM lead_playbook_owner_notifications WHERE kind='signup_ready' AND status='accepted'").get().n, 2);
  const finalCount = f.customerSms.length;
  await api.processMetaConfirmations(f.env);
  await api.runScheduledYardOps(f.env);
  await f.inbound('yes', 'after-craig-handoff');
  assert.equal(f.customerSms.length, finalCount, 'Legacy jobs and post-handoff replies cannot duplicate customer sends');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM meta_sms_jobs WHERE purpose IN ('reply','follow_up','signup') AND status IN ('sent','delivered')").get().n, 0);
  assert.ok(f.directoryReads.length > 0, 'New contacts are verified against the customer directory before automated messages');
});

test('a signed ordinary customer thread cannot start lead automation even when it shares the owner test phone', async t => {
  const f = await fixture(t, {existingCustomer: true, ownerPhone: CUSTOMER});
  const saved = await f.meta();
  assert.equal(f.customerSms.length, 0);
  const held = f.db.sqlite.prepare('SELECT status,block_reason,attempted_at FROM meta_sms_jobs WHERE submission_id=?').get(saved.id);
  assert.equal(held.status, 'blocked');
  assert.equal(held.block_reason, 'existing_customer');
  assert.equal(held.attempted_at, null);
  for (const [text, id] of [['yes', 'customer-yes'], ['I need a quote for weekly poop cleanup', 'customer-quote'], ['please reschedule my service', 'customer-service']]) await f.inbound(text, id);
  assert.equal(f.customerSms.length, 0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM lead_reply_drafts').get().n, 0);
  assert.ok(f.directoryReads.length > 0);
  const payload = JSON.parse(f.db.sqlite.prepare('SELECT payload FROM submissions WHERE id=?').get(saved.id).payload);
  assert.equal(payload.sms_consent_evidence.valid, true);
  await f.inbound('STOP', 'existing-customer-stop');
  assert.equal(f.customerSms.length, 0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM lead_suppressions').get().n, 1);
});

test('a signed large-yard answer uses approved wording and notifies the owner without continuing automation', async t => {
  const f = await fixture(t);
  const saved = await f.meta();
  await f.inbound('yes', 'large-yes');
  await f.inbound('E', 'large-yard');
  assert.equal(f.customerSms.at(-1).content,CRAIG_TEMPLATES.property_walk);
  assert.doesNotMatch(f.customerSms.at(-1).content,/\bCraig\b/);
  assert.doesNotMatch(f.customerSms.at(-1).content, /\$/);
  assert.equal(f.state(saved.id).stage, 'escalated');
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM lead_playbook_owner_notifications WHERE kind='property_walk' AND status='accepted'").get().n, 2);
  const count = f.customerSms.length;
  await f.inbound('yes', 'after-large-handoff');
  assert.equal(f.customerSms.length, count);
});

test('a signed AI question with a request for a person discloses automation and stops further automatic answers', async t => {
  const f = await fixture(t);
  const saved = await f.meta();
  await f.inbound('Is this AI? I want to talk to a real person.', 'identity-question');
  const reply = f.customerSms.at(-1).content;
  assert.match(reply, /Ohio Pet Waste Pros/i);
  assert.match(reply, /\b(?:use AI|are automated)\b/i);
  assert.match(reply, /(?:owner|person)\b.{0,35}(?:follow up|call)/i);
  assert.doesNotMatch(reply, /\b(?:Craig|Sona|Quo|OpenPhone)\b|set (?:you|it) up|on the schedule|\$/i);
  assert.equal(f.state(saved.id).stage, 'escalated');
  assert.ok(f.ownerEmails.some(row => /needs your review/.test(row.subject)));
  const count = f.customerSms.length;
  await f.inbound('yes', 'after-identity-handoff');
  assert.equal(f.customerSms.length, count);
});

test('controlled signed intake holds other leads, while signed STOP suppresses the approved thread', async t => {
  const f = await fixture(t);
  const other = await f.meta('fixture-other', {phone: OTHER});
  assert.equal(f.customerSms.length, 0);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM meta_sms_jobs WHERE submission_id=?').get(other.id).status, 'queued');
  await f.inbound('I need a quote for weekly poop cleanup', 'other-inbound', OTHER);
  assert.equal(f.customerSms.length, 0);
  const saved = await f.meta();
  assert.equal(f.customerSms.length, 1);
  await f.inbound('STOP', 'opt-out');
  await f.inbound('yes', 'reply-after-stop');
  await api.processMetaConfirmations(f.env);
  assert.equal(f.customerSms.length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM lead_suppressions').get().n, 1);
  assert.equal(f.db.sqlite.prepare('SELECT owner FROM lead_conversations WHERE submission_id=?').get(saved.id).owner, 'backend');
});

test('an uncertain confirmation through the actual signed Meta handler never retries or seeds a confirmed prompt', async t => {
  const f = await fixture(t, {confirmationUncertain: true});
  const saved = await f.meta();
  assert.equal(f.customerSms.length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM meta_sms_jobs WHERE submission_id=?').get(saved.id).status, 'unknown');
  await f.meta();
  await api.processMetaConfirmations(f.env);
  assert.equal(f.customerSms.length, 1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM lead_playbook_state WHERE submission_id=?').get(saved.id).n, 0);
});

test('a signed customer reply on the shared owner phone remains in the inbox after handoff while staff notices stay out of learning and ownership', async t => {
  const f = await fixture(t, {ownerPhone: CUSTOMER});
  const saved = await f.meta();
  await f.inbound('yes', 'shared-owner-yes');
  assert.match(f.customerSms.at(-1).content, /About how big/);
  await f.inbound('My card failed. Can you resubmit my invoice?', 'shared-owner-review');
  const notice = f.db.sqlite.prepare("SELECT * FROM lead_playbook_owner_notifications WHERE channel='sms' AND status='accepted' ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(notice, 'A genuine payment exception produces a real owner notice at the same phone');
  assert.deepEqual(f.ownerSms.at(-1).to, [CUSTOMER]);
  assert.match(f.ownerSms.at(-1).content, /^\[OPWP STAFF ALERT\] /);
  assert.match(f.ownerSms.at(-1).content, /account_billing/);
  assert.match(f.ownerSms.at(-1).content, /Customer said: "My card failed\. Can you resubmit my invoice\?"/);
  assert.doesNotMatch(f.ownerSms.at(-1).content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
  const before = f.db.sqlite.prepare('SELECT owner,owner_event_id FROM lead_conversations WHERE submission_id=?').get(saved.id);
  const outboundCount = f.db.sqlite.prepare("SELECT COUNT(*) n FROM lead_messages WHERE direction='outbound'").get().n;
  assert.equal((await api.quoPost(signedDelivery(f.ownerSms.at(-1).content, notice.provider_message_id))).status, 200);
  assert.deepEqual(f.db.sqlite.prepare('SELECT owner,owner_event_id FROM lead_conversations WHERE submission_id=?').get(saved.id), before);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM playbook_turns WHERE provider_message_id=?').get(notice.provider_message_id).n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM lead_messages WHERE direction='outbound'").get().n, outboundCount);
  const customerCount = f.customerSms.length;
  const acknowledgement = f.db.sqlite.prepare("SELECT provider_message_id,body,delivery_status FROM lead_messages WHERE conversation_id=? AND direction='outbound' ORDER BY rowid DESC LIMIT 1").get(notice.conversation_id);
  assert.equal(acknowledgement.provider_message_id, `fixture-customer-${customerCount}`);
  assert.equal(acknowledgement.body, f.customerSms.at(-1).content);
  assert.equal(acknowledgement.delivery_status, 'sent');
  assert.match(acknowledgement.body, /office.*invoice/i);
  assert.equal(f.state(saved.id).stage, 'escalated');
  await f.inbound('A', 'shared-owner-yard-answer');
  const incoming = f.db.sqlite.prepare('SELECT conversation_id,direction,body,channel FROM lead_messages WHERE provider_message_id=?').get('shared-owner-yard-answer');
  assert.ok(incoming, 'A signed customer reply on the owner test phone must still be recorded');
  assert.deepEqual({...incoming}, {conversation_id: notice.conversation_id, direction: 'inbound', body: 'A', channel: 'quo_sms'});
  assert.equal(f.customerSms.length, customerCount, 'A later reply cannot restart the sale after a staff handoff');
  assert.equal(f.state(saved.id).stage, 'escalated');
  assert.equal((await api.quoPost(signedDelivery(acknowledgement.body, acknowledgement.provider_message_id))).status, 200);
  assert.equal(f.db.sqlite.prepare('SELECT delivery_status FROM lead_messages WHERE provider_message_id=?').get(acknowledgement.provider_message_id).delivery_status, 'delivered');
  assert.deepEqual(f.db.sqlite.prepare('SELECT owner,owner_event_id FROM lead_conversations WHERE submission_id=?').get(saved.id), before);
  assert.equal(before.owner, 'backend');
});
