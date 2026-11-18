import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaConfirmation, mapMetaAnswers } from "../lib/meta-lead-policy.mjs";

const lead = { name: "Jason Example", number_of_dogs: 2, zip: "43551", clean_up_frequency: "Weekly" };
const opener = "Hello Jason, this is Craig with Ohio Pet Waste Pros. I received your Facebook form.";
const closing = "\n\nReply STOP to opt out";
const missingDogs = "How many dogs exactly should we plan for?";
const missingZip = "What ZIP code is the yard in?";
const missingFrequency = "Would you like weekly, every-other-week, twice-weekly, or one-time cleanup?";

function checkCopy(message, expected) {
  assert.equal(message, expected);
  assert.doesNotMatch(message, /[\u2013\u2014]/);
  assert.doesNotMatch(message, /automated confirmation/i);
  assert.match(message, /^[\x00-\x7f]+$/);
  assert.equal(message.split("Reply STOP to opt out").length, 2);
  assert.equal(message.split("\n").length, 3);
  assert.ok(message.endsWith(closing));
  assert.ok(message.length <= 1000, "confirmation fits the stored message limit");
}

test("Meta confirmation full data matches Craig's approved text exactly", () => {
  checkCopy(buildMetaConfirmation(lead), "Hello Jason, this is Craig with Ohio Pet Waste Pros. I received your Facebook form. You have 2 dogs, live in 43551, and would like cleanups weekly. Is that correct?\n\nReply STOP to opt out");
});

for (const [label, overrides, summary, questions] of [
  ["one dog and one-time cleanup", { number_of_dogs: 1, zip: "43537", clean_up_frequency: "One Time" }, "You have 1 dog, live in 43537, and would like a one-time cleanup. Is that correct?", []],
  ["missing dogs", { number_of_dogs: null }, "You live in 43551 and would like cleanups weekly. Is that correct?", [missingDogs]],
  ["missing ZIP with safe city", { zip: "", city: "Maumee" }, "You have 2 dogs, live in Maumee, and would like cleanups weekly. Is that correct?", [missingZip]],
  ["ZIP preferred over city", { city: "Maumee" }, "You have 2 dogs, live in 43551, and would like cleanups weekly. Is that correct?", []],
  ["missing ZIP and city", { zip: "" }, "You have 2 dogs and would like cleanups weekly. Is that correct?", [missingZip]],
  ["unsafe city omitted", { zip: "", city: "Maumee\u2014Toledo" }, "You have 2 dogs and would like cleanups weekly. Is that correct?", [missingZip]],
  ["missing frequency", { clean_up_frequency: "" }, "You have 2 dogs and live in 43551. Is that correct?", [missingFrequency]],
  ["only frequency", { number_of_dogs: null, zip: "" }, "You would like cleanups weekly. Is that correct?", [missingDogs, missingZip]],
  ["only dogs", { zip: "", clean_up_frequency: "" }, "You have 2 dogs. Is that correct?", [missingZip, missingFrequency]],
  ["only ZIP", { number_of_dogs: null, clean_up_frequency: "" }, "You live in 43551. Is that correct?", [missingDogs, missingFrequency]],
  ["missing dogs with city", { number_of_dogs: null, zip: "", city: "Maumee" }, "You live in Maumee and would like cleanups weekly. Is that correct?", [missingDogs, missingZip]],
  ["nothing known", { number_of_dogs: null, zip: "", clean_up_frequency: "" }, "", [missingDogs, missingZip, missingFrequency]],
]) {
  test(`Meta confirmation copy: ${label}`, () => {
    const expectedBody = [opener, summary, ...questions].filter(Boolean).join(" ");
    checkCopy(buildMetaConfirmation({ ...lead, ...overrides }), `${expectedBody}${closing}`);
  });
}

for (const [answer, normalized, phrase] of [
  ["Weekly", "Weekly", "would like cleanups weekly"],
  ["Every Other Week", "Biweekly", "would like cleanups every other week"],
  ["Bi-Weekly", "Biweekly", "would like cleanups every other week"],
  ["Twice A Week", "Twice Weekly", "would like cleanups twice a week"],
  ["Monthly", "Monthly", "would like cleanups monthly"],
  ["One Time", "One Time", "would like a one-time cleanup"],
]) {
  test(`Meta confirmation frequency: ${answer}`, () => {
    const mapped = mapMetaAnswers({ clean_up_frequency: answer });
    assert.equal(mapped.clean_up_frequency, normalized);
    for (const clean_up_frequency of [answer, mapped.clean_up_frequency]) {
      checkCopy(buildMetaConfirmation({ ...lead, clean_up_frequency }), `${opener} You have 2 dogs, live in 43551, and ${phrase}. Is that correct?${closing}`);
    }
  });
}

test("Meta confirmation unknown frequency uses lower-case service fallback and ASCII dashes", () => {
  checkCopy(buildMetaConfirmation({ ...lead, clean_up_frequency: "Custom\u2013Seasonal\u2014Plan" }), `${opener} You have 2 dogs, live in 43551, and would like custom-seasonal-plan service. Is that correct?${closing}`);
});

for (const name of ["", null, "123", "Jason! Example", "<script> Example", "A".repeat(41)]) {
  test(`Meta confirmation omits unusable name ${JSON.stringify(name)}`, () => {
    checkCopy(buildMetaConfirmation({ ...lead, name }), `Hello, this is Craig with Ohio Pet Waste Pros. I received your Facebook form. You have 2 dogs, live in 43551, and would like cleanups weekly. Is that correct?${closing}`);
  });
}

test("Meta confirmation no name and city-only location with every-other-week frequency", () => {
  checkCopy(buildMetaConfirmation({ name: "", number_of_dogs: null, zip: "", city: "Maumee", clean_up_frequency: "Every Other Week" }), `Hello, this is Craig with Ohio Pet Waste Pros. I received your Facebook form. You live in Maumee and would like cleanups every other week. Is that correct? ${missingDogs} ${missingZip}${closing}`);
});

test("Meta confirmation no known details omits confirmation question", () => {
  checkCopy(buildMetaConfirmation({}), `Hello, this is Craig with Ohio Pet Waste Pros. I received your Facebook form. ${missingDogs} ${missingZip} ${missingFrequency}${closing}`);
});

test("Meta confirmation keeps the safe-name check and renders apostrophes as ASCII", () => {
  checkCopy(buildMetaConfirmation({ ...lead, name: "O\u2019Neil Example" }), `Hello O'Neil, this is Craig with Ohio Pet Waste Pros. I received your Facebook form. You have 2 dogs, live in 43551, and would like cleanups weekly. Is that correct?${closing}`);
});
