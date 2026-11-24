import {FAQ_TEMPLATES, planOptions, faqPricingSlots} from './lead-playbook-faq.mjs';
import {recognizeLeadFaq, faqServiceLocation} from './lead-playbook-faq-topics.mjs';
import {declinedServiceCity} from '../data/cities.js';
import { formatCustomerSms } from "./customer-sms.mjs";
import { classifyMetaReply } from "./meta-lead-policy.mjs";
import { parseNaturalPlaybookReply } from "./lead-playbook-natural-replies.mjs";
import { cleanupRecapClause } from "./lead-cleanup-timeframe.mjs";
import { CRAIG_TEMPLATES, CRAIG_RANGE_SENTENCE, renderCraigReply, validateCraigReply } from "./craig-voice.mjs";
import { allowedOperationalDays } from "./route-day-policy.mjs";
import { looksLikeCustomerServiceText } from "./lead-assistant.mjs";
import { PRICING, YARD_TIERS, PRICING_VERSION, frequencyId, initialRange, oneTimeRange, monthly, yardTierId, yardUpcharge } from "./lead-pricing.mjs";

export const PLAYBOOK_POLICY_VERSION = "lead-playbook-2026-11-23-faq-v1";
export const PLAYBOOK_CLASSIFIER_VERSION = "lead-intents-2026-11-23-faq-v1";
export const INTENTS = Object.freeze(["confirm_yes", "correction", "address_given", "question_price", "question_service_day", "question_what_included", "question_contract", "question_haul_away", "question_pets_safety", "question_gate_access", "question_payment", "objection_price", "objection_thinking", "objection_competitor", "ready_to_sign_up", "not_interested", "reschedule_timing", "is_this_ai", "stop", "wrong_number", "faq_handoff", "faq_question", "other"]);
export const STAGES = Object.freeze(["intro_sent", "collect_details", "confirm_details_sent", "details_confirmed", "details_corrected", "quote_sent", "objection", "discount_offered", "ready", "access_questions_sent", "handoff_signup", "closed_won", "closed_lost", "escalated"]);
export const RANGE_SENTENCE = CRAIG_RANGE_SENTENCE;
export const TEMPLATES = CRAIG_TEMPLATES;
const FREQ_TEXT = { once_a_week: "weekly", twice_a_week: "twice weekly", every_other_week: "bi-weekly", once_a_month: "monthly", one_time: "one-time" };
const FREQ_LABEL = { once_a_week: "Weekly", twice_a_week: "Twice Weekly", every_other_week: "Biweekly", once_a_month: "Monthly", one_time: "One Time" };
const priceObjections = new Set(["objection_price", "objection_competitor"]);
const ascii = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x00-\x7f]/g, " ");
const cleanSlot = (value) => ascii(value).replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const signupExpected = new Set(["signupName", "signupEmail", "signupIdentity", "signupAccess", "gateSide", "trashLocation"]);
// Match complete, bounded affirmations before considering longer replies. A
// leading "yes" alone must never hide a correction, question, or refusal.
const affirmativePhrase = "(?:(?:yes|yep|yeah|yup)(?:[,;.!\\s]+(?:please|correct|that(?:'?s| is) (?:right|correct)|all correct|you got it))?|correct|that(?:'?s| is) (?:right|correct)|all correct|you got it)";
const affirmativeText = text => String(text || "").replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
const affirmativeOnlyPattern = new RegExp(`^${affirmativePhrase}[,;.!\\s]*$`, "i");
const affirmativeAccessPattern = new RegExp(`^${affirmativePhrase}(?:[,;.!\\s]*|[,;.!\\s]+(?:the )?(?:gate|trash|garbage|bin)\\b.*)$`, "i");
const affirmativeOnly = text => affirmativeOnlyPattern.test(affirmativeText(text));
const affirmative = text => affirmativeAccessPattern.test(affirmativeText(text));
function understoodConfirmation(message, slots, context) {
  if (/\?/.test(message) || !context.details || !Object.entries(slots).filter(([key]) => key !== 'lastCleanedAnswer').every(([key, value]) => context.details[key] === value)) return false;
  const clauses = message.replace(/^(?:yes|yep|yeah|yup)\b[\s,.!]*/i, "").split(/[.!;]+/).map(value => value.trim()).filter(Boolean);
  return clauses.length > 0 && clauses.every(clause => {
    if (/^(?:thanks|thank you|perfect|sounds good|that is correct|that's (?:right|correct)|all correct)$/i.test(clause)) return true;
    if (/^(?:(?:it was|the yard was|last) )?cleaned (?:on )?(?:the )?\d{1,2}(?:st|nd|rd|th)?$/i.test(clause)) return Boolean(context.now && slots.lastCleaned);
    if (/^(?:i|we) (?:had|have|just had|recently had) (?:surgery|an operation)(?: on (?:the )?\d{1,2}(?:st|nd|rd|th)?)?(?: and (?:(?:i|we) )?(?:can't|cannot|can not|am unable to|are unable to) do (?:the )?(?:weekly )?clean(?: ?up|ing))?$/i.test(clause)) return true;
    if (/^(?:i|we) (?:would |will |only )?(?:need|want)(?: the)? service for (?:only |just )?(?:a few|[1-4]|one|two|three|four) months?$/i.test(clause)) return true;
    if (/^(?:(?:i|we) (?:have|own)|there (?:is|are)) (?:\d{1,2}|one|two|three|four|five|six|seven) dogs?$/i.test(clause)) return slots.dogs === context.details.dogs;
    return false;
  });
}
export function playbookEnabled(env = {}) { return env.LEAD_PLAYBOOK_ENABLED === true || env.LEAD_PLAYBOOK_ENABLED === "true"; }
export function renderPlaybookTemplate(key, slots = {}) {
  return renderCraigReply(key, {...slots, dogs_phrase: slots.dogs_phrase || (slots.dogs ? slots.dogs + (Number(slots.dogs) === 1 ? " dog" : " dogs") : "your dogs")});
}

export function classifyPlaybookRules(text, context = {}) {
  const message = String(text || "").trim().slice(0, 4000), branch = classifyMetaReply(message), slots = {};
  let natural = {};
  const result = (intent, confidence = 1, reason = "deterministic_rule") => ({ intent, confidence, slots, reason, classifierVersion: PLAYBOOK_CLASSIFIER_VERSION, ...Object.fromEntries(["yardStatus", "lastCleanedStatus", "dogsStatus"].filter(key => natural[key]).map(key => [key, natural[key]])) });
  if (branch === "opted_out") return result("stop");
  if (branch === "wrong_number") return result("wrong_number");
  natural = parseNaturalPlaybookReply(message, context.photo_received && /\b(?:weeks?|months?|days?)\b/i.test(message) && !/\b(?:start|wait|schedule)\b/i.test(message) ? {...context, expected: 'lastCleaned'} : context);
  const faq = recognizeLeadFaq(message, {...context, metaBranch: branch});
  const location = faqServiceLocation(message);
  if (faq?.accessCode) return {...result(faq.intent, 1, 'approved_faq'), faq};
  if (!location.inquiry && location.zip) slots.zip = location.zip;
  if (!location.inquiry && (location.city || location.declined)) slots.city = location.declined || location.city;
  if (faq) {
    // Mentions of monthly billing, add-ons and plan comparisons do not change
    // the frequency on an existing quote.
    for (const key of ['dogs','address','yardAcres','yardTier','lastCleaned','lastCleanedAnswer']) {
      if (!(faq.topic === 'dog_comparison' && key === 'dogs') && Object.hasOwn(natural.slots, key)) slots[key] = natural.slots[key];
    }
    if (faq.topic.startsWith('coverage_') && /^\d{1,6}\s+[\p{L}\d .,#'\-]{5,180}$/u.test(message)) slots.address = message;
    if (['holiday','coverage_yes','dog_comparison'].includes(faq.topic) && natural.slots.frequency) slots.frequency = natural.slots.frequency;
    if (faq.topic === 'access_note') {
      const gate = message.match(/\bgate (?:is )?(?:on )?(?:the )?(left|right)\b/i);
      const can = message.match(/\b(?:trash can|garbage can|can|bin) (?:is |sits )?((?:by|beside|behind|near|inside|outside|next to|in|at|on) [^.;!?]{2,120})/i);
      if (gate && !/\bfacing (?:the )?(?:street|road|away)\b/i.test(message)) slots.gateSide = gate[1].toLowerCase();
      if (can) slots.trashLocation = can[1].trim();
    }
    return {...result(faq.intent, 1, faq.reason || 'approved_faq'), faq};
  }
  if (branch === "human_help") return result("is_this_ai");
  if (branch === "declined" && !/\b(?:too (?:expensive|pricey|much)|cheaper|afford)\b/i.test(message)) return result("not_interested");
  if (/\b(?:haul[- ]?away|take (?:it|the waste) with you|double[- ]?bag)\b/i.test(message)) return result("question_haul_away");
  if (/\b(?:pay(?:ment)?|billing|bill|refund|charge|credit card|invoice)\b/i.test(message)) return result("question_payment");
  if (/\b(?:expensive|pricey|too much|more than (?:i|we) expected|afford|price is high|cost is high|cheaper|lower (?:the )?price|discount)\b/i.test(message)) return result("objection_price");
  if (/\b(?:think about|thinking (?:it )?over|think it over|let (?:me|us) think|need (?:some )?time|ask (?:my |the )?(?:husband|wife|spouse)|talk (?:to|with) (?:my |the )?(?:husband|wife|spouse))\b/i.test(message)) return result("objection_thinking");
  if (/\b(?:comparing|competitor|other compan|another (?:company|quote)|shop around)\w*/i.test(message)) return result("objection_competitor");
  Object.assign(slots, natural.slots);
  // Calendar references need explicit event time; never guess a month from a
  // server clock or interpret a street number as a cleanup date.
  const calendar = message.match(/\bcleaned (?:on )?(?:the )?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (calendar && context.now) {
    const now = new Date(context.now), local = new Date(now.getFullYear(), now.getMonth(), Number(calendar[1]));
    if (local > now) local.setMonth(local.getMonth() - 1);
    const days = Math.floor((now - local) / 86400000);
    if (days >= 0 && days <= 120) {
      slots.lastCleaned = days <= 7 ? "one_week" : days <= 14 ? "two_weeks" : days <= 21 ? "three_weeks" : days <= 31 ? "one_month" : days <= 62 ? "two_months" : "3_4_months";
      slots.lastCleanedAnswer = 'on ' + calendar[0].replace(/^cleaned\s+(?:on\s+)?/i, '');
    }
  }
  if (natural.reason === "frequency_ambiguous") return result("correction", 1, natural.reason);
  if (natural.yardStatus && natural.yardStatus !== "matched" || natural.lastCleanedStatus === "ambiguous" || natural.dogsStatus === "ambiguous") return result("correction", 1, natural.reason);
  if (signupExpected.has(context.expected)) {
    const email = message.match(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+\b/i);
    if (email) slots.email = email[0];
    const name = message.match(/\b(?:my name is|the name is|account name is|use the name|name should be)\s+([\p{L}][\p{L}'\u2019 -]{1,79})(?=[,;.!]|$)/iu);
    if (name) slots.name = name[1].trim();
    else if (context.expected === "signupName" && /^[\p{L}][\p{L}'\u2019 -]{1,79}$/u.test(message) && !affirmativeOnly(message) && !/^(?:no|thanks|thank you|not sure)$/i.test(message)) slots.name = message;
    if (!/\bfacing (?:the )?(?:street|road|away)\b/i.test(message)) {
      const side = message.match(/\b(?:gate(?: is)?(?: on)?(?: the)?\s+|(?:on )?the\s+)?(left|right)(?:[- ]hand)?(?: side)?\b/i);
      if (side && (/\bgate\b/i.test(message) || ["signupAccess", "gateSide"].includes(context.expected) && /^(?:the |on the )?(?:left|right)(?:[- ]hand)?(?: side)?[.!\s]*$/i.test(message))) slots.gateSide = side[1].toLowerCase();
      if (/\b(?:no gate|isn['\u2019]?t a gate|is not a gate)\b/i.test(message)) slots.gateSide = "no_gate";
    }
    const trash = message.match(/\b(?:trash(?: can| bin)?|garbage(?: can| bin)?|outdoor can|bin)(?: is| are)?(?: located)?\s+((?:at|by|beside|behind|near|on|in|next to)\s+[^.;!?]{2,150})/i);
    if (trash) slots.trashLocation = trash[1].trim();
    else if (context.expected === "trashLocation" && /^(?:at|by|beside|behind|near|on|in|next to)\s+[^.;!?]{2,150}[.!]?$/i.test(message)) slots.trashLocation = message.replace(/[.!]+$/, "");
    if (Object.keys(slots).length && affirmative(message)) return result("confirm_yes");
    if (Object.keys(slots).length) return result("correction", 0.95);
  }
  if (!natural.yardStatus && Object.keys(slots).every(key => ['city','zip'].includes(key)) && /^\d{1,6}\s+[\p{L}\d .,#'\-]{5,180}$/u.test(message) && /[a-z]/i.test(message)) { slots.address = message; return result("address_given"); }
  if (/\b(?:ready (?:to |for )?(?:sign|start|go)|sign (?:me|us) up|let['’]?s (?:do it|get started)|go ahead|get (?:me|us) (?:started|signed up))\b/i.test(message)) return result("ready_to_sign_up");
  if (affirmativeOnly(message) || /^(?:sounds good|that works|i can do that|let\x27s do it|all good|sounds right)[.!\s]*$/i.test(message)) return result(context.stage === "quote_sent" || context.stage === "discount_offered" || context.expected === "biweeklyAcceptance" ? "ready_to_sign_up" : "confirm_yes");
  if (natural.intent === "confirm_yes") return result(context.expected === "biweeklyAcceptance" ? "ready_to_sign_up" : "confirm_yes");
  if (/^(?:yes|yep|yeah|yup)\b/i.test(message)) {
    if (/\?|\b(?:how|what|which|when)\b/i.test(message) && !Object.keys(slots).length) {
      if (/\b(?:included|include|how (?:does|do) (?:it|you|the service) work|what (?:do you|is the service))\b/i.test(message)) return result("question_what_included");
      if (/\b(?:how much|price|pricing|cost|quote)\b/i.test(message)) return result("question_price");
      if (/\b(?:what|which) day\b|\bwhen (?:can|do|will)\b|\bschedule\b/i.test(message)) return result("question_service_day");
      if (/\b(?:contract|cancel anytime|month to month|commitment|cancel)\b/i.test(message)) return result("question_contract");
      if (/\b(?:dogs? (?:be )?(?:outside|out|inside)|pets? safe|safety|friendly dog)\b/i.test(message)) return result("question_pets_safety");
      if (/\b(?:gate|lock|key|access)\b/i.test(message)) return result("question_gate_access");
    }
    if (understoodConfirmation(message, slots, context)) return result("confirm_yes", 0.9);
    if (Object.keys(slots).length) return result("correction", 0.95);
    return result("other", 0, "confirmation_requires_review");
  }
  if (/\b(?:concerning|considering|interested in|want|need) service\b/i.test(message) && context.stage === "intro_sent") return result("confirm_yes", 0.9);
  if (natural.intent && !["confirm_yes", "correction"].includes(natural.intent)) return result(natural.intent, 0.95, natural.reason);
  if ((/\b(?:how much|what(?:'s| is) (?:the )?(?:cost|price)|give (?:me|us) a quote)\b/i.test(message) || /\b(?:what|how much|cost|price|rate)\b/i.test(message) && /\b(?:rate|cost|price|charge)\b|\?/i.test(message) && slots.frequency || slots.frequency === 'one_time') && Object.keys(slots).length) return result("question_price");
  if (Object.keys(slots).length || branch === "correction") return result("correction", Object.keys(slots).length ? 0.95 : 0.7);
  if (/\b(?:how much|price|pricing|cost|quote)\b/i.test(message)) return result("question_price");
  if (/\b(?:what|which) day\b|\bwhen (?:can|do|will)\b|\bschedule\b/i.test(message)) return result("question_service_day");
  if (/\b(?:included|include|how (?:does|do) (?:it|you|the service) work|what (?:do you|is the service))\b/i.test(message)) return result("question_what_included");
  if (/\b(?:contract|cancel anytime|month to month|commitment|cancel)\b/i.test(message)) return result("question_contract");
  if (/\b(?:dogs? (?:be )?(?:outside|out|inside)|pets? safe|safety|friendly dog)\b/i.test(message)) return result("question_pets_safety");
  if (/\b(?:gate|lock|key|access)\b/i.test(message)) return result("question_gate_access");
  if (branch === "delayed_start" || /\b(?:reschedule|start later)\b/i.test(message)) return result("reschedule_timing");
  return result("other", 0, "unrecognized");
}

export function lintPlaybookText(body, { intent = "other", templateKey = "", state = {}, slots = {} } = {}) {
  const text = String(body || ""), violations = [...validateCraigReply(text, {step: templateKey})];
  if (/[\u2013\u2014]/.test(text)) violations.push("forbidden_dash");
  if (/[^\x00-\x7f]/.test(text)) violations.push("non_ascii_sms");
  if (text.length > 1000 || !text.trim()) violations.push("invalid_length");
  const prices = [...text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g)].map(match => Number(match[1].replaceAll(",", "")));
  const quote = ['quote_recurring', 'quote_one_time'].includes(templateKey);
  const upcharge = yardUpcharge(slots.yardTier);
  if (['objection_discount','objection_biweekly'].includes(templateKey) || /\b(?:\d+(?:\s*%| dollars?)? off|give you (?:a )?discount|waive (?:the|your) (?:fee|charge)|match (?:that|their) price)\b/i.test(text)) violations.push('discount_not_authorized');
  if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|to|and)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:arrive|be there|come|be out) (?:at|before|by) (?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight)\b/i.test(text)) violations.push('unverified_time_promise');
  if (quote) {
    if (!state.details_confirmed) violations.push("quote_before_confirmation");
    if (!slots.day) violations.push("unresolved_or_changed_quote_closing");
    const oneTime = templateKey === "quote_one_time", range = oneTime ? oneTimeRange(slots.dogs, slots.lastCleaned) : initialRange(slots.dogs, slots.lastCleaned);
    const amount = monthly(slots.frequencyId || slots.frequency, slots.dogs);
    if (!range || upcharge === null || slots.yardTier === 'unsure' || Number(slots.low) !== range?.[0] || Number(slots.high) !== range?.[1] || (oneTime ? !initialRange(slots.dogs, slots.lastCleaned) : amount === null || Number(slots.monthly) !== amount + upcharge)) violations.push("price_disagrees_with_grid");
    if (!oneTime && !text.includes(RANGE_SENTENCE)) violations.push("missing_range_sentence");
    let canonical = "";
    try { canonical = renderPlaybookTemplate(templateKey, slots); } catch { /* Missing slots fail closed. */ }
    if (text !== canonical) violations.push("quote_text_price_mismatch");
  } else if (Object.hasOwn(FAQ_TEMPLATES, templateKey) || templateKey === 'haul_away_answer') {
    let canonical = '';
    try { canonical = renderPlaybookTemplate(templateKey, slots); } catch { /* Incomplete or unsafe slot. */ }
    if (text !== canonical) violations.push('faq_template_mismatch');
    if ([slots.next_question, slots.scope_question, slots.area_name].some(value => value && /[$\d]/.test(value))) violations.push('unapproved_price_text');
    if (templateKey === 'dog_comparison' && !faqPricingSlots(slots).comparison_rates || templateKey === 'custom_initial' && (monthly(slots.frequency, slots.dogs) === null || Number(slots.dogs) > 7) ||
        ['frequency_options','unavailable_frequency'].includes(templateKey) && !faqPricingSlots(slots).plan_options) violations.push('price_disagrees_with_grid');
    if (templateKey === 'published_plan_rate' && (!faqPricingSlots(slots).base_yard_basis || monthly(slots.frequencyId || slots.frequency, slots.dogs) === null || !Number.isInteger(Number(slots.dogs)) || Number(slots.dogs) < 1 || Number(slots.dogs) > 7)) violations.push('price_disagrees_with_grid');
    if (templateKey === 'haul_away_answer') {
      const addon = PRICING.addons.find(item => item.id === 'haul_away');
      const price = Number(slots.dogs) >= 3 ? addon.price3Plus : addon.price;
      if (Number(slots.haul_monthly) !== price || !Number.isInteger(Number(slots.dogs)) || Number(slots.dogs) < 1) violations.push('price_disagrees_with_grid');
    }
  } else if (prices.length) violations.push("unapproved_price_text");
  if ((/\b(?:on|for|this|next) (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text) || /\b(?:start|come|visit|schedule|available|get you).{0,50}\b(?:tomorrow|today|next week|\d{1,2}\/\d{1,2})\b/i.test(text)) && !slots.day) violations.push("unverified_day_promise");
  return [...new Set(violations)];
}

const QUESTIONS = Object.freeze({
  dogs: 'How many dogs use the yard?',
  frequency: 'Were you thinking one-time or recurring service?',
  zip: "What's the ZIP for the yard?",
  cleaned: 'How long has it been since the yard was last thoroughly cleaned up?',
  yard: "What's the size of the cleanup area, or the address so I can measure it?",
  address: "What's the service address?",
  email: "What's the best email for the account?",
  approve: 'Want me to get you set up?',
  gate: "If you're facing the house, which side is the gate?",
  can: 'Where is the outdoor trash can?',
  setup: "We'll use your setup email for the secure Sweep&Go portal.",
});
function nextQuestion(details) {
  if (!details.dogs) return QUESTIONS.dogs;
  if (!details.frequency) return QUESTIONS.frequency;
  if (!details.zip && !details.city) return QUESTIONS.zip;
  if (!details.lastCleaned) return QUESTIONS.cleaned;
  if (!details.yardTier || details.yardTier === 'unsure') return QUESTIONS.yard;
  return QUESTIONS.approve;
}

export function leadPlaybookDetails(lead = {}, state = {}) {
  let payload = lead.payload || {};
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  const raw = { ...payload, ...(payload.quote_context || {}), ...(payload.lead_workspace?.intake || {}), ...(lead.lead_workspace?.intake || {}), ...lead, ...(state.details || {}) };
  const dogs = raw.dogs ?? raw.number_of_dogs;
  const yardAnswer = raw.yard_size_answer ? classifyPlaybookRules(raw.yard_size_answer, { expected: "yardTier" }).slots : {};
  const cleanedAnswer = raw.last_cleaned_answer ? parseNaturalPlaybookReply(raw.last_cleaned_answer, {expected: "lastCleaned"}).slots : {};
  const lastCleaned = raw.lastCleaned || raw.last_cleaned || cleanedAnswer.lastCleaned;
  const lastCleanedAnswer = raw.lastCleanedAnswer || (cleanedAnswer.lastCleaned === lastCleaned ? cleanedAnswer.lastCleanedAnswer : '') || '';
  const yardAcres = raw.yardAcres !== undefined ? raw.yardAcres : raw.yard_acres ?? yardAnswer.yardAcres;
  return { dogs: dogs === undefined || dogs === null || dogs === "" ? null : Number(dogs), frequency: frequencyId(raw.frequency || raw.clean_up_frequency), yardTier: yardTierId(raw.yardTier || raw.yard_size_tier || raw.yardSize || raw.yard_size || yardAnswer.yardTier), yardAcres, lastCleaned, lastCleanedAnswer, address: raw.address || raw.street_address || "", city: raw.city || "", zip: raw.zip || "", name: raw.name || [raw.first_name || raw.firstName, raw.last_name || raw.lastName].filter(Boolean).join(" "), email: raw.email || "", gateSide: raw.gateSide || "", trashLocation: raw.trashLocation || "" };
}
export function matchesAuditedPlaybookLocation(audit, proposed) {
  const city = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  const zip = value => String(value || '').trim().slice(0,5);
  return !(city(audit?.city) && city(proposed?.city) && city(audit.city) !== city(proposed.city)) &&
    !(zip(audit?.zip) && zip(proposed?.zip) && zip(audit.zip) !== zip(proposed.zip));
}
export function confirmedPlaybookRoute(route, details) {
  const days = route?.approvedDays || (route?.day ? [route.day] : []);
  const allowed = allowedOperationalDays({ city: details.city, zip: details.zip, frequency: FREQ_LABEL[details.frequency] });
  return days.length === 1 && matchesAuditedPlaybookLocation(route, details) && (route.confirmed === true || Boolean(route.auditedBy)) && allowed.includes(days[0]) ? days[0] : null;
}

// Produces a proposal only. The caller atomically persists state when its draft is sent.
export function nextPlaybookResponse({ conversation = {}, state = {}, lead = {}, text = "", classification, route, approvedAnswers = [], suppressed = false, existingCustomerTestException = false } = {}) {
  const currentStage = state.stage || "intro_sent", previousDetails = leadPlaybookDetails(lead, state);
  const classified = classification || classifyPlaybookRules(text, { ...state, stage: currentStage, details: previousDetails });
  const faq = classified.faq || recognizeLeadFaq(text, {...state, details: previousDetails});
  const intent = INTENTS.includes(classified.intent) ? classified.intent : "other", confidence = Number(classified.confidence) || 0;
  const details = { ...previousDetails, ...(classified.slots || {}) };
  if (Object.hasOwn(classified.slots || {}, 'lastCleaned') && !Object.hasOwn(classified.slots, 'lastCleanedAnswer') && details.lastCleaned !== previousDetails.lastCleaned) details.lastCleanedAnswer = '';
  const next = { ...state, stage: currentStage, details, turns: Number(state.turns || 0) + 1 };
  const base = { intent, confidence, slots: { ...details }, pricingVersion: PRICING_VERSION, policyVersion: PLAYBOOK_POLICY_VERSION, templateKey: null, body: "", escalate: false, reason: "", state: next };
  const stop = (reason, escalate = false) => ({ ...base, escalate, reason, state: { ...next, ...(escalate ? { stage: "escalated", escalation_reason: reason } : {}) } });
  const draft = (key, stage, extra = {}, escalate = false, reason = "approved_template") => {
    const slots = { ...details, ...extra }, body = renderPlaybookTemplate(key, slots);
    const violations = lintPlaybookText(body, { intent, templateKey: key, state, slots });
    if (violations.length) return stop(violations.join(","), true);
    return { ...base, slots, body, templateKey: key, escalate, reason, state: { ...next, stage, ...(escalate ? { escalation_reason: reason } : {}) } };
  };
  if (suppressed || intent === "stop" || intent === "wrong_number") return stop(suppressed ? "suppressed" : intent);
  if (conversation.owner !== "backend") return stop(`owner_${conversation.owner || "unknown"}`);
  if (['closed_won','handoff_signup'].includes(currentStage)) return stop('thread_not_active');
  const existing = (lead.existing_customer || lead.is_existing_customer) && !existingCustomerTestException;
  if (existing) return {...stop(faq?.handoff ? faq.reason : 'existing_customer', true), staffOnly: true};
  if (next.turns > 20) return stop('conversation_turn_limit', true);
  // Once staff own a handoff, further inbound details may update the alert,
  // but cannot restart a sales script or send another automatic acknowledgment.
  // A price review can still receive published payment policy and a public
  // self-service path. These replies preserve the durable sales hold.
  if (currentStage === 'escalated') {
    if (state.escalation_reason === 'price_objection' && !faq?.handoff) {
      if (faq?.topic === 'payment') {
        if (/\bcash\b/i.test(text)) next.cash_policy_explained = true;
        return draft('payment_review', 'escalated', {}, false, 'payment_policy_during_price_review');
      }
      if (intent === 'ready_to_sign_up') return draft('signup_path_review', 'escalated', {}, false, 'public_signup_path_during_price_review');
    }
    return {...stop(faq?.handoff ? faq.reason : state.escalation_reason || 'intent_needs_review', true), staffOnly: true};
  }
  if (currentStage === 'closed_lost' && !faq?.handoff) return stop('thread_not_active');
  if (faq?.handoff) return draft(faq.topic, 'escalated', {}, true, faq.reason);
  if (!faq && (classified.reason === 'bounded_model_classifier' || intent === 'other' && /\?|\b(?:what|how|why|can you|could you)\b/i.test(text))) return stop('intent_needs_review', true);
  if (priceObjections.has(intent)) return draft('price_objection', 'escalated', {}, true, 'price_objection');
  if (intent === 'is_this_ai' && !faq) return draft('identity_line', currentStage, {}, false, 'approved_faq');
  if (faq?.topic?.startsWith('coverage_') && !['coverage_monroe','coverage_yes'].includes(faq.topic)) {
    next.faq_last_topic = faq.topic;
    return draft(faq.topic, faq.inquiry ? currentStage : 'closed_lost', {area_name: faq.areaName || 'that ZIP'}, false, faq.inquiry ? 'coverage_information' : 'outside_service_area');
  }
  if (faq?.topic === 'coverage_monroe') {
    next.expected = 'serviceAddressZip';
    return draft(faq.topic, 'collect_details', {}, false, 'area_needs_address');
  }
  const knownOutside = declinedServiceCity(details.city || '');
  if (knownOutside || details.zip && !PRICING.serviceZips.includes(String(details.zip).slice(0, 5))) {
    next.faq_last_topic = 'coverage_decline';
    if (knownOutside && PRICING.serviceZips.includes(details.zip)) return draft('coverage_handoff', 'escalated', {}, true, 'coverage_handoff');
    return draft('coverage_decline', 'closed_lost', {area_name: knownOutside || declinedServiceCity(details.zip) || 'that ZIP'}, false, 'outside_service_area');
  }
  const hasPropertyException = details.yardTier === 'xlarge' || details.yardTier === 'E' || Number(details.yardAcres) > 0.75;
  const hasCustomHistory = details.lastCleaned && !Object.hasOwn(PRICING.initialCleanup, details.lastCleaned);
  if (hasPropertyException) return draft('property_walk', 'escalated', {}, true, 'property_walk');
  if (details.dogs !== null && (!Number.isInteger(Number(details.dogs)) || Number(details.dogs) >= 8 || Number(details.dogs) < 1)) return draft('custom_many_dogs', 'escalated', {}, true, 'custom_pricing');
  if (hasCustomHistory || Number(details.dogs) >= 6) {
    if (Number(details.dogs) >= 6 && monthly(details.frequency, details.dogs) !== null && details.frequency !== 'one_time') {
      const missing = [!details.lastCleaned && 'when the yard was last thoroughly cleaned', (!details.yardTier || details.yardTier === 'unsure') && 'the size of the cleanup area', !details.address && 'the service address'].filter(Boolean);
      return draft('custom_initial', 'escalated', {scope_question: missing.length ? 'Can you send ' + missing.join(' and ') + '?' : "I'll have someone follow up with the initial-cleanup price."}, true, 'custom_pricing');
    }
    return draft(hasCustomHistory && !details.frequency ? 'custom_without_plan' : 'custom_quote', 'escalated', {}, true, 'custom_pricing');
  }
  if (faq && faq.topic !== 'accept_quote') {
    next.faq_last_topic = faq.topic;
    if (['dogs','frequency','yardTier','lastCleaned','zip','address'].some(key => Object.hasOwn(classified.slots || {}, key) && details[key] !== previousDetails[key])) next.details_confirmed = false;
    if (faq.topic === 'payment' && /\bcash\b/i.test(text)) next.cash_policy_explained = true;
    if (faq.topic === 'referral' || faq.topic === 'referral_policy') next.referral_message_pending = true;
    if (faq.topic === 'photo') next.photo_received = true;
    if (faq.topic === 'coverage_yes' && state.expected === 'serviceAddressZip') next.expected = '';
    if (faq.topic === 'service_area_prompt') next.expected = 'serviceAddressZip';
    if (faq.topic === 'disposal_rates' && details.dogs) {
      const addon = PRICING.addons.find(item => item.id === 'haul_away');
      return draft('haul_away_answer', currentStage, {haul_monthly: details.dogs >= 3 ? addon.price3Plus : addon.price}, false, 'approved_disposal_answer');
    }
    if (faq.topic === 'dog_comparison') {
      if (!details.frequency) return prompt('ask_frequency','frequency');
      const comparison = {...details, comparisonDogs:faq.counts, repeatConfirmedRange:Boolean(state.quote && state.details_confirmed)};
      if (!faqPricingSlots(comparison).comparison_rates) return draft('frequency_policy',currentStage);
      return draft('dog_comparison',currentStage,comparison);
    }
    if (faq.topic === 'frequency_options') {
      if (!details.dogs) return prompt('ask_dogs', 'dogs');
      const requested = ['twice_a_week','every_other_week','once_a_week','once_a_month'].filter(id => ({
        twice_a_week: /twice (?:a week|weekly)/i, every_other_week: /bi[- ]?weekly|every other week/i,
        once_a_week: /(?<!bi[- ]?)(?<!twice )\bweekly\b|once a week/i, once_a_month: /\bmonthly|once a month/i,
      })[id].test(text));
      if (!planOptions(details.dogs, details.yardTier, requested)) {
        if (state.faq_last_topic === 'unavailable_frequency') return draft('plan_exception', 'escalated', {}, true, 'plan_exception');
        next.faq_last_topic = 'unavailable_frequency';
        return draft('unavailable_frequency', currentStage, {requestedPlans: ['once_a_week','every_other_week']});
      }
      return draft('frequency_options', currentStage, {requestedPlans: requested, next_question: QUESTIONS.approve});
    }
    if (faq.topic === 'access_note') {
      next.access_notes_supplied = true;
      next.expecting_access_code = !faq.accessCode && /\b(?:code|pin)\b.{0,60}\b(?:to follow|will follow|send|text|later|coming)\b|\b(?:send|text)\b.{0,20}\b(?:the |my )?(?:code|pin)\b/i.test(text);
      const accepting = currentStage === 'quote_sent' && state.details_confirmed && Boolean(state.quote) && /\b(?:yes|let's start|sign me up|go ahead|let's do it)\b/i.test(text);
      if (accepting) next.signup_quote_accepted = true;
      if (!accepting && !(currentStage === 'access_questions_sent' && state.details_confirmed && (state.quote || state.signup_quote_accepted))) {
        return draft('access_note', currentStage, {next_question: nextQuestion(details)}, false, 'lead_access_noted');
      }
      const question = !details.email ? QUESTIONS.email : !details.gateSide ? QUESTIONS.gate : !details.trashLocation ? QUESTIONS.can : QUESTIONS.setup;
      return draft('signup_access_note', 'access_questions_sent', {next_question: question}, false, 'signup_access_noted');
    }
    if (faq.topic === 'do_it_myself') return draft('do_it_myself', 'closed_lost', {}, false, 'do_it_myself');
    return draft(faq.topic, currentStage, {next_question: nextQuestion(details)}, false, faq.topic === 'contract_answer' ? 'approved_contract_answer' : 'approved_faq');
  }
  const existingServiceClaim = /\b(?:(?:my|our) (?:service|account|invoice|payment)|last (?:service|visit)|pause|skip|reschedule|moving|move out|missed|did(?:n't| not) (?:come|show))\b/i.test(text);
  const prospectiveQuestion = ["question_what_included", "question_contract", "question_haul_away", "question_pets_safety", "question_gate_access"].includes(intent) && !existingServiceClaim;
  const suppliedSignupDetails = currentStage === "access_questions_sent" && Object.keys(classified.slots || {}).some(key => ["gateSide", "trashLocation", "name", "email"].includes(key)) && !existingServiceClaim;
  if (looksLikeCustomerServiceText(text) && !prospectiveQuestion && !suppliedSignupDetails) return stop('service_billing_or_anger', true);
  if (intent === 'question_price' && !state.details_confirmed && !state.quote && details.frequency !== 'one_time' && monthly(details.frequency, details.dogs) !== null &&
      (!details.yardTier || details.yardTier === 'unsure' || !details.lastCleaned)) {
    // Published starting rates are information, not a personal quote. Unknown
    // yard, buildup, confirmation and route facts remain unknown and unapproved.
    return draft('published_plan_rate', currentStage, {next_question: !details.yardTier || details.yardTier === 'unsure' ? QUESTIONS.yard : QUESTIONS.cleaned}, false, 'published_starting_rate');
  }
  if (details.dogs && ['once_a_month','every_other_week'].includes(details.frequency) && monthly(details.frequency,details.dogs) === null) {
    if (state.faq_last_topic === 'unavailable_frequency') return draft('plan_exception', 'escalated', {}, true, 'plan_exception');
    next.faq_last_topic = 'unavailable_frequency';
    next.details_confirmed = false;
    next.expected = 'frequency';
    details.frequency = null;
    return draft('unavailable_frequency','collect_details',{requestedPlans:['once_a_week','every_other_week']});
  }
  if (classified.yardStatus === "matched") {
    next.map_measurement_pending = false;
  } else if (["unsure", "ambiguous", "address"].includes(classified.yardStatus)) {
    details.yardTier = null; details.yardAcres = null; next.details_confirmed = false;
    if (classified.yardStatus === "address" && details.address) {
      next.map_measurement_pending = true; next.expected = "yardMeasurement";
      return {...draft("map_measurement_hold", "collect_details", {}, false, "yard_measurement_pending"), needsMapMeasurement: true};
    }
    if (state.map_measurement_pending) return stop("awaiting_yard_measurement");
    if (classified.yardStatus === "unsure") {
      next.expected = "yardMapAddress";
      return draft("ask_map_address", "collect_details", {}, false, "yard_address_requested");
    }
    return clarify("yardTier", "clarify_yard");
  }
  if (classified.dogsStatus === "ambiguous") { details.dogs = null; next.details_confirmed = false; return clarify("dogs", "clarify_dogs"); }
  if (classified.reason === "frequency_ambiguous") { details.frequency = null; next.details_confirmed = false; return clarify("frequency", "clarify_frequency"); }
  if (classified.lastCleanedStatus === "ambiguous") { details.lastCleaned = null; details.lastCleanedAnswer = ''; next.details_confirmed = false; return clarify("lastCleaned", "clarify_last_cleaned"); }
  if (intent === "other" || confidence < 0.8) {
    const clarifyKey = {dogs: "clarify_dogs", frequency: "clarify_frequency", yardTier: "clarify_yard", lastCleaned: "clarify_last_cleaned", yardMapAddress: "ask_map_address"}[state.expected];
    if (clarifyKey) return clarify(state.expected, clarifyKey);
    if (state.map_measurement_pending) return stop("awaiting_yard_measurement");
    return stop("intent_needs_review", true);
  }
  if (intent === "question_payment") return draft("payment", currentStage);
  if (intent === "reschedule_timing") {
    next.preferred_start = cleanSlot(text);
    return draft("timing_preference", currentStage, {}, false, "start_preference_recorded");
  }
  if (intent === "not_interested") return { ...stop("not_interested"), state: { ...next, stage: "closed_lost" } };
  if (intent === "objection_thinking") return draft("spouse_thinking", currentStage, {}, false, "thinking_reply");
  const quoteDetailsChanged = ["dogs", "frequency", "yardTier", "yardAcres", "lastCleaned", "address", "city", "zip"].some(key => Object.hasOwn(classified.slots || {}, key) && details[key] !== previousDetails[key]);
  const pricingDetailsChanged = ["dogs", "frequency", "yardTier", "yardAcres", "lastCleaned"].some(key => Object.hasOwn(classified.slots || {}, key) && details[key] !== previousDetails[key]);
  if (pricingDetailsChanged) return confirmation();
  if (currentStage === "access_questions_sent" && quoteDetailsChanged) return confirmation();
  if (currentStage === "access_questions_sent" && ["confirm_yes", "correction", "ready_to_sign_up"].includes(intent)) return signup();
  if (intent === "question_service_day" && state.details_confirmed && ["quote_sent", "objection", "discount_offered"].includes(currentStage)) {
    const day = confirmedPlaybookRoute(route, details);
    if (!details.address || !day) return stop("route_day_requires_confirmation", true);
    return draft("service_day_answer", currentStage, {day}, false, "verified_service_day");
  }
  if (intent === "question_contract") return draft("contract_answer", currentStage, {}, false, "approved_contract_answer");
  if (intent === "question_haul_away") {
    if (details.dogs === null) return prompt("ask_dogs", "dogs");
    const addon = PRICING.addons.find(item => item.id === "haul_away");
    return draft("haul_away_answer", currentStage, {haul_monthly: details.dogs >= 3 ? addon.price3Plus : addon.price}, false, "approved_disposal_answer");
  }
  if (["question_what_included", "question_contract", "question_pets_safety", "question_gate_access"].includes(intent)) {
    const answer = approvedAnswers.find((item) => item.intent === intent && item.approval_status === "approved" && (!item.stage || item.stage === currentStage));
    if (!answer) return stop("no_approved_library_answer", true);
    let body = String(answer.answer_template || "");
    body = formatCustomerSms(ascii(body.replace(/\{([a-z_]+)\}/g, (_, name) => cleanSlot(details[name] ?? ""))));
    const violations = lintPlaybookText(body, { intent, state, slots: details });
    return violations.length ? stop(violations.join(","), true) : { ...base, body, answerKey: answer.answer_key, answerVersion: answer.version, reason: "approved_library" };
  }
  if (intent === "correction") {
    if (!Object.keys(classified.slots || {}).length) return stop("ambiguous_correction", true);
    next.details_confirmed = false;
    return confirmation();
  }
  function prompt(key, expected, stage = "collect_details") {
    next.expected = expected;
    return draft(key, stage);
  }
  function clarify(field, key) {
    const counts = {...(state.clarification_counts || {})};
    next.clarification_counts = counts; next.expected = field;
    if (Number(counts[field] || 0) >= 1) return stop(`awaiting_${field}`);
    counts[field] = Number(counts[field] || 0) + 1;
    // Confidence is in the approved clarification choice, not an invented value.
    return {...draft(key, "collect_details", {}, false, "detail_clarification"), confidence: 1};
  }
  function confirmation() {
    next.details_confirmed = false;
    if (details.dogs === null) return prompt("ask_dogs", "dogs");
    if (!details.frequency) return prompt("ask_frequency", "frequency");
    if (!details.yardTier || details.yardTier === "unsure") return prompt("ask_yard", "yardTier");
    if (!details.lastCleaned) return prompt("ask_last_cleaned", "lastCleaned");
    const yard = YARD_TIERS.find(({ id }) => id === details.yardTier)?.label;
    const cleaned = PRICING.lastCleanedOptions.find(({ id }) => id === details.lastCleaned)?.label;
    if (!yard || !cleaned || !FREQ_TEXT[details.frequency]) return stop("unrecognized_form_details", true);
    next.expected = "confirmDetails";
    return draft("confirm_details", "confirm_details_sent", { dogs_phrase: `${details.dogs} ${details.dogs === 1 ? "dog" : "dogs"}`, frequency: FREQ_TEXT[details.frequency], yard_phrase: yard.toLowerCase(), last_cleaned_clause: cleanupRecapClause(details.lastCleanedAnswer || cleaned.toLowerCase()) });
  }
  function signup() {
    // A delivered quote stage is carried forward for historical conversations
    // that predate the explicit acceptance marker. Unsolicited access notes
    // or a bare affirmative cannot create a signup path.
    const deliveredQuote = state.quote || currentStage === 'quote_sent' || state.signup_quote_accepted;
    if (!state.details_confirmed || !deliveredQuote || !details.address || !details.dogs || !details.frequency || !details.lastCleaned || !details.yardTier || details.yardTier === 'unsure') return confirmation();
    next.signup_quote_accepted = true;
    const changedIdentity = ["name", "email"].some(key => Object.hasOwn(classified.slots || {}, key) && details[key] !== previousDetails[key]);
    if (changedIdentity) next.signup_identity_confirmed = false;
    if (!details.name) return prompt("ask_signup_name", "signupName", "access_questions_sent");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) return prompt("ask_signup_email", "signupEmail", "access_questions_sent");
    if (currentStage !== "access_questions_sent" || changedIdentity || ["signupName", "signupEmail"].includes(state.expected)) {
      next.signup_identity_confirmed = false;
      return prompt("ready_access", "signupAccess", "access_questions_sent");
    }
    if (intent === "confirm_yes" && affirmative(String(text).trim()) && ["signupAccess", "signupIdentity", "gateSide", "trashLocation"].includes(state.expected)) next.signup_identity_confirmed = true;
    if (/\b(?:no|don['\u2019]?t have (?:a |any )?|do not have (?:a |any )?)(?:trash|garbage)(?: can| bin)?\b/i.test(text) || /\bfacing (?:the )?(?:street|road|away)\b/i.test(text)) return stop("signup_access_requires_review", true);
    if (!next.signup_identity_confirmed) return prompt("confirm_signup_identity", "signupIdentity", "access_questions_sent");
    if (!["left", "right", "no_gate"].includes(details.gateSide)) return prompt("ask_gate_side", "gateSide", "access_questions_sent");
    if (!details.trashLocation) return prompt("ask_trash_location", "trashLocation", "access_questions_sent");
    next.expected = "";
    return draft("signup_handoff", "handoff_signup", {}, true, "signup_ready");
  }
  if (["intro_sent", "collect_details"].includes(currentStage)) return confirmation();
  if (["confirm_details_sent", "details_corrected"].includes(currentStage)) {
    // A price/day question is useful engagement, not a refusal or a confirmation.
    // Re-present the details so the next affirmative can safely unlock a quote.
    if (["question_price", "question_service_day", "ready_to_sign_up"].includes(intent)) return confirmation();
    if (intent !== "confirm_yes") return stop("details_not_confirmed", true);
    if (details.dogs === null || !details.frequency || !details.yardTier || details.yardTier === "unsure" || !details.lastCleaned) return confirmation();
    next.details_confirmed = true;
    next.stage = "details_confirmed";
    next.expected = "address";
    if (!details.address) return draft("ask_address", "details_confirmed");
  }
  if (["quote_sent", "discount_offered", "ready"].includes(currentStage) && intent === "ready_to_sign_up") {
    if (!state.details_confirmed) return confirmation();
    return signup();
  }
  if (next.details_confirmed && (next.stage === "details_confirmed" || intent === "question_price" || intent === "question_service_day")) {
    if (!details.address) return prompt("ask_address", "address", "details_confirmed");
    const day = confirmedPlaybookRoute(route, details);
    if (!day) return stop("route_day_requires_confirmation", true);
    const oneTime = details.frequency === "one_time", key = oneTime ? "quote_one_time" : "quote_recurring";
    const range = oneTime ? oneTimeRange(details.dogs, details.lastCleaned) : initialRange(details.dogs, details.lastCleaned), amount = monthly(details.frequency, details.dogs), upcharge = yardUpcharge(details.yardTier);
    if (!range || !oneTime && amount === null || upcharge === null) return stop("custom_pricing", true);
    const slots = { low: range[0], high: range[1], monthly: amount + upcharge, frequencyId: details.frequency, frequency: FREQ_TEXT[details.frequency], day, day_intro: "" };
    // Quote validation reads the confirmation resulting from this inbound turn.
    const quoted = { ...state, details_confirmed: true };
    const body = renderPlaybookTemplate(key, { ...details, ...slots });
    const violations = lintPlaybookText(body, { intent, templateKey: key, state: quoted, slots: { ...details, ...slots } });
    return violations.length ? stop(violations.join(","), true) : { ...base, body, templateKey: key, slots: { ...details, ...slots }, reason: "confirmed_details_and_route", state: { ...next, expected: "quoteAcceptance", stage: "quote_sent", quote: { ...slots, pricingVersion: PRICING_VERSION } } };
  }
  return stop("unexpected_state_intent", true);
}
