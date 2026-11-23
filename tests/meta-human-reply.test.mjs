import assert from "node:assert/strict";
import test from "node:test";
import { classifyMetaReply } from "../lib/meta-lead-policy.mjs";
import { META_RESPONSES, metaWebsiteQuote, nextMetaResponse } from "../lib/meta-conversation.mjs";

const lead = { name: "Example Lead", number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly" };
const disclosure = "Good question! These first texts are automated to help me get your info quickly, but I'm a real person and I read every conversation. Want me to text you personally?";

test("Meta identity questions get Craig's exact ASCII disclosure without depending on the static answer library", () => {
  assert.equal(META_RESPONSES.human_help, disclosure);
  assert.match(disclosure, /^[\x00-\x7f]+$/);
  for (const text of [
    "are you a real person", "is this a bot", "is this AI", "am I talking to a robot",
    "Are you really human?", "Are you an AI bot?", "Am I texting with a real person?",
    "Is this message automated?", "Are these texts automated?", "Real person?",
    "Are you real?", "Is there a real person?", "Are these texts sent by a bot?",
  ]) {
    assert.equal(classifyMetaReply(text), "human_help", text);
    const result = nextMetaResponse({ lead, state: { expected: "yard", details_confirmed: true }, text, staticAnswer: "Other library answer" });
    assert.equal(result.response, disclosure, text);
    assert.equal(result.state.expected, "human_offer");
    assert.equal(result.state.human_offer_expected, "yard");
    assert.equal(result.handoff, false);
  }
});

test("yes after the personal-reply offer hands off and subsequent automation stays stopped", () => {
  const offer = nextMetaResponse({ lead, text: "is this AI?", state: { expected: "yard", details_confirmed: true } });
  const result = nextMetaResponse({ lead, state: offer.state, text: "yes" });
  assert.equal(result.response, "");
  assert.equal(result.handoff, true);
  assert.equal(result.state.human_requested, true);
  assert.equal(result.state.expected, "");
  assert.equal(result.state.ready_for_route_audit, false);
  for (const text of ["yes, please", "sure", "please do", "yes, text me personally"]) {
    const accepted = nextMetaResponse({ lead, state: offer.state, text });
    assert.equal(accepted.state.human_requested, true, text);
    assert.equal(accepted.response, "");
  }
  for (const text of ["43615", "how much?", "are you a bot?", "next month", "lots of poop buildup"]) {
    const later = nextMetaResponse({ lead, state: result.state, text });
    assert.equal(later.response, "");
    assert.equal(later.handoff, true);
    assert.equal(later.state.human_requested, true);
  }
});

test("identity handling does not take ordinary pricing, ZIP or quote-acceptance answers", () => {
  for (const text of ["What is the price?", "What ZIP codes do you serve?", "43615", "Are you in 43615?", "2 dogs", "weekly",
    "Is this a real price?", "Is this real pricing?", "Is this a real quote for 43615?", "Are you a real company?"]) {
    assert.notEqual(classifyMetaReply(text), "human_help", text);
  }
  const details = { ...lead, yard_size_tier: "tiny", last_cleaned: "one_month" };
  const quote = metaWebsiteQuote(details);
  const state = { details, details_confirmed: true, quote, expected: "quote_acceptance" };
  const price = nextMetaResponse({ lead, state, text: "What is the price?" });
  assert.equal(price.response, quote.text);
  for (const text of ["Is this a real price?", "Is this real pricing?", "Is this a real quote for 43615?"]) {
    assert.equal(nextMetaResponse({ lead, state, text }).response, quote.text, text);
  }
  const acceptance = nextMetaResponse({ lead, state, text: "yes" });
  assert.equal(acceptance.state.quote_accepted, true);
  assert.equal(acceptance.state.expected, "address");
  assert.notEqual(acceptance.state.human_requested, true);
  const offer = nextMetaResponse({ lead, state: { expected: "zip" }, text: "are you a bot?" });
  const zip = nextMetaResponse({ lead, state: offer.state, text: "43551" });
  assert.equal(zip.state.details.zip, "43551");
  assert.equal(zip.state.expected, "confirm");
  assert.equal(zip.handoff, false);
  const priceAfterOffer = nextMetaResponse({ lead, state: nextMetaResponse({ lead, state, text: "is this AI?" }).state, text: "what is the price?" });
  assert.equal(priceAfterOffer.response, quote.text);
});

test("a personal-reply acceptance at the turn limit still requests Craig while terminal safeguards stay in force", () => {
  const offer = nextMetaResponse({ lead, state: { turns: 15, expected: "yard" }, text: "are you a real person?" });
  assert.equal(offer.state.turns, 16);
  assert.equal(offer.state.expected, "human_offer");
  const accepted = nextMetaResponse({ lead, state: offer.state, text: "yes" });
  assert.equal(accepted.state.turns, 17);
  assert.equal(accepted.state.human_requested, true);
  assert.equal(accepted.handoff, true);
  assert.equal(accepted.response, "");
  assert.equal(accepted.state.ready_for_route_audit, false);
  const stopped = nextMetaResponse({ lead, state: offer.state, text: "STOP" });
  assert.equal(stopped.branch, "opted_out");
  assert.notEqual(stopped.state.human_requested, true);
  const alreadyHandedOff = nextMetaResponse({ lead, state: { ...offer.state, handoff: true, ready_for_route_audit: false }, text: "yes" });
  assert.notEqual(alreadyHandedOff.state.human_requested, true);
  assert.equal(alreadyHandedOff.response, "");
  const capped = nextMetaResponse({ lead, state: { turns: 16, expected: "yard" }, text: "A" });
  assert.equal(capped.handoff, true);
  assert.equal(capped.response, "");
  assert.notEqual(capped.state.human_requested, true);
});

test("STOP takes priority over identity questions and an existing handoff cannot restart", () => {
  const stop = nextMetaResponse({ lead, text: "Stop texting me. Are you a bot?" });
  assert.equal(stop.branch, "opted_out");
  assert.equal(stop.response, "");
  const paused = nextMetaResponse({ lead, state: { handoff: true }, text: "is this AI?" });
  assert.equal(paused.response, "");
  assert.equal(paused.handoff, true);
});
