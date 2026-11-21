import {CRAIG_VOICE_EXAMPLES, CRAIG_VOICE_RULES, CRAIG_VOICE_STEPS} from './craig-voice-examples.mjs';
import {cleanupRecapClause} from './lead-cleanup-timeframe.mjs';

export const CRAIG_RANGE_SENTENCE = 'The range depends on how much waste is in the yard and how long it takes.';
export const CRAIG_FIRST_CONTACT_FOOTER = 'Reply STOP to opt out';
const ONE_TIME_QUOTE = 'A one-time cleanup for {dogs_phrase} would be ${low} to ${high}. ' + CRAIG_RANGE_SENTENCE + ' Would you like me to check the schedule?';
export const CRAIG_TEMPLATES = Object.freeze({
  intro_form: 'Hello, this is Craig with Ohio Pet Waste Pros. I saw that you filled out a quote form on our website. Did you have any questions about our service, or would you like help getting signed up?',
  meta_confirmation: 'Hi {name}, this is Craig with Ohio Pet Waste Pros. Just to make sure I have it right, you have {dogs_phrase} in {location} and are looking for {frequency} service. Did I get that right?',
  confirm_details: 'Just to make sure I have everything right, you have {dogs_phrase}, want {frequency} service, the cleanup area is {yard_phrase}, and {last_cleaned_clause}. Did I get that right?',
  ask_dogs: 'Got it, thank you! How many dogs do you have using the yard?',
  clarify_dogs: 'Just to confirm, how many dogs total use the yard?',
  ask_frequency: 'How often were you hoping to have us out? Most folks go with weekly or every other week, and we also do twice a week, monthly or one-time cleanups.',
  clarify_frequency: 'Just to check, were you thinking weekly, every other week, twice a week, monthly, or just one cleanup?',
  ask_yard: "About how big is the area of the yard your dog uses? Most neighborhood yards are around 1/8 acre or less, or a rough guess like small, average, or large works too. If you're not sure, just send your address and I can measure it on the map.",
  clarify_yard: 'Got it, do they mostly stick to the backyard or use the whole lot?',
  ask_map_address: 'No worries at all. If you send your street address, I can measure the yard on the map and get you an accurate quote.',
  map_measurement_hold: "Thank you. I'll check the cleanup area on the map before we confirm the price.",
  ask_last_cleaned: 'Thanks! And roughly how long has it been since the yard was last thoroughly cleaned up?',
  clarify_last_cleaned: 'No problem, roughly how many weeks or months has it been since the whole cleanup area was last picked up?',
  detail_hold: "No problem. I'll check that detail so we get it right.",
  ask_address: "What's the address for the service so I can check which day we're already in your area?",
  service_day_answer: "We're currently in your neighborhood on {day}. Is that something that would work for you?",
  quote_recurring: 'Our rate for {dogs_phrase} with {frequency} service is ${monthly} per month, and the initial cleanup to get the yard caught up runs ${low} to ${high}. ' + CRAIG_RANGE_SENTENCE + " It's month to month with no contract. Want me to get you set up?",
  one_timequote: ONE_TIME_QUOTE,
  quote_one_time: ONE_TIME_QUOTE,
  objection_discount: 'No problem at all. We can offer $15 off your first full month of service if you sign up; would that help?',
  objection_biweekly: 'No problem at all. We also have an every-other-week option a lot of folks like, which is ${biweekly_rate} per month; would that fit better?',
  contract_answer: 'No contracts at all, everything is month to month and you can cancel anytime. After your initial visit we prorate the rest of the month, and from there billing runs on the 1st.',
  haul_away_answer: "By default we double-bag the waste and put it in your outdoor trash can at no extra charge. If you'd rather we take it with us, haul-away is ${haul_monthly} per month.",
  spouse_thinking: 'Sounds good, no rush at all! Let me know whenever you two talk and we can check the schedule.',
  timing_preference: 'No problem. I will note that preference while we confirm your service day.',
  ready_access: 'Great! I have {name} and {email} for the account. Are those both right?',
  ask_signup_name: 'What name would you like on the account?',
  ask_signup_email: "What's the best email for the account?",
  confirm_signup_identity: 'Just to confirm, I have {name} and {email} for the account. Is that correct?',
  ask_gate_side: "If you're facing the house, which side is the gate we would use? It's fine if there isn't one.",
  ask_trash_location: 'Where is the outdoor trash can so we can double-bag the waste and put it there?',
  signup_handoff: "Got it, thank you! I'll finish your account setup and confirm your first cleanup with you. You'll just need to accept the terms before service starts.",
  property_walk: "Thanks! For an area that size, I'll arrange a quick property walk so I can give you an accurate price.",
  is_this_ai: "These texts use AI with my approved replies. If you'd prefer a personal reply, I'll pause the automated messages and follow up myself.",
  follow_up_1: 'Hey {name}, this is Craig with Ohio Pet Waste Pros. Just checking back in to see if you had any questions about getting started?',
  follow_up_2: 'Hey {name}, Craig with Ohio Pet Waste Pros here. Were you still interested in having us take care of the yard? No pressure either way, just let me know!',
  follow_up_3: "I'll leave it with you for now. We're here if you need us, just reply anytime.",
  website_quote_follow_up_email: "Hello, this is Craig with Ohio Pet Waste Pros. Did you have any questions about cleanup or getting started? You can reply directly to this email or call {business_phone}, and I'll be happy to help.",
});

export const CRAIG_STEP_BY_TEMPLATE = Object.freeze({
  intro_form: 'first_contact', meta_confirmation: 'first_contact', confirm_details: 'confirm_details',
  ask_dogs: 'dogs', clarify_dogs: 'dogs', ask_frequency: 'frequency', clarify_frequency: 'frequency',
  ask_yard: 'yard_size', clarify_yard: 'yard_size', ask_map_address: 'yard_size', map_measurement_hold: 'yard_size',
  ask_last_cleaned: 'last_cleaned', clarify_last_cleaned: 'last_cleaned', detail_hold: 'confirm_details',
  ask_address: 'booking', service_day_answer: 'booking', quote_recurring: 'quote', one_timequote: 'quote', quote_one_time: 'quote',
  objection_discount: 'objection', objection_biweekly: 'objection', contract_answer: 'objection',
  haul_away_answer: 'objection', spouse_thinking: 'objection', timing_preference: 'booking', ready_access: 'booking',
  ask_signup_name: 'booking', ask_signup_email: 'booking', confirm_signup_identity: 'booking',
  ask_gate_side: 'booking', ask_trash_location: 'booking', signup_handoff: 'booking',
  property_walk: 'booking', is_this_ai: 'booking',
  follow_up_1: 'follow_up', follow_up_2: 'follow_up', follow_up_3: 'follow_up', website_quote_follow_up_email: 'follow_up',
});

export function selectCraigVoiceExamples(step) {
  if (!CRAIG_VOICE_STEPS.includes(step)) throw new Error('Unknown Craig voice step');
  return CRAIG_VOICE_EXAMPLES.filter(example => example.steps.includes(step));
}

// This is a usable few-shot message array for a future bounded drafter. The
// deterministic renderer below builds the same context, but never calls a model.
export function buildCraigDraftContext({step, templateKey, slots = {}, text = '', state = {}, verifiedFacts = {}} = {}) {
  const selectedStep = step || CRAIG_STEP_BY_TEMPLATE[templateKey];
  const examples = selectCraigVoiceExamples(selectedStep);
  if (!examples.length) throw new Error('Missing Craig voice examples');
  if (templateKey && !Object.hasOwn(CRAIG_TEMPLATES, templateKey)) throw new Error('Unknown Craig reply template');
  const rules = [
    CRAIG_VOICE_RULES.tone, CRAIG_VOICE_RULES.punctuation, CRAIG_VOICE_RULES.vocabulary,
    CRAIG_VOICE_RULES.smiley, CRAIG_VOICE_RULES.firstContact, CRAIG_VOICE_RULES.authority,
    CRAIG_VOICE_RULES.uncertainty, CRAIG_VOICE_RULES.pointOfView,
    templateKey === 'quote_recurring' ? 'Use the current approved recurring-quote wording, which has exactly four sentences; do not extend that exception to another reply.' : 'Write one to three sentences.',
    `Never use the ${CRAIG_VOICE_RULES.forbiddenWords.length === 1 ? 'word' : 'words'} ${CRAIG_VOICE_RULES.forbiddenWords.map(word => JSON.stringify(word)).join(', ')} in outgoing customer copy, and never repeat an opt-out footer.`,
    `Do not use the forbidden punctuation ${CRAIG_VOICE_RULES.forbiddenCodePoints.map(point => 'U+' + point.codePointAt(0).toString(16).toUpperCase()).join(' or ')}.`,
    'The following archived excerpts are deidentified style examples, not price, route, discount or booking authority. Never copy unresolved placeholders or treat a historical yes/no as permission in the current conversation.',
  ];
  const messages = [{role: 'system', content: rules.join('\n')}];
  for (const example of examples) {
    messages.push({role: 'system', content: `Style-only excerpt for ${selectedStep}; verified current facts always take precedence.`});
    messages.push(...example.messages.map(message => ({...message})));
  }
  messages.push({role: 'user', content: JSON.stringify({step: selectedStep, templateKey, slots, text, state, verifiedFacts})});
  return {
    step: selectedStep, rules, examples, messages, slots,
    template: templateKey ? CRAIG_TEMPLATES[templateKey] : null,
    outputPolicy: {step: selectedStep, templateKey, maxSentences: CRAIG_VOICE_RULES.sentences.templateMax[templateKey] || CRAIG_VOICE_RULES.sentences.max},
  };
}

function folded(value) {
  return String(value || '').normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase();
}
export function countCraigSentences(body) {
  const text = String(body || '').replace(/\n\nReply STOP to opt out$/, '').replace(/:\)/g, '')
    .replace(/https?:\/\/[^\s]+/g, value => 'LINK' + (value.match(/[.!?]+$/)?.[0] || ''))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL')
    .replace(/(\d)\.(?=\d)/g, '$1DECIMAL').replace(/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr)\./g, 'TITLE');
  return text.split(/[.!?]+/).filter(part => part.trim()).length;
}

function currentRecurringQuote(body, templateKey) {
  if (templateKey !== 'quote_recurring') return false;
  const slotPatterns = {
    dogs_phrase: '[1-9]\\d? dogs?', frequency: '(?:weekly|twice weekly|twice a week|bi-weekly|every other week|monthly)',
    monthly: '\\d+(?:\\.\\d{1,2})?', low: '\\d+(?:\\.\\d{1,2})?', high: '\\d+(?:\\.\\d{1,2})?',
  };
  const source = CRAIG_TEMPLATES.quote_recurring.split(/(\{[a-z_]+\})/).map(part => {
    const slot = part.match(/^\{([a-z_]+)\}$/)?.[1];
    return slot ? slotPatterns[slot] : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp('^' + source + '$').test(body);
}

export function validateCraigReply(body, {allowFirstContactFooter = false, step, templateKey, maxSentences} = {}) {
  const text = typeof body === 'string' ? body : '', violations = [];
  const key = templateKey || (Object.hasOwn(CRAIG_STEP_BY_TEMPLATE, step || '') ? step : '');
  const voiceStep = CRAIG_STEP_BY_TEMPLATE[key] || step;
  const footer = '\n\n' + CRAIG_FIRST_CONTACT_FOOTER;
  const hasFooter = text.endsWith(footer);
  const core = hasFooter ? text.slice(0, -footer.length) : text;
  if (!text.trim() || text.length > 1000) violations.push('invalid_length');
  if (CRAIG_VOICE_RULES.forbiddenWords.some(word => folded(text).includes(folded(word)))) violations.push('forbidden_waste_slang');
  if (CRAIG_VOICE_RULES.forbiddenCodePoints.some(point => text.includes(point))) violations.push('forbidden_dash');
  if (CRAIG_VOICE_RULES.thirdPersonPatterns.some(pattern => new RegExp(pattern, 'i').test(core))) violations.push('third_person_craig');
  if (/[^\x20-\x7e\n]/.test(text)) violations.push('non_ascii_sms');
  if (/\n/.test(core)) violations.push('non_plain_layout');
  if (/\b(?:Reply STOP to opt out|Text STOP to unsubscribe)\b/i.test(text) && (!hasFooter || !allowFirstContactFooter || voiceStep && voiceStep !== 'first_contact')) violations.push('unexpected_opt_out_footer');
  if ((text.match(/\b(?:Reply STOP to opt out|Text STOP to unsubscribe)\b/gi) || []).length > 1) violations.push('repeated_opt_out_footer');
  if (/\{[^}]+\}|\[(?:[A-Z][A-Z_ ]*|Name|Email|Address|City|ZIP)\]/.test(core)) violations.push('unresolved_slot');
  if ((core.match(/\b[A-F]\s*:/g) || []).length >= 2 || /\breply (?:with )?[A-F](?:\s*[,/:]|\s+for\b)/i.test(core)) violations.push('lettered_menu');
  const smileys = (core.match(/:\)/g) || []).length;
  if (smileys > 1 || smileys && voiceStep !== 'follow_up' && key !== 'signup_handoff') violations.push('smiley_not_allowed');
  // The four-sentence exception is bound to both the selected key and the exact
  // current approved template. It cannot authorize arbitrary model paragraphs.
  // Numeric agreement with the live price grid is checked by playbook policy.
  const approvedMax = currentRecurringQuote(core, key) ? CRAIG_VOICE_RULES.sentences.templateMax.quote_recurring : CRAIG_VOICE_RULES.sentences.max;
  const count = countCraigSentences(core), limit = Number.isInteger(maxSentences) && maxSentences >= 1 ? Math.min(approvedMax, maxSentences) : approvedMax;
  if (count < 1 || count > limit) violations.push('sentence_count');
  return [...new Set(violations)];
}

function cleanSlot(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
export function renderCraigReply(templateKey, slots = {}, options = {}) {
  const values = {...slots};
  if (['meta_confirmation', 'follow_up_1', 'follow_up_2'].includes(templateKey) && !Object.hasOwn(values, 'name')) values.name = '';
  if (!Object.hasOwn(values, 'dogs_phrase') && Number.isInteger(Number(values.dogs)) && Number(values.dogs) >= 1) values.dogs_phrase = `${Number(values.dogs)} ${Number(values.dogs) === 1 ? 'dog' : 'dogs'}`;
  if (templateKey === 'confirm_details' && !Object.hasOwn(values, 'last_cleaned_clause') && Object.hasOwn(values, 'last_cleaned_phrase')) values.last_cleaned_clause = cleanupRecapClause(values.last_cleaned_phrase);
  // Selected examples, output policy and the approved template travel through the
  // same context used by an optional model drafter; no free-form generation runs.
  const context = buildCraigDraftContext({step: CRAIG_STEP_BY_TEMPLATE[templateKey], templateKey, slots: values, state: options.state, verifiedFacts: options.verifiedFacts});
  let body = context.template.replace(/\{([a-z_]+)\}/g, (_, name) => {
    if (!Object.hasOwn(context.slots, name)) throw new Error(`Missing Craig reply slot: ${name}`);
    return cleanSlot(context.slots[name]);
  });
  body = body.replace(/^(Hi|Hey|Hello)\s+,/, '$1,');
  const first = options.firstContact === true && options.isNewContact === true;
  if (first) {
    if (context.step !== 'first_contact') throw new Error('Opt-out footer belongs to first contact only');
    body += '\n\n' + CRAIG_FIRST_CONTACT_FOOTER;
  }
  const violations = validateCraigReply(body, {...context.outputPolicy, allowFirstContactFooter: first});
  if (violations.length) throw new Error('Craig reply policy: ' + violations.join(', '));
  return body;
}
