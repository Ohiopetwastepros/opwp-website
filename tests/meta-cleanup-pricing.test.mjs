import assert from "node:assert/strict";
import test from "node:test";
import { PRICING } from "../app/free-quote/pricing.js";
import {CRAIG_RANGE_SENTENCE} from '../lib/craig-voice.mjs';
import { metaCleanupAnswer, metaCleanupSummary, metaWebsiteQuote, nextMetaResponse } from "../lib/meta-conversation.mjs";

const lead = { name: "ExampleLead", number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly" };
const details = { ...lead, yard_size_tier: "tiny", last_cleaned: "one_month" };
const awaiting = { details: { ...lead, yard_size_tier: "tiny" }, details_confirmed: true, expected: "cleaned" };

test("initial and one-time estimates match all 60 listed cleanup chart cells without adding a monthly yard fee to cleanup", () => {
  let cells = 0;
  for (const [table, frequency] of [[PRICING.initialCleanup, "Weekly"], [PRICING.oneTimeCleanup, "One Time"]]) {
    for (const [last_cleaned, prices] of Object.entries(table)) for (const [dogs, expected] of Object.entries(prices)) {
      const quote = metaWebsiteQuote({ ...details, clean_up_frequency: frequency, number_of_dogs: Number(dogs), last_cleaned, yard_size_tier: "large" });
      assert.deepEqual(quote?.initialRange || quote?.range, expected, `${frequency}/${dogs}/${last_cleaned}`);
      assert.equal(quote.basis.lastCleaned, last_cleaned);
      assert.equal(quote.basis.dogs, Number(dogs));
      assert.ok(quote.text.includes(`$${expected[0]} to $${expected[1]}. ${CRAIG_RANGE_SENTENCE}`));
      assert.equal(quote.text.split(CRAIG_RANGE_SENTENCE).length - 1, 1);
      assert.doesNotMatch(quote.text, /[\u2013\u2014]|exact.*after we see the yard/i);
      cells++;
    }
  }
  assert.equal(cells, 60);
  assert.deepEqual(metaWebsiteQuote(details).initialRange, [58, 70]);
  assert.equal(metaWebsiteQuote({ ...details, yard_size_tier: "small" }).monthly, 115);
  assert.deepEqual(metaWebsiteQuote({ ...details, clean_up_frequency: "One Time" }).range, [80, 110]);
});

test("Meta weekly quotes use the current base rate and add each yard fee only to recurring service", () => {
  const weeklyRates = [95, 105, 120, 130, 140];
  const yardFees = { tiny: 0, small: 10, medium: 20, large: 30 };
  for (const [index, base] of weeklyRates.entries()) {
    const dogs = index + 1;
    for (const [yard_size_tier, fee] of Object.entries(yardFees)) {
      const quote = metaWebsiteQuote({ ...details, number_of_dogs: dogs, yard_size_tier });
      assert.equal(quote.monthly, base + fee, `${dogs} dogs / ${yard_size_tier}`);
      assert.equal(quote.basis.monthlyBase, base);
      assert.equal(quote.basis.yardUpcharge, fee);
      assert.deepEqual(quote.initialRange, PRICING.initialCleanup.one_month[dogs]);
      assert.ok(quote.text.includes(`$${(base + fee).toFixed(2)} per month`));
    }
  }
});

test("unlisted history, dog counts, yard sizes and service combinations never produce automatic prices", () => {
  for (const clean_up_frequency of ["Weekly", "One Time"]) {
    for (const last_cleaned of [undefined, "", "5_6_months", "7_9_months", "10_plus", "never", "custom", "19 days", "constructor"]) assert.equal(metaWebsiteQuote({ ...details, clean_up_frequency, last_cleaned }), null);
    for (const number_of_dogs of [0, -1, 1.5, "2", 6, 7, 8, 20]) assert.equal(metaWebsiteQuote({ ...details, clean_up_frequency, number_of_dogs }), null);
    for (const yard_size_tier of [undefined, "xlarge", "unsure", "invented"]) assert.equal(metaWebsiteQuote({ ...details, clean_up_frequency, yard_size_tier }), null);
  }
  assert.equal(metaWebsiteQuote({ ...details, clean_up_frequency: "Biweekly", number_of_dogs: 4 }), null);
  assert.equal(metaWebsiteQuote({ ...details, clean_up_frequency: "Monthly", number_of_dogs: 2 }).monthly, 65);
  assert.equal(metaWebsiteQuote({ ...details, clean_up_frequency: "Monthly", number_of_dogs: 3 }), null);
});

test("cleanup history is required even for yes or a pricing question and accepts explicit ordinary answers", () => {
  for (const text of ["yes", "how much?"]) {
    const step = nextMetaResponse({ lead, state: awaiting, text, confirmationSent: true });
    assert.equal(step.state.expected, "cleaned"); assert.equal(step.state.quote, undefined);
    assert.doesNotMatch(step.response, /\$/);
  }
  for (const [text, id] of [["A", "one_week"], ["about 2 weeks", "two_weeks"], ["2-3 weeks", "three_weeks"], ["last thoroughly cleaned 3 weeks ago", "three_weeks"], ["it's been about 1 month", "one_month"], ["2 months ago", "two_months"], ["4 months", "3_4_months"]]) {
    const step = nextMetaResponse({ lead, state: awaiting, text, confirmationSent: true });
    assert.equal(step.state.details.last_cleaned, id, text);
    assert.equal(step.state.details.last_cleaned_answer, text);
    assert.equal(step.state.expected, "quote_acceptance");
    assert.ok(step.state.quote.initialRange);
  }
  assert.equal(metaCleanupAnswer("D"), null, "menu letters are meaningful only when the cleanup question is pending");
  for (const text of ["5 months", "never", "19 days", "6 months, maybe longer"]) {
    const step = nextMetaResponse({ lead, state: awaiting, text, confirmationSent: true });
    assert.equal(step.state.handoff, true, text); assert.equal(step.state.quote, null);
    assert.equal(step.state.details.last_cleaned_answer, text); assert.match(step.response, /custom quote/); assert.doesNotMatch(step.response, /\$/);
  }
});

test("cleanup corrections invalidate an accepted quote and pending route audit and require a new acceptance", () => {
  const accepted = { details, details_confirmed: true, quote: metaWebsiteQuote(details), quote_accepted: true, expected: "", handoff: true, ready_for_route_audit: true };
  const corrected = nextMetaResponse({ lead, state: accepted, text: "actually it was 2 months ago", confirmationSent: true });
  assert.equal(corrected.state.details.last_cleaned, "two_months");
  assert.deepEqual(corrected.state.quote.initialRange, [75, 85]);
  assert.equal(corrected.state.quote_accepted, false);
  assert.equal(corrected.state.ready_for_route_audit, false);
  assert.equal(corrected.state.expected, "quote_acceptance");
  const custom = nextMetaResponse({ lead, state: accepted, text: "actually 6 months ago", confirmationSent: true });
  assert.equal(custom.state.quote, null); assert.equal(custom.state.quote_accepted, false);
  assert.equal(custom.state.ready_for_route_audit, false); assert.match(custom.response, /custom quote/);
  assert.match(metaCleanupSummary(custom.state), /Custom quote/);
  assert.doesNotMatch(metaCleanupSummary(custom.state), /\$/);
});
