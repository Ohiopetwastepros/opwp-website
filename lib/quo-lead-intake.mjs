import { isStopMessage, normalizePhone, sngClientMatchesPhone } from "./lead-assistant.mjs";

// Admission requires positive buying intent. Unclear texts remain in Quo.
const SOLICITATION = /\b(?:marketing|seo|advertis(?:ing|ements?)|agency|backlinks?|website design|google ranking|yard signs?|free ad setup|fund your ads|home[- ]service leads|connect local homeowners|trusted home service providers|business loan|recruit(?:er|ing))\b|\breply\s+stop\s+to\s+(?:opt\s*out|unsubscribe)\b/i;
const SERVICE_REQUEST = /\b(?:cancel|cancellation|pause|skip|reschedule|invoice|charged|refund|billing issue|payment failed|missed (?:service|visit)|technician|gate code|my account|our account|already (?:a customer|signed up)|current (?:customer|service)|existing (?:customer|service)|change (?:my|our) (?:service|plan)|(?:consider|count|combine).{0,60}(?:one|1) propert(?:y|ies)|(?:insulat|repair|remodel)\w*|chicken coop)\b/i;
const OPERATIONAL = /\b(?:treating|spraying|fertiliz\w*|pesticide|fleas?)\b.{0,50}\b(?:yard|lawn|property)\b|\b(?:have|mailed?|pick(?:ed)? up|drop(?:ped)? off)\b.{0,30}\bcheck\b|\b(?:you|the team) (?:coming|come|arriving)|\b(?:came|coming) (?:today|tomorrow)|\b(?:hiring|job application|looking for work)\b/i;
const SERVICE = /\b(?:poop|pooper scoop(?:er|ing)?|pet waste|dog waste|scooping|yard clean(?:up|ing)|weekly clean(?:up|ing)|biweekly clean(?:up|ing)|one[- ]time clean(?:up|ing)|dog food|extreme dog fuel)\b/i;
const BUYING_INTENT = /\b(?:quote|estimate|pricing|prices?|cost|how much|rates?|interested|looking for|need|would like|want|sign ?up|start|book|schedule|do you (?:offer|service|serve)|can you (?:clean|service|help))\b/i;
const SIGNUP = /\b(?:how (?:do|can) i|what do you need from me to|i (?:want|would like|am ready|['’]m ready) to|i['’]d like to)\s+(?:get )?(?:signed up|sign up|start (?:service|weekly|biweekly)|book (?:a |an )?(?:cleanup|cleaning))\b/i;

export function classifyQuoLeadIntent(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").slice(0, 4000);
  if (isStopMessage(text)) return { eligible: false, reason: "opted_out" };
  if (SOLICITATION.test(text)) return { eligible: false, reason: "solicitation" };
  if (/\b(?:not interested|no thanks|don['’]t need|do not need|stop (?:my |our )?service)\b/i.test(text)) return { eligible: false, reason: "declined_or_cancelling" };
  if (SERVICE_REQUEST.test(text) || OPERATIONAL.test(text)) return { eligible: false, reason: "service_or_unrelated_request" };
  if (SIGNUP.test(text)) return { eligible: true, reason: "explicit_signup" };
  // Keep a quote for an unrelated project from borrowing context from a later sentence.
  if (text.split(/[.!?;]+/).some((sentence) => SERVICE.test(sentence) && BUYING_INTENT.test(sentence))) {
    return { eligible: true, reason: "explicit_service_inquiry" };
  }
  return { eligible: false, reason: "no_clear_sales_intent" };
}

export async function checkQuoCustomerDirectory(phone, loadDirectory) {
  if (!normalizePhone(phone)) throw new Error("Inbound Quo phone number is invalid.");
  const directories = await Promise.all([
    loadDirectory("/api/v1/clients/active"),
    loadDirectory("/api/v1/clients/active_no_subscription"),
  ]);
  if (directories.some((result) => result?.ok && (result.rows || []).some((client) => sngClientMatchesPhone(client, phone)))) return true;
  if (directories.some((result) => !result?.ok || result.complete !== true || !Array.isArray(result.rows))) {
    throw new Error("Customer directory verification is incomplete; Quo intake will retry.");
  }
  return false;
}
