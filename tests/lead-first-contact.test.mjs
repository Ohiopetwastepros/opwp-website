import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {renderPlaybookTemplate} from '../lib/lead-playbook.mjs';
import {isFirstLeadMessage} from '../lib/lead-first-contact.mjs';

const built = await build({stdin: {contents: "export {sendLeadMessage} from './lib/lead-assistant.js';", resolveDir: process.cwd()},
  bundle: true, platform: 'node', format: 'esm', write: false, alias: {'@': process.cwd()},
  plugins: [{name: 'first-contact-fake-outbound', setup(builder) {
    builder.onResolve({filter: /^\.\/outbound-request$/}, () => ({path: 'outbound', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: "export const outboundFetch=(...args)=>globalThis.__firstContactOutbound(...args);", loader: 'js'}));
  }}]});
const {sendLeadMessage} = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const PHONE = '+14195550100';
const env = {LEAD_PLAYBOOK_ENABLED: 'true', QUO_API_KEY: 'fictional-key', QUO_FROM_NUMBER: '+14195550188', LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: 'true', META_TEST_RECIPIENTS: PHONE};
const countFooters = body => (body.match(/Reply STOP to opt out|Text STOP to unsubscribe/gi) || []).length;

function fixture(t) {
  const db = leadTestDatabase(), sent = [], previousFetch = globalThis.fetch;
  let unexpectedNetworkCalls = 0;
  globalThis.fetch = async () => {unexpectedNetworkCalls++; throw new Error('Real network forbidden in first-contact tests');};
  globalThis.__firstContactOutbound = async (url, request, policy) => {
    assert.equal(url.href, 'https://api.openphone.com/v1/messages');
    assert.equal(policy.operation, 'yardops_lead_reply');
    assert.equal(policy.retries, 0);
    const payload = JSON.parse(request.body);
    assert.deepEqual(payload.to, [PHONE]);
    sent.push(payload.content);
    return Response.json({data: {id: 'ACfictional-first-contact-' + sent.length}});
  };
  t.after(() => {globalThis.fetch = previousFetch; delete globalThis.__firstContactOutbound; db.sqlite.close(); assert.equal(unexpectedNetworkCalls, 0);});
  function seed(id = crypto.randomUUID(), phone = PHONE) {
    const payload = JSON.stringify({follow_up_consent: true});
    const conversationId = crypto.randomUUID();
    db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,name,phone,payload) VALUES (?,'partial_quote','website','new','Casey Example',?,?)").run(id, phone, payload);
    db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id,status,owner,automation_mode) VALUES (?,?,'org-opwp','open','backend','approved')").run(conversationId, id);
    db.sqlite.prepare("UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0 WHERE organization_id='org-opwp'").run();
    return {id, conversation_id: conversationId, name: 'Casey Example', phone, payload, unread_count: 0};
  }
  const send = (lead, body, options) => sendLeadMessage(db, env, lead, body, 'playbook-approved:fixture-owner', true, options);
  return {db, sent, seed, send};
}

test('actual playbook send transport adds a blank-line STOP footer only to a brand-new contact', async t => {
  const f = fixture(t), lead = f.seed(), intro = renderPlaybookTemplate('intro_form');
  assert.equal(await isFirstLeadMessage(f.db, {submission_id: lead.id, phone: lead.phone}), true);
  const first = await f.send(lead, intro);
  assert.equal(countFooters(f.sent[0]), 1);
  assert.equal(first.body, intro + '\n\nReply STOP to opt out');
  assert.equal(f.db.sqlite.prepare('SELECT body FROM lead_messages WHERE provider_message_id=?').get(first.provider_message_id).body, first.body);
  assert.equal(await isFirstLeadMessage(f.db, {submission_id: lead.id, phone: lead.phone}), false);
  await f.send(lead, renderPlaybookTemplate('ask_dogs') + '\n\nReply STOP to opt out');
  assert.equal(countFooters(f.sent[1]), 0);
  assert.deepEqual(f.db.sqlite.prepare('SELECT body FROM lead_messages ORDER BY rowid').all().map(row => countFooters(row.body)), [1, 0]);
});

test('a subsequent submission with the same formatted phone gets no new footer', async t => {
  const f = fixture(t), firstLead = f.seed();
  await f.send(firstLead, renderPlaybookTemplate('intro_form'));
  const nextLead = f.seed(crypto.randomUUID(), '(419) 555-0100');
  assert.equal(await isFirstLeadMessage(f.db, {submission_id: nextLead.id, phone: nextLead.phone}), false);
  await f.send(nextLead, renderPlaybookTemplate('intro_form'));
  assert.deepEqual(f.sent.map(countFooters), [1, 0]);
});

for (const history of ['prior_contact', 'service_history']) test(`actual send transport omits the first-contact footer for ${history}`, async t => {
  const f = fixture(t);
  if (history === 'prior_contact') {
    f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES ('fictional-old-contact','onboarding','website','synced','419-555-0100','{}')").run();
  } else {
    f.db.sqlite.prepare("INSERT INTO sng_events(id,event_type,phone,payload) VALUES ('fictional-service','job:completed','419-555-0100','{}')").run();
  }
  const lead = f.seed();
  assert.equal(await isFirstLeadMessage(f.db, {submission_id: lead.id, phone: lead.phone}), false);
  await f.send(lead, renderPlaybookTemplate('intro_form') + '\n\nReply STOP to opt out');
  assert.equal(countFooters(f.sent[0]), 0);
  assert.doesNotMatch(f.sent[0], /\n/);
});

test('actual send transport accepts only the approved four-sentence quote context without repeating STOP', async t => {
  const f = fixture(t), lead = f.seed();
  await f.send(lead, renderPlaybookTemplate('intro_form'));
  const body = renderPlaybookTemplate('quote_recurring', {dogs: 1, frequency: 'weekly', monthly: 95, low: 37, high: 45});
  await assert.rejects(f.send(lead, body), /sentence_count/);
  await assert.rejects(f.send(lead, 'One. Two. Three. Four.', {templateKey: 'quote_recurring'}), /sentence_count/);
  assert.equal(f.sent.length, 1);
  const quote = await f.send(lead, body, {templateKey: 'quote_recurring'});
  assert.equal(quote.body, body);
  assert.equal(countFooters(quote.body), 0);
  assert.equal(f.sent.length, 2);
});
