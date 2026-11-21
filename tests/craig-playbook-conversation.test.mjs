import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {processPlaybookInbound} from '../lib/lead-playbook-ingest.js';
import {buildMetaConfirmation} from '../lib/meta-lead-policy.mjs';
import {isFirstLeadMessage} from '../lib/lead-first-contact.mjs';
import {monthly, initialRange, PRICING} from '../lib/lead-pricing.mjs';
import {validateCraigReply} from '../lib/craig-voice.mjs';
import {playbookHash} from '../lib/lead-playbook-links.mjs';
import {normalizeQuoMessageEvent} from '../lib/quo-webhook.mjs';

const CUSTOMER = '+14195550100', BUSINESS = '+14195550188', OWNER = '+14195550199';
const ADDRESS = '123 Fictional Avenue';
const emptyDirectory = async () => ({ok: true, complete: true, rows: []});
const artifactDirectory = new URL('../tmp/craig-voice-local-2026-11-21/', import.meta.url);

async function fixture(t, {dogs = 1, quoted = false, zip = '43528'} = {}) {
  const previousFetch = globalThis.fetch;
  let unexpectedNetworkCalls = 0;
  globalThis.fetch = async () => {unexpectedNetworkCalls++; throw new Error('Every conversation provider must be an injected fake');};
  t.after(() => {globalThis.fetch = previousFetch; assert.equal(unexpectedNetworkCalls, 0);});
  const db = leadTestDatabase(), submissionId = crypto.randomUUID(), conversationId = crypto.randomUUID();
  const env = {LEAD_PLAYBOOK_ENABLED: 'true', LEAD_PLAYBOOK_AUTO_SEND_ENABLED: 'true', LEAD_PLAYBOOK_NOTIFY_ENABLED: 'true',
    LEAD_PLAYBOOK_LINK_SECRET: 'fabricated-conversation-review-secret-not-production', LEAD_PLAYBOOK_CRAIG_CELL: OWNER,
    LEAD_PLAYBOOK_ADMIN_ORIGIN: 'https://opwp.example', OWNER_NOTIFICATION_EMAIL: 'owner@example.test', QUO_API_KEY: 'fabricated-provider-key',
    QUO_FROM_NUMBER: BUSINESS, LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: CUSTOMER};
  const lead = {name: 'Casey Example', email: 'casey@example.test', number_of_dogs: dogs, clean_up_frequency: 'Weekly', zip, city: 'Holland',
    sms_consent_evidence: {valid: true, formId: 'fictional-form', pageId: 'fictional-page'}};
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,email,phone,payload) VALUES (?,'partial_quote','facebook_lead','new',?,?,?,?)")
    .run(submissionId, lead.name, lead.email, CUSTOMER, JSON.stringify(lead));
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode) VALUES (?,?,'org-opwp','facebook_lead','backend','approved')").run(conversationId, submissionId);
  db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0 WHERE organization_id='org-opwp'").run();
  db.sqlite.prepare("INSERT INTO growth_leads(submission_id,organization_id,stage,updated_by) VALUES (?,'org-opwp','new','fixture-owner')").run(submissionId);
  db.sqlite.prepare("INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,review_reason,response_state,route_guidance,route_audited_at) VALUES (?,'org-opwp',?,'fictional-form','fictional-page','fixture://source','',?,?,?)")
    .run(submissionId, 'fictional-meta-' + submissionId, JSON.stringify({details: {address: ADDRESS}}), JSON.stringify({approvedDays: ['Friday'], auditedBy: 'fictional-owner'}), '2026-11-21T12:00:00Z');
  const customer = [], staff = [], turns = [];
  const persistOutbound = body => {
    const providerId = 'ACfabricated-craig-outbound-' + customer.length;
    db.sqlite.prepare("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author) VALUES (?,?,'org-opwp','outbound','quo_sms',?,?,'sent',1,'fixture-backend','backend')")
      .run(crypto.randomUUID(), conversationId, providerId, body);
    db.sqlite.prepare('UPDATE lead_conversations SET last_outbound_at=CURRENT_TIMESTAMP WHERE id=?').run(conversationId);
    customer.push(body);
    return {provider_message_id: providerId};
  };
  assert.equal(await isFirstLeadMessage(db, {phone: CUSTOMER, submission_id: submissionId}), true);
  const first = buildMetaConfirmation(lead, {firstMessage: true});
  persistOutbound(first);
  assert.equal(await isFirstLeadMessage(db, {phone: CUSTOMER, submission_id: submissionId}), false);
  const details = {dogs, frequency: 'once_a_week', city: lead.city, zip, name: lead.name, email: lead.email,
    ...(quoted ? {yardTier: 'tiny', yardAcres: 0.125, lastCleaned: 'three_weeks', address: ADDRESS} : {})};
  const state = {stage: quoted ? 'quote_sent' : 'confirm_details_sent', details_confirmed: quoted, details, meta_confirmation_sent: true};
  db.sqlite.prepare('INSERT INTO lead_playbook_state(conversation_id,submission_id,stage,state_json,revision) VALUES (?,?,?,?,1)').run(conversationId, submissionId, state.stage, JSON.stringify(state));
  const notificationOptions = {
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.openphone.com/v1/messages');
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, [OWNER]);
      assert.match(payload.content, /^\[OPWP STAFF ALERT\]/);
      assert.doesNotMatch(payload.content, /Reply STOP to opt out|Text STOP to unsubscribe/i);
      staff.push({channel: 'sms', body: payload.content});
      return Response.json({data: {id: 'ACfabricated-staff-' + staff.length}});
    },
    emailSender: async (_env, message) => {assert.equal(message.to, 'owner@example.test'); staff.push({channel: 'email', body: message.text}); return {id: 'fabricated-email-' + staff.length};},
  };
  const readState = () => db.sqlite.prepare('SELECT revision,state_json FROM lead_playbook_state WHERE conversation_id=?').get(conversationId);
  let sequence = 0;
  async function inbound(text, {expectSend = true} = {}) {
    const prior = readState(), count = customer.length;
    const event = {providerMessageId: 'ACfabricated-craig-inbound-' + ++sequence, direction: 'inbound', from: CUSTOMER, to: BUSINESS, text, createdAt: new Date().toISOString()};
    const options = {sender: async (_db, _env, _lead, body) => persistOutbound(body), loadCustomerDirectory: emptyDirectory, notificationOptions};
    const result = await processPlaybookInbound(db, env, {conversationId, submissionId, event}, options);
    if (expectSend) {
      assert.equal(result.delivery?.status, 'sent', `Expected a sent draft for ${text}; result=${JSON.stringify(result)}`);
      assert.equal(customer.length, count + 1, text);
      assert.equal(readState().revision, prior.revision + 1, text);
      assert.equal(result.draft.provider_message_id, 'ACfabricated-craig-outbound-' + count);
    } else assert.equal(customer.length, count, `No outbound expected for ${text}`);
    const after = readState(), countAfter = customer.length;
    assert.equal((await processPlaybookInbound(db, env, {conversationId, submissionId, event}, options)).duplicate, true, 'The exact provider event is idempotent');
    assert.equal(customer.length, countAfter);
    assert.equal(readState().revision, after.revision);
    if (result.draft) turns.push({text, templateKey: result.draft.template_key, body: result.draft.body, slots: JSON.parse(result.draft.slots_json), stage: JSON.parse(after.state_json).stage});
    return result;
  }
  t.after(() => db.sqlite.close());
  return {db, env, lead, submissionId, conversationId, customer, staff, turns, inbound, readState};
}

test('Craig conversation uses natural yard and cleanup answers, one first-contact footer, current prices and one state update per turn', async t => {
  const f = await fixture(t);
  assert.match(f.customer[0], /1 dog.*43528.*weekly/);
  assert.match(f.customer[0], /\n\nReply STOP to opt out$/);
  for (const [text, key] of [
    ['Yes that is correct.', 'ask_yard'],
    ["It's just a standard sized yard. Id say about 1/8th acre", 'ask_last_cleaned'],
    ['2-3 weeks', 'confirm_details'],
    ['yep', 'ask_address'],
    [ADDRESS, 'quote_recurring'],
    ['What day do you come?', 'service_day_answer'],
    ['yes', 'ready_access'],
    ['yes', 'ask_gate_side'],
    ['left', 'ask_trash_location'],
    ['trash can is by the garage', 'signup_handoff'],
  ]) {
    assert.equal((await f.inbound(text)).draft.template_key, key, text);
    if (key !== 'signup_handoff') assert.equal(f.staff.length, 0, 'Ordinary lead answers must not produce staff alerts');
  }
  const quote = f.turns.find(turn => turn.templateKey === 'quote_recurring');
  assert.equal(quote.slots.monthly, monthly('once_a_week', 1));
  assert.equal(quote.slots.monthly, 95);
  assert.deepEqual([quote.slots.low, quote.slots.high], initialRange(1, 'three_weeks'));
  assert.equal(quote.body, "Our rate for 1 dog with weekly service is $95 per month, and the initial cleanup to get the yard caught up runs $37 to $45. The range depends on how much waste is in the yard and how long it takes. It's month to month with no contract. Want me to get you set up?");
  assert.doesNotMatch(quote.body, /;/);
  const recap = f.turns.find(turn => turn.templateKey === 'confirm_details');
  assert.match(recap.body, /and it's been about 2 to 3 weeks since the last cleanup\. Did I get that right\?$/);
  assert.doesNotMatch(recap.body, /last thoroughly cleaned about 3 weeks|been about 3 weeks/);
  const dayAnswer = f.turns.find(turn => turn.templateKey === 'service_day_answer');
  assert.match(dayAnswer.body, /in your neighborhood on Friday/);
  assert.doesNotMatch(dayAnswer.body, /\$/);
  const final = JSON.parse(f.readState().state_json);
  assert.equal(final.stage, 'handoff_signup');
  assert.equal(final.details.yardTier, 'tiny');
  assert.equal(final.details.yardAcres, 0.125);
  assert.equal(final.details.lastCleaned, 'three_weeks');
  assert.equal(final.details.lastCleanedAnswer, '2-3 weeks');
  assert.equal(final.details.gateSide, 'left');
  assert.equal(final.details.trashLocation, 'by the garage');
  assert.equal(f.customer.at(-1), "Got it, thank you! I'll finish your account setup and confirm your first cleanup with you. You'll just need to accept the terms before service starts.");
  assert.equal(f.staff.length, 2, 'Signup produces only the explicit staff handoff pair');
  for (const [index, body] of f.customer.entries()) {
    assert.equal((body.match(/Reply STOP to opt out/g) || []).length, index === 0 ? 1 : 0);
    assert.doesNotMatch(body, /poop|[\u2013\u2014]|\b[A-E]:/i);
    assert.deepEqual(validateCraigReply(body, {allowFirstContactFooter: index === 0, step: index === 0 ? 'first_contact' : undefined, templateKey: index === 0 ? 'meta_confirmation' : f.turns[index - 1].templateKey}), []);
  }
  mkdirSync(artifactDirectory, {recursive: true});
  writeFileSync(new URL('sample-conversation-new.json', artifactDirectory), JSON.stringify({first: f.customer[0], lead: f.lead, turns: f.turns}, null, 2) + '\n');
});

test('partial confirmations correct dogs and ZIP without generic staff review', async t => {
  const f = await fixture(t, {zip: '43537'});
  await f.inbound("yes except it's 2 dogs");
  assert.equal(JSON.parse(f.readState().state_json).details.dogs, 2);
  await f.inbound('actually 43528');
  assert.equal(JSON.parse(f.readState().state_json).details.zip, '43528');
  assert.equal(f.staff.length, 0);
});

test('price objection offers the approved biweekly grid and reconfirms before repricing', async t => {
  const f = await fixture(t, {quoted: true});
  const offered = await f.inbound('too expensive');
  assert.equal(offered.draft.template_key, 'objection_biweekly');
  assert.match(f.customer.at(-1), new RegExp(`\\$${monthly('every_other_week', 1)} per month`));
  assert.doesNotMatch(f.customer.at(-1), /\$15|\$68/);
  assert.equal((await f.inbound('yes')).draft.template_key, 'confirm_details');
  const revised = await f.inbound('yes');
  assert.equal(revised.draft.template_key, 'quote_recurring');
  assert.equal(JSON.parse(revised.draft.slots_json).monthly, monthly('every_other_week', 1));
  assert.equal(f.staff.length, 0);
});

test('contract and haul-away questions use current policy including the three-dog $31 addon', async t => {
  const f = await fixture(t, {dogs: 3, quoted: true});
  assert.equal((await f.inbound('Can I cancel anytime?')).draft.template_key, 'contract_answer');
  assert.match(f.customer.at(-1), /No contracts.*month to month.*cancel anytime/);
  assert.equal((await f.inbound('How does haul away work?')).draft.template_key, 'haul_away_answer');
  const haul = PRICING.addons.find(item => item.id === 'haul_away');
  assert.equal(haul.price3Plus, 31);
  assert.match(f.customer.at(-1), /double-bag.*outdoor trash can.*no extra charge.*\$31 per month/);
  assert.equal(f.staff.length, 0);
});

test('unsure yard size records the supplied address and a passive map task without staff alerts', async t => {
  const f = await fixture(t);
  await f.inbound('yes');
  assert.equal((await f.inbound('not sure')).draft.template_key, 'ask_map_address');
  assert.equal(JSON.parse(f.readState().state_json).expected, 'yardMapAddress');
  const mapped = await f.inbound(ADDRESS);
  assert.equal(mapped.draft.template_key, 'map_measurement_hold');
  const state = JSON.parse(f.readState().state_json);
  assert.equal(state.details.address, ADDRESS);
  assert.equal(state.map_measurement_pending, true);
  assert.equal(state.expected, 'yardMeasurement');
  assert.equal(state.details.yardTier, null);
  const task = f.db.sqlite.prepare('SELECT next_action,priority FROM growth_leads WHERE submission_id=?').get(f.submissionId);
  assert.match(task.next_action, /measure the provided cleanup area on the map before quoting/);
  assert.equal(task.priority, 'normal');
  assert.equal(f.staff.length, 0);
  await f.inbound('still not sure', {expectSend: false});
  assert.equal(f.staff.length, 0);
});

test('one yard clarification is followed by a quiet hold and a valid answer resumes the flow', async t => {
  const f = await fixture(t);
  await f.inbound('yes');
  const first = await f.inbound('big front and back, invisible fence');
  assert.equal(first.draft.template_key, 'clarify_yard');
  assert.equal(JSON.parse(f.readState().state_json).clarification_counts.yardTier, 1);
  const held = await f.inbound('they use the whole lot or just backyard?', {expectSend: false});
  assert.equal(held.reason, 'awaiting_yardTier');
  assert.equal(held.escalated, false);
  assert.equal(f.staff.length, 0);
  const resumed = await f.inbound('about 1/8th acre');
  assert.equal(resumed.draft.template_key, 'ask_last_cleaned');
  assert.equal(JSON.parse(f.readState().state_json).details.yardTier, 'tiny');
  assert.equal(f.staff.length, 0);
});

test('seasonal cleanup gets one friendly clarification while explicit out-of-range buildup gets a reasoned staff alert', async t => {
  const f = await fixture(t);
  await f.inbound('yes');
  await f.inbound('small backyard');
  assert.equal((await f.inbound('since before winter')).draft.template_key, 'clarify_last_cleaned');
  assert.equal(f.staff.length, 0);
  const held = await f.inbound('5 months', {expectSend: false});
  assert.equal(held.draft.status, 'pending');
  assert.equal(held.draft.reason, 'custom_pricing');
  assert.equal(f.staff.length, 2);
  for (const notice of f.staff) {
    assert.match(notice.body, /\[OPWP STAFF ALERT\]/);
    assert.match(notice.body, /custom_pricing/);
    assert.match(notice.body, /Customer said: "5 months"/);
    assert.doesNotMatch(notice.body, /Reply STOP to opt out|Text STOP to unsubscribe/i);
  }
});

test('malformed envelopes, STOP, wrong number and suppression cannot become detail clarifications', async t => {
  for (const envelope of [{}, {id: 'fictional-event', type: 'message.received', data: {object: {id: 'fictional-message', direction: 'incoming', text: ''}}}, {id: 'fictional-event', type: 'message.received', data: {object: {direction: 'incoming', text: 'small yard'}}}]) assert.equal(normalizeQuoMessageEvent(envelope), null);
  for (const text of ['STOP', 'wrong number', 'suppressed']) await t.test(text, async child => {
    const f = await fixture(child);
    await f.inbound('yes');
    const drafts = f.db.sqlite.prepare('SELECT count(*) count FROM lead_reply_drafts').get().count;
    if (text === 'suppressed') f.db.sqlite.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES ('org-opwp',?,'stop','fixture','fixture-owner')").run(await playbookHash(CUSTOMER));
    const result = await f.inbound(text === 'suppressed' ? 'standard sized yard' : text, {expectSend: false});
    assert.equal(result.reason, text === 'suppressed' ? 'suppressed' : text === 'STOP' ? 'stop' : 'wrong_number');
    assert.equal(f.db.sqlite.prepare('SELECT count(*) count FROM lead_reply_drafts').get().count, drafts);
    assert.equal(f.staff.length, 0);
  });
});
