import test from 'node:test';
import assert from 'node:assert/strict';
import {answered, customerName, customerPhone, escalated, faqThread, prices} from './helpers/lead-faq-thread.mjs';

test('FAQ guard | difficulty keeping up with cleanup is not mistaken for an unsafe loose dog', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound("I can't keep up with the waste in the yard. How much for weekly service?");
  answered(turn, /per month/i, /initial cleanup/i);
  assert.deepEqual(prices(turn.body), [95, 48, 58]);
});

test('FAQ guard | a postquote referral discount request reaches staff without inventing a credit', async t => {
  const f = await faqThread(t);
  const quote = await f.inbound('How much is weekly service?');
  answered(quote);
  const turn = await f.inbound('Can I get a referral discount off that quoted price?');
  escalated(f, turn, {reason: /price|concession|objection/i, quotePrices: [95, 48, 58]});
  assert.doesNotMatch(turn.body, /credit|\$|want me to get/i);
});

test('FAQ guard | sensitive payment and access values are withheld from both staff transports', async t => {
  const f = await faqThread(t);
  const card = '4'.repeat(16), cvv = '7'.repeat(3), gate = '6'.repeat(4);
  const turn = await f.inbound('My card number is ' + card + ', CVV is ' + cvv + ', gate code is ' + gate + '. Please charge it.');
  assert.match(turn.body, /secure|portal/i);
  assert.deepEqual(turn.notices.map(notice => notice.channel).sort(), ['email', 'sms']);
  for (const body of [turn.body, ...turn.notices.map(notice => notice.body)]) {
    const prose = body.replace(/https?:\/\/\S+/g, '');
    assert.ok(!prose.includes(card));
    assert.ok(!prose.includes(cvv));
    assert.ok(!prose.includes(gate));
  }
  for (const notice of turn.notices) {
    assert.ok(notice.body.includes(customerName));
    assert.ok(notice.body.replace(/\D/g, '').includes(customerPhone.slice(-10)));
    assert.match(notice.body, /secure|sensitive|payment/i);
  }
});

test('FAQ guard | disabling the playbook gate prevents FAQ and staff sends', async t => {
  const f = await faqThread(t);
  f.env.LEAD_PLAYBOOK_ENABLED = 'false';
  const turn = await f.inbound('Can you tell me about haul-away?');
  assert.equal(turn.body, '');
  assert.deepEqual(turn.notices, []);
});

test('FAQ guard | the controlled test allowlist cannot be widened by an inbound FAQ question', async t => {
  const f = await faqThread(t);
  f.env.META_TEST_RECIPIENTS = '+14195550123';
  const turn = await f.inbound('Can you tell me about sanitizing?');
  assert.equal(turn.body, '');
  assert.deepEqual(turn.notices, []);
});

test('FAQ guard | direct AI questions receive an honest disclosure without a vendor name', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('Are you a bot or AI?');
  answered(turn, /\bAI\b|automat(?:ed|ion)|assistant/i);
  assert.doesNotMatch(turn.body, /sona|openai|automation credits|voice cloning/i);
});

test('FAQ guard | a five-digit gate code cannot replace the service ZIP or close an in-area lead', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('The gate code is 43416 and the outdoor can is inside the gate.');
  assert.equal(turn.state.details.zip, '43528');
  assert.notEqual(turn.state.stage, 'closed_lost');
  assert.doesNotMatch(turn.body, /Elmore|don't service|do not service|outside (?:our|the) (?:area|route)/i);
  assert.ok(turn.body || turn.notices.length, 'The access note must be acknowledged or sent for staff review');
});

test('FAQ guard | signup keeps a supplied outdoor-can location instead of asking for it again', async t => {
  const f = await faqThread(t);
  await f.inbound('How much is weekly service?');
  await f.inbound('👍');
  await f.inbound("Yes, that's right.");
  const turn = await f.inbound('Gate is on the left facing the house and the outdoor can is by the garage.');
  assert.equal(turn.state.details.gateSide, 'left');
  assert.equal(turn.state.details.trashLocation, 'by the garage');
  assert.equal(turn.state.stage, 'handoff_signup');
  assert.doesNotMatch(turn.body, /where is (?:the |your )?(?:outdoor )?(?:trash )?can/i);
  assert.deepEqual(turn.notices.map(notice => notice.channel).sort(), ['email', 'sms']);
});
