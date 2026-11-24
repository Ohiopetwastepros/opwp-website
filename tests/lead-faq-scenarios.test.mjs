import test from 'node:test';
import assert from 'node:assert/strict';
import {playbookHash} from '../lib/lead-playbook-links.mjs';
import {PRICING} from '../lib/lead-pricing.mjs';
import {address, answered, customerName, customerPhone, escalated, faqThread, prices, salesClose, setup} from './helpers/lead-faq-thread.mjs';

const month = /month[ -]to[ -]month/i;
const contract = /no (?:long[ -]term )?contracts?|without (?:a )?contract/i;
const followingMonth = /(?:following|next) month/i;
const firstInvoice = /(?:first|initial) invoice/i;
const noTimeWindow = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\bbetween \d{1,2} (?:and|to) \d{1,2}\b/i;
const noPrice = body => assert.deepEqual(prices(body), []);

function recurringQuote(turn, monthly, low, high) {
  const body = answered(turn, /per month|\/mo(?:nth)?\b|monthly/i, /initial cleanup/i, month, contract, setup);
  assert.deepEqual(prices(body), [monthly, low, high], 'The current monthly price comes before both endpoints of the initial range');
  assert.match(body, /The range depends on how much waste is in the yard and how long it takes\./);
  return body;
}

function declined(turn, town) {
  assert.match(turn.body, new RegExp(town, 'i'));
  assert.match(turn.body, /(?:do not|don't|no longer|not currently|outside|out of|haven't (?:expanded|reached)|not (?:in|on)|aren't (?:in|servicing|serving))/i);
  assert.doesNotMatch(turn.body, salesClose);
  noPrice(turn.body);
}

async function assertSuppressed(thread, text) {
  const first = await thread.inbound(text);
  assert.equal(first.body, '');
  assert.equal(first.draft, undefined);
  assert.deepEqual(first.notices, []);
  const suppression = thread.db.sqlite.prepare("SELECT reason FROM lead_suppressions WHERE organization_id='org-opwp' AND phone_hash=?")
    .get(await playbookHash(customerPhone));
  assert.ok(suppression, 'The webhook must persist the do-not-text decision');
  const next = await thread.inbound('Yes, how much for weekly service?');
  assert.equal(next.body, '');
  assert.equal(next.draft, undefined);
  assert.deepEqual(next.notices, []);
}

test('FAQ 01 | a two-dog weekly quote is followed by a price-objection handoff', async t => {
  const f = await faqThread(t, {details: {dogs: 2, city: 'Sylvania', zip: '43560'}, auditDay: 'Tuesday'});
  recurringQuote(await f.inbound('I have 2 dogs in Sylvania, weekly, last cleaned about a month ago. How much?'), 105, 58, 70);
  const objection = await f.inbound("That's more than I expected. I need something cheaper.");
  escalated(f, objection, {reason: /price|pricing|objection/i, quotePrices: [105, 58, 70]});
  assert.doesNotMatch(objection.body, /biweekly|every other week|discount|\boff\b/i);
  assert.match(objection.body, /follow up|in touch|reach out|look (?:at|into) (?:it|that)/i);
  assert.equal((await f.inbound('OK, thank you.')).body, '');
});

test('FAQ 02 | a callback request asks for a time and confirms the callback number', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound("Can I just talk to a person? I'd rather have the owner call me tonight.");
  escalated(f, turn, {reason: /human|person|call|owner/i});
  assert.match(turn.body, /call/i);
  assert.match(turn.body, /(?:what|which|best).*time|when.*(?:good|work|best)/i);
  assert.match(turn.body, /this (?:phone |cell )?number|best (?:phone |cell )?number/i);
  assert.doesNotMatch(turn.body, /\d{3}[-.()\s]*\d{3}[-.\s]*\d{4}/);
});

test('FAQ 03 | a missed-service complaint and the subsequent refund request each reach staff', async t => {
  const f = await faqThread(t);
  const complaint = await f.inbound("I signed up last week and just walked the yard. I picked up a bunch of piles. This is unacceptable.");
  escalated(f, complaint, {reason: /complaint|quality|missed|service_billing/i});
  assert.match(complaint.body, /sorry|apologi/i);
  assert.match(complaint.body, /look|check|make (?:it|this|that) right/i);
  assert.match(complaint.body, /what day|which day|when/i);
  assert.match(complaint.body, /where|which (?:area|part)/i);
  const refund = await f.inbound('I want a refund and I want to cancel.');
  // A held thread can stay silent, but the new payment request must reach staff.
  escalated(f, refund, {reason: /refund|disput|billing/i, silent: !refund.body});
  assert.doesNotMatch(refund.body, /(?:already|have|we'll|I'll) (?:refund(?:ed)?|cancel(?:led|ed)? (?:the|your) (?:plan|account))|free (?:month|visit)/i);
});

test('FAQ 04 | Findlay gets a Bowling Green service-boundary reply', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('Do you service Findlay Ohio? 45840. 2 dogs, weekly.');
  declined(turn, 'Findlay');
  assert.match(turn.body, /Bowling Green/i);
  assert.match(turn.body, /expand|future|open|reach out|let you know/i);
});

test('FAQ 05 | Fremont gets a decline with no residential price or booking', async t => {
  const f = await faqThread(t);
  declined(await f.inbound("I'm in Fremont 43420. Can you come out?"), 'Fremont');
});

test('FAQ 06 | Monroe requires an address and ZIP and the actual Michigan ZIP controls coverage', async t => {
  await t.test('resolve an ambiguous Monroe location', async child => {
    const f = await faqThread(child, {details: {dogs: 2, address: '', city: '', zip: ''}});
    const ask = await f.inbound('We are in the Monroe area, 2 dogs, looking for weekly. Do you come out here?');
    answered(ask, /address/i, /zip/i);
    noPrice(ask.body);
    declined(await f.inbound(address + ', Monroe MI 48161.'), 'Monroe|48161|area');
  });
  await t.test('a location that is still unclear goes to staff', async child => {
    const f = await faqThread(child, {details: {address: '', city: '', zip: ''}});
    answered(await f.inbound('Do you come to the Monroe area?'), /address/i, /zip/i);
    const unresolved = await f.inbound("I don't have the exact ZIP. All I know is it is near Monroe.");
    escalated(f, unresolved, {reason: /area|coverage|location/i});
  });
  for (const [city, zip] of [['Temperance', '48182'], ['Lambertville', '48144']]) {
    await t.test('quote the audited ' + city + ' address', async child => {
      const f = await faqThread(child, {details: {dogs: 2, city, zip}});
      recurringQuote(await f.inbound('What is the weekly rate?'), 105, 58, 70);
    });
  }
});

test('FAQ 07 | six and seven dogs have published weekly prices and custom initial cleanups', async t => {
  for (const [dogs, rate] of [[6, 150], [7, 160]]) await t.test(dogs + ' dogs', async child => {
    const f = await faqThread(child, {details: {dogs, lastCleaned: null, yardTier: null, yardAcres: null}});
    const turn = await f.inbound(`We have ${dogs} dogs. What's weekly?`);
    assert.deepEqual(prices(turn.body), [rate], 'No extrapolated initial range');
    assert.match(turn.body, /per month|\/month|monthly/i);
    assert.match(turn.body, /how (?:big|large)|yard size|size of (?:the|your) (?:yard|cleanup area)/i);
    assert.match(turn.body, /last (?:thoroughly )?clean|since.*clean|how long.*clean/i);
    if (turn.notices.length) escalated(f, turn, {reason: /custom|initial/i, customerPrices: [rate]});
    else {
      const initial = await f.inbound('Yes, I want to start recurring. What will the initial cleanup cost?');
      escalated(f, initial, {reason: /custom|initial/i, customerPrices: prices(initial.body).length ? [rate] : []});
    }
  });
  await t.test('a one-time cleanup for six dogs has no published range', async child => {
    const f = await faqThread(child, {details: {dogs: 6, frequency: 'one_time'}});
    const oneTime = await f.inbound('How much for a one-time cleanup for our six dogs?');
    escalated(f, oneTime, {reason: /custom|initial/i});
  });
});

test('FAQ 08 | four dogs and seven incoming puppies require custom scoping', async t => {
  const f = await faqThread(t, {details: {dogs: null, address: '', yardTier: null, yardAcres: null, lastCleaned: null}});
  const turn = await f.inbound("We have 4 dogs and 7 puppies. They'll all be in the yard in 2-3 weeks. How much for weekly?");
  escalated(f, turn, {reason: /custom|dog count/i});
  for (const pattern of [/total|all (?:11|eleven)|how many/i, /address/i, /(?:yard|cleanup area).{0,18}size|how (?:large|big)|size of/i, /last clean|since .*clean/i]) {
    assert.match(turn.body, pattern);
  }
});

test('FAQ 09 | a dog park with bins needs commercial scope and a staff quote', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('We have a small dog side and a large dog side. Both have two waste bins to empty. Our old company also changed extra trash cans and replaced the bags we supplied.');
  escalated(f, turn, {reason: /commercial|waste.station/i});
  for (const pattern of [/how often|frequency/i, /how many|number of/i, /haul|off.?site/i, /dumpster/i, /walk|scoop/i]) assert.match(turn.body, pattern);
});

test('FAQ 10 | wrong number is a durable suppression, including later sales messages', async t => {
  await assertSuppressed(await faqThread(t), 'Who is this? I think you have the wrong number.');
});

test('FAQ 11 | Spanish gets a brief English handoff and no sales questions', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('Hola, cuanto cuesta el servicio para 2 perros? Estamos en Toledo.');
  escalated(f, turn, {reason: /Spanish|language|English/i});
  assert.match(turn.body, /Ohio Pet Waste Pros/i);
  assert.match(turn.body, /follow up|reach out|in touch/i);
  assert.doesNotMatch(turn.body, /\b(?:Hola|perro|precio|servicio|weekly|dogs|quote)\b/i);
});

test('FAQ 12 | asking if it is a bot and requesting a person triggers an honest handoff', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('Is this a bot? Are you Sona? I want to talk to a real person.');
  escalated(f, turn, {reason: /identity|human|owner|person/i});
  assert.match(turn.body, /automat(?:ed|ion)|\bAI\b|virtual assistant/i);
  assert.match(turn.body, /owner|personally|follow up|call|reach out/i);
  assert.doesNotMatch(turn.body, /\b(?:Sona|Quo)\b|voice clon|credits|real person typing/i);
});

test('FAQ 13 | STOP leaves the native opt-out reply to Quo and blocks later sales', async t => {
  await assertSuppressed(await faqThread(t), 'STOP');
});

test('FAQ 14 | thumbs-up after a quote advances to missing signup details', async t => {
  const f = await faqThread(t, {details: {email: ''}});
  recurringQuote(await f.inbound('How much?'), 95, 48, 58);
  const turn = await f.inbound('👍');
  answered(turn, /email|gate|trash can/i);
  noPrice(turn.body);
  assert.doesNotMatch(turn.body, /how many dogs|how (?:large|big)|last (?:thoroughly )?cleaned/i);
});

test('FAQ 15 | an emoji with no quote context gets a greeting and no guessed details', async t => {
  const f = await faqThread(t, {stage: 'intro_sent', details: {dogs: null, frequency: '', lastCleaned: null, yardTier: null, yardAcres: null, address: '', city: '', zip: ''}});
  const turn = await f.inbound('🐶');
  answered(turn, /Ohio Pet Waste Pros/i, /quote|schedule/i);
  noPrice(turn.body);
  assert.doesNotMatch(turn.body, /\b(?:one|two|\d+) dogs?\b/i);
});

test('FAQ 16 | a captionless yard photo survives webhook normalization and asks for missing facts', async t => {
  const f = await faqThread(t, {stage: 'intro_sent', details: {dogs: null, frequency: '', lastCleaned: null, yardTier: null, yardAcres: null, address: '', city: '', zip: ''}});
  const turn = await f.inbound('', {photo: true});
  answered(turn, /thank/i, /photo|picture/i, /dogs|often|frequenc|last clean|address|zip/i);
  noPrice(turn.body);
  const inbound = f.db.sqlite.prepare("SELECT body FROM lead_messages WHERE provider_message_id=?").get(turn.event.providerMessageId);
  assert.doesNotMatch(inbound.body, /media\.example\.test/);
});

test('FAQ 17 | a photo followed by count, frequency and cleanup timing produces the grid quote', async t => {
  const f = await faqThread(t, {stage: 'collect_details', details: {dogs: null, lastCleaned: null}});
  const photo = await f.inbound('', {photo: true});
  answered(photo, /thank/i, /photo|picture/i);
  noPrice(photo.body);
  let turn = await f.inbound("That's the backyard. 1 dog, I think it's been 2 or 3 weeks. Weekly?");
  if (!prices(turn.body).length && /which|closer/i.test(turn.body)) turn = await f.inbound('Closer to 3 weeks.');
  if (!prices(turn.body).length) {
    answered(turn, /did I get that right|is that right|sound right/i);
    turn = await f.inbound('Yes.');
  }
  const amounts = prices(turn.body);
  assert.ok([[95, 27, 34], [95, 37, 45], [95, 27, 34, 37, 45]].some(expected => expected.join() === amounts.join()), 'Weekly rate and only published two- or three-week ranges');
  answered(turn, /range depends on how much waste/i, month, contract, setup);
});

test('FAQ 18 | a contract or one-month trial question explains cancel, pause and first invoice', async t => {
  const f = await faqThread(t);
  answered(await f.inbound('Can I cancel at any time or is it contractual?'), month, contract, /cancel any ?time/i, setup);
  answered(await f.inbound('Can I pay for 1 month to see if I like it?'), /initial cleanup/i, followingMonth, firstInvoice, /pause|reassess/i, setup);
});

test('FAQ 19 | nobody needs to be home and route timing comes with two texts', async t => {
  const f = await faqThread(t);
  answered(await f.inbound('Do I have to be home?'), /(?:nobody|no one|don.t|do not|needn.t|no need).*home/i, /access|gate/i, setup);
  const turn = await f.inbound('What time would they be out?');
  answered(turn, /garbage (?:pick[ -]?up|collection)/i, /route/i, /on (?:the|our|their|my) way|on-the-way/i, /done|complete|finish/i, /text/i, setup);
  assert.doesNotMatch(turn.body, noTimeWindow);
});

test('FAQ 20 | rain and heavy snow have distinct service policies and no promised credit', async t => {
  const f = await faqThread(t);
  answered(await f.inbound("Do you still come if it's raining?"), /rain or shine/i, setup);
  const turn = await f.inbound('What if we get a big snow?');
  answered(turn, /snow/i, /buried|covered|can.t see/i, /before|ahead/i, setup);
  assert.doesNotMatch(turn.body, /\b(?:refund|credit|free visit)\b/i);
});

test('FAQ 21 | disposal is double-bagged and haul-away for three dogs is $31 monthly', async t => {
  const f = await faqThread(t, {details: {dogs: 3}});
  answered(await f.inbound('Do you dump it right in the can or bag it?'), /double[ -]bag/i, /outdoor (?:trash )?can/i, /no extra|included|no (?:additional )?charge/i, setup);
  const haul = await f.inbound("I'd rather you just take it with you. I have 3 dogs.");
  answered(haul, /haul|take/i, /\$31\s*(?:per |a |\/)?month/i, setup);
  assert.ok(prices(haul.body).every(amount => [21, 31].includes(amount)));
});

test('FAQ 22 | add-ons use individual published rates and pushing for a special deal goes to staff', async t => {
  const f = await faqThread(t);
  const add = await f.inbound('Can I add a sanitizer and deodorizer to the cleanup?');
  answered(add, /saniti/i, /deodori/i, /\$30\s*(?:per |a |\/)?month/i, /\$35.{0,22}one[ -]time|one[ -]time.{0,22}\$35/i, /\$25.{0,15}treatment/i, setup);
  assert.deepEqual(prices(add.body).sort((a, b) => a - b), [25, 30, 35]);
  const combo = await f.inbound('Is there a combo price if I do it every month with the subscription?');
  answered(combo, /individuall?y|separately|no (?:package|combo|bundle)|(?:don.t|do not) (?:bundle|offer .*discount)/i);
  assert.ok(prices(combo.body).every(amount => [25, 30, 35].includes(amount)));
  escalated(f, await f.inbound('Can you do better and give me a special deal for both?'), {reason: /pric|discount|objection|deal/i});
});

test('FAQ 23 | one-time pricing explains both ranges, the one-month commitment and the billing date', async t => {
  const f = await faqThread(t, {details: {dogs: 3, frequency: 'one_time'}});
  const turn = await f.inbound('I would like to start with a one time clean-up and possibly set up recurring in the future. 3 dogs, about a month since it was cleaned.');
  answered(turn, /one[ -]time/i, /even biweekly|(?:weekly or )?biweekly|every other week/i, /(?:at least |even (?:for )?|for )(?:one|1|a) month/i,
    /initial cleanup/i, /lower|drops|go(?:es)? down/i, followingMonth, firstInvoice, /(?:1st|first (?:day )?of (?:each|the|every) month)/i, month, contract, setup);
  assert.deepEqual(prices(turn.body).slice(0, 4), [95, 120, 65, 75]);
  assert.ok(prices(turn.body).slice(4).every(amount => [120, 92].includes(amount)));
});

test('FAQ 24 | asking a spouse gets a low-pressure reply with no discount', async t => {
  const f = await faqThread(t);
  recurringQuote(await f.inbound('How much?'), 95, 48, 58);
  const turn = await f.inbound("Okay, let me talk with my husband. I'll text you back if that's okay?");
  answered(turn, /no (?:worries|problem|rush|pressure)|take your time|sounds good|of course/i);
  assert.doesNotMatch(turn.body, /discount|limited time|\boff\b|\?$/i);
  noPrice(turn.body);
});

test('FAQ 25 | a cheaper competitor is a pricing handoff even when the lead says they will pass', async t => {
  const f = await faqThread(t);
  recurringQuote(await f.inbound('How much?'), 95, 48, 58);
  const turn = await f.inbound("Thanks for the fast response. I think I'll pass, another company close to Perrysburg is cheaper. Thank you for your time.");
  escalated(f, turn, {reason: /pric|competitor|objection/i, quotePrices: [95, 48, 58]});
  assert.doesNotMatch(turn.body, /biweekly|every other week|match|discount|better than/i);
});

test('FAQ 26 | a do-it-yourself sign-off gets a kind acknowledgment and ends the sales exchange', async t => {
  const f = await faqThread(t);
  recurringQuote(await f.inbound('How much?'), 95, 48, 58);
  const turn = await f.inbound("I was interested but I think I'll do it myself. I was just being lazy. Lol thank you.");
  answered(turn, /no (?:worries|problem)|nothing wrong|understand|change your mind|off your plate/i);
  noPrice(turn.body);
  assert.doesNotMatch(turn.body, /lazy|discount|limited|hurry/i);
  assert.equal((await f.inbound('Thanks again!')).body, '');
});

test('FAQ 27 | gate and can details survive a tricky-latch note and are not asked again', async t => {
  const f = await faqThread(t, {details: {email: ''}});
  recurringQuote(await f.inbound('How much?'), 95, 48, 58);
  const turn = await f.inbound("Yes let's start. The gate is on the left if you're facing the house. It has a four-digit code, and the can is inside the gate by the shed.");
  answered(turn, /email/i, /noted|note|account|thanks|thank you|got it/i);
  assert.equal(turn.state.details.gateSide, 'left');
  assert.match(turn.state.details.trashLocation, /shed/i);
  assert.doesNotMatch(turn.body, /which side|where.*(?:trash|can)/i);
  const latch = await f.inbound("There's a second latch that sticks. You have to lift it.");
  answered(latch, /note|account|technician|got it|thanks|thank you/i);
  assert.equal(latch.state.details.gateSide, 'left');
  assert.match(latch.state.details.trashLocation, /shed/i);
  const noted = f.db.sqlite.prepare(`SELECT body FROM lead_messages WHERE conversation_id=?
    AND direction='inbound' AND id IN (SELECT value FROM json_each(?)) ORDER BY rowid`)
    .all(f.conversationId, JSON.stringify(latch.state.access_note_message_ids || []));
  assert.deepEqual(noted.map(row => row.body), [turn.text, latch.text],
    'Staff can resolve both access notes to the exact private inbound without copying access details into shared state');
  assert.doesNotMatch(latch.body, /which side|where.*(?:trash|can)/i);
  const billing = await f.inbound('How does payment work once my account is set up?');
  answered(billing, /sweep\s*(?:and|&)\s*go/i, /email/i, /card/i, /check/i, followingMonth, firstInvoice);
});

test('FAQ 28 | a wary dog gets a request to secure it and a bite history goes to staff', async t => {
  const f = await faqThread(t);
  const dogs = await f.inbound("I won't be home. The dogs have a doggie door and will probably be in the yard. One of them is not great with strangers.");
  answered(dogs, /home/i, /inside|secure|keep .* in|door closed/i, /door/i, /note|technician/i);
  const unsafe = await f.inbound("I can't secure the dog during visits. He has bitten a stranger before.");
  escalated(f, unsafe, {reason: /safety|unsafe|bite|aggressive/i});
  assert.doesNotMatch(unsafe.body, /work around|they.ll be fine|tech(?:nician)? (?:will|can) (?:come|work) anyway/i);
});

test('FAQ 29 | a food question midway through a one-dog cleanup quote keeps the plan intact', async t => {
  const f = await faqThread(t);
  await f.inbound('Weekly for 1 dog sounds good.');
  const turn = await f.inbound('Do you also deliver dog food? How much?');
  answered(turn, /Extreme Dog Fuel/i, /40[ -]?(?:lb|pound)/i, /\$59.{0,8}(?:plus|\+) tax/i, /regular (?:service|cleanup|visit)/i,
    /https:\/\/www\.ohiopetwastepros\.com\/dog-food\//, /recommend|which (?:bag|formula)|help .* (?:bag|formula)/i);
  assert.deepEqual(prices(turn.body), [59]);
  assert.equal(turn.state.details.dogs, 1);
  assert.equal(turn.state.details.frequency, 'once_a_week');
  assert.doesNotMatch(turn.body, /I.ve (?:added|ordered)|has been (?:added|ordered)|charged/i);
});

test('FAQ 30 | a Thanksgiving inquiry keeps the route provisional and a required date goes to staff', async t => {
  const f = await faqThread(t, {details: {city: 'Toledo', zip: '43606'}});
  const holiday = await f.inbound('Can you start the week of Thanksgiving? I have 1 dog, weekly, Toledo.');
  answered(holiday, /holiday|Thanksgiving/i, /adjust|move|nearby day/i, /confirm/i);
  assert.doesNotMatch(holiday.body, /(?:come|start|be there) (?:on )?Thursday/i);
  assert.doesNotMatch(holiday.body, noTimeWindow);
  if (prices(holiday.body).length) assert.deepEqual(prices(holiday.body), [95, 48, 58]);
  else recurringQuote(await f.inbound('What would the weekly plan cost?'), 95, 48, 58);
  const date = await f.inbound('I need a definite first appointment that exact holiday week.');
  escalated(f, date, {reason: /holiday|schedul|dispatch|start date|route/i, quotePrices: [95, 48, 58]});
  assert.doesNotMatch(date.body, noTimeWindow);
});

test('FAQ 31 | offering a check is fine, but insisting on cash goes to staff', async t => {
  const f = await faqThread(t);
  recurringQuote(await f.inbound('How much?'), 95, 48, 58);
  const payment = await f.inbound("The quote looks good. I'll be home so you can just take a check. Or I can pay cash if that's easier.");
  answered(payment, /check/i, /cash.*(?:offline.*owner|owner.*offline)/i, setup);
  const cash = await f.inbound('I insist on paying cash. I can only use cash.');
  escalated(f, cash, {reason: /cash|payment/i, quotePrices: [95, 48, 58]});
  assert.doesNotMatch(cash.body, /(?:leave|bring) (?:me |us )?(?:the )?cash|cash (?:works|is fine)/i);
});

test('FAQ 32 | removing a dog after a loss sends a kind reply and a billing change to the office', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound('If I need to remove a dog from the account do I just log in to update? Our oldest dog has passed away.');
  escalated(f, turn, {reason: /dog|account|billing/i});
  for (const pattern of [/sorry|condolence/i, /office|on our (?:end|side)|have us|we.ll|I.ll (?:take care|have|update)/i, /portal|billing/i, /when|what date/i]) assert.match(turn.body, pattern);
  assert.doesNotMatch(turn.body, /just (?:log in|click)|automatically (?:fix|adjust|update)/i);
});

test('FAQ 33 | a Columbus Facebook lead gets a geographic decline and ad explanation', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound("I saw your ad. I'm in Columbus. 1 dog, weekly.");
  declined(turn, 'Columbus');
  assert.match(turn.body, /Facebook|ad/i);
  assert.match(turn.body, /Toledo/i);
});

test('FAQ 34 | six months of buildup gets a custom cleanup review without a guessed price', async t => {
  const f = await faqThread(t, {stage: 'collect_details', details: {address: '', frequency: '', yardTier: null, yardAcres: null, lastCleaned: null}});
  const turn = await f.inbound("Can you give me a quote on my yard? It's been about six months since my backyard was cleaned. I have one dog, a golden retriever.");
  escalated(f, turn, {reason: /custom|buildup|initial/i});
  for (const pattern of [/address/i, /yard size|how (?:large|big)|size of (?:the|your)/i, /one[ -]time/i, /recurring|regular service/i]) assert.match(turn.body, pattern);
});

test('FAQ 35 | asking to skip next week keeps the plan and sends a dispatch request', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound("Can I cancel next week's cleanup ONLY? I want to keep the service, just skip that day.");
  escalated(f, turn, {reason: /skip|dispatch/i});
  assert.match(turn.body, /skip/i);
  assert.match(turn.body, /keep|stay|continues|plan (?:will |is )?(?:still|active)/i);
  assert.doesNotMatch(turn.body, /(?:we.ve|I.ve|already) (?:skipped|cancelled|canceled)|refund|credit/i);
});

test('FAQ 36 | winter pause explains 90 days, the March extension, and saves the office request', async t => {
  const f = await faqThread(t);
  const turn = await f.inbound("Can we pause through the winter and start back up in the spring? We won't be using the backyard.");
  escalated(f, turn, {reason: /winter|pause/i});
  for (const pattern of [/90[ -]day/i, /extend|renew|pause again/i, /March/i, /follow up|check (?:back|in)|reach out/i, /when|what date/i]) assert.match(turn.body, pattern);
  const row = f.db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?")
    .get('winter_pause:org-opwp:' + f.conversationId);
  assert.ok(row, 'Winter requests must be durably available to the private staff list');
  const request = JSON.parse(row.payload);
  assert.equal(request.name, customerName);
  assert.equal(request.phone, customerPhone);
  assert.equal(request.status, 'staff_review');
  assert.match(request.plannedRestart || '', /March|\d{4}-03(?:-|$)/i);
  assert.ok(Object.hasOwn(request, 'pauseStart'), 'Keep the unconfirmed start explicit until staff have a date');
});

test('FAQ 37 | Elmore, ZIP 43416, and both together all receive the standard decline', async t => {
  assert.ok(!PRICING.serviceZips.includes('43416'));
  assert.ok(!PRICING.serviceZips.includes('43430'));
  for (const [description, text] of [
    ['name and ZIP', 'Do you service Elmore? 43416. 1 dog, weekly, last cleaned about a month ago.'],
    ['name only', 'Do you service Elmore?'],
    ['ZIP only', 'Do you service ZIP 43416?'],
  ]) await t.test(description, async child => {
    const f = await faqThread(child);
    const turn = await f.inbound(text);
    declined(turn, 'Elmore|43416|your area');
    assert.match(turn.body, /future|expand|open|reach out|let you know/i);
  });
});

test('FAQ clarification | the per-visit question explains prepaid monthly billing without a price handoff', async t => {
  const f = await faqThread(t, {details: {dogs: 2}});
  recurringQuote(await f.inbound('How much?'), 105, 58, 70);
  const clarification = await f.inbound('Is that per month or per visit?');
  answered(clarification, /prepaid|prepay|paid (?:up front|in advance)|pay .*in advance/i, /month/i, setup);
  assert.doesNotMatch(clarification.body, /\$105\s*(?:per |a |\/)visit/i);
  assert.doesNotMatch(clarification.body, /how many dogs|which frequency|last cleaned|what(?:'s| is) your (?:address|ZIP)|how (?:big|large)/i);
  for (const slot of ['dogs', 'frequency', 'yardTier', 'lastCleaned', 'zip', 'address']) assert.equal(clarification.state.details[slot], f.facts[slot], slot);
});

test('FAQ add-ons | a front yard costs $21 monthly and a referral receives thanks without a credit', async t => {
  const f = await faqThread(t);
  const front = await f.inbound('What is included, and can you scoop the patio and front yard?');
  answered(front, /patio|hard surfaces/i, /front yard/i, /\$21\s*(?:per |a |\/)?month/i, setup);
  const referral = await f.inbound('Our neighbor Taylor Fixture referred us.');
  answered(referral, /thank/i, /note|Taylor|refer/i);
  assert.doesNotMatch(referral.body, /(?:earn|give|receive|get) (?:a |you |your neighbor )?(?:bonus|credit|discount)|\$\d+ (?:off|credit)/i);
});

test('FAQ escalation rules | payment disputes, unsupported payments, legal, coverage, food orders and unknowns notify the office', async t => {
  for (const [issue, why, silentAllowed] of [
    ['My card was declined. Can you resubmit my invoice?', /card|past.due|billing|payment/i],
    ["Don't charge me. I am disputing the last payment.", /payment|disput|billing/i],
    ['Can I pay with Venmo instead?', /payment|Venmo/i],
    ['Can you send me your W-9 and proof of insurance?', /insur|licens|vendor|document/i],
    ['My attorney will contact you about this.', /legal|attorney/i, true],
    ['I want to order only dog food. Can you set up billing and the first delivery?', /food|delivery/i],
    ['Could you explain your special protocol for rooftop kennels on a floating platform?', /commercial|custom|unknown|approved answer|unmatched/i, true],
  ]) await t.test(issue, async child => {
    const f = await faqThread(child);
    const turn = await f.inbound(issue);
    escalated(f, turn, {reason: why, silent: Boolean(silentAllowed && !turn.body)});
    assert.doesNotMatch(turn.body, /we (?:have|carry) \$|payment (?:was|has been) (?:charged|resubmitted)|order is placed/i);
  });
});

test('FAQ admission | a verified existing customer gets a specific winter-pause notice without customer automation', async t => {
  const f = await faqThread(t, {existing: true});
  const turn = await f.inbound('Please pause my service for the winter and restart in March.');
  escalated(f, turn, {reason: /winter|pause/i, silent: true});
  assert.equal(turn.draft, undefined);
  const row = f.db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").get('winter_pause:org-opwp:' + f.conversationId);
  assert.ok(row);
  assert.equal(JSON.parse(row.payload).phone, customerPhone);
});
