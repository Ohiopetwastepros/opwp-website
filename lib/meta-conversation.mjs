import { PRICING, YARD_TIERS } from "../app/free-quote/pricing.js";
import { buildMetaConfirmation, classifyMetaReply, exactDogs, metaFrequency, metaServiceArea } from "./meta-lead-policy.mjs";

export const META_CADENCE_VERSION = "meta-nurture-1-3-7-v1";
export const META_RESPONSES = {
  dogs: "How many dogs exactly should we plan for? Please reply with the exact number, including any dogs covered by this cleanup.",
  zip: "What is the five-digit ZIP code for the yard?",
  frequency: "Would you like weekly, every-other-week, twice-weekly, monthly, or one-time cleanup?",
  yard: "How large is the area we would clean? Reply A: up to 1/8 acre; B: 1/8–1/4 acre; C: 1/4–1/2 acre; D: 1/2–3/4 acre; E: larger; or unsure.",
  cleaned: "How long has it been since the entire cleanup area was last thoroughly cleared of dog waste? Reply A: within a week; B: about 2 weeks; C: about 3 weeks; D: about 1 month; E: about 2 months; F: 3–4 months; or tell us if longer, never fully cleaned, or unsure. Anything outside the pricing chart needs a custom quote.",
  custom_cleanup: "That cleanup history or service combination is outside the pricing chart. Craig will review a custom quote for the cleanup before we confirm a price or signup.",
  address: "What is the service street address and city? Craig will audit the route before we confirm a service day.",
  delayed_start: "Thanks for letting me know. When would you like to start, and are any puppies changing when you will need cleanup? I will flag the timing for Craig.",
  buildup: "Thanks for explaining the buildup. Craig will review the initial cleanup separately so we can confirm the scope before giving a final price.",
  handoff: "I will flag that for Craig to review so we can give you an accurate answer.",
  route_review: "Thanks! Craig will audit the current route before we confirm your service day. No day is booked yet.",
};

const FREQ = { Weekly: "once_a_week", Biweekly: "every_other_week", "Twice Weekly": "twice_a_week", Monthly: "once_a_month", "One Time": "one_time" };
const dollars = (amount) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function metaCleanupAnswer(text, allowChoice = false) {
  const raw = String(text || "").trim().slice(0, 500);
  const normalized = raw.toLowerCase().replace(/[.!]+$/g, "").replace(/[–—]/g, "-")
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
  const range = (frequency === "one_time" ? PRICING.oneTimeCleanup : PRICING.initialCleanup)[details.last_cleaned]?.[dogs];
  if (!history || !Array.isArray(range) || range.length !== 2 || !range.every((value) => Number.isFinite(value) && value >= 0) || range[1] < range[0]) return null;
  const basis = { source: "app/free-quote/pricing.js", dogs, frequency, lastCleaned: history.id, lastCleanedLabel: history.label, yardTier: tier.id, cleanupRange: [...range] };
  const historyText = `${history.label.toLowerCase()} since the last thorough cleanup`;
  if (frequency === "one_time") return { type: "one_time", range: [...range], basis, text: `For ${dogs} ${dogs === 1 ? "dog" : "dogs"} and ${historyText}, the pricing-chart estimate for your one-time cleanup is ${range.map(dollars).join("–")}. The exact price is confirmed after we see the yard; Craig will review the scope and scheduling.` };
  const base = PRICING.monthly[frequency]?.[dogs];
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(tier.upcharge) || tier.upcharge < 0) return null;
  const monthly = base + tier.upcharge;
  return { type: "recurring", monthly, initialRange: [...range], basis: { ...basis, monthlyBase: base, yardUpcharge: tier.upcharge }, text: `For ${dogs} ${dogs === 1 ? "dog" : "dogs"} with ${details.clean_up_frequency.toLowerCase()} cleanup and the yard size you selected, service is ${dollars(monthly)} per month. With ${historyText}, the pricing-chart estimate for the separate initial cleanup is ${range.map(dollars).join("–")}; the exact cleanup price is confirmed after we see the yard. Optional add-ons are separate. Would you like to move forward?` };
}

export function metaCleanupSummary(state = {}) {
  const details = state.details || {};
  const history = PRICING.lastCleanedOptions.find((option) => option.id === details.last_cleaned)?.label;
  const quote = state.quote;
  const range = quote?.initialRange || quote?.range;
  const estimate = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) ? `${range.map(dollars).join("–")} (${quote.type === "one_time" ? "one-time cleanup" : "initial cleanup"}; estimate, exact price after inspection)` : state.handoff ? "Custom quote / Craig review required" : "Pending required answers";
  return `Last thorough cleanup: ${history || (details.last_cleaned === "custom" ? "Outside chart / unknown" : "Not confirmed")}\nCustomer's cleanup answer: ${String(details.last_cleaned_answer || "Not recorded").slice(0, 500)}\nCleanup estimate: ${estimate}${quote?.basis ? `\nPricing source: ${quote.basis.source}; ${quote.basis.dogs} dogs; ${quote.basis.lastCleanedLabel}` : ""}`;
}

// Deterministic extraction accepts explicit, bounded answers. Unclear prose goes to Craig.
export function nextMetaResponse({ lead, state = {}, text, confirmationSent = false, staticAnswer = null }) {
  const message = String(text || "").trim();
  const branch = classifyMetaReply(message);
  const details = { number_of_dogs: lead.number_of_dogs, zip: lead.zip, city: lead.city, clean_up_frequency: lead.clean_up_frequency, ...(state.details || {}) };
  const next = { ...state, details, branch, turns: (state.turns || 0) + 1 };
  let quoteInvalidated = false;
  const resetQuote = () => { quoteInvalidated = true; next.quote = null; next.quote_accepted = false; next.ready_for_route_audit = false; };
  const finish = (response, expected = "", handoff = false, routeReady = false) => ({ state: { ...next, expected, handoff, ready_for_route_audit: handoff ? routeReady : Boolean(next.ready_for_route_audit) }, response, branch, handoff });
  if (["opted_out", "wrong_number", "channel_change", "declined"].includes(branch)) { next.ready_for_route_audit = false; return finish("", "", true); }
  if (next.turns > 16) return finish("", "", true);
  if (["delayed_start", "buildup"].includes(branch)) { resetQuote(); return finish(META_RESPONSES[branch], "", true); }
  const cleanupAnswer = metaCleanupAnswer(message, state.expected === "cleaned");
  if (cleanupAnswer) {
    details.last_cleaned = cleanupAnswer.id;
    details.last_cleaned_answer = cleanupAnswer.raw;
    if (cleanupAnswer.id !== state.details?.last_cleaned) resetQuote();
  }
  if (state.handoff && !state.ready_for_route_audit) return finish("", "", true);
  if (cleanupAnswer?.id === "custom") { resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true); }
  if (branch === "question") {
    if (/\b(?:price|pricing|cost|quote|how much)\b/i.test(message)) {
      const priced = state.details_confirmed ? metaWebsiteQuote(details) : null;
      if (priced) { next.quote = priced; next.quote_accepted = false; next.ready_for_route_audit = false; return finish(priced.text, "quote_acceptance", priced.type === "one_time"); }
      const missing = !details.number_of_dogs ? "dogs" : !details.zip ? "zip" : !details.clean_up_frequency ? "frequency" : !details.yard_size_tier ? "yard" : !details.last_cleaned ? "cleaned" : "";
      if (missing) return finish(`I can help with the price. ${META_RESPONSES[missing]}`, missing);
      resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true);
    }
    return finish(staticAnswer || META_RESPONSES.handoff, state.expected || "", !staticAnswer);
  }
  let understood = branch === "confirmed" || Boolean(cleanupAnswer);
  // Multi-field corrections are recorded but never partially applied as if fully understood.
  const dogAnswer = exactDogs(message.replace(/^(?:actually[, ]*|i have |we have )/i, ""));
  const zipAnswer = message.match(/^(?:(?:my )?zip(?: code)?(?: is)?[ :]+)?(\d{5})$/i)?.[1];
  const frequencyAnswer = metaFrequency(message.replace(/^(?:actually[, ]*|i (?:want|need|prefer) )/i, ""));
  if (dogAnswer && (["dogs", ""].includes(state.expected || "") || /dogs?/i.test(message))) { details.number_of_dogs = dogAnswer; understood = true; }
  if (zipAnswer) { details.zip = zipAnswer; details.city = ""; understood = true; }
  if (frequencyAnswer) { details.clean_up_frequency = frequencyAnswer; understood = true; }
  if (dogAnswer || zipAnswer || frequencyAnswer) resetQuote();
  if (state.expected === "yard" && /^[a-e]$/i.test(message)) { details.yard_size_tier = ["tiny", "small", "medium", "large", "xlarge"][message.toLowerCase().charCodeAt(0) - 97]; understood = true; }
  if (state.expected === "cleaned" && !cleanupAnswer && !dogAnswer && !zipAnswer && !frequencyAnswer) {
    if (branch === "confirmed") return finish(META_RESPONSES.cleaned, "cleaned");
    details.last_cleaned = "custom"; details.last_cleaned_answer = message.slice(0, 500);
    resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true);
  }
  if (state.expected === "address" && /^\d{1,6}\s+[\p{L}\d .,#'-]{5,180}$/u.test(message)) { details.address = message; understood = true; }
  if (!understood) { resetQuote(); return finish(META_RESPONSES.handoff, "", true); }
  if (metaServiceArea(details) === "outside_published_area" || metaServiceArea(details) === "location_conflict") return finish("I need Craig to review service availability for that location before we quote or schedule.", "", true);
  if (!details.number_of_dogs) return finish(META_RESPONSES.dogs, "dogs");
  if (!details.zip) return finish(META_RESPONSES.zip, "zip");
  if (!details.clean_up_frequency) return finish(META_RESPONSES.frequency, "frequency");
  if (details.number_of_dogs > 7) return finish("Thanks for the exact count. Craig will review pricing for more than seven dogs.", "", true);
  if (!state.details_confirmed || dogAnswer || zipAnswer || frequencyAnswer) {
    if (branch === "confirmed" && confirmationSent && !state.expected) next.details_confirmed = true;
    else if (branch === "confirmed" && state.expected === "confirm") next.details_confirmed = true;
    else { next.details_confirmed = false; return finish(buildMetaConfirmation({ ...lead, ...details }).replace("Thanks for filling out our Facebook form.", "Thanks for clarifying."), "confirm"); }
  }
  if (!details.yard_size_tier) return finish(META_RESPONSES.yard, "yard");
  if (details.yard_size_tier === "xlarge") return finish("Craig will review a custom quote for that yard size.", "", true);
  if (!details.last_cleaned) return finish(META_RESPONSES.cleaned, "cleaned");
  const quote = metaWebsiteQuote(details);
  if (!quote) { resetQuote(); return finish(META_RESPONSES.custom_cleanup, "", true); }
  next.quote = quote;
  if (quoteInvalidated || !state.quote || JSON.stringify(state.quote) !== JSON.stringify(quote)) { next.quote_accepted = false; next.ready_for_route_audit = false; return finish(quote.text, "quote_acceptance", quote.type === "one_time"); }
  if (state.expected === "quote_acceptance" && branch === "confirmed") next.quote_accepted = true;
  if (!next.quote_accepted) return finish("Would you like to move forward with this cleanup?", "quote_acceptance");
  if (!details.address) return finish(META_RESPONSES.address, "address");
  next.ready_for_route_audit = true;
  return finish(META_RESPONSES.route_review, "", true, true);
}

export function metaFollowUpDrafts(name = "") {
  const first = String(name).trim().split(/\s+/)[0];
  const greeting = /^[\p{L}'’-]{1,40}$/u.test(first) ? `Hi ${first}, ` : "Hi, ";
  return [
    { step: 1, day: 1, body: `${greeting}this is Craig with Ohio Pet Waste Pros, following up on your Facebook form. Did we get your dog count, ZIP and cleanup frequency right? Reply here with any corrections. Reply STOP to opt out.` },
    { step: 2, day: 3, body: `${greeting}checking back about your Facebook cleanup request. Are you looking for recurring service, a one-time cleanup, or a later start? Reply here and we can help with the next step. Reply STOP to opt out.` },
    { step: 3, day: 7, body: `${greeting}I will close the loop on your Facebook cleanup request for now. If you would still like help, reply here and we can pick it back up. Reply STOP to opt out.` },
  ];
}
