import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { PRICING } from "../app/free-quote/pricing.js";
import { accountSubmitState, questionSubmitState } from "../lib/quote-form-state.mjs";
import { buildCustomerQuoteFollowUpEmail, buildCustomerQuoteFollowUpSms, buildSubmissionNotification, escapeEmailHtml, normalizeFunnelId, normalizeFunnelStage, PARTIAL_QUOTE_FOLLOW_UP_DELAY_MINUTES } from "../lib/quote-funnel.mjs";
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

test("configured live quote preserves Sweep & Go's price, tax and cross-sells for chart plans and legacy aliases", async () => {
  const source = fs.readFileSync(new URL("../app/api/quote/route.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const calls = [];
  const upstream = { price: { value: "113.25" }, tax_percent: 7.25, cross_sells: [{ id: 1 }] };
  const { GET } = vm.runInNewContext(source + "\n({GET})", {
    PRICING, Response, URL, checkRateLimit: async () => ({ allowed: true }),
    normalizeFrequency: (value) => value, normalizeLastCleaned: (value) => value,
    sngRequest: async (_path, { searchParams }) => { calls.push(searchParams); return { configured: true, ok: true, data: upstream }; },
  });
  const request = (frequency) => new Request(`https://example.test/api/quote?zip=43604&dogs=2&frequency=${frequency}`);
  for (const frequency of ["once_a_week", "bi_weekly", "monthly"]) {
    const result = await GET(request(frequency));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { configured: true, ok: true, monthly: 113.25, tax: 7.25, crossSells: upstream.cross_sells });
    assert.equal(calls.at(-1).clean_up_frequency, frequency);
  }
  assert.equal((await GET(request("unknown"))).status, 400);
  assert.equal(calls.length, 3);
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
    card_choice: "yes",
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

test("partial quote owner email contains the saved quote context", () => {
  const content = buildSubmissionNotification({
    type: "partial_quote",
    submissionId: "quote-id",
    body: { email: "person@example.com", phone: "4195550100", zip: "43604", quote_context: { dogs: 2, frequency: "once_a_week", yard_size: "medium", quote_monthly: 130 } },
  });
  assert.equal(content.subject, "New website quote lead");
  assert.match(content.text, /Quoted monthly: 130/);
  assert.match(content.text, /Submission ID: quote-id/);
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

test("partial quote queue retains its ten-minute default for callers without an explicit delay", () => {
  assert.equal(PARTIAL_QUOTE_FOLLOW_UP_DELAY_MINUTES, 10);
});

test("partial quote customer email identifies relief technician and invites a direct reply", () => {
  const content = buildCustomerQuoteFollowUpEmail();
  assert.match(content.subject, /Ohio Pet Waste Pros quote/i);
  assert.match(content.text, /This is Craig with Ohio Pet Waste Pros/);
  assert.match(content.text, /reply directly to this email/i);
  assert.match(content.text, /\(419\) 262-2371/);
});

test("partial quote follow-up stays concise without an opt-out footer", () => {
  const content = buildCustomerQuoteFollowUpSms();
  assert.equal(content, "Hello, this is Craig with Ohio Pet Waste Pros. I saw that you filled out a quote form on our website. Did you have any questions about our service, or would you like help getting signed up?");
});

test("no-card onboarding requires a question but still validates for account creation", () => {
  const base = {
    funnel_id: "1234567890abcdef", first_name: "Test", last_name: "Customer", email: "test@example.com",
    cell_phone_number: "4195550100", home_address: "123 Main St", city: "Toledo", state: "OH", zip_code: "43604",
    number_of_dogs: 1, clean_up_frequency: "once_a_week", last_time_yard_was_thoroughly_cleaned: "one_month",
    initial_cleanup_required: 1, marketing_allowed: 0, terms_open_api: 1, tracking_field: "search_engine",
    "dog_name[]": [""], "safe_dog[]": ["yes"], "dog_comment[]": [""], gate_location: "left",
    garbage_can_location: "right", areas_to_clean: ["Back Yard"], selected_addons: [], card_choice: "no",
  };
  assert.equal(validateOnboardingInput(base).ok, false);
  const accepted = validateOnboardingInput({ ...base, service_question: "Can you confirm my first service day?" });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.card_choice, "no");
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

test("questions need only a name, question, and a valid phone or email", () => {
  const base = { source: "question", name: "Test", question: "Do you remove the waste?" };
  for (const contact of [{ phone: "4195550100" }, { email: "test@example.com" }]) {
    const result = validateLeadInput({ ...base, ...contact });
    assert.equal(result.ok, true);
    assert.equal(result.value.follow_up_allowed, false);
  }
  assert.equal(validateLeadInput({ ...base, phone: "4195550100", question: " " }).ok, false);
  assert.equal(validateLeadInput(base).ok, false);
  assert.equal(validateLeadInput({ ...base, phone: "bad", email: "bad" }).ok, false);
});

test("one-time lead context preserves the estimate and coupon without a zero monthly price", () => {
  const base = { source: "question", name: "Test", question: "Do you remove the waste?", email: "test@example.com" };
  for (const price of [null, undefined, ""]) {
    assert.equal(validateLeadInput({ ...base, quote_monthly: price }).value.quote_context.quote_monthly, null);
  }
  const result = validateLeadInput({ ...base, frequency: "one_time", quote_monthly: 0, quote_one_time_range: [80, 110], coupon: "TEST", dogs: 2, selected_addons: ["haul_away"] });
  assert.equal(result.value.quote_context.quote_monthly, null);
  assert.deepEqual(result.value.quote_context.quote_one_time_range, [80, 110]);
  assert.equal(result.value.quote_context.coupon, "TEST");
  assert.deepEqual(result.value.quote_context.selected_addons, ["haul_away"]);
  assert.equal(validateLeadInput({ ...base, frequency: "one_time", quote_one_time_range: [110, 80] }).value.quote_context.quote_one_time_range, null);
  assert.equal(validateLeadInput({ ...base, dogs: 2, frequency: "once_a_week", quote_monthly: 110 }).value.quote_context.quote_monthly, 110);
});

const questionContact = { name: "Test Customer", phone: "4195550100", email: "", token: "verified" };
const signupFields = {
  firstName: "Test", lastName: "Customer", email: "test@example.com", phone: "4195550100",
  address: "123 Main St", city: "Toledo", usState: "OH", safeDog: "yes", gateLocation: "left",
  garbageCan: "right", heardAbout: "search_engine", termsAgreed: true, cardChoice: "no",
  serviceQuestion: "Do you remove the waste?", token: "verified",
};

test("question-first cannot start service and does not require signup fields to ask", () => {
  assert.equal(questionSubmitState({ ...questionContact, question: " " }).ready, false);
  const questionOnly = questionSubmitState({ ...questionContact, question: "Do you remove the waste?" });
  assert.equal(questionOnly.ready, true);
  assert.equal(accountSubmitState({ cardChoice: "no", serviceQuestion: "Do you remove the waste?", token: "verified" }).ready, false);
  assert.equal(accountSubmitState(signupFields).ready, false, "full signup fields do not silently opt the customer into an account");
  assert.equal(accountSubmitState({ ...signupFields, createAccountBeforeCard: true }).ready, true);
  assert.equal(accountSubmitState({ ...signupFields, createAccountBeforeCard: true, serviceQuestion: " " }).ready, false);
});

test("missing verification stays visibly unavailable and a tap can explain the error", () => {
  for (const state of [
    questionSubmitState({ ...questionContact, question: "Do you remove the waste?", token: "" }),
    accountSubmitState({ ...signupFields, createAccountBeforeCard: true, token: "" }),
  ]) {
    assert.equal(state.ready, false, "ready controls green button styling");
    assert.equal(state.disabled, false, "a verification-only problem must reach the submit handler");
    assert.ok(state.missing.includes("complete the security check"));
    assert.match(state.error, /Please complete the verification/);
  }
  const empty = questionSubmitState({ ...questionContact, question: "", token: "" });
  assert.equal(empty.disabled, true);
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.missing, ["enter your question", "complete the security check"]);
  assert.equal(questionSubmitState({ ...questionContact, question: "Question?", busy: true }).ready, false);
});

test("question endpoint verifies quote_question, stores kind=question and never starts onboarding", async () => {
  const source = fs.readFileSync(new URL("../app/api/lead/route.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const calls = [];
  const body = { source: "question", funnel_id: "1234567890abcdef", name: "Test Customer", phone: "4195550100", question: "Do you remove the waste?", dogs: 2, frequency: "one_time", quote_monthly: null, quote_one_time_range: [80, 110], turnstileToken: "verified" };
  const api = vm.runInNewContext(source + "\n({POST})", {
    Response, validateLeadInput,
    protectJsonRequest: async () => ({ body }),
    verifyTurnstile: async (_request, token, action) => { calls.push({ action, token }); return { ok: true }; },
    saveSubmission: async (value) => { calls.push(value); return { configured: true, id: "test-question" }; },
    queueSubmissionNotificationSafe: async (value) => { calls.push(value); return { status: "queued" }; },
    upsertPartialQuoteSubmission: async () => { throw new Error("Question must not update a partial quote instead of being stored"); },
    queuePartialQuoteFollowUp: async () => { throw new Error("Question must not queue customer follow-up SMS"); },
  });
  const response = await api.POST(new Request("https://example.test/api/lead", { method: "POST" }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].action, "quote_question");
  assert.equal(calls[1].kind, "question");
  assert.equal(calls[1].funnelId, body.funnel_id);
  assert.equal(calls[1].body.question, body.question);
  assert.equal(calls[1].body.quote_context.quote_monthly, null);
  assert.equal(calls[2].type, "question");
  assert.equal((await response.json()).smsFollowup, null);
});
