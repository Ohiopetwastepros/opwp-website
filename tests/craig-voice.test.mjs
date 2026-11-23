import test from 'node:test';
import assert from 'node:assert/strict';
import {CRAIG_VOICE_EXAMPLES, CRAIG_VOICE_RULES, CRAIG_VOICE_STEPS} from '../lib/craig-voice-examples.mjs';
import {
  CRAIG_TEMPLATES, CRAIG_STEP_BY_TEMPLATE, CRAIG_RANGE_SENTENCE,
  CRAIG_FIRST_CONTACT_FOOTER, selectCraigVoiceExamples, buildCraigDraftContext,
  renderCraigReply, validateCraigReply, countCraigSentences,
} from '../lib/craig-voice.mjs';

const slots = {
  dogs: 1, name: 'Avery Example', email: 'avery@example.test', location: 'ZIP 00000',
  frequency: 'weekly', yard_phrase: 'up to 1/8 acre', last_cleaned_phrase: 'about two weeks ago',
  monthly: 95, low: 27, high: 34, haul_monthly: 21, frequencyId: 'once_a_week', lastCleaned: 'two_weeks',
  yardTier: 'tiny', area_name: 'that ZIP', scope_question: 'When was the yard last cleaned?', next_question: 'Want me to get you set up?',
  business_phone: '(419) 555-0100', day: 'Friday',
};

test('thirty deidentified exchanges cover every step without real provider metadata or historical prices', () => {
  assert.equal(CRAIG_VOICE_EXAMPLES.length, 30);
  assert.equal(new Set(CRAIG_VOICE_EXAMPLES.map(example => example.id)).size, 30);
  assert.equal(Object.isFrozen(CRAIG_VOICE_EXAMPLES), true);
  assert.equal(Object.isFrozen(CRAIG_VOICE_RULES.forbiddenWords), true);
  assert.equal(Object.isFrozen(CRAIG_VOICE_RULES.forbiddenCodePoints), true);
  assert.deepEqual(CRAIG_VOICE_RULES.forbiddenWords, ['poop']);
  assert.deepEqual(CRAIG_VOICE_RULES.forbiddenCodePoints, ['\u2013', '\u2014']);
  const all = JSON.stringify(CRAIG_VOICE_EXAMPLES);
  assert.doesNotMatch(all, /\+?1[- .()]?\d{3}[- .()]?\d{3}[- .()]?\d{4}/);
  assert.doesNotMatch(all, /\b(?:CN|AC|PN|EV)[A-Za-z0-9]{8,}\b|\b\d{4}-\d{2}-\d{2}\b/);
  assert.doesNotMatch(all, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(all, /\$\s*\d/);
  assert.doesNotMatch(all, /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|ASAP)\b/i);
  assert.doesNotMatch(all, /poop|[\u2013\u2014]/i);
  assert.doesNotMatch(all, /Source data:|conversations reviewed|Craig Bridgman|[A-Z]:\\/);
  for (const example of CRAIG_VOICE_EXAMPLES) {
    assert.equal(example.styleOnly, true);
    assert.equal(Object.isFrozen(example.messages), true);
    assert.ok(example.messages.some(message => message.role === 'user'));
    assert.ok(example.messages.some(message => message.role === 'assistant'));
    assert.ok(example.steps.every(step => CRAIG_VOICE_STEPS.includes(step)));
  }
  for (const step of CRAIG_VOICE_STEPS) assert.ok(selectCraigVoiceExamples(step).length > 0, step);
});

test('each step builds real few-shot role messages from its selected exchanges', () => {
  for (const step of CRAIG_VOICE_STEPS) {
    const selected = selectCraigVoiceExamples(step), context = buildCraigDraftContext({step, text: 'Current customer answer', verifiedFacts: {approved: false}});
    assert.equal(context.step, step);
    assert.deepEqual(context.examples, selected);
    assert.equal(context.messages[0].role, 'system');
    assert.match(context.messages[0].content, /style examples|style only/);
    assert.match(context.messages[0].content, /current facts always take precedence|current verified pricing/);
    assert.match(context.messages[0].content, /Never use the word/);
    for (const word of CRAIG_VOICE_RULES.forbiddenWords) assert.ok(context.messages[0].content.includes(JSON.stringify(word)));
    for (const point of CRAIG_VOICE_RULES.forbiddenCodePoints) assert.ok(context.messages[0].content.includes('U+' + point.codePointAt(0).toString(16).toUpperCase()));
    for (const example of selected) for (const message of example.messages) {
      assert.ok(context.messages.some(actual => actual.role === message.role && actual.content === message.content));
    }
    assert.equal(context.messages.at(-1).role, 'user');
    assert.equal(JSON.parse(context.messages.at(-1).content).text, 'Current customer answer');
    assert.equal(context.outputPolicy.maxSentences, 3);
  }
  assert.throws(() => selectCraigVoiceExamples('unknown'), /Unknown/);
  assert.throws(() => buildCraigDraftContext({step: 'quote', templateKey: 'unknown'}), /Unknown/);
});

test('every approved template renders through the step context and passes the output guard', () => {
  const previousFetch = globalThis.fetch;
  const sentenceLimits = {quote_recurring: 4, quote_one_time: 5, one_timequote: 5};
  globalThis.fetch = () => { throw new Error('The deterministic renderer must never call a provider'); };
  try {
    for (const [key, template] of Object.entries(CRAIG_TEMPLATES)) {
      const context = buildCraigDraftContext({templateKey: key, slots});
      assert.equal(context.template, template);
      assert.equal(context.step, CRAIG_STEP_BY_TEMPLATE[key]);
      assert.ok(context.examples.length);
      const body = renderCraigReply(key, slots);
      assert.deepEqual(validateCraigReply(body, {templateKey: key}), [], key);
      const count = countCraigSentences(body);
      assert.ok(count >= 1 && count <= (sentenceLimits[key] ?? 3), key);
      assert.doesNotMatch(body, /poop|[\u2013\u2014]|[^\x00-\x7f]|\b[A-F]:/i, key);
      assert.doesNotMatch(body, /Reply STOP|Text STOP/, key);
    }
  } finally { globalThis.fetch = previousFetch; }
  for (const key of ['intro_form', 'confirm_details', 'ask_dogs', 'ask_frequency', 'ask_yard', 'ask_last_cleaned', 'ask_address', 'quote_recurring', 'price_objection', 'ready_access', 'ask_signup_name', 'ask_signup_email', 'confirm_signup_identity', 'ask_gate_side', 'ask_trash_location', 'signup_handoff', 'property_walk', 'human_ai']) assert.ok(Object.hasOwn(CRAIG_TEMPLATES, key));
});

test('the yard prompt is the exact requested three-sentence natural prompt', () => {
  assert.equal(renderCraigReply('ask_yard'), "About how big is the area of the yard your dog uses? Most neighborhood yards are around 1/8 acre or less, or a rough guess like small, average, or large works too. If you're not sure, just send your address and I can measure it on the map.");
  assert.equal(countCraigSentences(renderCraigReply('ask_yard')), 3);
});

test('the recurring quote is the exact approved four-sentence copy with current numeric slots', () => {
  const body = renderCraigReply('quote_recurring', slots);
  assert.equal(body, "Our rate for 1 dog with weekly service is $95 per month, and the initial cleanup to get the yard caught up runs $27 to $34. The range depends on how much waste is in the yard and how long it takes. It's month to month with no contract. Want me to get you set up?");
  assert.equal(CRAIG_RANGE_SENTENCE, 'The range depends on how much waste is in the yard and how long it takes.');
  assert.ok(body.includes(CRAIG_RANGE_SENTENCE));
  assert.match(body, /1 dog with weekly service is \$95 per month/);
  assert.match(body, /initial cleanup.*\$27 to \$34/);
  assert.match(body, /month to month with no contract/);
  assert.match(body, /Want me to get you set up\?$/);
  assert.equal(countCraigSentences(body), 4);
  assert.deepEqual([...body.matchAll(/\$(\d+)/g)].map(match => Number(match[1])), [95, 27, 34]);
  assert.match(renderCraigReply('quote_recurring', {...slots, dogs: 2}), /2 dogs/);
  assert.match(renderCraigReply('price_objection', slots), /follow up/);
  assert.doesNotMatch(renderCraigReply('price_objection', slots), /\$|biweekly|every other week/i);
  assert.match(renderCraigReply('haul_away_answer', {...slots, dogs: 3, haul_monthly: 31}), /\$31 per month/);
  assert.equal(renderCraigReply('one_timequote', slots), renderCraigReply('quote_one_time', slots));
  assert.equal(renderCraigReply('timing_preference'), 'No problem. I will note that preference while we confirm your service day.');
});

test('four sentences are scoped to the exact current recurring quote and its template context', () => {
  const quote = renderCraigReply('quote_recurring', slots);
  assert.deepEqual(validateCraigReply(quote, {step: 'quote_recurring'}), []);
  assert.deepEqual(validateCraigReply(quote, {templateKey: 'quote_recurring'}), []);
  assert.ok(validateCraigReply(quote).includes('sentence_count'));
  assert.ok(validateCraigReply(quote, {step: 'quote'}).includes('sentence_count'));
  assert.ok(validateCraigReply(quote, {templateKey: 'quote_one_time'}).includes('sentence_count'));
  assert.ok(validateCraigReply(quote, {templateKey: 'quote_recurring', maxSentences: 3}).includes('sentence_count'));
  assert.ok(validateCraigReply('One. Two. Three. Four.', {templateKey: 'quote_recurring', maxSentences: 4}).includes('sentence_count'));
  assert.ok(validateCraigReply(quote + ' Please hurry.', {templateKey: 'quote_recurring'}).includes('sentence_count'));
  assert.ok(validateCraigReply(quote.replace('Want me to get you set up?', 'Should I book you tomorrow?'), {templateKey: 'quote_recurring'}).includes('sentence_count'));
  const context = buildCraigDraftContext({templateKey: 'quote_recurring', slots});
  assert.equal(context.outputPolicy.maxSentences, 4);
  assert.match(context.messages[0].content, /exactly four sentences/);
  assert.equal(CRAIG_VOICE_RULES.sentences.templateMax.quote_recurring, 4);
  assert.equal(Object.isFrozen(CRAIG_VOICE_RULES.sentences.templateMax), true);
});

test('cleanup confirmation uses the supplied recap clause and signup speaks as Craig in first person', () => {
  const confirmation = renderCraigReply('confirm_details', {...slots, last_cleaned_clause: "it's been about 2 to 3 weeks since the last cleanup"});
  assert.equal(confirmation, "Just to make sure I have everything right, you have 1 dog, want weekly service, the cleanup area is up to 1/8 acre, and it's been about 2 to 3 weeks since the last cleanup. Did I get that right?");
  assert.match(renderCraigReply('confirm_details', slots), /since the last cleanup/);
  assert.doesNotMatch(renderCraigReply('confirm_details', slots), /ago since/);
  assert.equal(renderCraigReply('signup_handoff'), "Got it, thank you! I'll finish your account setup and confirm your first cleanup with you. You'll just need to accept the terms before service starts.");
  for (const text of [
    'Craig will finish your account.', "I'll have Craig check the map.", 'Refer to Craig for that.',
    "I'll hand this conversation to Craig.", "These texts use Craig's approved replies.",
    'You can text Craig personally.',
  ]) assert.ok(validateCraigReply(text).includes('third_person_craig'), text);
  assert.deepEqual(validateCraigReply('Hello, this is Craig with Ohio Pet Waste Pros.'), []);
  assert.deepEqual(validateCraigReply('Hey, Craig with Ohio Pet Waste Pros here.'), []);
  assert.deepEqual(validateCraigReply('I have Craig Bridgman and craig@example.test for the account. Is that right?'), []);
  for (const key of ['one_timequote', 'quote_one_time', 'map_measurement_hold', 'detail_hold', 'property_walk', 'is_this_ai', 'signup_handoff']) {
    assert.doesNotMatch(renderCraigReply(key, slots), /\bCraig\b/i, key);
  }
  assert.match(buildCraigDraftContext({step: 'booking'}).messages[0].content, /first person/);
  assert.equal(Object.isFrozen(CRAIG_VOICE_RULES.thirdPersonPatterns), true);
});

test('first-contact footer requires both fresh-contact facts and is never available on later steps', () => {
  const first = renderCraigReply('meta_confirmation', slots, {firstContact: true, isNewContact: true});
  assert.ok(first.endsWith('\n\n' + CRAIG_FIRST_CONTACT_FOOTER));
  assert.equal((first.match(/Reply STOP to opt out/g) || []).length, 1);
  assert.equal(countCraigSentences(first), 3);
  assert.deepEqual(validateCraigReply(first, {allowFirstContactFooter: true, step: 'first_contact'}), []);
  assert.ok(validateCraigReply(first).includes('unexpected_opt_out_footer'));
  assert.ok(validateCraigReply(first, {allowFirstContactFooter: true, step: 'yard_size'}).includes('unexpected_opt_out_footer'));
  assert.doesNotMatch(renderCraigReply('meta_confirmation', slots, {firstContact: true, isNewContact: false}), /STOP/);
  assert.doesNotMatch(renderCraigReply('meta_confirmation', slots, {firstContact: false, isNewContact: true}), /STOP/);
  assert.match(renderCraigReply('meta_confirmation', {...slots, name: ''}), /^Hi, this is Craig/);
  assert.match(renderCraigReply('follow_up_1'), /^Hey, this is Craig/);
  assert.throws(() => renderCraigReply('ask_yard', slots, {firstContact: true, isNewContact: true}), /first contact only/);
  assert.ok(validateCraigReply(first + '\n\n' + CRAIG_FIRST_CONTACT_FOOTER, {allowFirstContactFooter: true}).includes('repeated_opt_out_footer'));
});

test('raw model output and hostile slots cannot bypass vocabulary, dash, ASCII or sentence guards', () => {
  for (const text of ['PoOp', 'ＰＯＯＰ', 'po\u200dop', 'póop']) assert.ok(validateCraigReply(text + '.').includes('forbidden_waste_slang'), text);
  for (const text of ['Thanks\u2014we can help.', 'Thanks\u2013we can help.']) assert.ok(validateCraigReply(text).includes('forbidden_dash'));
  assert.ok(validateCraigReply('Thanks 😊.').includes('non_ascii_sms'));
  assert.ok(validateCraigReply('One. Two. Three. Four.').includes('sentence_count'));
  assert.ok(validateCraigReply('One.Two.Three.Four.', {maxSentences: Number.NaN}).includes('sentence_count'));
  assert.ok(validateCraigReply('A: small; B: large.').includes('lettered_menu'));
  assert.ok(validateCraigReply('Hi [Name].').includes('unresolved_slot'));
  assert.throws(() => renderCraigReply('ready_access', {...slots, name: 'ＰＯＯＰ'}), /forbidden_waste_slang/);
  assert.throws(() => renderCraigReply('ask_signup_name', {}, {firstContact: true, isNewContact: true}), /first contact only/);
  assert.throws(() => renderCraigReply('quote_recurring', {}), /Missing Craig reply slot/);
  assert.throws(() => renderCraigReply('unknown'), /Unknown/);
});

test('sentence counting protects prices, email addresses and links without swallowing sentence endings', () => {
  assert.equal(countCraigSentences('It is $95.50 monthly. Is avery@example.test right?'), 2);
  assert.equal(countCraigSentences('Use https://example.test/setup/. Please confirm. Thank you.'), 3);
  assert.equal(countCraigSentences('Hi Dr. Example. Is avery@example.test right?'), 2);
  assert.ok(validateCraigReply('I have avery@example.test. Is it right? Thank you. Have a good day.').includes('sentence_count'));
});

test('a smiley is optional and restricted to one on a warm handoff or follow-up', () => {
  assert.deepEqual(validateCraigReply('Sounds good, thank you! :)', {step: 'signup_handoff'}), []);
  assert.deepEqual(validateCraigReply("We're here if you need us. :)", {step: 'follow_up'}), []);
  assert.ok(validateCraigReply('How many dogs use the yard? :)', {step: 'dogs'}).includes('smiley_not_allowed'));
  assert.ok(validateCraigReply('Which side is the gate on? :)', {step: 'booking'}).includes('smiley_not_allowed'));
  assert.ok(validateCraigReply('Sounds good. :) :)', {step: 'booking'}).includes('smiley_not_allowed'));
  assert.equal(CRAIG_VOICE_RULES.sentences.max, 3);
});
