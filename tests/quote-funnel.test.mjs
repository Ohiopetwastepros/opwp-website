import assert from "node:assert/strict";
import test from "node:test";
import { buildSubmissionNotification, escapeEmailHtml, normalizeFunnelId, normalizeFunnelStage } from "../lib/quote-funnel.mjs";
import {
  OPWP_SNG_FORM_OPTIONS,
  normalizeHowHeard,
  publicOnboardingFailure,
  repeatDogValue,
  selectedSngCrossSells,
  validSngHowHeardValues,
} from "../lib/sng-onboarding.mjs";
import { validateLeadInput, validateOnboardingInput } from "../lib/public-input.js";

test("funnel IDs and stages fail closed", () => {
  assert.equal(normalizeFunnelId("short"), "");
  assert.equal(normalizeFunnelId("1234567890abcdef"), "1234567890abcdef");
  assert.equal(normalizeFunnelStage("details_started"), "details_started");
  assert.equal(normalizeFunnelStage("invented"), "quote_viewed");
});

test("website attribution values map to documented Sweep & Go enums", () => {
  const inputs = ["google_search", "google_maps", "facebook", "nextdoor", "friend_referral", "door_hanger", "yard_sign", "other"];
  for (const input of inputs) assert.equal(validSngHowHeardValues.has(normalizeHowHeard(input)), true, input);
  assert.equal(normalizeHowHeard("unexpected"), "other");
});

test("OPWP onboarding choices match the configured Sweep & Go enums", () => {
  assert.deepEqual(OPWP_SNG_FORM_OPTIONS.safeDog, ["yes", "no"]);
  assert.deepEqual(OPWP_SNG_FORM_OPTIONS.gateLocations, ["left", "right", "alley", "no_gate", "other"]);
  assert.deepEqual(OPWP_SNG_FORM_OPTIONS.garbageCanLocations, ["left", "right", "alley", "other"]);
  assert.equal(OPWP_SNG_FORM_OPTIONS.areasToClean.includes("Area with Mulch"), true);
  assert.equal(OPWP_SNG_FORM_OPTIONS.areasToClean.includes("Area With Mulch"), false);
});

test("multi-dog fields stay index-aligned and add-ons use OPWP cross-sell IDs", () => {
  assert.deepEqual(repeatDogValue(["Dixie"], 3, { firstOnly: true }), ["Dixie", "", ""]);
  assert.deepEqual(repeatDogValue(["no"], 3), ["no", "no", "no"]);
  assert.deepEqual(selectedSngCrossSells(["front_yard", "haul_away", "food_blue"]), {
    ids: [2851, 3200],
    names: "Add Front Yard Scooping,Haul Away Service",
  });
});

test("onboarding validation rejects values Sweep & Go cannot accept", () => {
  const valid = {
    funnel_id: "1234567890abcdef",
    first_name: "Test",
    last_name: "Customer",
    email: "test@example.com",
    cell_phone_number: "4195550100",
    home_address: "123 Main St",
    city: "Toledo",
    state: "OH",
    zip_code: "43604",
    number_of_dogs: 2,
    clean_up_frequency: "once_a_week",
    last_time_yard_was_thoroughly_cleaned: "one_month",
    initial_cleanup_required: 1,
    marketing_allowed: 0,
    terms_open_api: 1,
    tracking_field: "search_engine",
    "dog_name[]": ["Dixie"],
    "safe_dog[]": ["yes"],
    "dog_comment[]": [""],
    gate_location: "left",
    garbage_can_location: "right",
    areas_to_clean: ["Back Yard"],
    selected_addons: ["front_yard"],
  };
  assert.equal(validateOnboardingInput(valid).ok, true);
  assert.equal(validateOnboardingInput({ ...valid, gate_location: "behind the shed" }).ok, false);
  assert.equal(validateOnboardingInput({ ...valid, "safe_dog[]": ["indoors"] }).ok, false);
  assert.equal(validateOnboardingInput({ ...valid, areas_to_clean: ["Area With Mulch"] }).ok, false);
});

test("owner notification escapes untrusted lead content", () => {
  const content = buildSubmissionNotification({
    type: "question",
    submissionId: "safe-id",
    body: { name: "<script>alert(1)</script>", email: "person@example.com", question: "A & B" },
  });
  assert.equal(content.html.includes("<script>"), false);
  assert.equal(content.html.includes("&lt;script&gt;"), true);
  assert.equal(content.text.includes("A & B"), true);
  assert.equal(escapeEmailHtml('"<&'), "&quot;&lt;&amp;");
});

test("partial quote follow-up requires explicit scoped consent", () => {
  const partial = {
    source: "partial_quote",
    funnel_id: "1234567890abcdef",
    email: "test@example.com",
    phone: "4195550100",
    zip: "43604",
  };
  assert.equal(validateLeadInput(partial).ok, false);
  const accepted = validateLeadInput({ ...partial, follow_up_consent: true });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.follow_up_allowed, true);
  assert.equal(accepted.value.follow_up_consent_version, "quote_service_sms_v1");
  assert.equal(accepted.value.marketing_consent, false);
});

test("onboarding failures distinguish an existing SNG account without exposing provider details", () => {
  assert.deepEqual(publicOnboardingFailure({
    configured: true,
    data: { error: "A client with this email has already been onboarded." },
  }), {
    code: "account_exists",
    message: "An account already exists for this email. Nothing was charged. Please use Client Login or contact us for help with the existing account.",
  });
  const other = publicOnboardingFailure({ configured: true, data: { error: "Internal provider detail" } });
  assert.equal(other.code, "provider_rejected");
  assert.equal(other.message.includes("Internal provider detail"), false);
});
