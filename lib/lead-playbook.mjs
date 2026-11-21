import { formatCustomerSms } from "./customer-sms.mjs";
import { classifyMetaReply, metaFrequency } from "./meta-lead-policy.mjs";
import { metaCleanupAnswer } from "./meta-conversation.mjs";
import { allowedOperationalDays } from "./route-day-policy.mjs";
import { looksLikeCustomerServiceText } from "./lead-assistant.mjs";
import { PRICING, YARD_TIERS, PRICING_VERSION, frequencyId, initialRange, monthly, yardTierId, yardUpcharge } from "./lead-pricing.mjs";

export const PLAYBOOK_POLICY_VERSION = "lead-playbook-2026-11-20-v2";
export const PLAYBOOK_CLASSIFIER_VERSION = "lead-intents-2026-11-20-v2";
export const INTENTS = Object.freeze(["confirm_yes", "correction", "address_given", "question_price", "question_service_day", "question_what_included", "question_contract", "question_pets_safety", "question_gate_access", "question_payment", "objection_price", "objection_thinking", "objection_competitor", "ready_to_sign_up", "not_interested", "reschedule_timing", "is_this_ai", "stop", "wrong_number", "other"]);
export const STAGES = Object.freeze(["intro_sent", "collect_details", "confirm_details_sent", "details_confirmed", "details_corrected", "quote_sent", "objection", "discount_offered", "ready", "access_questions_sent", "handoff_signup", "closed_won", "closed_lost", "escalated"]);
export const RANGE_SENTENCE = "We provide a range which is based on how much waste is in the yard and how long it takes the technician.";
export const TEMPLATES = Object.freeze({
  intro_form: "Hello, this is Craig with Ohio Pet Waste Pros. I saw that you filled out a quote form on our website. Did you have any questions about our service, or would you like help getting signed up?",
  confirm_details: "Thanks for getting back to me! Just to make sure I have everything right from the form: you have {dogs_phrase}, you're looking for {frequency} service, the yard is {yard_phrase}, and it was last cleaned {last_cleaned_phrase}. Is that all correct?",
  ask_dogs: "I can help with the price. How many dogs use the yard?",
  ask_frequency: "How often would you like cleanup: weekly, twice weekly, bi-weekly, monthly, or a one-time cleanup?",
  ask_yard: "About how large is the area we'd clean? A: up to 1/8 acre; B: over 1/8 to 1/4 acre; C: over 1/4 to 1/2 acre; D: over 1/2 but under 3/4 acre; E: 3/4 acre or larger. You can reply with the letter or acreage.",
  ask_last_cleaned: "When was the yard last thoroughly cleaned? A: within a week; B: about 2 weeks; C: about 3 weeks; D: about 1 month; E: about 2 months; F: 3 to 4 months. If it's been longer or you're not sure, please tell me.",
  ask_address: "What's the address for the service so I can check which day we're already in your area?",
  quote_recurring: "{day_intro}The initial cleanup to get the yard caught up runs ${low} to ${high}. We provide a range which is based on how much waste is in the yard and how long it takes the technician. After that it's ${monthly} a month for {frequency} service. If this all sounds good I can get your account setup and get you on the schedule for {day}.",
  objection_discount: "I understand. It's month to month, so you can cancel anytime. And we can offer you $15 off your first full month of service if you sign up.",
  ready_access: "Great! Please confirm the account name is {name} and the email is {email}. When you're facing the house, which side is the gate we'd use, and where's the trash can so we can double bag and dispose of the waste?",
  ask_signup_name: "What name should Craig use on the account?",
  ask_signup_email: "What email should Craig use for the account?",
  confirm_signup_identity: "Please confirm the account name is {name} and the email is {email}. Is that correct?",
  ask_gate_side: "When you're facing the house, which side is the gate we'd use? If there is no gate, please tell me.",
  ask_trash_location: "Where is the trash can so we can double bag and dispose of the waste?",
  signup_handoff: "Thanks! I'll pass the confirmed account and access details to Craig to complete your Sweep & Go setup. He'll text you when your account and service start are confirmed.",
  property_walk: "Thanks! For yards 3/4 of an acre or larger we like to do a quick property walk before quoting so the price is accurate. Craig will reach out to set that up.",
  is_this_ai: "Good question! These texts use AI and Craig's approved replies. I'll hand this conversation to Craig so he can text you personally.",
});
const FREQ_TEXT = { once_a_week: "weekly", twice_a_week: "twice weekly", every_other_week: "bi-weekly", once_a_month: "monthly", one_time: "one-time" };
const FREQ_LABEL = { once_a_week: "Weekly", twice_a_week: "Twice Weekly", every_other_week: "Biweekly", once_a_month: "Monthly", one_time: "One Time" };
const objections = new Set(["objection_price", "objection_thinking", "objection_competitor"]);
const DOG_WORDS = { no: 0, zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const ascii = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x00-\x7f]/g, " ");
const cleanSlot = (value) => ascii(value).replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const signupExpected = new Set(["signupName", "signupEmail", "signupIdentity", "signupAccess", "gateSide", "trashLocation"]);
const affirmative = (text) => /^(?:yes|yep|yeah|correct|that['\u2019]?s (?:right|correct)|all correct|you got it)(?:[.!\s]*|[,;.!\s]+(?:the )?(?:gate|trash|garbage|bin)\b.*)$/i.test(text);
function understoodConfirmation(message, slots, context) {
  if (/\?/.test(message) || !context.details || !Object.entries(slots).every(([key, value]) => context.details[key] === value)) return false;
  const clauses = message.replace(/^(?:yes|yep|yeah)\b[\s,.!]*/i, "").split(/[.!;]+/).map(value => value.trim()).filter(Boolean);
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
  if (!Object.hasOwn(TEMPLATES, key)) throw new Error("Unapproved playbook template");
  const body = TEMPLATES[key].replace(/\{([a-z_]+)\}/g, (_, name) => {
    if (!Object.hasOwn(slots, name)) throw new Error(`Missing playbook slot: ${name}`);
    const value = cleanSlot(slots[name]);
    return name === "day_intro" && value ? `${value} ` : value;
  });
  if (body.length > 978) throw new Error("Playbook text exceeds SMS limit");
  return formatCustomerSms(body);
}

export function classifyPlaybookRules(text, context = {}) {
  const message = String(text || "").trim().slice(0, 4000), branch = classifyMetaReply(message), slots = {};
  const result = (intent, confidence = 1, reason = "deterministic_rule") => ({ intent, confidence, slots, reason, classifierVersion: PLAYBOOK_CLASSIFIER_VERSION });
  if (branch === "opted_out") return result("stop");
  if (branch === "wrong_number") return result("wrong_number");
  if (branch === "human_help") return result("is_this_ai");
  if (branch === "declined") return result("not_interested");
  if (/\b(?:pay(?:ment)?|billing|bill|refund|charge|credit card|invoice)\b/i.test(message)) return result("question_payment");
  if (/\b(?:expensive|too much|afford|price is high|cost is high|cheaper|lower (?:the )?price|discount)\b/i.test(message)) return result("objection_price");
  if (/\b(?:think about|thinking (?:it )?over|think it over|let (?:me|us) think|need (?:some )?time)\b/i.test(message)) return result("objection_thinking");
  if (/\b(?:comparing|competitor|other compan|another (?:company|quote)|shop around)\w*/i.test(message)) return result("objection_competitor");
  const count = message.match(/\b(?:(?:actually|have|has|for|with)\s+)?(\d{1,2}|no|zero|none|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+dogs?\b/i);
  if (count) { const word = count[1].toLowerCase(); slots.dogs = Object.hasOwn(DOG_WORDS, word) ? DOG_WORDS[word] : Number(word); }
  if (context.expected === "dogs" && /^(?:\d{1,2}|no|zero|none|one|two|three|four|five|six|seven|eight|nine|ten)[.!\s]*$/i.test(message)) {
    const word = message.toLowerCase().replace(/[.!\s]+$/g, "");
    slots.dogs = Object.hasOwn(DOG_WORDS, word) ? DOG_WORDS[word] : Number(word);
  }
  const freqMatch = message.match(/\b(twice (?:a week|weekly)|every other week|bi[- ]?weekly|once a month|monthly|once a week|weekly|one[- ]time)\b/i);
  if (freqMatch) slots.frequency = frequencyId(metaFrequency(freqMatch[1].replace("-", " ")));
  const cleanup = metaCleanupAnswer(message, context.expected === "lastCleaned");
  if (cleanup) slots.lastCleaned = cleanup.id;
  // Calendar references only resolve against an explicit processing date. A bare
  // day of month is never interpreted against the server's current month.
  const calendar = message.match(/\bcleaned (?:on )?(?:the )?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (calendar && context.now) {
    const now = new Date(context.now), local = new Date(now.getFullYear(), now.getMonth(), Number(calendar[1]));
    if (local > now) local.setMonth(local.getMonth() - 1);
    const days = Math.floor((now - local) / 86400000);
    if (days >= 0 && days <= 120) slots.lastCleaned = days <= 7 ? "one_week" : days <= 14 ? "two_weeks" : days <= 21 ? "three_weeks" : days <= 31 ? "one_month" : days <= 62 ? "two_months" : "3_4_months";
  }
  if (context.expected === "yardTier" && /^[a-e]$/i.test(message)) {
    slots.yardTier = ["tiny", "small", "medium", "large", "xlarge"][message.toLowerCase().charCodeAt(0) - 97];
    slots.yardAcres = null;
  }
  const normalizedYard = cleanSlot(message).toLowerCase().replace(/\s*(?:-|\bto\b)\s*/g, " to ").replace(/^over /, "").replace(/\s+/g, " ");
  const labeledYard = YARD_TIERS.find(tier => tier.id !== "unsure" && cleanSlot(tier.label).toLowerCase().replace(/^over /, "") === normalizedYard);
  if (labeledYard) slots.yardTier = labeledYard.id;
  if (/\b(?:3\/4|three[- ]quarters?)\s*(?:of (?:an? )?)?(?:acre)?\s*(?:or (?:larger|more)|and (?:larger|more)|\+)|\b(?:over|larger than|more than)\s+(?:3\/4|three[- ]quarters?)\b/i.test(message)) slots.yardTier = "xlarge";
  const acreage = !labeledYard && !/\bto\b|\d\s*-\s*\d/i.test(message) && message.match(/\b(\d+\s*\/\s*\d+|\d+(?:\.\d+)?|three quarters?|three fourths|half|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of (?:an? )?)?acres?\b/i);
  if (acreage) {
    const raw = acreage[1].toLowerCase(), parts = raw.split("/");
    const acres = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, "three quarter": 0.75, "three quarters": 0.75, "three fourths": 0.75 })[raw] ?? Number(raw);
    if (Number.isFinite(acres) && acres > 0) {
      slots.yardAcres = acres;
      slots.yardTier = acres >= 0.75 ? "xlarge" : acres <= 0.125 ? "tiny" : acres <= 0.25 ? "small" : acres <= 0.5 ? "medium" : "large";
    }
  }
  if (signupExpected.has(context.expected)) {
    const email = message.match(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+\b/i);
    if (email) slots.email = email[0];
    const name = message.match(/\b(?:my name is|the name is|account name is|use the name|name should be)\s+([\p{L}][\p{L}'\u2019 -]{1,79})(?=[,;.!]|$)/iu);
    if (name) slots.name = name[1].trim();
    else if (context.expected === "signupName" && /^[\p{L}][\p{L}'\u2019 -]{1,79}$/u.test(message) && !/^(?:yes|no|correct|thanks|thank you|not sure)$/i.test(message)) slots.name = message;
    if (!/\bfacing (?:the )?(?:street|road|away)\b/i.test(message)) {
      const side = message.match(/\b(?:gate(?: is)?(?: on)?(?: the)?\s+|(?:on )?the\s+)?(left|right)(?:[- ]hand)?(?: side)?\b/i);
      if (side && (/\bgate\b/i.test(message) || ["signupAccess", "gateSide"].includes(context.expected) && /^(?:the |on the )?(?:left|right)(?:[- ]hand)?(?: side)?[.!\s]*$/i.test(message))) slots.gateSide = side[1].toLowerCase();
      if (/\b(?:no gate|isn['\u2019]?t a gate|is not a gate)\b/i.test(message)) slots.gateSide = "no_gate";
    }
    const trash = message.match(/\b(?:trash(?: can| bin)?|garbage(?: can| bin)?|bin)(?: is| are)?(?: located)?\s+((?:at|by|beside|behind|near|on|in|next to)\s+[^.;!?]{2,150})/i);
    if (trash) slots.trashLocation = trash[1].trim();
    else if (context.expected === "trashLocation" && /^(?:at|by|beside|behind|near|on|in|next to)\s+[^.;!?]{2,150}[.!]?$/i.test(message)) slots.trashLocation = message.replace(/[.!]+$/, "");
    if (Object.keys(slots).length && affirmative(message)) return result("confirm_yes");
    if (Object.keys(slots).length) return result("correction", 0.95);
  }
  if (!Object.keys(slots).length && /^\d{1,6}\s+[\p{L}\d .,#'\-]{5,180}$/u.test(message) && /[a-z]/i.test(message)) { slots.address = message; return result("address_given"); }
  if (/\b(?:ready (?:to |for )?(?:sign|start|go)|sign (?:me|us) up|let['’]?s (?:do it|get started)|go ahead|get (?:me|us) (?:started|signed up))\b/i.test(message)) return result("ready_to_sign_up");
  if (/^(?:yes|yep|yeah|correct|that['’]?s (?:right|correct)|you got it)[.!\s]*$/i.test(message)) return result(context.stage === "quote_sent" || context.stage === "discount_offered" ? "ready_to_sign_up" : "confirm_yes");
  if (/^(?:yes|yep|yeah)\b/i.test(message)) {
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
  const text = String(body || ""), violations = [];
  if (/[\u2013\u2014]/.test(text)) violations.push("forbidden_dash");
  if (/[^\x00-\x7f]/.test(text)) violations.push("non_ascii_sms");
  if (!text.endsWith("\n\nReply STOP to opt out")) violations.push("missing_stop_footer");
  if (text.length > 1000 || !text.replace(/\s*Reply STOP to opt out\s*$/, "").trim()) violations.push("invalid_length");
  if (/\$\s*15\b/.test(text) && !objections.has(intent)) violations.push("discount_outside_objection");
  if (/\$\s*15\b/.test(text) && state.discount_offered) violations.push("discount_already_offered");
  if ([...text.matchAll(/\$\s*15\b/g)].length > 1) violations.push("discount_repeated_in_text");
  const quote = templateKey === "quote_recurring" || /\binitial cleanup\b/i.test(text) && /\$/.test(text);
  if (/\$\s*\d/.test(text) && !quote && !(objections.has(intent) && /\$\s*15\b/.test(text) && !/\$\s*(?!15\b)\d/.test(text))) violations.push("unapproved_price_text");
  if (quote) {
    if (!state.details_confirmed) violations.push("quote_before_confirmation");
    if (!text.includes(RANGE_SENTENCE)) violations.push("missing_range_sentence");
    if (!slots.day || !text.includes(`If this all sounds good I can get your account setup and get you on the schedule for ${slots.day}.`)) violations.push("unresolved_or_changed_quote_closing");
    const range = initialRange(slots.dogs, slots.lastCleaned), amount = monthly(slots.frequencyId || slots.frequency, slots.dogs), upcharge = yardUpcharge(slots.yardTier);
    if (!range || amount === null || upcharge === null || Number(slots.low) !== range[0] || Number(slots.high) !== range[1] || Number(slots.monthly) !== amount + upcharge) violations.push("price_disagrees_with_grid");
    const prices = [...text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replaceAll(",", "")));
    if (JSON.stringify(prices) !== JSON.stringify([Number(slots.low), Number(slots.high), Number(slots.monthly)]) || !text.includes(`The initial cleanup to get the yard caught up runs $${slots.low} to $${slots.high}.`) || !text.includes(`After that it's $${slots.monthly} a month for ${slots.frequency} service.`)) violations.push("quote_text_price_mismatch");
    if (/\$\s*15\b/.test(text)) violations.push("discount_in_quote");
  }
  if ((/\b(?:on|for|this|next) (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text) || /\b(?:start|come|visit|schedule|available|get you).{0,50}\b(?:tomorrow|today|next week|\d{1,2}\/\d{1,2})\b/i.test(text)) && !slots.day) violations.push("unverified_day_promise");
  return [...new Set(violations)];
}

export function leadPlaybookDetails(lead = {}, state = {}) {
  let payload = lead.payload || {};
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  const raw = { ...payload, ...(payload.quote_context || {}), ...(payload.lead_workspace?.intake || {}), ...(lead.lead_workspace?.intake || {}), ...lead, ...(state.details || {}) };
  const dogs = raw.dogs ?? raw.number_of_dogs;
  const yardAnswer = raw.yard_size_answer ? classifyPlaybookRules(raw.yard_size_answer, { expected: "yardTier" }).slots : {};
  const cleanedAnswer = raw.last_cleaned_answer ? metaCleanupAnswer(raw.last_cleaned_answer, true) : null;
  const yardAcres = raw.yardAcres !== undefined ? raw.yardAcres : raw.yard_acres ?? yardAnswer.yardAcres;
  return { dogs: dogs === undefined || dogs === null || dogs === "" ? null : Number(dogs), frequency: frequencyId(raw.frequency || raw.clean_up_frequency), yardTier: yardTierId(raw.yardTier || raw.yard_size_tier || raw.yardSize || raw.yard_size || yardAnswer.yardTier), yardAcres, lastCleaned: raw.lastCleaned || raw.last_cleaned || cleanedAnswer?.id, address: raw.address || raw.street_address || "", city: raw.city || "", zip: raw.zip || "", name: raw.name || [raw.first_name || raw.firstName, raw.last_name || raw.lastName].filter(Boolean).join(" "), email: raw.email || "", gateSide: raw.gateSide || "", trashLocation: raw.trashLocation || "" };
}
export function confirmedPlaybookRoute(route, details) {
  const days = route?.approvedDays || (route?.day ? [route.day] : []);
  const allowed = allowedOperationalDays({ city: details.city, zip: details.zip, frequency: FREQ_LABEL[details.frequency] });
  return days.length === 1 && (route.confirmed === true || Boolean(route.auditedBy)) && allowed.includes(days[0]) ? days[0] : null;
}

// Produces a proposal only. The caller atomically persists state when its draft is sent.
export function nextPlaybookResponse({ conversation = {}, state = {}, lead = {}, text = "", classification, route, approvedAnswers = [], suppressed = false } = {}) {
  const currentStage = state.stage || "intro_sent", previousDetails = leadPlaybookDetails(lead, state);
  const classified = classification || classifyPlaybookRules(text, { stage: currentStage, expected: state.expected, details: previousDetails });
  const intent = INTENTS.includes(classified.intent) ? classified.intent : "other", confidence = Number(classified.confidence) || 0;
  const details = { ...previousDetails, ...(classified.slots || {}) };
  const next = { ...state, stage: currentStage, details, turns: Number(state.turns || 0) + 1 };
  const base = { intent, confidence, slots: { ...details }, pricingVersion: PRICING_VERSION, policyVersion: PLAYBOOK_POLICY_VERSION, templateKey: null, body: "", escalate: false, reason: "", state: next };
  const stop = (reason, escalate = false) => ({ ...base, escalate, reason, state: { ...next, ...(escalate ? { stage: "escalated", escalation_reason: reason } : {}) } });
  const draft = (key, stage, extra = {}, escalate = false, reason = "approved_template") => {
    const slots = { ...details, ...extra }, body = renderPlaybookTemplate(key, slots);
    const violations = lintPlaybookText(body, { intent, templateKey: key, state, slots });
    if (violations.length) return stop(violations.join(","), true);
    return { ...base, slots, body, templateKey: key, escalate, reason, state: { ...next, stage, ...(key === "objection_discount" ? { discount_offered: true } : {}), ...(escalate ? { escalation_reason: reason } : {}) } };
  };
  if (suppressed || intent === "stop" || intent === "wrong_number") return stop(suppressed ? "suppressed" : intent);
  if (conversation.owner !== "backend") return stop(`owner_${conversation.owner || "unknown"}`);
  if (["closed_won", "closed_lost", "escalated", "handoff_signup"].includes(currentStage)) return stop("thread_not_active");
  if (next.turns > 20) return stop("conversation_turn_limit", true);
  if (intent === "is_this_ai") return draft("is_this_ai", "escalated", {}, true, "identity_question");
  if (lead.existing_customer || lead.is_existing_customer) return stop("existing_customer", true);
  const existingServiceClaim = /\b(?:(?:my|our) (?:service|account|invoice|payment)|last (?:service|visit)|pause|skip|reschedule|moving|move out|missed|did(?:n't| not) (?:come|show))\b/i.test(text);
  const prospectiveQuestion = ["question_what_included", "question_contract", "question_pets_safety", "question_gate_access"].includes(intent) && !existingServiceClaim;
  const suppliedSignupDetails = currentStage === "access_questions_sent" && Object.keys(classified.slots || {}).some(key => ["gateSide", "trashLocation", "name", "email"].includes(key)) && !existingServiceClaim;
  if ((looksLikeCustomerServiceText(text) && !prospectiveQuestion && !suppliedSignupDetails) || /\b(?:missed (?:my|our|a) (?:yard|service|visit)|complaint|terrible|angry|pissed|fuck|shit|damn|refund|billing|invoice|charged|payment)\b/i.test(text)) return stop("service_billing_or_anger", true);
  if (details.zip && !PRICING.serviceZips.includes(String(details.zip).slice(0, 5))) return stop("outside_service_area", true);
  if (details.yardTier === "xlarge" || details.yardTier === "E" || Number(details.yardAcres) >= 0.75) return draft("property_walk", "escalated", {}, true, "property_walk");
  if (details.dogs !== null && (!Number.isInteger(Number(details.dogs)) || Number(details.dogs) >= 8 || Number(details.dogs) < 1) || details.dogs !== null && details.lastCleaned && !initialRange(details.dogs, details.lastCleaned)) return stop("custom_pricing", true);
  if (intent === "other" || confidence < 0.8) return stop("intent_needs_review", true);
  if (intent === "question_payment" || intent === "reschedule_timing") return stop(intent, true);
  if (intent === "not_interested") return { ...stop("not_interested"), state: { ...next, stage: "closed_lost" } };
  if (objections.has(intent)) {
    if (!state.details_confirmed || !["quote_sent", "objection", "discount_offered"].includes(currentStage)) return stop("objection_before_quote", true);
    if (state.discount_offered) return stop("second_objection", true);
    return draft("objection_discount", "discount_offered");
  }
  const quoteDetailsChanged = ["dogs", "frequency", "yardTier", "yardAcres", "lastCleaned", "address", "city", "zip"].some(key => Object.hasOwn(classified.slots || {}, key) && details[key] !== previousDetails[key]);
  const pricingDetailsChanged = ["dogs", "frequency", "yardTier", "yardAcres", "lastCleaned"].some(key => Object.hasOwn(classified.slots || {}, key) && details[key] !== previousDetails[key]);
  if (pricingDetailsChanged) return confirmation();
  if (currentStage === "access_questions_sent" && quoteDetailsChanged) return confirmation();
  if (currentStage === "access_questions_sent" && ["confirm_yes", "correction", "ready_to_sign_up"].includes(intent)) return signup();
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
    return draft("confirm_details", "confirm_details_sent", { dogs_phrase: `${details.dogs} ${details.dogs === 1 ? "dog" : "dogs"}`, frequency: FREQ_TEXT[details.frequency], yard_phrase: yard.toLowerCase(), last_cleaned_phrase: cleaned.toLowerCase().replace(/(\d)-(\d)/g, "$1 to $2") });
  }
  function signup() {
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
    const range = initialRange(details.dogs, details.lastCleaned), amount = monthly(details.frequency, details.dogs), upcharge = yardUpcharge(details.yardTier);
    if (!range || amount === null || upcharge === null || details.frequency === "one_time") return stop("custom_pricing", true);
    const slots = { low: range[0], high: range[1], monthly: amount + upcharge, frequencyId: details.frequency, frequency: FREQ_TEXT[details.frequency], day: route.dayPhrase || day, day_intro: route.dayIntro || "" };
    // Quote validation reads the confirmation resulting from this inbound turn.
    const quoted = { ...state, details_confirmed: true };
    const body = renderPlaybookTemplate("quote_recurring", { ...details, ...slots });
    const violations = lintPlaybookText(body, { intent, templateKey: "quote_recurring", state: quoted, slots: { ...details, ...slots } });
    return violations.length ? stop(violations.join(","), true) : { ...base, body, templateKey: "quote_recurring", slots: { ...details, ...slots }, reason: "confirmed_details_and_route", state: { ...next, expected: "quoteAcceptance", stage: "quote_sent", quote: { ...slots, pricingVersion: PRICING_VERSION } } };
  }
  return stop("unexpected_state_intent", true);
}
