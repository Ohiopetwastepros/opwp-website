import { mapMetaAnswers } from "./meta-lead-policy.mjs";
const encoder = new TextEncoder();

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hexBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

export async function verifyMetaSignature(rawBody, signatureHeader, secret) {
  if (!secret || typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) return false;
  const supplied = hexBytes(signatureHeader.slice(7));
  if (!supplied) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  return constantTimeEqual(expected, supplied);
}

export async function verifyMetaToken(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string" || !supplied || !expected) return false;
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return constantTimeEqual(new Uint8Array(suppliedHash), new Uint8Array(expectedHash));
}

export function metaLeadIds(webhook) {
  const ids = [];
  for (const entry of Array.isArray(webhook?.entry) ? webhook.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      if (change?.field === "leadgen" && typeof value.leadgen_id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.leadgen_id)) {
        ids.push({ leadId: value.leadgen_id, formId: String(value.form_id || "").slice(0, 100), pageId: String(value.page_id || entry.id || "").slice(0, 100), createdTime: Number(value.created_time || 0) });
      }
    }
  }
  return [...new Map(ids.map((event) => [event.leadId, event])).values()].slice(0, 50);
}

function valueMap(fieldData) {
  const result = Object.create(null);
  for (const field of (Array.isArray(fieldData) ? fieldData : []).slice(0, 100)) {
    const name = String(field?.name || "").toLowerCase().slice(0, 100);
    if (!name || !Array.isArray(field.values)) continue;
    const answer = field.values.slice(0, 10).map((value) => String(value || "").slice(0, 1000)).join(", ").slice(0, 1000);
    result[name] = result[name] && result[name] !== answer ? `${result[name]}, ${answer}`.slice(0, 1000) : answer;
  }
  return result;
}

function first(fields, names) {
  for (const name of names) if (fields[name]) return fields[name];
  return "";
}

export function normalizeMetaLead(data, event = {}) {
  const fields = valueMap(data?.field_data);
  const fullName = first(fields, ["full_name", "full name", "name"]);
  const firstName = first(fields, ["first_name", "first name"]);
  const lastName = first(fields, ["last_name", "last name"]);
  const email = first(fields, ["email", "email_address", "email address"]).trim();
  const consentValue = first(fields, ["sms_consent", "sms consent", "text_message_consent", "text message consent", "consent_to_sms", "consent to sms", "text_consent", "text consent"]);
  const consent = /^(yes|true|1|i agree|agreed)$/i.test(consentValue.trim());
  const known = new Set(["full_name", "full name", "name", "first_name", "first name", "last_name", "last name", "email", "email_address", "email address", "phone_number", "phone number", "phone", "zip_code", "zip code", "postal_code", "postal code", "zip", "city", "sms_consent", "sms consent", "text_message_consent", "text message consent", "consent_to_sms", "consent to sms", "text_consent", "text consent"]);
  const customAnswers = Object.fromEntries(Object.entries(fields).filter(([name]) => !known.has(name)));
  const question = Object.entries(customAnswers).map(([name, value]) => `${name.replaceAll("_", " ")}: ${value}`).join("\n").slice(0, 1000);
  return {
    source: "facebook_lead",
    name: (fullName || `${firstName} ${lastName}`).trim().slice(0, 200),
    email: email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    phone: first(fields, ["phone_number", "phone number", "phone"]).trim().slice(0, 40),
    zip: first(fields, ["zip_code", "zip code", "postal_code", "postal code", "zip"]).trim().slice(0, 20),
    city: first(fields, ["city"]).trim().slice(0, 100),
    question,
    follow_up_consent: consent,
    follow_up_consent_at: consent ? String(data?.created_time || new Date().toISOString()).slice(0, 60) : "",
    meta_lead_id: String(data?.id || event.leadId || "").slice(0, 100),
    meta_form_id: String(event.formId || data?.form_id || "").slice(0, 100),
    meta_page_id: String(event.pageId || "").slice(0, 100),
    meta_created_time: String(data?.created_time || event.createdTime || "").slice(0, 60),
    answers: customAnswers,
    original_fields: fields,
    original_form: data,
    ...mapMetaAnswers(fields),
  };
}
