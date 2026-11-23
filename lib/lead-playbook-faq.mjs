import {PRICING, monthly, yardUpcharge, initialRange} from './lead-pricing.mjs';

// Reviewed copy is part of the existing deterministic playbook library. The
// classifier selects a topic, never a price or free-form customer reply.
const addOn = id => PRICING.addons.find(item => item.id === id);
const haul = addOn('haul_away'), sanitize = addOn('sani_monthly'), sanitizeOnce = addOn('sani_onetime');
const deodorize = addOn('deodorize'), front = addOn('front_yard'), food = addOn('food_blue');
const close = 'Want me to get you set up?';
export const FAQ_TEMPLATES = Object.freeze({
  price_objection: "Totally understand. I'll have us follow up with you about the price.",
  human_request: "Of course, I'll have the owner call you. What time works for you, and is this the best number?",
  human_ai: "Yes, this is the Ohio Pet Waste Pros text line and these replies use AI. I'll have the owner call you back. What time works, and is this the best number?",
  language_handoff: "Hi, you've reached Ohio Pet Waste Pros. I'll have someone follow up with you shortly.",
  complaint: "I'm sorry we missed that. I'll have it looked at and make it right. Which day was the visit, and about where in the yard did you find the problem?",
  payment_dispute: "I'll have our office look into the charge and follow up with you personally.",
  cash_exception: "We accept checks or a card on file. I'll have someone follow up with you about the cash request.",
  payment_exception: "I'll have our office follow up about that payment request. Please leave any card or bank details out of this text thread.",
  payment_secure: "Please use the secure Sweep&Go portal for payment details. I'll have our office follow up with you.",
  account_billing: "I'll have our office check the invoice and get back to you.",
  safety_handoff: "Thanks for telling me. I'll flag that for our technician and have someone follow up about safe access before a visit.",
  commercial_scope: "We can put together a custom quote for that property. What's the address, how often did the previous company visit, and how many stations or extra cans are there? Should we haul the bags away or use an on-site dumpster, and do you want us to walk and scoop the yards too?",
  custom_quote: "That first cleanup needs a custom quote. Can you send the service address, the size of the cleanup area and any details we still need about the buildup? I'll have someone review it with you.",
  custom_many_dogs: "Can you confirm the total number of dogs that will use the yard, including puppies? I'll have us put together a custom quote once we have the address, yard size and when it was last cleaned.",
  custom_initial: "For {dogs_phrase}, {frequency_label} service starts at ${plan_rate} per month for a standard yard. I'll have us price the first cleanup separately. {scope_question}",
  custom_without_plan: "With that much buildup the first cleanup needs a custom quote. What's the address and size of the cleanup area, and were you thinking one-time or recurring service?",
  coverage_handoff: "Let me have us check that location before I promise service. What's the full street address and ZIP?",
  coverage_monroe: "We service Temperance and Lambertville. Can you send the full street address and ZIP so I can check which area the yard is in?",
  coverage_decline: "Thanks for reaching out. We currently don't service {area_name}, but I can reach out if we expand that way.",
  coverage_south: "We currently go as far as Bowling Green and don't service {area_name}. I can reach out if we expand that way.",
  coverage_columbus: "We don't service Columbus. Facebook sometimes shows our page to people it thinks are in the Toledo area. I can reach out if we expand that way.",
  coverage_yes: "Yes, we service that area. {next_question}",
  insurance_handoff: "I'll have us follow up with the exact information so you get the right details.",
  legal_handoff: "I've received your message and will have the owner review it.",
  account_dog: "I'll have the office update the dog count and check the rate, since the portal may not adjust billing on its own. When would you like the change to start?",
  account_dog_loss: "I'm sorry to hear about your dog. I'll have the office update the dog count and rate, since the portal may not adjust billing on its own. When would you like that to start?",
  account_change: "I'll have our office handle the change and confirm it with you. When would you like it to start?",
  skip_visit: "Yes, we can skip that cleanup and keep your plan going. I'll have our office confirm the change with you.",
  winter_pause: "Yes, we can pause for up to 90 days at a time, then extend it until March and follow up in March about starting back up. I'll take care of the dates. When would you like the pause to start?",
  routing_handoff: "I'll have our office check the route and confirm whether we can make that change.",
  holiday_booking: "We adjust routes around major holidays. I'll have our office check that week and confirm your first visit with you.",
  food_order: "I'll have our office follow up about the food order and confirm delivery and billing with you.",
  access_risk: "Thanks for letting me know. I'll note that for the technician and have us confirm how to get in safely.",
  clarify_unit: "That's the prepaid monthly rate for that month's service. " + close,
  included: "We scoop the area your dogs use, usually the backyard, including patios and other hard surfaces there, then double-bag the waste and put it in your outdoor can. Front yard scooping, haul-away, sanitizing and deodorizing are optional add-ons. " + close,
  included_front: "We scoop the backyard and hard surfaces your dogs use, including the patio, then double-bag the waste and use your outdoor trash can. We can add front yard scooping for $" + front.price + " per month. Want me to include that when we set you up?",
  front_yard: "We can scoop the front yard too for $" + front.price + " per month. Do your dogs use it, and would you like me to include it at setup?",
  disposal_rates: "We double-bag the waste and put it in your outdoor trash can at no extra charge. Haul-away is $" + haul.price + " per month for 1 or 2 dogs or $" + haul.price3Plus + " per month for 3 or more. Want me to include haul-away at setup?",
  disposal_once: "We double-bag the waste and use your outdoor trash can at no extra charge. One-time haul-away is $31 if you'd like us to take it with us. Want me to add that to the cleanup?",
  treatments: "Sanitizing is $" + sanitize.price + " per month or $" + sanitizeOnce.price + " one time, and deodorizing is $" + deodorize.price + " per treatment. I usually recommend a one-time sanitizing treatment on the first visit if there's buildup. Want to add one of those when we set up your cleanup?",
  combo: "We price the add-ons individually, so there's no combo rate. Sanitizing is $" + sanitize.price + " per month or $" + sanitizeOnce.price + " one time, and deodorizing is $" + deodorize.price + " per treatment. Want me to include either at setup?",
  combo_handoff: "We price the add-ons individually, so there's no package rate. I'll have someone follow up about your request.",
  rain_snow: "We come rain or shine, but after heavy snow we usually pause when the waste is buried. If a big snow is coming, we try to get yards done beforehand. " + close,
  winter_weather: "We usually pause after heavy snow because the waste is buried, and we try to get yards done beforehand when a big snow is coming. " + close,
  treatments_weather: "We scoop rain or shine, but we hold sanitizing until the active rain lets up. Want me to add that to your cleanup?",
  holiday: "We adjust routes around major holidays and use a nearby service day. I'll confirm the first visit when we set up your account. {next_question}",
  home: "Nobody needs to be home as long as we can get through the gate. You'll get a text when we're on the way and another when the cleanup is done. " + close,
  time_of_day: "It's like garbage pickup and depends on the route for that day, so I can't guarantee a time of day. We'll text when we're on the way and again when the cleanup is done. " + close,
  pets: "Nobody needs to be home, but it helps if the dogs are secured while we're there. Can you close the doggie door or keep them inside for the visit? I'll note it for the technician when we set you up.",
  access: "Nobody needs to be home as long as we have access. If you're facing the house, which side is the gate we should use?",
  access_note: "Thanks, I'll keep those access notes for the technician. {next_question}",
  signup_access_note: "Thanks, I'll put those access notes on the account for the technician. Sweep&Go will email you about a card on file or you can pay by check, and your first invoice includes the initial cleanup plus the following month of service. {next_question}",
  try_month: "Yes, you can try one month. To get the lower initial-cleanup rate, the first invoice includes the initial cleanup plus the following month of service, and you can pause after that month to reassess. " + close,
  billing: "After the first visit, your first invoice includes the initial cleanup plus the following month of service, then we bill on the 1st of each month. Sweep&Go emails you a secure portal for a card on file, or a check works too. " + close,
  payment: "A check works, or you can keep a card on file through the secure Sweep&Go portal. We don't take cash. " + close,
  dog_food: "Yes, we deliver Extreme Dog Fuel on a regular cleanup visit, and a 40 lb bag is $" + food.price + " plus tax. You can see the formulas at https://www.ohiopetwastepros.com/dog-food/ . Would you like a bag recommendation while we get your cleanup set up?",
  first_visit: "The initial cleanup gets the yard caught up before regular service starts. Your first invoice includes the initial cleanup and the following month of service, then billing runs on the 1st. {next_question}",
  plan_exception: "I'll have our office follow up about that service frequency before I quote anything outside our published plans.",
  frequency_policy: "Weekly and twice weekly are available for up to 7 dogs, biweekly for up to 3 and monthly for 1 or 2. We can change the frequency later. Which plan would you like to start with?",
  frequency_options: "For {yard_basis}, {plan_options}. {next_question}",
  dog_comparison: "For {yard_basis}, {comparison_rates}. {comparison_close}",
  unavailable_frequency: "We offer monthly for 1 or 2 dogs and biweekly for up to 3. For {yard_basis}, {plan_options}. Which available plan would work for you?",
  referral: "Thank you for the referral. I'll make a note of who referred you. " + close,
  referral_policy: "Thanks for bringing that up, we don't have a referral credit or program. I'll make a note of who referred you. " + close,
  do_it_myself: "Nothing wrong with that at all. If you change your mind, we'd love to take it off your plate.",
  emoji_greeting: "Hey, this is Ohio Pet Waste Pros. Did you want help getting a quote or getting on the schedule?",
  photo: "Thanks for the photo, that helps. {next_question}",
  proof: "We'll text when we're on the way and again when the cleanup is done, often with a gate photo. " + close,
  identity_line: "Yes, this is the Ohio Pet Waste Pros text line and these replies use AI. I can answer questions or have the owner call or text you back. What would you like help with?",
  who: "You've reached Ohio Pet Waste Pros. Did you want help with a quote or getting on the schedule?",
  service_area_prompt: "What's the ZIP for the yard so I can check whether we service your area?",
});

export const FAQ_REASON_LABELS = Object.freeze({
  price_objection: 'The customer asked for a price concession or objected to a quoted price',
  human_request: 'The customer requested a personal call or reply',
  language_handoff: 'The message needs a person who can help in the requested language',
  complaint: 'The customer reported a quality or missed-service problem',
  payment_dispute: 'A refund, charge dispute or billing decision needs approval',
  cash_exception: 'The customer is insisting on paying cash',
  payment_exception: 'The customer requested a payment method or arrangement outside policy',
  payment_secure: 'Sensitive payment or account information needs secure handling',
  account_billing: 'An existing invoice or failed payment needs office review',
  safety_handoff: 'The customer reported a safety or injury concern',
  commercial_scope: 'A commercial property needs a scoped quote',
  coverage_handoff: 'Service-area details conflict or an exception was requested',
  insurance_handoff: 'The customer requested insurance, licensing or vendor documents',
  legal_handoff: 'A legal, fraud or harassment complaint needs the owner',
  account_dog: 'The office must update the dog count and verify billing',
  account_change: 'The office must confirm a subscription or service change',
  skip_visit: 'Dispatch must confirm a single-visit skip while keeping the plan',
  winter_pause: 'Office: confirm pause dates, set up to 90 days, extend until March and follow up from the winter pause list',
  routing_handoff: 'Dispatch must confirm a change to an existing route',
  holiday_booking: 'Dispatch must confirm a specific start on an already planned route',
  food_order: 'The office must confirm a food order, billing or first delivery',
  access_risk: 'The technician needs access confirmed before the visit',
  intent_needs_review: 'No approved FAQ answer covers the question',
  conversation_turn_limit: 'The conversation needs personal review',
  conflicting_details: 'Conflicting details need clarification before quoting',
  plan_exception: 'The requested frequency is outside the published dog-count limit',
});

export const FREQ_LABELS = {once_a_week: 'weekly', twice_a_week: 'twice weekly', every_other_week: 'biweekly', once_a_month: 'monthly'};
const planIds = Object.keys(FREQ_LABELS);
export function planOptions(dogs, yardTier, requested = planIds) {
  const extra = yardTier && yardTier !== 'unsure' ? yardUpcharge(yardTier) : 0;
  if (extra === null) return '';
  return requested.flatMap(id => {
    const rate = monthly(id, dogs);
    return rate === null ? [] : [FREQ_LABELS[id] + ' is $' + (rate + extra) + ' per month'];
  }).join(' and ');
}

export const FAQ_LIBRARY_PREFIX = 'lead-faq-20261123-';
export const faqAnswerKey = templateKey => FAQ_LIBRARY_PREFIX + templateKey;

// A versioned, idempotent catalog import using the existing answer library.
// Empty keyword lists intentionally keep these scoped templates out of legacy
// keyword-only responders. The playbook's topic/state policy supplies the match.
export async function seedPlaybookFaqLibrary(db) {
  const entries = Object.entries(FAQ_TEMPLATES);
  const existing = await db.prepare('SELECT COUNT(*) total FROM lead_answer_library WHERE organization_id=? AND answer_key LIKE ?').bind('org-opwp', FAQ_LIBRARY_PREFIX + '%').first();
  if (Number(existing?.total) === entries.length) return;
  await db.batch(entries.map(([key, body]) => db.prepare("INSERT OR IGNORE INTO lead_answer_library(answer_key,organization_id,category,question,answer_template,keywords,response_mode,approval_status,auto_send_allowed,updated_by,intent,source) VALUES (?,'org-opwp','Lead texting FAQ',?,?,'[]',?,'approved',1,'reviewed-faq',?,'seed')")
    .bind(faqAnswerKey(key), key.replaceAll('_',' '), body, Object.hasOwn(FAQ_REASON_LABELS,key) ? 'handoff' : /\$/.test(body) ? 'pricing' : 'static', key)));
}

// These are calculated from the same versioned tables as the website. The
// renderer calls this again immediately before a send; prices in draft slots
// cannot supplant the rate card.
export function faqPricingSlots(slots) {
  const dogs = Number(slots.dogs), tier = slots.yardTier;
  const freq = slots.frequencyId || slots.frequency;
  const extra = yardUpcharge(tier), initial = initialRange(dogs, slots.lastCleaned);
  const ids = Array.isArray(slots.requestedPlans) ? planIds.filter(id => slots.requestedPlans.includes(id)) : planIds;
  const weekly = monthly('once_a_week', dogs), biweekly = monthly('every_other_week', dogs);
  const rates = weekly !== null && extra !== null ? 'Weekly is $' + (weekly + extra) + ' per month' + (biweekly !== null ? ' and biweekly is $' + (biweekly + extra) + ' per month' : '') : '';
  const comparison = [...new Set(Array.isArray(slots.comparisonDogs) ? slots.comparisonDogs : [])].filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
  const comparisonRates = comparison.map(n => {
    const price = monthly(freq,n);
    if (price === null || extra === null && tier && tier !== 'unsure') return '';
    return FREQ_LABELS[freq] + ' service for ' + n + (n === 1 ? ' dog' : ' dogs') + ' is $' + (price + (extra || 0)) + ' per month';
  });
  const comparisonClose = slots.repeatConfirmedRange && initial ? 'For your current dog count the initial cleanup would be $' + initial[0] + ' to $' + initial[1] + '. Want me to get you set up?' : dogs > 0 ? 'Want me to check the initial cleanup for the dogs you have now?' : 'Which dog count should I use for the initial cleanup?';
  return {
    yard_basis: !tier || tier === 'unsure' || tier === 'tiny' ? 'a standard yard' : 'that size of cleanup area',
    comparison_rates: comparisonRates.length === 2 && comparisonRates.every(Boolean) ? comparisonRates.join(' and ') : '',
    comparison_close: comparisonClose, frequency_label: FREQ_LABELS[freq], plan_rate: monthly(freq,dogs),
    plan_options: planOptions(dogs, tier, ids), init_low: initial?.[0], init_high: initial?.[1],
    recurring_option: biweekly !== null ? 'recurring service, even biweekly,' : 'weekly recurring service', recurring_rates: rates,
  };
}
