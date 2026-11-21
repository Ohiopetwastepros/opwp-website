import { PRICING, YARD_TIERS, calcLocalQuote, formatCleanupRange } from "../app/free-quote/pricing.js";
import { buildMetaConfirmation, classifyMetaReply, exactDogs, metaFrequency, metaServiceArea } from "./meta-lead-policy.mjs";
import { CRAIG_TEMPLATES, CRAIG_RANGE_SENTENCE, buildCraigDraftContext, renderCraigReply, validateCraigReply } from './craig-voice.mjs';
import {formatCustomerSms} from './customer-sms.mjs';
import {parseNaturalPlaybookReply} from './lead-playbook-natural-replies.mjs';

export const META_CADENCE_VERSION = "meta-nurture-1-3-7-v1";
export const META_RESPONSES = {
  dogs: CRAIG_TEMPLATES.ask_dogs,
  zip: "What's the ZIP code for the yard?",
  frequency: CRAIG_TEMPLATES.ask_frequency,
  yard: CRAIG_TEMPLATES.ask_yard,
  cleaned: CRAIG_TEMPLATES.ask_last_cleaned,
  custom_cleanup: "No problem, I'll review a custom quote for that cleanup before we confirm anything.",
  address: CRAIG_TEMPLATES.ask_address,
  delayed_start: "No problem at all. When were you hoping to start?",
  buildup: "No problem, thank you for letting me know. I'll check the initial cleanup so I can give you an accurate price.",
  handoff: CRAIG_TEMPLATES.detail_hold,
  human_help: CRAIG_TEMPLATES.is_this_ai,
  route_review: "Thank you! I'll check the route and confirm the service day with you. No day is booked yet.",
};

const FREQ = { Weekly: "once_a_week", Biweekly: "every_other_week", "Twice Weekly": "twice_a_week", Monthly: "once_a_month", "One Time": "one_time" };
const dollars = (amount) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
function craigCopy(body, step) {
  const context = buildCraigDraftContext({step});
  const formatted = formatCustomerSms(body);
  const violations = validateCraigReply(formatted, context.outputPolicy);
  if (violations.length) throw new Error('Meta reply copy: ' + violations.join(', '));
  return formatted;
}

export function metaCleanupAnswer(text, allowChoice = false) {
  const raw = String(text || "").trim().slice(0, 500);
  const normalized = raw.toLowerCase().replace(/[.!]+$/g, "").replace(/[\u2013\u2014]/g, "-")
    .replace(/^(?:actually[, ]*|correction[: ]*)/, "")
    .replace(/^(?:(?:it was|it has been|it's been|its been|last (?:thoroughly )?cleaned|the yard was last (?:thoroughly )?cleaned)\s+)/, "")
    .replace(/\s+ago$/, "").trim();
  const choices = ["one_week", "two_weeks", "three_weeks", "one_month", "two_months", "3_4_months"];
  if (allowChoice && /^[a-f]$/.test(normalized)) return { id: choices[normalized.charCodeAt(0) - 97], raw };
  const aliases = [
    ["one_week", /^(?:within (?:a|one|1) week|(?:a|one|1) week|this week|today|yesterday)$/],
    ["two_weeks", /^(?:about )?(?:two|2) weeks$/],
    ["three_weeks", /^(?:about )?(?:three|3) weeks$/],
    ["one_month", /^(?:about )?(?:a|one|1) month$/],
    ["two_months", /^(?:about )?(?:two|2) months$/],
    ["3_4_months", /^(?:three|four|3|4|3\s*-\s*4|three to four) months$/],
  ];
  const match = aliases.find(([, pattern]) => pattern.test(normalized));
  if (match) return { id: match[0], raw };
  if (/^(?:never(?: (?:fully|thoroughly) cleaned)?|not sure|unsure|unknown|i don['’]?t know)$/.test(normalized) || /^(?:(?:about|over|more than|at least) )?(?:\d+(?:\s*(?:-|to)\s*\d+)?|five|six|seven|eight|nine|ten|several|a few) (?:days?|weeks?|months?|years?)$/.test(normalized)) return { id: "custom", raw };
  return null;
}

export function metaWebsiteQuote(details) {
  const dogs = details.number_of_dogs, frequency = FREQ[details.clean_up_frequency];
  const tier = YARD_TIERS.find((item) => item.id === details.yard_size_tier);
  if (!Number.isInteger(dogs) || dogs < 1 || dogs > 7 || !frequency || !tier || tier.id === "unsure" || tier.upcharge === null || !details.last_cleaned || metaServiceArea(details) !== "published_area") return null;
  if (dogs > PRICING.frequencies.find((item) => item.id === frequency)?.maxDogs) return null;
  const history = PRICING.lastCleanedOptions.find((option) => option.id === details.last_cleaned);
  const quote = calcLocalQuote({ dogs, frequency, lastCleaned: details.last_cleaned });
  const range = frequency === "one_time" ? quote.oneTimeRange : quote.initialRange;
  if (!history || !Array.isArray(range) || range.length !== 2 || !range.every((value) => Number.isFinite(value) && value >= 0) || range[1] < range[0]) return null;
  const basis = { source: "app/free-quote/pricing.js", dogs, frequency, lastCleaned: history.id, lastCleanedLabel: history.label, yardTier: tier.id, cleanupRange: [...range] };
  const estimate = formatCleanupRange(range);
  if (frequency === "one_time") return { type: "one_time", range: [...range], basis, text: renderCraigReply('one_timequote', {dogs, low: range[0], high: range[1]}, {verifiedFacts: basis}) };
  const base = quote.monthly;
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(tier.upcharge) || tier.upcharge < 0) return null;
  const monthly = base + tier.upcharge;
  return { type: "recurring", monthly, initialRange: [...range], basis: { ...basis, monthlyBase: base, yardUpcharge: tier.upcharge }, text: craigCopy(`Our rate for ${dogs} ${dogs === 1 ? "dog" : "dogs"} with ${details.clean_up_frequency.toLowerCase()} service is ${dollars(monthly)} per month and optional add-ons are separate; the initial cleanup runs ${estimate}. ${CRAIG_RANGE_SENTENCE} Is that something you might be interested in?`, 'quote') };
}

export function metaCleanupSummary(state = {}) {
  const details = state.details || {};
  const history = PRICING.lastCleanedOptions.find((option) => option.id === details.last_cleaned)?.label;
  const quote = state.quote;
  const range = quote?.initialRange || quote?.range;
  const estimate = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) ? `${formatCleanupRange(range)} (${quote.type === "one_time" ? "one-time cleanup" : "initial cleanup"})` : state.handoff ? "Custom quote / Craig review required" : "Pending required answers";
  return `Last thorough cleanup: ${history || (details.last_cleaned === "custom" ? "Outside chart / unknown" : "Not confirmed")}\nCustomer's cleanup answer: ${String(details.last_cleaned_answer || "Not recorded").slice(0, 500)}\nCleanup estimate: ${estimate}${quote?.basis ? `\nPricing source: ${quote.basis.source}; ${quote.basis.dogs} dogs; ${quote.basis.lastCleanedLabel}` : ""}`;
}

// Deterministic extraction accepts explicit, bounded answers. Unclear prose goes to Craig.
export function nextMetaResponse({ lead, state = {}, text, confirmationSent = false, staticAnswer = null }) {
  const message = String(text || "").trim();
  const branch = classifyMetaReply(message);
  const details = { number_of_dogs: lead.number_of_dogs, zip: lead.zip, city: lead.city, clean_up_frequency: lead.clean_up_frequency, ...(state.details || {}) };
  const next = { ...state, details, branch, turns: (state.turns || 0) + 1 };
  const expected = state.expected === "human_offer" ? state.human_offer_expected || "" : state.expected || "";
  let quoteInvalidated = false;
  const resetQuote = () => { quoteInvalidated = true; next.quote = null; next.quote_accepted = false; next.ready_for_route_audit = false; };
  const finish = (response, expected = "", handoff = false, routeReady = false) => ({ state: { ...next, expected, handoff, ready_for_route_audit: handoff ? routeReady : Boolean(next.ready_for_route_audit) }, response: response ? craigCopy(response, expected === 'yard' ? 'yard_size' : expected === 'cleaned' ? 'last_cleaned' : expected === 'dogs' ? 'dogs' : expected === 'frequency' ? 'frequency' : expected === 'quote_acceptance' ? 'quote' : expected === 'confirm' ? 'confirm_details' : 'booking') : '', branch, handoff });
  if (["opted_out", "wrong_number", "channel_change", "declined"].includes(branch)) { next.ready_for_route_audit = false; return finish("", "", true); }
  if (state.human_requested) return finish("", "", true);
  if (!(state.handoff && !state.ready_for_route_audit) && state.expected === "human_offer" && (branch === "confirmed" || /^(?:yes[, ]+please|sure|please do|(?:yes[, ]+)?(?:please )?text me personally)[.!\s]*$/i.test(message))) {
    delete next.human_offer_expected;
    next.human_requested = true;
    return finish("", "", true);
  }
  if (next.turns > 16) return finish("", "", true);
  const naturalExpected = {yard:'yardTier',yard_map_address:'yardMapAddress',yard_measurement:'yardMeasurement',cleaned:'lastCleaned',dogs:'dogs',frequency:'frequency',zip:'zip',address:'address'}[expected];
  const natural = parseNaturalPlaybookReply(message, {expected:naturalExpected,stage:expected==='confirm'?'confirm_details_sent':'collect_details'});
  const naturalYard = ['yard','yard_map_address','yard_measurement'].includes(expected);
  const naturalDetail = naturalYard && (natural.yardStatus || natural.slots.yardTier || natural.slots.address) || expected==='cleaned' && (natural.lastCleanedStatus || natural.slots.lastCleaned);
  const activeDetail = (!state.handoff || state.ready_for_route_audit) && branch!=='human_help';
  if (["delayed_start", "buildup"].includes(branch) && !(activeDetail && naturalDetail)) { resetQuote(); return finish(META_RESPONSES[branch], "", true); }
  const legacyCleanup = metaCleanupAnswer(message, expected === "cleaned");
  const boundedWeeks = /\b\d+\s*(?:-|to)\s*\d+\s+weeks?\b/i.test(message);
  const cleanupAnswer = natural.slots.lastCleaned && (!legacyCleanup || legacyCleanup.id!=='custom' || boundedWeeks) ? {id:natural.slots.lastCleaned,raw:message.slice(0,500)} : legacyCleanup;
  if (cleanupAnswer) {
    details.last_cleaned = cleanupAnswer.id;
    details.last_cleaned_answer = cleanupAnswer.raw;
    if (cleanupAnswer.id !== state.details?.last_cleaned) resetQuote();
  }
  if (state.handoff && !state.ready_for_route_audit) return finish("", "", true);
  if (branch === "human_help") {
    next.human_offer_expected = expected;
    return finish(META_RESPONSES.human_help, "human_offer");
  }
  delete next.human_offer_expected;
  function clarify(field, key) {
    resetQuote();
    const counts={...(state.clarification_counts||{})};next.clarification_counts=counts;
    if (next.detail_hold_pending===field) return finish('',field);
    if (Number(counts[field]||0)>=1) {next.detail_hold_pending=field;return finish(renderCraigReply('detail_hold'),field);}
    counts[field]=1;
    return finish(renderCraigReply(key),field);
  }
  if (naturalYard && natural.yardStatus==='address') {
    details.address=natural.slots.address;next.map_measurement_pending=true;resetQuote();
    return finish(renderCraigReply('map_measurement_hold'),'yard_measurement');
  }
  if (naturalYard && !natural.slots.yardTier && (branch!=='question' || natural.yardStatus)) {
    if (expected==='yard_measurement' && state.map_measurement_pending) return finish('','yard_measurement');
    if (natural.yardStatus==='unsure' || expected==='yard_map_address') {
      resetQuote();
      if (expected==='yard_map_address') return finish('','yard_map_address');
      return finish(renderCraigReply('ask_map_address'),'yard_map_address');
    }
    const counts=state.clarification_counts||{};
    if (Number(counts.yard||0)>=1) {resetQuote();return finish(renderCraigReply('ask_map_address'),'yard_map_address');}
    return clarify('yard','clarify_yard');
  }
  if (expected==='cleaned' && (natural.lastCleanedStatus==='ambiguous' || !cleanupAnswer && !['confirmed','question'].includes(branch))) return clarify('cleaned','clarify_last_cleaned');
  if (expected==='dogs' && natural.dogsStatus==='ambiguous') return clarify('dogs','clarify_dogs');
  if (expected==='frequency' && natural.reason==='frequency_ambiguous') return clarify('frequency','clarify_frequency');
  if (cleanupAnswer?.id === "custom") { resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true); }
  if (branch === "question") {
    if (/\b(?:price|pricing|cost|quote|how much)\b/i.test(message)) {
      const priced = state.details_confirmed ? metaWebsiteQuote(details) : null;
      if (priced) { next.quote = priced; next.quote_accepted = false; next.ready_for_route_audit = false; return finish(priced.text, "quote_acceptance", priced.type === "one_time"); }
      const missing = !details.number_of_dogs ? "dogs" : !details.zip ? "zip" : !details.clean_up_frequency ? "frequency" : !details.yard_size_tier ? "yard" : !details.last_cleaned ? "cleaned" : "";
      if (missing) return finish(META_RESPONSES[missing], missing);
      resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true);
    }
    return finish(staticAnswer || META_RESPONSES.handoff, expected, !staticAnswer);
  }
  let understood = branch === "confirmed" || Boolean(cleanupAnswer);
  // Multi-field corrections are recorded but never partially applied as if fully understood.
  const naturalDogs=Number.isInteger(natural.slots.dogs)&&natural.slots.dogs>=1&&natural.slots.dogs<=20&&!natural.dogsStatus?natural.slots.dogs:null;
  const dogAnswer = exactDogs(message.replace(/^(?:actually[, ]*|i have |we have )/i, "")) || naturalDogs;
  const zipAnswer = message.match(/^(?:(?:my )?zip(?: code)?(?: is)?[ :]+)?(\d{5})$/i)?.[1] || natural.slots.zip;
  const frequencyAnswer = metaFrequency(message.replace(/^(?:actually[, ]*|i (?:want|need|prefer) )/i, "")) || Object.entries(FREQ).find(([,value])=>value===natural.slots.frequency)?.[0];
  if (dogAnswer && (["dogs", ""].includes(expected) || /dogs?/i.test(message))) { details.number_of_dogs = dogAnswer; understood = true; }
  if (zipAnswer) { details.zip = zipAnswer; details.city = ""; understood = true; }
  if (frequencyAnswer) { details.clean_up_frequency = frequencyAnswer; understood = true; }
  if (dogAnswer || zipAnswer || frequencyAnswer) resetQuote();
  if (naturalYard && natural.slots.yardTier) {
    details.yard_size_tier=natural.slots.yardTier;
    if (natural.slots.yardAcres!==undefined) details.yard_acres=natural.slots.yardAcres;
    next.map_measurement_pending=false;delete next.detail_hold_pending;resetQuote();understood=true;
  }
  if (cleanupAnswer && cleanupAnswer.id!=='custom') delete next.detail_hold_pending;
  if (expected === "yard" && /^[a-e]$/i.test(message)) { details.yard_size_tier = ["tiny", "small", "medium", "large", "xlarge"][message.toLowerCase().charCodeAt(0) - 97]; understood = true; }
  if (expected === "cleaned" && !cleanupAnswer && !dogAnswer && !zipAnswer && !frequencyAnswer) {
    if (branch === "confirmed") return finish(META_RESPONSES.cleaned, "cleaned");
    details.last_cleaned = "custom"; details.last_cleaned_answer = message.slice(0, 500);
    resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true);
  }
  if (expected === "address" && /^\d{1,6}\s+[\p{L}\d .,#'-]{5,180}$/u.test(message)) { details.address = message; understood = true; }
  if (!understood) { resetQuote(); return finish(META_RESPONSES.handoff, "", true); }
  if (metaServiceArea(details) === "outside_published_area" || metaServiceArea(details) === "location_conflict") return finish("I'll check service availability for that location before we quote or schedule.", "", true);
  if (!details.number_of_dogs) return finish(META_RESPONSES.dogs, "dogs");
  if (!details.zip) return finish(META_RESPONSES.zip, "zip");
  if (!details.clean_up_frequency) return finish(META_RESPONSES.frequency, "frequency");
  if (details.number_of_dogs > 7) return finish("Thanks for the exact count. I'll review pricing for more than seven dogs.", "", true);
  if (!state.details_confirmed || dogAnswer || zipAnswer || frequencyAnswer) {
    if (branch === "confirmed" && confirmationSent && !expected) next.details_confirmed = true;
    else if (branch === "confirmed" && expected === "confirm") next.details_confirmed = true;
    else { next.details_confirmed = false; return finish(buildMetaConfirmation({ ...lead, ...details }, { firstMessage: false }).replace(/^Hi(?: [^,]{1,80})?, this is Craig with Ohio Pet Waste Pros\./, "Thanks for clarifying."), "confirm"); }
  }
  if (!details.yard_size_tier) return finish(META_RESPONSES.yard, "yard");
  if (details.yard_size_tier === "xlarge") return finish("I'll put together a custom quote for that yard size.", "", true);
  if (!details.last_cleaned) return finish(META_RESPONSES.cleaned, "cleaned");
  const quote = metaWebsiteQuote(details);
  if (!quote) { resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true); }
  next.quote = quote;
  if (quoteInvalidated || !state.quote || JSON.stringify(state.quote) !== JSON.stringify(quote)) { next.quote_accepted = false; next.ready_for_route_audit = false; return finish(quote.text, "quote_acceptance", quote.type === "one_time"); }
  if (expected === "quote_acceptance" && branch === "confirmed") next.quote_accepted = true;
  if (!next.quote_accepted) return finish("Would you like to move forward with this cleanup?", "quote_acceptance");
  if (!details.address) return finish(META_RESPONSES.address, "address");
  next.ready_for_route_audit = true;
  return finish(META_RESPONSES.route_review, "", true, true);
}

export function metaFollowUpDrafts(name = "") {
  const first = String(name || "").trim().split(/\s+/)[0];
  const safeName = /^[\p{L}][\p{L}'’-]{0,39}$/u.test(first) ? first.replace(/\u2019/g, "'") : "";
  return [
    { step: 1, day: 1, body: renderCraigReply('follow_up_1', {name: safeName}) },
    { step: 2, day: 3, body: renderCraigReply('follow_up_2', {name: safeName}) },
    { step: 3, day: 7, body: renderCraigReply('follow_up_3') },
  ];
}
