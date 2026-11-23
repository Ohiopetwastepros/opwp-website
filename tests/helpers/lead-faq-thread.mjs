import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {leadTestDatabase} from './lead-inbox-fixture.mjs';
import {buildMetaConfirmation} from '../../lib/meta-lead-policy.mjs';
import {isFirstLeadMessage} from '../../lib/lead-first-contact.mjs';
import {normalizeQuoMessageEvent} from '../../lib/quo-webhook.mjs';

// Load the ordinary webhook, customer admission, delivery and staff transports.
// Only the Worker bindings and external I/O are replaced in this test process.
const imports = {
  './cloudflare': "export const getRuntimeEnv=()=>({SNG_API_KEY:'fixture-only'});",
  './airtable': "export const ensureFreshAirtableCockpitSnapshot=()=>{throw Error('Unexpected Airtable call');};",
  './outbound-request': 'export const outboundFetch=(url,options)=>fetch(url,options);',
  './route-partner': "export const OPWP_ORGANIZATION_ID='org-opwp';",
};
const hooks = registerHooks({resolve(specifier, context, next) {
  if (Object.hasOwn(imports, specifier)) return {url: 'data:text/javascript,' + encodeURIComponent(imports[specifier]), shortCircuit: true};
  if (specifier === './sweepandgo') return next('./sweepandgo.js', context);
  return next(specifier, context);
}});
let recordInboundQuoMessage;
try {
  ({recordInboundQuoMessage} = await import('../../lib/lead-assistant.js'));
  await import('../../lib/submission-notifications.js');
} finally {
  hooks.deregister();
}

export const customerPhone = '+14195550120';
export const customerName = 'Riley Fixture';
export const address = '123 Fictional Terrace';
const business = '+14195550121';
const staff = '+14195550122';
const staffEmail = 'office@example.test';
const consent = {valid: true, formId: 'fixture-form', pageId: 'fixture-page'};
const customerFooter = /\b(?:reply|text) STOP|\bopt[ -]out\b|\bunsubscribe\b/i;
export const salesClose = /want (?:me|us) to (?:get|set|put)|get you (?:set up|on the schedule)|shall (?:we|I) (?:book|schedule)|ready to (?:start|sign up)|what(?:'s| is) (?:the|your) best email/i;
export const setup = /set\s?up|set you up|on the schedule|signup|sign up|get (?:the |your )?(?:account|service|cleanup) started|add (?:that|it)|which (?:way|option)|which .*fits|want .*regular (?:cleanup|service)|move (?:ahead|forward)/i;

function customerCopy(body, first = false) {
  assert.doesNotMatch(body, /poop|[\u2013\u2014]/i);
  assert.doesNotMatch(body, /(?:\$\s*15\b.{0,18}\boff\b|\bdiscount(?:ed)? (?:of|to) \$|\bmatch (?:that|their) price\b)/i);
  const withoutSelfIntroduction = body.replace(/\b(?:(?:this is|I am|I'm) Craig (?:with|from) Ohio Pet Waste Pros|Craig with Ohio Pet Waste Pros here)\b/gi, '');
  assert.doesNotMatch(withoutSelfIntroduction, /\bCraig\b/i);
  if (first) {
    assert.match(body, /\n\nReply STOP to opt out$/);
    assert.equal((body.match(/\bSTOP\b/gi) || []).length, 1);
  } else {
    assert.doesNotMatch(body, customerFooter);
    assert.doesNotMatch(body, /\b(?:text|send|give) (?:me |us )?(?:your |the |a )?(?:full )?(?:card number|CVV|bank account|social security number)\b/i);
  }
}

export function prices(body) {
  return [...body.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
}

export async function faqThread(t, {details = {}, stage = 'details_confirmed', expected = '', existing = false, auditAddress = address, auditDay = 'Friday'} = {}) {
  // Next resolves this extensionless dynamic import when the real sender runs.
  const smsImport = registerHooks({resolve(specifier, context, next) {
    return next(specifier === './lead-assistant' ? './lead-assistant.js' : specifier, context);
  }});
  t.after(() => smsImport.deregister());
  const db = leadTestDatabase();
  t.after(() => db.sqlite.close());
  const submissionId = crypto.randomUUID(), conversationId = crypto.randomUUID();
  const facts = {name: customerName, email: 'riley@example.test', address, city: 'Holland', zip: '43528',
    dogs: 1, frequency: 'once_a_week', lastCleaned: 'one_month', yardTier: 'tiny', yardAcres: 0.125, ...details};
  const frequencies = {once_a_week: 'Weekly', twice_a_week: 'Twice Weekly', every_other_week: 'Biweekly', one_time: 'One Time', monthly: 'Monthly'};
  const form = {name: facts.name, email: facts.email, city: facts.city, zip: facts.zip, number_of_dogs: facts.dogs,
    clean_up_frequency: frequencies[facts.frequency] || '', sms_consent_evidence: consent, follow_up_consent: true};
  db.sqlite.prepare(`INSERT INTO submissions(id, kind, source, status, name, email, phone, zip, payload)
    VALUES (?, 'partial_quote', 'facebook_lead', 'new', ?, ?, ?, ?, ?)`)
    .run(submissionId, facts.name, facts.email, customerPhone, facts.zip, JSON.stringify(form));
  db.sqlite.prepare(`INSERT INTO lead_conversations(id, submission_id, organization_id, channel, owner, automation_mode)
    VALUES (?, ?, 'org-opwp', 'facebook_lead', 'backend', 'approved')`).run(conversationId, submissionId);
  db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1, human_review_required=0 WHERE organization_id='org-opwp'").run();
  db.sqlite.prepare("INSERT INTO growth_leads(submission_id, organization_id, stage, updated_by) VALUES (?, 'org-opwp', 'new', 'fixture')")
    .run(submissionId);
  db.sqlite.prepare(`INSERT INTO meta_lead_intakes(submission_id, organization_id, meta_lead_id, form_id, page_id,
    source_url, review_reason, response_state, route_guidance, route_audited_at)
    VALUES (?, 'org-opwp', ?, ?, ?, 'https://example.test/form', '', ?, ?, '2026-11-20T15:00:00Z')`)
    .run(submissionId, 'test-' + submissionId, consent.formId, consent.pageId, JSON.stringify({details: {address: auditAddress}}),
      JSON.stringify({approvedDays: [auditDay], auditedBy: 'fixture-office'}));
  const state = {stage, expected, details_confirmed: stage === 'details_confirmed', details: facts, meta_confirmation_sent: true};
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id, submission_id, stage, state_json, revision) VALUES (?, ?, ?, ?, 1)")
    .run(conversationId, submissionId, stage, JSON.stringify(state));

  const firstContact = await isFirstLeadMessage(db, {submission_id: submissionId, phone: customerPhone});
  assert.equal(firstContact, true);
  // For a directory match this is pre-existing human correspondence. A new
  // applicant has the actual form confirmation, including its one-time footer.
  const intro = existing ? 'Thanks for contacting Ohio Pet Waste Pros.' : buildMetaConfirmation(form, {firstMessage: firstContact});
  if (!existing) customerCopy(intro, true);
  db.sqlite.prepare(`INSERT INTO lead_messages(id, conversation_id, organization_id, direction, channel, provider_message_id,
    body, delivery_status, automated, created_by, author) VALUES (?, ?, 'org-opwp', 'outbound', 'quo_sms', ?, ?, 'sent', ?, 'fixture', ?)`)
    .run(crypto.randomUUID(), conversationId, 'fixture-intro', intro, existing ? 0 : 1, existing ? 'craig' : 'backend');
  db.sqlite.prepare("UPDATE lead_conversations SET last_outbound_at=CURRENT_TIMESTAMP WHERE id=?").run(conversationId);
  assert.equal(await isFirstLeadMessage(db, {submission_id: submissionId, phone: customerPhone}), false);

  const customer = [], notices = [], unexpected = [];
  const env = {LEAD_PLAYBOOK_ENABLED: 'true', LEAD_PLAYBOOK_AUTO_SEND_ENABLED: 'true', LEAD_PLAYBOOK_NOTIFY_ENABLED: 'true',
    LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: customerPhone,
    LEAD_PLAYBOOK_ADMIN_ORIGIN: 'https://admin.example.test', LEAD_PLAYBOOK_LINK_SECRET: 'fictional-faq-signing-key-never-used-externally',
    LEAD_PLAYBOOK_CRAIG_CELL: staff, QUO_FROM_NUMBER: business, QUO_API_KEY: 'fixture-only',
    OWNER_NOTIFICATION_EMAIL: staffEmail, EMAIL_SENDING_ENABLED: 'true', EMAIL_FROM: 'sender@example.test',
    EMAIL: {async send(message) {
      assert.equal(message.to, staffEmail);
      const id = 'email-' + crypto.randomUUID();
      notices.push({channel: 'email', body: message.text, id});
      return {messageId: id};
    }}};
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = new URL(url);
    if (target.origin === 'https://openapi.sweepandgo.com' && options.method === 'GET' &&
        ['/api/v1/clients/active', '/api/v1/clients/active_no_subscription'].includes(target.pathname)) {
      return Response.json(existing ? [{cell_phone_number: customerPhone}] : []);
    }
    if (target.href === 'https://api.openphone.com/v1/messages' && options.method === 'POST') {
      const sms = JSON.parse(options.body), id = 'sms-' + crypto.randomUUID();
      assert.equal(sms.from, business);
      assert.deepEqual(sms.to, [sms.to[0]]);
      if (sms.to[0] === customerPhone) customer.push(sms.content);
      else if (sms.to[0] === staff) notices.push({channel: 'sms', body: sms.content, id});
      else { unexpected.push('Unexpected SMS recipient'); throw new Error(unexpected.at(-1)); }
      return Response.json({data: {id}});
    }
    unexpected.push(`${options.method || 'GET'} ${target.origin}${target.pathname}`);
    throw new Error('Unexpected provider call in FAQ fixture');
  });
  t.after(() => assert.deepEqual(unexpected, [], 'FAQ processing may only read the customer directory and use the fake message transports'));
  const readState = () => JSON.parse(db.sqlite.prepare("SELECT state_json FROM lead_playbook_state WHERE conversation_id=?").get(conversationId).state_json);
  async function inbound(text, {photo = false} = {}) {
    const id = 'in-' + crypto.randomUUID(), count = customer.length, noticeCount = notices.length;
    const object = {id, direction: 'incoming', from: customerPhone, to: [business], createdAt: new Date().toISOString(), text};
    if (photo) object.media = [{type: 'image/jpeg', url: 'https://media.example.test/fictional-yard.jpg'}];
    const event = normalizeQuoMessageEvent({id: 'ev-' + id, type: 'message.received', data: {object}});
    assert.ok(event, 'The Quo webhook normalizer must recognize this SMS or photo');
    await recordInboundQuoMessage(db, env, event);
    const sent = customer.slice(count);
    assert.ok(sent.length <= 1, 'At most one customer reply to an inbound event');
    for (const body of sent) customerCopy(body);
    for (const note of notices.slice(noticeCount)) {
      assert.match(note.body, /^\[OPWP STAFF ALERT\]/);
      assert.doesNotMatch(note.body, /Reply STOP to opt out/i);
    }
    const draft = db.sqlite.prepare(`SELECT d.* FROM lead_reply_drafts d JOIN lead_messages m ON m.id=d.inbound_message_id
      WHERE m.provider_message_id=? AND d.conversation_id=?`).get(id, conversationId);
    if (draft?.body) customerCopy(draft.body);
    return {text: event.text, body: sent[0] || '', draft, notices: notices.slice(noticeCount), state: readState(), event};
  }
  return {db, env, facts, customer, notices, conversationId, submissionId, inbound};
}

export function answered(turn, ...patterns) {
  assert.ok(turn.body, 'Expected a delivered customer SMS for ' + turn.text + ': ' +
    [turn.draft?.template_key, turn.draft?.status, turn.draft?.reason, turn.draft?.rejection_reason].filter(Boolean).join(', '));
  assert.equal(turn.notices.length, 0, 'Routine FAQ answers should stay with the lead');
  for (const pattern of patterns) assert.match(turn.body, pattern);
  return turn.body;
}

export function escalated(thread, turn, {reason, customerPrices = [], quotePrices = [], silent = false} = {}) {
  assert.deepEqual(turn.notices.map(item => item.channel).sort(), ['email', 'sms'], 'Expect one staff notice on each configured channel');
  assert.equal(Boolean(turn.body), !silent, 'Customer acknowledgment follows suppression and handoff policy');
  assert.doesNotMatch(turn.body, salesClose);
  assert.deepEqual(prices(turn.body), customerPrices, 'Only explicitly allowed published amounts belong in a handoff');
  for (const note of turn.notices) {
    const saved = thread.db.sqlite.prepare(`SELECT channel,status,conversation_id,submission_id FROM lead_playbook_owner_notifications
      WHERE provider_message_id=? AND organization_id='org-opwp'`).get(note.id);
    assert.deepEqual({...saved}, {channel: note.channel, status: 'accepted', conversation_id: thread.conversationId, submission_id: thread.submissionId});
    const explanation = note.body.match(/Reason:\s*(.*?)(?:\bLead:|\bName:|\bCustomer(?: said)?:|\bPhone:|\bQuote:|https?:\/\/|$)/is)?.[1];
    assert.match(explanation || '', reason);
    assert.ok(note.body.includes(turn.text), 'Staff see the exact inbound that triggered this handoff');
    assert.ok(note.body.includes(customerName), 'Staff see the lead name');
    assert.ok(note.body.replace(/[^\d]/g, '').includes(customerPhone.slice(-10)), 'Staff see the callback number');
    for (const amount of quotePrices) assert.ok(prices(note.body).includes(amount), 'Staff need the quote already sent, including $' + amount);
  }
}
