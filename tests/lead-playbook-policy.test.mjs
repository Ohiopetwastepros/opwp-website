import test from "node:test";
import assert from "node:assert/strict";
import { PRICING as WEBSITE_PRICING, YARD_TIERS as WEBSITE_TIERS, PRICING_VERSION as WEBSITE_VERSION } from "../app/free-quote/pricing.js";
import { PRICING, YARD_TIERS, PRICING_VERSION, initialRange, oneTimeRange, monthly, yardUpcharge } from "../lib/lead-pricing.mjs";
import { INTENTS, TEMPLATES, RANGE_SENTENCE, classifyPlaybookRules, nextPlaybookResponse, renderPlaybookTemplate, lintPlaybookText, leadPlaybookDetails, playbookEnabled } from "../lib/lead-playbook.mjs";
import { classifyPlaybookIntent, validateClassifierResult } from "../lib/lead-playbook-classifier.mjs";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
const lead = { dogs: 1, frequency: "once_a_week", yardTier: "tiny", lastCleaned: "two_weeks", city: "Maumee", zip: "43537", name: "Example Lead", email: "lead@example.test" };
const conversation = { owner: "backend" };
const route = { approvedDays: ["Friday"], auditedBy: "fixture", dayPhrase: "tomorrow", dayIntro: "Perfect, we're already in Maumee on Fridays, so we could get you started as soon as tomorrow. " };
const afterConfirm = { stage: "details_confirmed", details_confirmed: true, details: { ...lead, address: "[SERVICE ADDRESS]" } };
const respond = (state, text, extra = {}) => nextPlaybookResponse({ conversation, lead, state, text, route, ...extra });

test("playbook prices are the website objects with no copied grid or divergence", () => {
  assert.equal(PRICING, WEBSITE_PRICING); assert.equal(YARD_TIERS, WEBSITE_TIERS); assert.equal(PRICING_VERSION, WEBSITE_VERSION);
  for (const [band, entries] of Object.entries(PRICING.initialCleanup)) for (const [dogs, range] of Object.entries(entries)) assert.equal(initialRange(dogs, band), range);
  for (const [band, entries] of Object.entries(PRICING.oneTimeCleanup)) for (const [dogs, range] of Object.entries(entries)) assert.equal(oneTimeRange(dogs, band), range);
  for (const [frequency, entries] of Object.entries(PRICING.monthly)) for (const [dogs, price] of Object.entries(entries)) assert.equal(monthly(frequency, dogs), price);
  for (const tier of YARD_TIERS) assert.equal(yardUpcharge(tier.id), tier.upcharge);
  assert.equal(monthly("Weekly", 2), 105); assert.equal(monthly("Twice Weekly", 1), 175); assert.equal(monthly("Monthly", 2), 65);
});
test("all exact seeds format once with no em/en dashes and no opt-out footer", () => {
  const slots = { dogs: 1, dogs_phrase: "1 dog", frequency: "weekly", frequencyId: "once_a_week", yardTier: "tiny", lastCleaned: "two_weeks", yard_phrase: "small", last_cleaned_phrase: "about 2 weeks", day_intro: "", low: 27, high: 34, monthly: 95, haul_monthly: 21, location: "ZIP 43528", day: "Friday", name: "Example", email: "lead@example.test", business_phone: "(419) 555-0101", area_name: "that ZIP", scope_question: "When was the yard last cleaned?", next_question: "Want me to get you set up?" };
  for (const [key, seed] of Object.entries(TEMPLATES)) { assert.doesNotMatch(seed, /[\u2013\u2014]/); const body = renderPlaybookTemplate(key, slots); assert.doesNotMatch(body, /Reply STOP to opt out|Text STOP to unsubscribe/i); assert.doesNotMatch(body, /[\u2013\u2014]/); }
});
test("rule intents are closed and safety signals take precedence over interest", () => {
  for (const [text, intent] of [["STOP", "stop"], ["wrong number", "wrong_number"], ["Is this AI?", "is_this_ai"], ["How much?", "question_price"], ["too expensive", "objection_price"], ["I need to think about it", "objection_thinking"], ["comparing another quote", "objection_competitor"], ["What is included?", "question_what_included"], ["Is there a contract?", "question_contract"], ["Can dogs be outside?", "question_pets_safety"], ["gate access?", "question_gate_access"], ["payment?", "question_payment"]]) { const got = classifyPlaybookRules(text); assert.equal(got.intent, intent); assert.ok(INTENTS.includes(got.intent)); }
  assert.equal(classifyPlaybookRules("I'm concerning service.", { stage: "intro_sent" }).intent, "confirm_yes");
  assert.equal(classifyPlaybookRules("yes", { stage: "quote_sent" }).intent, "ready_to_sign_up");
});
test("native website and workspace inputs are read without inventing missing slots", () => {
  const got = leadPlaybookDetails({ payload: JSON.stringify({ quote_context: { dogs: 2, frequency: "once_a_week", last_cleaned: "two_weeks", yard_size: "small" } }) });
  assert.equal(got.dogs, 2); assert.equal(got.lastCleaned, "two_weeks"); assert.equal(got.yardTier, "small");
  assert.equal(leadPlaybookDetails({ lead_workspace: { intake: { dogs: 3, yardSize: "medium", lastCleaned: "one_week" } } }).dogs, 3);
});
test("quote waits for detail confirmation and address, corrections require confirmation again", () => {
  const first = respond({ stage: "intro_sent" }, "How much?"); assert.equal(first.templateKey, "confirm_details"); assert.doesNotMatch(first.body, /\$/);
  const confirmed = respond(first.state, "Yes"); assert.equal(confirmed.templateKey, "ask_address"); assert.equal(confirmed.state.details_confirmed, true);
  const corrected = respond(afterConfirm, "Actually 2 dogs"); assert.equal(corrected.templateKey, "confirm_details"); assert.equal(corrected.state.details_confirmed, false); assert.doesNotMatch(corrected.body, /\$/);
  assert.notEqual(respond({ stage: "intro_sent" }, "ready to sign up").templateKey, "quote_recurring");
});
test("golden quote uses Craig's exact template wording and current grid", () => {
  const quote = respond(afterConfirm, "[SERVICE ADDRESS]", { classification: { intent: "address_given", confidence: 1, slots: {} } });
  assert.equal(quote.body, "Our rate for 1 dog with weekly service is $95 per month, and the initial cleanup to get the yard caught up runs $27 to $34. The range depends on how much waste is in the yard and how long it takes. It's month to month with no contract. Want me to get you set up?");
  assert.doesNotMatch(quote.body, /;/);
  assert.equal(quote.pricingVersion, WEBSITE_VERSION); assert.ok(quote.body.includes(RANGE_SENTENCE)); assert.doesNotMatch(quote.body, /\$15/);
  assert.equal(respond(afterConfirm, "How much?", { route: { approvedDays: ["Tuesday", "Friday"], auditedBy: "fixture" } }).reason, "route_day_requires_confirmation");
  const serviceDay = respond(quote.state, "What day do you come?");
  assert.equal(serviceDay.templateKey, "service_day_answer"); assert.match(serviceDay.body, /on Friday/); assert.doesNotMatch(serviceDay.body, /\$/);
  assert.equal(respond(quote.state, "What day do you come?", {route: null}).reason, "route_day_requires_confirmation");
  const yes = respond(quote.state, "yes"); assert.equal(yes.templateKey, "ready_access"); assert.ok(yes.body.includes(lead.email)); assert.ok(yes.body.includes(lead.name));
});
test("dated cleanup confirmation preserves matching details and corrections remain explicit", () => {
  const text = "Yes. Cleaned on the 8th. I had surgery on 9th and can't do the weekly clean up. I would need service for a few months.";
  const got = classifyPlaybookRules(text, { stage: "confirm_details_sent", now: "2026-11-19T14:03:00Z", details: lead });
  assert.equal(got.slots.lastCleaned, "two_weeks");
  // Frequency mentioned as context must agree with the already confirmed form.
  assert.equal(got.intent, "confirm_yes");
});
test("affirmative prefixes never silently confirm unparsed corrections or questions", async () => {
  const state = { ...afterConfirm, stage: "confirm_details_sent", details_confirmed: false };
  for (const text of ["Yes, we have nine dogs", "Yes, our yard is one acre", "Yes, we have no dogs", "yes, how does it work?", "Yes, except the cleanup is for a school campus", "Yes, the yard is two thirds of an acre"]) {
    const classification = classifyPlaybookRules(text, { ...state, details: lead, now: "2026-11-19T14:03:00Z" });
    assert.notEqual(classification.intent, "confirm_yes", text);
    const result = respond(state, text, { classification }); assert.notEqual(result.templateKey, "quote_recurring", text); assert.doesNotMatch(result.body, /\$/, text);
    if (text.includes("how does it work")) {
      assert.equal(result.state.details_confirmed, false);
      assert.equal(result.escalate, false);
      assert.match(result.body, /(?:scoop|cleanup|waste)/i);
    }
    else if (text.includes("two thirds")) {assert.equal(classification.slots.yardTier, "large"); assert.equal(result.templateKey, "confirm_details"); assert.equal(result.escalate, false);}
    else assert.equal(result.escalate, true, text);
  }
  assert.equal(classifyPlaybookRules("Yes, we have nine dogs").slots.dogs, 9);
  assert.equal(classifyPlaybookRules("Yes, we have no dogs").slots.dogs, 0);
  assert.equal(classifyPlaybookRules("Yes, our yard is one acre").slots.yardTier, "xlarge");
  let calls = 0;
  const result = await classifyPlaybookIntent("Yes, except the cleanup is for a school campus", { ...state, details: lead }, { env: { LEAD_CLASSIFIER_ENABLED: "true" }, usageStore: { claim() { calls++; return true; } }, provider: async () => { calls++; return { response: '{"intent":"confirm_yes","confidence":1,"slots":{}}' }; } });
  assert.equal(result.reason, "confirmation_requires_review"); assert.equal(calls, 0);
});
test("price objections hand off once while a spouse discussion gets a pressure-free reply", () => {
  const quoted = {...afterConfirm, stage: "quote_sent"};
  for (const text of ["too expensive", "Another company is cheaper", "Can you do better?", "Is there a discount?"]) {
    const result = respond(quoted, text);
    assert.equal(result.escalate, true, text);
    assert.equal(result.state.stage, "escalated");
    assert.doesNotMatch(result.body, /\$|biweekly|every other week|set you up/i);
    assert.equal(respond(result.state, "yes").body, "");
  }
  const waiting = respond(quoted, "Let me ask my husband.");
  assert.equal(waiting.escalate, false);
  assert.match(waiting.body, /no worries|no problem|take your time/i);
  assert.doesNotMatch(waiting.body, /\$|discount/i);
  for (const intent of ["objection_price", "confirm_yes"]) {
    assert.ok(lintPlaybookText("I can give you $15 off.", {intent}).length, "A discount is prohibited for " + intent);
  }
});
test("custom properties and price bands, unknown intents, human requests and billing escalate", () => {
  for (const patch of [{ yardTier: "xlarge" }, { yardTier: "E" }, { yardAcres: 0.7501 }, { dogs: 8 }, { lastCleaned: "5_6_months" }, { lastCleaned: "custom" }]) {
    const result = respond(afterConfirm, "yes", { lead: { ...lead, ...patch }, state: { ...afterConfirm, details: { ...afterConfirm.details, ...patch } } }); assert.equal(result.escalate, true); assert.doesNotMatch(result.body, /\$/);
  }
  for (const text of ["unrecognized unusual thing", "Is this a bot? I want the owner.", "refund please", "you missed my service"]) assert.equal(respond(afterConfirm, text).escalate, true);
});
test("Sona, Craig, STOP, wrong number and suppressions block every draft", () => {
  for (const owner of ["sona", "craig", undefined]) assert.equal(respond(afterConfirm, "How much?", { conversation: { owner } }).body, "");
  for (const text of ["STOP", "wrong number"]) assert.equal(respond(afterConfirm, text).body, "");
  assert.equal(respond(afterConfirm, "How much?", { suppressed: true }).body, "");
  assert.equal(playbookEnabled({}), false); assert.equal(playbookEnabled({ LEAD_PLAYBOOK_ENABLED: "false" }), false);
});
test("candidate lint reports dashes, upfront offers, unresolved promises and stale prices", () => {
  assert.ok(lintPlaybookText("Hi\u2014there").includes("forbidden_dash"));
  assert.ok(lintPlaybookText("I can come on Friday.").includes("unverified_day_promise"));
  const slots = { ...lead, frequencyId: "once_a_week", low: 25, high: 32, monthly: 90, frequency: "weekly", day_intro: "", day: "Friday" };
  assert.ok(lintPlaybookText(renderPlaybookTemplate("quote_recurring", slots), { templateKey: "quote_recurring", intent: "question_price", state: { details_confirmed: true }, slots }).includes("price_disagrees_with_grid"));
  const quoted = respond(afterConfirm, "How much?");
  assert.ok(lintPlaybookText(quoted.body.replace("$95", "$1"), { templateKey: "quote_recurring", intent: "question_price", state: afterConfirm, slots: quoted.slots }).includes("quote_text_price_mismatch"));
});
test("classifier rejects extra fields, unsafe slots and invalid confidence", () => {
  const valid = { intent: "confirm_yes", confidence: 0.9, slots: {} }; assert.ok(validateClassifierResult(valid));
  for (const value of [{ ...valid, body: "invented reply" }, { ...valid, confidence: 1.1 }, { ...valid, slots: { ignored: "x" } }, { ...valid, slots: { dogs: "2" } }]) assert.equal(validateClassifierResult(value), null);
});
test("fallback model uses a durable daily cap, kill switch, strict JSON and token accounting", async () => {
  const db = leadTestDatabase(), env = { LEAD_CLASSIFIER_ENABLED: "true", LEAD_CLASSIFIER_DAILY_CAP: "1" }; let calls = 0;
  const provider = async () => { calls++; return { response: JSON.stringify({ intent: "question_contract", confidence: 0.9, slots: {} }), usage: { total_tokens: 42 } }; };
  assert.equal((await classifyPlaybookIntent("unusual phrase", {}, { env, db, provider })).intent, "question_contract");
  assert.equal((await classifyPlaybookIntent("another unusual phrase", {}, { env, db, provider })).reason, "classifier_daily_cap"); assert.equal(calls, 1);
  assert.equal(db.sqlite.prepare("SELECT status,actual_tokens FROM lead_classifier_calls").get().actual_tokens, 42);
  assert.equal((await classifyPlaybookIntent("other unusual", {}, { env: { ...env, LEAD_CLASSIFIER_KILL_SWITCH: "true" }, db, provider })).reason, "classifier_disabled");
  assert.equal((await classifyPlaybookIntent("yes", {}, { env, db, provider })).intent, "confirm_yes"); assert.equal(calls, 1);
});
test("local migration fails closed on ownership, guards state and supersedes stale drafts", () => {
  const db = leadTestDatabase();
  db.sqlite.prepare("INSERT INTO submissions(id,kind,payload) VALUES('fixture-lead','question','{}')").run();
  db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id) VALUES('fixture-thread','fixture-lead','org-opwp')").run();
  assert.equal(db.sqlite.prepare("SELECT owner FROM lead_conversations WHERE id='fixture-thread'").get().owner, "sona");
  db.sqlite.prepare("INSERT INTO lead_playbook_state(conversation_id,submission_id) VALUES('fixture-thread','fixture-lead')").run();
  assert.throws(() => db.sqlite.exec("UPDATE lead_playbook_state SET state_json='{\"stage\":\"quote_sent\"}',prior_state_json='{\"stale\":true}',revision=revision+1"), /lead_playbook_state_conflict/);
  db.sqlite.exec("UPDATE lead_playbook_state SET state_json='{\"stage\":\"confirm_details_sent\"}',prior_state_json='{}',revision=revision+1");
  db.sqlite.exec("UPDATE lead_conversations SET owner='backend'");
  function draft(id) { db.sqlite.prepare("INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,intent,confidence,body,policy_version) VALUES(?,'fixture-thread','fixture-lead','confirm_yes',1,'fixture draft','fixture-policy')").run(id); }
  draft("fixture-draft-one");
  db.sqlite.exec("INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,body,created_by) VALUES('fixture-inbound','fixture-thread','org-opwp','inbound','quo_sms','Yes','fixture')");
  assert.equal(db.sqlite.prepare("SELECT status FROM lead_reply_drafts WHERE id='fixture-draft-one'").get().status, "superseded");
  draft("fixture-draft-two"); db.sqlite.exec("UPDATE lead_conversations SET owner='craig'");
  assert.equal(db.sqlite.prepare("SELECT status FROM lead_reply_drafts WHERE id='fixture-draft-two'").get().status, "superseded");
});

test("Meta confirmation gathers missing yard and cleanup answers then resumes an audited quote", () => {
  const form = { number_of_dogs: 2, clean_up_frequency: "Weekly", city: "Maumee", zip: "43537", name: "Casey Example", email: "casey@example.test" };
  let state = { stage: "confirm_details_sent", meta_confirmation_sent: true, details_confirmed: false };
  const turn = text => { const decision = nextPlaybookResponse({ conversation, lead: form, state, text, route }); state = decision.state; return decision; };
  assert.equal(turn("Yes").templateKey, "ask_yard");
  assert.equal(state.expected, "yardTier");
  assert.equal(turn("A").templateKey, "ask_last_cleaned");
  assert.equal(turn("2 weeks").templateKey, "confirm_details");
  assert.equal(state.details.dogs, 2);
  assert.equal(state.details.lastCleaned, "two_weeks");
  const priceQuestion = turn("How much?");
  assert.equal(priceQuestion.templateKey, "confirm_details");
  assert.equal(priceQuestion.escalate, false);
  assert.doesNotMatch(priceQuestion.body, /\$/);
  assert.equal(turn("Yes").templateKey, "ask_address");
  const quote = turn("123 Example Road");
  assert.equal(quote.templateKey, "quote_recurring");
  assert.equal(quote.slots.monthly, 105);
  assert.deepEqual([quote.slots.low, quote.slots.high], initialRange(2, "two_weeks"));
  assert.match(quote.body, /2 dogs with weekly service is \$105 per month/);
  assert.ok(quote.body.includes(RANGE_SENTENCE));
  assert.doesNotMatch(quote.body, /\$15|[^\x00-\x7f]/);
});

test("an incomplete website inquiry collects exact answers rather than stalling or guessing", () => {
  let state = { stage: "intro_sent" };
  const form = { city: "Maumee", zip: "43537" };
  const turn = text => { const decision = nextPlaybookResponse({ conversation, lead: form, state, text, route }); state = decision.state; return decision; };
  assert.equal(turn("How much?").templateKey, "ask_dogs");
  assert.equal(turn("2").templateKey, "ask_frequency");
  assert.equal(turn("weekly").templateKey, "ask_yard");
  assert.equal(turn("B").templateKey, "ask_last_cleaned");
  assert.equal(turn("B").templateKey, "confirm_details");
  assert.equal(state.details.dogs, 2);
  assert.equal(state.details.yardTier, "small");
  assert.equal(state.details.lastCleaned, "two_weeks");
  assert.equal(state.details_confirmed, false);
  assert.doesNotMatch(turn("What day?").body, /\$|schedule for/);
});

test("optional Meta form answers share deterministic parsing and never invent omitted values", () => {
  const supplied = leadPlaybookDetails({ number_of_dogs: 2, yard_size_answer: "1/4 to 1/2 acre", last_cleaned_answer: "About 2 weeks" });
  assert.equal(supplied.yardTier, "medium");
  assert.equal(supplied.lastCleaned, "two_weeks");
  assert.equal(leadPlaybookDetails({ yard_size_answer: "B", last_cleaned_answer: "F" }).yardTier, "small");
  assert.equal(leadPlaybookDetails({ yard_size_answer: "B", last_cleaned_answer: "F" }).lastCleaned, "3_4_months");
  assert.equal(leadPlaybookDetails({}).dogs, null);
  assert.equal(leadPlaybookDetails({}).lastCleaned == null, true);
  assert.equal(leadPlaybookDetails({ dogs: 0 }).dogs, 0);
  const corrected = leadPlaybookDetails({ yard_size_answer: "0.75 acre" }, { details: { yardTier: "small", yardAcres: null } });
  assert.equal(corrected.yardTier, "small");
  assert.equal(corrected.yardAcres, null);
});

test("properties through three quarters use the published surcharge and larger properties require a walk", () => {
  for (const text of ["3/4 acre", "0.75 acre", "three quarters of an acre"]) {
    const decision = respond(afterConfirm, text);
    assert.equal(decision.escalate, false, text);
    assert.equal(decision.state.details.yardTier, "large", text);
    assert.equal(yardUpcharge(decision.state.details.yardTier), 30);
  }
  for (const text of ["0.7501 acre", "3/4 acre or larger", "one acre", "2 acres"]) {
    const decision = respond(afterConfirm, text);
    assert.equal(decision.templateKey, "property_walk", text);
    assert.equal(decision.reason, "property_walk", text);
    assert.equal(decision.escalate, true, text);
    assert.doesNotMatch(decision.body, /\$/, text);
  }
  assert.equal(respond(afterConfirm, "How much?", { route: { approvedDays: ["Friday"] } }).reason, "route_day_requires_confirmation");
});

test("signup confirms contact and both access facts before a Craig-only SNG handoff", () => {
  const quote = respond(afterConfirm, "How much?");
  let state = quote.state;
  const turn = text => { const decision = respond(state, text); state = decision.state; return decision; };
  const access = turn("Yes");
  assert.equal(access.templateKey, "ready_access");
  assert.match(access.body, /Example Lead and lead@example\.test/);
  assert.match(access.body, /both right/);
  const gate = turn("Yes"); assert.equal(gate.templateKey, "ask_gate_side"); assert.match(gate.body, /facing the house/);
  assert.equal(turn("right").templateKey, "ask_trash_location");
  const handoff = turn("by the garage");
  assert.equal(handoff.reason, "signup_ready");
  assert.equal(handoff.templateKey, "signup_handoff");
  assert.equal(handoff.state.stage, "handoff_signup");
  assert.equal(handoff.state.signup_identity_confirmed, true);
  assert.equal(handoff.state.details.gateSide, "right");
  assert.equal(handoff.state.details.trashLocation, "by the garage");
  assert.equal(handoff.escalate, true);
  assert.equal(handoff.body, "Got it, thank you! I'll finish your account setup and confirm your first cleanup with you. You'll just need to accept the terms before service starts.");
  assert.equal(turn("Yes").body, "");
});

test("access answers cannot silently confirm name/email and identity corrections require another confirmation", () => {
  const quote = respond(afterConfirm, "How much?");
  const access = respond(quote.state, "Yes");
  const collected = respond(access.state, "My gate is on the left. My trash can is beside the garage.");
  assert.equal(collected.templateKey, "confirm_signup_identity");
  assert.equal(collected.state.details.gateSide, "left");
  assert.equal(collected.state.details.trashLocation, "beside the garage");
  const corrected = respond(collected.state, "Use the name Casey Example, email casey@example.test");
  assert.equal(corrected.templateKey, "ready_access");
  assert.equal(corrected.state.signup_identity_confirmed, false);
  assert.equal(corrected.state.details.name, "Casey Example");
  assert.equal(corrected.state.details.email, "casey@example.test");
  assert.equal(respond(corrected.state, "Yes").reason, "signup_ready");
  const changedDogs = respond(access.state, "Actually 2 dogs");
  assert.equal(changedDogs.templateKey, "confirm_details");
  assert.equal(changedDogs.state.details_confirmed, false);
  assert.doesNotMatch(changedDogs.body, /\$/);
});

test("missing signup contacts are collected explicitly and unsafe access answers go to review", () => {
  const form = { ...lead, name: "", email: "" };
  let state = { ...afterConfirm, stage: "quote_sent", details: { ...afterConfirm.details, name: "", email: "" } };
  const turn = text => { const decision = respond(state, text, { lead: form }); state = decision.state; return decision; };
  assert.equal(turn("Yes").templateKey, "ask_signup_name");
  assert.equal(turn("Casey Example").templateKey, "ask_signup_email");
  assert.equal(turn("casey@example.test").templateKey, "ready_access");
  const noTrash = turn("Yes, no trash can");
  assert.equal(noTrash.escalate, true);
  assert.notEqual(noTrash.reason, "signup_ready");
});

test("AI disclosure is truthful and a request for a person immediately hands off", () => {
  const identity = respond(afterConfirm, "Is this AI?");
  assert.equal(identity.escalate, false);
  assert.match(identity.body, /\bAI\b|automated/i);
  assert.match(identity.body, /owner|personal/i);
  assert.doesNotMatch(identity.body, /I'm a real person|[^\x00-\x7f]/);
  const requested = respond(identity.state, "I want a real person to call me.");
  assert.equal(requested.escalate, true);
  assert.equal(respond(requested.state, "Yes please").body, "");
  const body = renderPlaybookTemplate("ready_access", { name: "Ren\u00e9e Example", email: "example@example.test" });
  assert.match(body, /Renee Example/);
  assert.doesNotMatch(body, /[^\x00-\x7f]/);
  assert.ok(lintPlaybookText("Hi \u2603").includes("non_ascii_sms"));
});

test("prospective cancellation questions use approved answers while actual service requests remain held", () => {
  const approvedAnswers = [{ answer_key: "fixture-contract", intent: "question_contract", approval_status: "approved", version: 1, answer_template: "Service is month to month, so you can cancel anytime." }];
  const answer = respond(afterConfirm, "Can I cancel anytime?", { approvedAnswers });
  assert.equal(answer.reason, "approved_contract_answer");
  assert.equal(answer.escalate, false);
  assert.match(answer.body, /month to month/);
  for (const text of ["Cancel my service", "You missed my yard", "My gate was left open last visit"]) {
    const decision = respond(afterConfirm, text, { approvedAnswers });
    assert.equal(decision.escalate, true);
    assert.notEqual(decision.reason, "approved_contract_answer");
  }
});

test("cleanup recaps preserve customer duration ranges while only pricing uses the conservative band", () => {
  for (const [text, band, phrase] of [["2-3 weeks", "three_weeks", "2 to 3 weeks"], ["2 to 3 weeks", "three_weeks", "2 to 3 weeks"], ["6-8 weeks", "two_months", "6 to 8 weeks"], ["about a month", "one_month", "a month"]]) {
    const state = {stage: "collect_details", expected: "lastCleaned", details_confirmed: false, details: {...lead, lastCleaned: null}};
    const recap = respond(state, text);
    assert.equal(recap.templateKey, "confirm_details", text);
    assert.equal(recap.state.details.lastCleaned, band, text);
    assert.equal(recap.state.details.lastCleanedAnswer, text, text);
    assert.ok(recap.body.endsWith(`and it's been about ${phrase} since the last cleanup. Did I get that right?`), recap.body);
    assert.doesNotMatch(recap.body, /last thoroughly cleaned about|\$/);
    const confirmed = respond(recap.state, "yes");
    assert.equal(confirmed.templateKey, "ask_address");
    assert.equal(confirmed.state.details.lastCleanedAnswer, text);
    const quoted = respond(confirmed.state, "123 Example Road");
    assert.equal(quoted.templateKey, "quote_recurring");
    assert.deepEqual([quoted.slots.low, quoted.slots.high], initialRange(1, band));
    assert.equal(quoted.slots.monthly, 95);
    assert.equal(quoted.state.details.lastCleanedAnswer, text);
  }
});
