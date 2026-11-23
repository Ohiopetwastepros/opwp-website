import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CRAIG_TEMPLATES, renderCraigReply } from "../lib/craig-voice.mjs";
import { META_RESPONSES, metaFollowUpDrafts } from "../lib/meta-conversation.mjs";
import { buildMetaConfirmation } from "../lib/meta-lead-policy.mjs";
import { leadFollowUpDrafts } from "../lib/lead-assistant.mjs";
import { buildCustomerQuoteFollowUpEmail, buildCustomerQuoteFollowUpSms } from "../lib/quote-funnel.mjs";
import { metaCadenceApproved, queueMetaCadence } from "../lib/meta-lead-workflow.mjs";

const forbiddenDash = /[\u2013\u2014]/;
const timePromise = /\b(?:morning|afternoon|evening|tonight|noon|midnight)\b|\b(?:by|before|at|around)\s+\d{1,2}(?::\d{2})?\b(?![\d/])|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i;
const slots = {
  dogs: 2, name: "Craig", email: "fixture@example.test", location: "ZIP 43551",
  frequency: "weekly", frequencyId: "once_a_week", yardTier: "tiny", lastCleaned: "two_weeks",
  yard_phrase: "up to 1/8 acre", last_cleaned_phrase: "about two weeks ago",
  monthly: 105, low: 37, high: 44, haul_monthly: 21, day: "Friday",
  area_name: "that ZIP", scope_question: "When was the yard last cleaned?",
  next_question: "Want me to get you set up?", business_phone: "(419) 262-2371",
};

function checkCopy(body, label) {
  assert.equal(typeof body, "string", label);
  assert.doesNotMatch(body, forbiddenDash, `${label}: no en or em dash`);
  assert.doesNotMatch(body, timePromise, `${label}: no time-of-day promise`);
}

test("every lead customer template, confirmation variant and follow-up avoids dashes and time promises", () => {
  for (const [key, template] of Object.entries(CRAIG_TEMPLATES)) {
    checkCopy(template, `template ${key}`);
    checkCopy(renderCraigReply(key, slots), `rendered ${key}`);
  }
  for (const [key, body] of Object.entries(META_RESPONSES)) checkCopy(body, `Meta response ${key}`);
  const lead = { name: "Craig Bridgman", number_of_dogs: 2, zip: "43551", clean_up_frequency: "Weekly" };
  for (const patch of [{}, {name: ""}, {number_of_dogs: null}, {zip: ""}, {clean_up_frequency: ""}, {number_of_dogs: null, zip: "", clean_up_frequency: ""}]) {
    for (const firstMessage of [true, false]) checkCopy(buildMetaConfirmation({...lead, ...patch}, {firstMessage}), "Meta confirmation");
  }
  for (const draft of [...metaFollowUpDrafts("Craig"), ...leadFollowUpDrafts("Craig")]) checkCopy(draft.body, `follow-up ${draft.step}`);
  checkCopy(buildCustomerQuoteFollowUpSms(), "website quote SMS");
  const email = buildCustomerQuoteFollowUpEmail();
  for (const field of ["subject", "text", "html"]) checkCopy(email[field], `website quote email ${field}`);
});

test("the copy scan rejects both dash codepoints and the prohibited time promise shapes", () => {
  for (const bad of ["Thanks\u2013we can help.", "Thanks\u2014we can help.", "I'll call this afternoon.", "I'll call in the morning.", "I'll call by 3.", "I'll arrive at 3 pm.", "We can come before noon."]) {
    assert.throws(() => checkCopy(bad, "mutation"), assert.AssertionError);
  }
});

test("Meta day 1/3/7 follow-ups stay disabled without any database access", async () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"META_CADENCE_ENABLED"\s*:\s*"false"/);
  const db = {prepare() {assert.fail("Disabled cadence must not query or queue anything");}};
  for (const flag of [undefined, "false", false]) {
    assert.equal(await metaCadenceApproved(db, {META_CADENCE_ENABLED: flag}), false);
    assert.equal(await queueMetaCadence(db, {META_CADENCE_ENABLED: flag}, "fixture-lead"), false);
  }
  assert.equal(await metaCadenceApproved(db, {META_CADENCE_ENABLED: "true", LEAD_PLAYBOOK_ENABLED: "true"}), false);
  assert.deepEqual(metaFollowUpDrafts("Craig").map(({day}) => day), [1, 3, 7]);
});
