import { cities } from "../data/cities.js";
import { isInArea } from "../app/free-quote/pricing.js";

export const META_POLICY_VERSION = "meta-confirmation-v2";
const key = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clean = (value, max = 100) => String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);

export function exactDogs(value) {
  const answer = key(value);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  // Ranges, plus signs, puppies and compound answers always need clarification.
  if (/[+<>]/.test(String(value)) || /\b(or|more|pupp|to|about|over|under)\w*/.test(answer)) return null;
  const match = answer.match(/^(\d{1,2}|one|two|three|four|five|six|seven)(?: dogs?)?$/);
  const count = match ? words[match[1]] || Number(match[1]) : 0;
  return count >= 1 && count <= 20 ? count : null;
}

export function metaFrequency(value) {
  if (["monthly", "once a month", "once per month", "every month"].includes(key(value))) return "Monthly";
  const values = { weekly: "Weekly", "once a week": "Weekly", "once per week": "Weekly", "every week": "Weekly", biweekly: "Biweekly", "bi weekly": "Biweekly", "every other week": "Biweekly", "every two weeks": "Biweekly", "twice weekly": "Twice Weekly", "twice a week": "Twice Weekly", "twice per week": "Twice Weekly", "one time": "One Time", "one time cleanup": "One Time", "just once": "One Time", "single cleanup": "One Time" };
  return values[key(value)] || "";
}

export function mapMetaAnswers(fields) {
  const aliases = {
    dogs: ["number of dogs", "dog count", "how many dogs do you have", "how many dogs"],
    frequency: ["service frequency", "clean up frequency", "cleanup frequency", "frequency", "how often would you like service", "how often do you need service", "how often would you like your yard cleaned"],
    channel: ["contact preference", "preferred contact method", "preferred channel", "how would you prefer to be contacted", "how would you like to be contacted", "how do you prefer to be contacted", "how would you like us to contact you"],
    zip: ["zip", "zip code", "postal code", "what is your zip code", "what s your zip code"],
  };
  function read(type) {
    const matches = Object.entries(fields).filter(([name]) => aliases[type].includes(key(name)));
    const values = [...new Set(matches.map(([, value]) => clean(value, 200)))];
    return { value: values.length === 1 ? values[0] : "", fields: matches.map(([name]) => name), conflict: values.length > 1 };
  }
  const dogs = read("dogs"), frequency = read("frequency"), channel = read("channel"), zip = read("zip");
  const channels = { text: "sms", sms: "sms", "text message": "sms", "prefer text": "sms", email: "email", "prefer email": "email", phone: "phone", call: "phone", "phone call": "phone" };
  return {
    number_of_dogs: exactDogs(dogs.value), clean_up_frequency: metaFrequency(frequency.value),
    preferred_channel: channels[key(channel.value)] || "unknown",
    zip: /^\d{5}(?:-\d{4})?$/.test(zip.value) ? zip.value.slice(0, 5) : "",
    mapping: { version: META_POLICY_VERSION, dogs, frequency, channel, zip },
  };
}

export function metaServiceArea(lead) {
  if (!lead.zip) return "unknown";
  const matches = cities.filter((city) => city.zips.split(",").map((zip) => zip.trim()).includes(lead.zip));
  if (!isInArea(lead.zip)) return "outside_published_area";
  if (lead.city && !matches.some((city) => key(city.city) === key(lead.city))) return "location_conflict";
  return "published_area"; // Published coverage is not a route-capacity or service-day promise.
}

export function metaConsentEvidence(lead, approvedForms = {}) {
  const form = approvedForms?.[lead.meta_form_id];
  const fieldName = form?.consentField;
  const answers = lead.original_fields || {};
  const accepted = ["sms consent", "text message consent", "consent to sms", "text consent"].includes(key(fieldName)) && /^(yes|true|1|i agree|agreed)$/i.test(String(answers[fieldName] || "").trim());
  const suppliedAt = Date.parse(lead.meta_created_time);
  const valid = Boolean(accepted && form?.pageId === lead.meta_page_id && typeof form.disclosure === "string" && form.disclosure.trim() && typeof form.version === "string" && form.version.trim() && Number.isFinite(suppliedAt) && suppliedAt <= Date.now() + 60000);
  return { valid, field: clean(fieldName), answer: clean(answers[fieldName]), disclosure: valid ? clean(form.disclosure, 2000) : "", version: valid ? clean(form.version) : "", capturedAt: valid ? new Date(suppliedAt).toISOString() : "", formId: lead.meta_form_id, pageId: lead.meta_page_id };
}

export function metaReviewReasons(lead) {
  const reasons = [];
  if (!lead.sms_consent_evidence?.valid) reasons.push("consent_unverified");
  if (lead.preferred_channel !== "sms") reasons.push(`channel_${lead.preferred_channel || "unknown"}`);
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(lead.phone || "")) reasons.push("invalid_phone");
  const area = metaServiceArea(lead);
  if (["outside_published_area", "location_conflict"].includes(area)) reasons.push(area);
  return reasons;
}

export function buildMetaConfirmation(lead) {
  const firstName = clean(lead.name, 200).split(/\s+/)[0];
  const safeName = /^[\p{L}][\p{L}'’-]{0,39}$/u.test(firstName) ? firstName : "";
  const facts = [];
  if (lead.number_of_dogs) facts.push(`${lead.number_of_dogs} ${lead.number_of_dogs === 1 ? "dog" : "dogs"}`);
  if (lead.zip) facts.push(`ZIP ${lead.zip}`);
  else if (/^[\p{L} .'-]{2,60}$/u.test(lead.city || "")) facts.push(lead.city);
  if (lead.clean_up_frequency) facts.push(lead.clean_up_frequency === "One Time" ? "a one-time cleanup" : `${lead.clean_up_frequency.toLowerCase()} service`);
  const questions = [];
  if (!lead.number_of_dogs) questions.push("How many dogs exactly should we plan for?");
  if (!lead.zip) questions.push("What ZIP code is the yard in?");
  if (!lead.clean_up_frequency) questions.push("Would you like weekly, every-other-week, twice-weekly, or one-time cleanup?");
  return `Hi${safeName ? ` ${safeName}` : ""}, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form.${facts.length ? ` I have ${facts.join(", ")} for your cleanup. Did I get that right?` : ""}${questions.length ? ` ${questions.join(" ")}` : ""} This is an automated confirmation. Reply STOP to opt out.`;
}

export function classifyMetaReply(text) {
  const message = clean(text, 4000);
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)[.!\s]*$/i.test(message) || /\b(?:stop (?:texting|messaging|contacting)|do not (?:text|contact)|don['’]?t (?:text|contact)|remove (?:me|my number))\b/i.test(message)) return "opted_out";
  if (/\b(?:wrong number|wrong person|not (?:the right|my) number|you have the wrong|no one (?:here|by that name))\b/i.test(message)) return "wrong_number";
  if (/\b(?:not interested|no thanks|do not need|don['’]?t need|no longer need)\b/i.test(message)) return "declined";
  if (/\b(?:prefer email|email (?:me|instead|only)|rather (?:use )?email|call (?:me|instead))\b/i.test(message)) return "channel_change";
  if (/\b(?:pupp(?:y|ies)|next (?:month|year|season)|later|not (?:yet|ready)|wait until|start (?:in|on|after)|in \d+ (?:weeks|months))\b/i.test(message)) return "delayed_start";
  if (/\b(?:one[- ]time|just once|single cleanup|only once)\b/i.test(message)) return "one_time";
  if (/\b(?:buildup|build.up|piled up|months? of|hasn['’]?t been cleaned|long time|lots of (?:poop|waste))\b/i.test(message)) return "buildup";
  if (/^(?:yes|yes please|yep|yeah|correct|that['’]?s (?:right|correct)|you got it)[.!\s]*$/i.test(message)) return "confirmed";
  if (/\b(?:actually|mistake|correction|instead|wrong|\d+ dogs?|weekly|biweekly|zip)\b/i.test(message) || /^\d{5}$/.test(message)) return "correction";
  if (/\?|\b(?:how|what|when|price|cost|quote|day|schedule)\b/i.test(message)) return "question";
  return "needs_review";
}

export function metaReplyAction(branch, lead, confirmationSent) {
  const actions = {
    opted_out: "Opted out. Do not text this number.", wrong_number: "Wrong number. Do not text; verify contact details with Craig.",
    channel_change: "Craig: honor the requested contact channel; no more automated texts.",
    delayed_start: "Craig: confirm desired start date and puppy/service needs before scheduling.",
    one_time: "Craig: confirm one-time scope, yard size and buildup; use the website one-time pricing rules.",
    buildup: "Craig: confirm yard size and existing buildup before quoting the initial cleanup.",
    correction: "Craig: verify the corrected answers in this reply before quoting. Original form retained.",
    question: "Craig: answer using authoritative website pricing and verified route data. Do not promise a price or day without verification.",
    needs_review: "Craig: review this reply and clarify the service request.",
  };
  if (branch !== "confirmed") return actions[branch] || actions.needs_review;
  if (!confirmationSent || !lead.number_of_dogs || !lead.zip || !lead.clean_up_frequency || metaServiceArea(lead) !== "published_area") return "Craig: clarify exact dog count, ZIP and frequency; a yes reply does not fill missing or ambiguous answers.";
  return lead.clean_up_frequency === "One Time" ? actions.one_time : "Craig: details confirmed. Verify yard size, buildup, website price and route availability before sending a quote.";
}

export function metaQuietHours(settings, now = new Date()) {
  if (!settings || !/^\d{2}:\d{2}$/.test(settings.quiet_hours_start || "") || !/^\d{2}:\d{2}$/.test(settings.quiet_hours_end || "")) return true;
  // Meta confirmations always respect at least 8pm–8am local quiet hours.
  try {
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    if (local >= "20:00" || local < "08:00") return true;
    if (!settings.quiet_hours_enabled) return false;
    const start = settings.quiet_hours_start, end = settings.quiet_hours_end;
    if (start === end) return true;
    return start > end ? local >= start || local < end : local >= start && local < end;
  } catch { return true; }
}
