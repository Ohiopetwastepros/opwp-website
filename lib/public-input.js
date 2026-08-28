const EMAIL = /^[^\s@]{1,120}@[^\s@]{1,120}\.[^\s@]{2,63}$/;
const FUNNEL_ID = /^[A-Za-z0-9_-]{16,80}$/;

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function phone(value) {
  const valueText = text(value, 40);
  const digits = valueText.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? valueText : "";
}

function email(value) {
  const valueText = text(value, 254).toLowerCase();
  return EMAIL.test(valueText) ? valueText : "";
}

export function validateLeadInput(body) {
  const source = body.source === "question" ? "question" : "partial_quote";
  const clean = {
    source,
    name: text(body.name, 120),
    email: email(body.email),
    phone: phone(body.phone),
    zip: /^\d{5}$/.test(String(body.zip || "")) ? String(body.zip) : "",
    marketing_consent: false,
    follow_up_allowed: true,
    funnel_id: FUNNEL_ID.test(String(body.funnel_id || "")) ? String(body.funnel_id) : "",
    lifecycle_stage: body.lifecycle_stage === "details_started" ? "details_started" : "quote_viewed",
  };
  if (source === "partial_quote" && (!clean.email || !clean.phone)) return { ok: false, error: "Enter a valid email and phone number." };
  clean.quote_context = {
    dogs: Math.min(Math.max(Number(body.dogs) || 1, 1), 20),
    frequency: text(body.frequency, 40),
    last_cleaned: text(body.last_cleaned, 40),
    yard_size: text(body.yard_size, 40),
    quote_monthly: Number.isFinite(Number(body.quote_monthly)) ? Number(body.quote_monthly) : null,
    selected_addons: Array.isArray(body.selected_addons) ? body.selected_addons.slice(0, 12).map((item) => text(item, 80)) : [],
  };
  if (source === "question") {
    clean.question = text(body.question, 1500);
    if (!clean.name || !clean.question || (!clean.email && !clean.phone)) return { ok: false, error: "Enter your name, question, and a valid phone or email." };
  }
  return { ok: true, value: clean };
}

export function validateWaitlistInput(body) {
  const value = {
    zip: /^\d{5}$/.test(String(body.zip || "")) ? String(body.zip) : "",
    name: text(body.name, 120),
    email: email(body.email),
    phone: body.phone ? phone(body.phone) : "",
    consent: body.consent === true,
  };
  if (!value.zip || !value.name || !value.email || (body.phone && !value.phone)) return { ok: false, error: "Enter a valid name, email, and ZIP code." };
  return { ok: true, value };
}

const ONBOARD_FIELDS = new Set([
  "organization", "first_name", "last_name", "email", "cell_phone_number", "home_address", "city", "state", "zip_code",
  "number_of_dogs", "clean_up_frequency", "last_time_yard_was_thoroughly_cleaned", "initial_cleanup_required", "coupon",
  "marketing_allowed", "terms_open_api", "tracking_field", "dog_name[]", "safe_dog[]", "dog_comment[]", "gate_location", "gate_code",
  "has_doggie_door", "garbage_can_location", "areas_to_clean", "notification_message", "notification_type", "account_note",
  "yard_size_tier", "yard_upcharge_monthly", "quoted_monthly_total", "route_monthly_revenue", "selected_addons",
  "funnel_id",
]);

export function validateOnboardingInput(body) {
  const value = Object.fromEntries(Object.entries(body).filter(([key]) => ONBOARD_FIELDS.has(key)));
  value.first_name = text(value.first_name, 80);
  value.last_name = text(value.last_name, 80);
  value.email = email(value.email);
  value.cell_phone_number = phone(value.cell_phone_number);
  value.home_address = text(value.home_address, 200);
  value.city = text(value.city, 100);
  value.state = text(value.state, 2).toUpperCase();
  value.zip_code = /^\d{5}$/.test(String(value.zip_code || "")) ? String(value.zip_code) : "";
  value.number_of_dogs = Number(value.number_of_dogs);
  value.account_note = text(value.account_note, 2000);
  value.gate_code = text(value.gate_code, 100);
  value.areas_to_clean = Array.isArray(value.areas_to_clean) ? value.areas_to_clean.slice(0, 12).map((item) => text(item, 80)) : [];
  value.selected_addons = Array.isArray(value.selected_addons) ? value.selected_addons.slice(0, 12).map((item) => text(item, 80)) : [];
  value.funnel_id = FUNNEL_ID.test(String(value.funnel_id || "")) ? String(value.funnel_id) : "";
  if (!value.funnel_id || !value.first_name || !value.last_name || !value.email || !value.cell_phone_number || !value.home_address || !value.city || !["OH", "MI"].includes(value.state) || !value.zip_code || !Number.isInteger(value.number_of_dogs) || value.number_of_dogs < 1 || value.number_of_dogs > 20 || value.terms_open_api !== 1) {
    return { ok: false, error: "Complete all required customer and service fields." };
  }
  return { ok: true, value };
}

export const publicInput = { text, phone, email };
