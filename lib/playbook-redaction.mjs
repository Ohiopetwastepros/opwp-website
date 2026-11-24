// Keep unsolicited credentials out of lead records and staff channels. Access
// instructions, unlike card details, remain on the private original inbound.
export function redactInboundPaymentDetails(value) {
  return String(value ?? '').slice(0, 4000)
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[payment details removed]')
    .replace(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, '[payment details removed]')
    .replace(/\b((?:(?:credit|debit) card (?:number|details)|card (?:no\.?|number)|cvv2?|cvc2?|csc|expir(?:y|ation)|routing(?: number)?|bank account(?: number)?|account number|ssn|social security(?: number)?))\s*(?:is|are|=|:|#)?\s*(?=[\d*#])[\d*# \/.-]+/gi, '$1 [payment details removed]')
    .replace(/\b((?:card|visa|mastercard|amex|checking|routing|acct)\s*(?:ending in|is|:|#))\s*[\d -]{3,}/gi,'$1 [payment details removed]');
}

export function redactStaffExcerpt(value) {
  const safe = redactInboundPaymentDetails(value);
  // Customers commonly send a gate PIN or security code in a second text.
  // Staff can review the original access instructions in the private thread.
  if (/^\s*[#*]?\d(?:[ -]?\d){2,11}[#*]?[.!]?\s*$/.test(safe)) return '[private details removed]';
  return safe
    .replace(/\b(?:gate|door|garage|lockbox|keypad|access|alarm|entry|lock) (?:code|pin|password|combination|key)\b[^.!?\n]*/gi, '[access details removed]')
    .replace(/\b(?:code|pin|combination|password)\s*(?:is|:|=|#|will be)\s*[^.!?\n]*/gi, '[access details removed]')
    .replace(/\b(?:key|lockbox) (?:is |sits |will be )?(?:under|behind|inside|by|in|near|beside)\b[^.!?\n]*/gi, '[access details removed]')
    .replace(/\b(?:\d{3}[- ]\d{2}[- ]\d{4}|\d{9})\b/g, '[private details removed]');
}

// Deliberately conservative: learning text never needs a customer's identity.
function escapePattern(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function redactPlaybookText(value, { names = [], emails = [], addresses = [], phones = [] } = {}) {
  let body = redactStaffExcerpt(value);
  body = body.replace(/(?:https?:\/\/[^\s/]+)?\/admin\/playbook\/d\/[^\s<>"']+/gi, "[PRIVATE_REVIEW_LINK]");
  names = [...new Set(names.filter(Boolean).flatMap(name => [name, ...String(name).split(/\s+/).filter(part => part.length > 1)]))];
  for (const [values, label] of [[addresses, "ADDRESS"], [emails, "EMAIL"], [phones, "PHONE"], [names, "NAME"]]) {
    for (const item of values.filter(Boolean).sort((a, b) => String(b).length - String(a).length)) {
      body = body.replace(new RegExp(escapePattern(item), "gi"), `[${label}]`);
    }
  }
  body = body.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/(?:\+?1[ .()-]*)?(?:\(?\d{3}\)?[ .()-]*)\d{3}[ .()-]*\d{4}\b/g, "[PHONE]")
    .replace(/\b\d{1,6}\s+(?:(?:[NSEW]\.?|north|south|east|west)\s+)?(?:[\p{L}][\p{L}.'-]*\s+){1,6}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|terrace|trail)\b\.?/giu, "[ADDRESS]")
    .replace(/\b((?:[Mm]eet|[Cc]ontact|[Aa]sk for|[Ss]peak (?:to|with)|[Tt]alk (?:to|with)|[Ff]or|[Ff]rom|[Ww]ith|[Cc]ustomer|[Cc]lient|[Ll]ead)\s+)[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){1,3}\b/gu, "$1[NAME]")
    .replace(/\b((?:[Aa]t|[Aa]ddress(?: is)?|[Ll]ocated at|[Ll]ive at|[Ss]ervice (?:at|address)|[Pp]roperty at)\s*:?\s*)\d{1,6}\s+[\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){0,4}/gu, "$1[ADDRESS]")
    .replace(/(?<![$\w])\d{1,6}(?=\s+(?!(?:dogs?|weeks?|months?|days?|hours?|minutes?|acres?|times?|am|pm)\b)[\p{L}])/giu, "[STREET_NUMBER]")
    .replace(/\b(?:my name is|this is)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/gi, (match, name) => match.replace(name, "[NAME]"))
    .replace(/\b(?:i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, (match, name) => match.replace(name, "[NAME]"))
    .replace(/\b(address\s*(?:is|:)?\s*)\d{1,6}\b/gi, "$1[STREET_NUMBER]")
    .replace(/\b\d{1,6}(?=\s+(?:[NSEW]\.?|north|south|east|west)\s+[a-z])/gi, "[STREET_NUMBER]")
    .replace(/\b(?:Hi|Hello|Hey|Thanks|Thank you),?\s+[A-Z][a-z]+\b/g, match => match.replace(/[A-Z][a-z]+$/, "[NAME]"));
  // Unrecognized street numbers and long numeric identifiers are not useful prose.
  return body.replace(/(?<![$\w])\d{3,}(?!\w)/g, "[NUMBER]");
}

export function redactPlaybookSlots(slots = {}) {
  return Object.fromEntries(Object.entries(slots).filter(([key]) => !/name|email|address|phone|handle|psid/i.test(key)).map(([key, value]) => [key, typeof value === "string" ? redactPlaybookText(value) : value]));
}

export async function hashExternalRef(value, secret) {
  if (!secret || String(secret).length < 32) throw new Error("A private learning hash key of at least 32 characters is required.");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
