import { acceptedHowHeardInputs, OPWP_SNG_FORM_OPTIONS } from "./sng-onboarding.mjs";

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
    follow_up_consent: body.follow_up_consent === true,
    follow_up_allowed: body.follow_up_consent === true,
    follow_up_consent_version: body.follow_up_consent === true ? "quote_service_sms_v1" : "",
    funnel_id: FUNNEL_ID.test(String(body.funnel_id || "")) ? String(body.funnel_id) : "",
    lifecycle_stage: body.lifecycle_stage === "details_started" ? "details_started" : "quote_viewed",
  };
  if (source === "partial_quote" && (!clean.email || !clean.phone || !clean.follow_up_consent)) return { ok: false, error: "Enter a valid email and phone number and agree to quote follow-up." };
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
  "gated_community", "doggie_door", "has_doggie_door", "garbage_can_location", "areas_to_clean", "notification_message", "notification_type", "account_note",
  "yard_size_tier", "yard_upcharge_monthly", "quoted_monthly_total", "route_monthly_revenue", "selected_addons",
  "funnel_id", "card_choice", "service_question",
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
  value.clean_up_frequency = text(value.clean_up_frequency, 40);
  value.last_time_yard_was_thoroughly_cleaned = text(value.last_time_yard_was_thoroughly_cleaned, 40);
  value.account_note = text(value.account_note, 2000);
  value.coupon = text(value.coupon, 80);
  value.tracking_field = text(value.tracking_field, 80);
  value.gate_location = text(value.gate_location, 30);
  value.gate_code = text(value.gate_code, 100);
  value.gated_community = text(value.gated_community || value.gate_code, 100);
  value.doggie_door = text(value.doggie_door || value.has_doggie_door, 10);
  value.garbage_can_location = text(value.garbage_can_location, 30);
  value["dog_name[]"] = Array.isArray(value["dog_name[]"]) ? value["dog_name[]"].slice(0, 7).map((item) => text(item, 80)) : [];
  value["safe_dog[]"] = Array.isArray(value["safe_dog[]"]) ? value["safe_dog[]"].slice(0, 7).map((item) => text(item, 10)) : [];
  value["dog_comment[]"] = Array.isArray(value["dog_comment[]"]) ? value["dog_comment[]"].slice(0, 7).map((item) => text(item, 300)) : [];
  value.areas_to_clean = Array.isArray(value.areas_to_clean) ? value.areas_to_clean.slice(0, 12).map((item) => text(item, 80)) : [];
  value.selected_addons = Array.isArray(value.selected_addons) ? value.selected_addons.slice(0, 12).map((item) => text(item, 80)) : [];
  value.funnel_id = FUNNEL_ID.test(String(value.funnel_id || "")) ? String(value.funnel_id) : "";
  value.card_choice = text(value.card_choice, 3).toLowerCase();
  value.service_question = text(value.service_question, 1500);
  const selectionsValid =
    OPWP_SNG_FORM_OPTIONS.frequencies.includes(value.clean_up_frequency) &&
    OPWP_SNG_FORM_OPTIONS.lastCleaned.includes(value.last_time_yard_was_thoroughly_cleaned) &&
    value["safe_dog[]"].length > 0 && value["safe_dog[]"].every((item) => OPWP_SNG_FORM_OPTIONS.safeDog.includes(item)) &&
    OPWP_SNG_FORM_OPTIONS.gateLocations.includes(value.gate_location) &&
    (!value.doggie_door || OPWP_SNG_FORM_OPTIONS.doggieDoor.includes(value.doggie_door)) &&
    OPWP_SNG_FORM_OPTIONS.garbageCanLocations.includes(value.garbage_can_location) &&
    value.areas_to_clean.every((item) => OPWP_SNG_FORM_OPTIONS.areasToClean.includes(item)) &&
    value.selected_addons.every((item) => OPWP_SNG_FORM_OPTIONS.selectedAddons.includes(item)) &&
    acceptedHowHeardInputs.has(value.tracking_field);
  if (!selectionsValid || !value.funnel_id || !value.first_name || !value.last_name || !value.email || !value.cell_phone_number || !value.home_address || !value.city || !["OH", "MI"].includes(value.state) || !value.zip_code || !Number.isInteger(value.number_of_dogs) || value.number_of_dogs < 1 || value.number_of_dogs > 7 || ![0, 1].includes(value.initial_cleanup_required) || ![0, 1].includes(value.marketing_allowed) || value.terms_open_api !== 1 || !["yes", "no"].includes(value.card_choice) || (value.card_choice === "no" && !value.service_question)) {
    return { ok: false, error: "Complete all required customer and service fields." };
  }
  return { ok: true, value };
}

export const publicInput = { text, phone, email };
