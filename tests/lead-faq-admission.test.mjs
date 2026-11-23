import test from 'node:test';
import assert from 'node:assert/strict';
import {answered, customerPhone, faqThread, prices, salesClose} from './helpers/lead-faq-thread.mjs';
import {winterPauseRows} from '../lib/winter-pause-export.mjs';

const accessNote = 'The gate is on the left. The can is inside the gate. The code is to follow.';
const prematureSetup = /finish (?:your|the) account|confirm your first cleanup|are those both right|best email for the account/i;

test('an unsolicited gate and can note cannot start signup before scope, route and price are confirmed', async t => {
  const f = await faqThread(t, {stage: 'intro_sent', details: {
    dogs: null, frequency: '', lastCleaned: null, yardTier: null, yardAcres: null, address: '', city: '', zip: '',
  }});
  const access = await f.inbound(accessNote);
  assert.ok(access.state.access_note_message_ids?.length, 'Staff can retrieve the original private access instructions');
  const turns = [access, await f.inbound('Yes'), await f.inbound('Yes')];
  for (const turn of turns) {
    assert.ok(!['access_questions_sent', 'handoff_signup', 'closed_won'].includes(turn.state.stage), turn.state.stage);
    assert.ok(!turn.state.quote);
    assert.equal(turn.state.details_confirmed, false);
    assert.doesNotMatch(turn.body, prematureSetup);
    assert.ok(!turn.notices.some(note => /signup ready|ready (?:for|to finish) (?:account )?setup/i.test(note.body)));
  }
  const signup = f.db.sqlite.prepare("SELECT COUNT(*) count FROM lead_playbook_owner_notifications WHERE conversation_id=? AND kind='signup_ready'").get(f.conversationId);
  assert.equal(signup.count, 0);
});

test('a gate code supplied in a separate text stays in the private thread and out of staff SMS and email', async t => {
  const f = await faqThread(t);
  const gate = '6'.repeat(4);
  await f.inbound(accessNote);
  const code = await f.inbound(gate);
  assert.equal(code.state.details.zip, f.facts.zip);
  const original = f.db.sqlite.prepare("SELECT body FROM lead_messages WHERE conversation_id=? AND provider_message_id=? AND direction='inbound'").get(f.conversationId, code.event.providerMessageId);
  assert.equal(original.body, gate);
  await f.inbound('Can I get a call from the owner?');
  assert.deepEqual([...new Set(f.notices.map(note => note.channel))].sort(), ['email', 'sms']);
  for (const note of f.notices) {
    assert.ok(!note.body.replace(/https?:\/\/\S+/g, '').includes(gate), 'Keep the gate code out of both staff transports');
    const receipt = f.db.sqlite.prepare('SELECT channel,status FROM lead_playbook_owner_notifications WHERE conversation_id=? AND provider_message_id=?').get(f.conversationId, note.id);
    assert.deepEqual({...receipt}, {channel: note.channel, status: 'accepted'});
  }
  assert.ok(!f.customer.some(body => body.includes(gate)), 'Avoid echoing the access code to the lead');
});

test('a corrected ZIP and city cannot reuse a route approval for the same street line in another city', async t => {
  const f = await faqThread(t);
  const initial = await f.inbound('How much?');
  assert.deepEqual(prices(answered(initial)), [95, 48, 58]);
  const change = await f.inbound('Actually my ZIP is 43606 in Toledo.');
  assert.equal(change.state.details.city, 'Toledo');
  assert.equal(change.state.details.zip, '43606');
  assert.equal(change.state.details.address, f.facts.address);
  const turns = [change, await f.inbound('Yes'), await f.inbound('What day do you come?')];
  for (const turn of turns) {
    assert.deepEqual(prices(turn.body), [], 'A personalized quote needs a current route audit for the corrected address');
    assert.doesNotMatch(turn.body, /\bFriday\b/i);
    assert.doesNotMatch(turn.body, salesClose);
    assert.ok(!['quote_recurring', 'quote_one_time', 'service_day_answer'].includes(turn.draft?.template_key));
  }
});

test('a pending quote rechecks the audited city and ZIP immediately before staff approval sends it', async t => {
  const f = await faqThread(t);
  f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED = 'false';
  const pending = await f.inbound('How much for weekly service?');
  assert.equal(pending.draft.template_key, 'quote_recurring');
  assert.equal(pending.draft.status, 'pending');
  assert.equal(pending.body, '');
  f.db.sqlite.prepare("UPDATE meta_lead_intakes SET response_state=json_set(response_state,'$.details.city','Toledo','$.details.zip','43606') WHERE submission_id=?").run(f.submissionId);
  const {actOnPlaybookDraft} = await import('../lib/lead-playbook-service.js');
  await assert.rejects(actOnPlaybookDraft(f.db, f.env, pending.draft.id, {action: 'approve'}, 'fixture-reviewer'), /route|address|location/i);
  assert.equal(f.customer.length, 0);
});

for (const ackStatus of ['pending', 'failed']) {
  test('a ' + ackStatus + ' customer acknowledgment holds the sales thread after staff receive the pricing objection', async t => {
    const f = await faqThread(t);
    const quote = await f.inbound('How much?');
    assert.deepEqual(prices(answered(quote)), [95, 48, 58]);
    let failedAttempts = 0;
    if (ackStatus === 'pending') {
      f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED = 'false';
    } else {
      const fakeTransport = globalThis.fetch;
      t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        if (new URL(url).href === 'https://api.openphone.com/v1/messages' && options.method === 'POST' &&
            JSON.parse(options.body).to.includes(customerPhone)) {
          failedAttempts++;
          return Response.json({error: 'fixture provider unavailable'}, {status: 503});
        }
        return fakeTransport(url, options);
      });
    }
    const objection = await f.inbound("That's too expensive.");
    assert.equal(objection.draft.status, ackStatus);
    assert.equal(objection.body, '');
    const alert = objection.notices.filter(note => note.body.includes("That's too expensive.") && /price|pricing/i.test(note.body));
    assert.deepEqual([...new Set(alert.map(note => note.channel))].sort(), ['email', 'sms']);
    assert.equal(objection.state.stage, 'escalated');
    if (ackStatus === 'failed') {
      assert.equal(failedAttempts, 1);
      globalThis.fetch.mock.restore();
    }
    f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED = 'true';
    const prior = [f.customer.length, f.notices.length];
    const {recordInboundQuoMessage} = await import('../lib/lead-assistant.js');
    await recordInboundQuoMessage(f.db, f.env, objection.event);
    assert.deepEqual([f.customer.length, f.notices.length], prior, 'Retrying the original event cannot deliver a second acknowledgment or alert');
    const assent = await f.inbound('Yes');
    assert.equal(assent.body, '');
    assert.ok(!assent.draft?.body || !salesClose.test(assent.draft.body));
    assert.equal(assent.state.stage, 'escalated');
  });
}

test('a relative winter start is dated in Eastern time and a completed staff task stays complete', async t => {
  const f = await faqThread(t, {existing: true});
  const key = 'winter_pause:org-opwp:' + f.conversationId;
  const row = () => f.db.sqlite.prepare('SELECT snapshot_key,payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(key);
  const {normalizeQuoMessageEvent} = await import('../lib/quo-webhook.mjs');
  const {recordInboundQuoMessage} = await import('../lib/lead-assistant.js');
  async function receiveAt(text, createdAt) {
    const id = crypto.randomUUID();
    const event = normalizeQuoMessageEvent({id: 'event-' + id, type: 'message.received', data: {object: {
      id, direction: 'incoming', from: customerPhone, to: [f.env.QUO_FROM_NUMBER], text, createdAt,
    }}});
    await recordInboundQuoMessage(f.db, f.env, event);
  }
  await receiveAt('Can we pause through winter and start back in the spring?', '2026-11-23T02:00:00Z');
  assert.deepEqual(f.notices.map(note => note.channel).sort(), ['email', 'sms']);
  // It is still November 22 in Ohio when the date reply arrives.
  await receiveAt('Tomorrow', '2026-11-23T03:00:00Z');
  const exported = winterPauseRows([row()]);
  assert.equal(exported.length, 1);
  assert.equal(exported[0].pause_start, '2026-11-23', 'Tomorrow is November 23 for an Ohio text sent on November 22 at 10 PM');
  assert.equal(exported[0].planned_restart, 'March 2027');
  f.db.sqlite.prepare("UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.status','completed') WHERE snapshot_key=?").run(key);
  await receiveAt('Thank you!', '2026-11-23T04:00:00Z');
  assert.equal(JSON.parse(row().payload).status, 'completed');
  assert.deepEqual(winterPauseRows([row()]), []);
  assert.deepEqual(f.customer, [], 'An existing customer stays with the office throughout the pause request');
});

test('a deferred staff alert excludes a quote accepted after the triggering text', async t => {
  const f = await faqThread(t);
  const transport = globalThis.fetch, staffPhone = f.env.LEAD_PLAYBOOK_CRAIG_CELL, staffEmail = f.env.OWNER_NOTIFICATION_EMAIL;
  let objection;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const isSms = new URL(url).href === 'https://api.openphone.com/v1/messages' && options.method === 'POST';
    const msg = isSms ? JSON.parse(options.body) : null;
    if (msg?.to.includes(customerPhone) && msg.content.includes('per month')) {
      f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED = 'false';
      f.env.LEAD_PLAYBOOK_CRAIG_CELL = '';
      f.env.OWNER_NOTIFICATION_EMAIL = '';
      // The customer texts again while Quo is still accepting the first send.
      objection = await f.inbound("That's too expensive.");
    }
    return transport(url, options);
  });
  const quote = await f.inbound('How much?');
  assert.deepEqual(prices(quote.body), [95, 48, 58]);
  assert.equal(objection.notices.length, 0);
  const events = f.db.sqlite.prepare('SELECT direction FROM lead_messages WHERE conversation_id=? AND provider_message_id IN (?,?) ORDER BY rowid').all(f.conversationId, objection.event.providerMessageId, quote.draft.provider_message_id);
  assert.deepEqual(events.map(event => event.direction), ['inbound', 'outbound']);
  f.env.LEAD_PLAYBOOK_CRAIG_CELL = staffPhone;
  f.env.OWNER_NOTIFICATION_EMAIL = staffEmail;
  const {flushPlaybookOwnerNotices} = await import('../lib/lead-playbook-notifications.mjs');
  await flushPlaybookOwnerNotices(f.db, f.env);
  assert.deepEqual(f.notices.map(note => note.channel).sort(), ['email', 'sms']);
  for (const note of f.notices) {
    assert.ok(note.body.includes("That's too expensive."));
    assert.match(note.body, /Prior quote: None recorded/i);
    assert.deepEqual(prices(note.body), []);
  }
});
