import assert from "node:assert/strict";
import test from "node:test";
import { metaFollowUpDrafts } from "../lib/meta-conversation.mjs";

const closing = "\n\nReply STOP to opt out";
const messages = [
  "Did you see my confirmation? I can send your price and help get you on the schedule. Would you like me to send it over?",
  "I can help with your quote and check for an open route day this week. Would you like to get started?",
  "Just checking in one last time. If you'd like service now or down the road, reply here anytime. I'm happy to help.",
];

function checkDrafts(name, opener) {
  const drafts = metaFollowUpDrafts(name);
  assert.deepEqual(drafts.map(({ step, day }) => ({ step, day })), [
    { step: 1, day: 1 }, { step: 2, day: 3 }, { step: 3, day: 7 },
  ]);
  assert.deepEqual(drafts.map(({ body }) => body), messages.map((message) => `${opener} ${message}${closing}`));
  for (const { body } of drafts) {
    assert.match(body, /^[\x00-\x7f]+$/);
    assert.doesNotMatch(body, /[\u2013\u2014]/);
    assert.ok(body.endsWith(closing));
    assert.equal(body.split("Reply STOP to opt out").length, 2);
    assert.equal(body.split("\n").length, 3);
    assert.ok(body.slice(0, -closing.length).length < 230);
  }
}

test("Meta follow-ups use Jason's first name and Craig's exact copy", () => {
  checkDrafts("Jason Example", "Hello Jason, this is Craig with Ohio Pet Waste Pros.");
});

for (const name of [undefined, "", null, "123", "Jason! Example", "<script> Example", "A".repeat(41), "---"]) {
  test(`Meta follow-ups omit unusable name ${JSON.stringify(name)}`, () => {
    checkDrafts(name, "Hello, this is Craig with Ohio Pet Waste Pros.");
  });
}

test("Meta follow-ups keep the safe-name check and ASCII apostrophes", () => {
  checkDrafts("O\u2019Neil Example", "Hello O'Neil, this is Craig with Ohio Pet Waste Pros.");
});
