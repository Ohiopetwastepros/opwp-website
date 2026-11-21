import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaConfirmation, mapMetaAnswers } from "../lib/meta-lead-policy.mjs";

const lead = { name: "Jason Example", number_of_dogs: 2, zip: "43551", clean_up_frequency: "Weekly" };
const opener = "Hi Jason, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form.";
const missingDogs = "How many dogs exactly should we plan for?";
const missingZip = "What ZIP code is the yard in?";
const missingFrequency = "Would you like weekly, every-other-week, twice-weekly, or one-time cleanup?";

function checkCopy(message, expected) {
  assert.equal(message, `${expected}\n\nReply STOP to opt out`);
  assert.doesNotMatch(message, /[\u2013\u2014]/);
  assert.doesNotMatch(message, /automated confirmation/i);
  assert.match(message, /^[\x00-\x7f]+$/);
  assert.equal(message.split("Reply STOP to opt out").length, 2);
  assert.equal(message.split("\n").length, 3);
  assert.equal(message, message.trim());
  assert.ok(message.length <= 1000, "confirmation fits the stored message limit");
}

test("Meta confirmation full data matches Craig's approved text exactly", () => {
  checkCopy(buildMetaConfirmation(lead), `${opener} I have you down for 2 dogs in ZIP 43551 with weekly service. Did I get that right?`);
  checkCopy(buildMetaConfirmation({ ...lead, name: "Craig Bridgman", zip: "43537" }), "Hi Craig, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form. I have you down for 2 dogs in ZIP 43537 with weekly service. Did I get that right?");
});

for (const [label, overrides, summary, questions] of [
  ["one dog and one-time cleanup", { number_of_dogs: 1, zip: "43537", clean_up_frequency: "One Time" }, "I have you down for 1 dog in ZIP 43537 with one-time service. Did I get that right?", []],
  ["missing dogs", { number_of_dogs: null }, "I have you down for weekly service in ZIP 43551. Did I get that right?", [missingDogs]],
  ["missing ZIP with safe city", { zip: "", city: "Maumee" }, "I have you down for 2 dogs in Maumee with weekly service. Did I get that right?", [missingZip]],
  ["ZIP preferred over city", { city: "Maumee" }, "I have you down for 2 dogs in ZIP 43551 with weekly service. Did I get that right?", []],
  ["missing ZIP and city", { zip: "" }, "I have you down for 2 dogs with weekly service. Did I get that right?", [missingZip]],
  ["unsafe city omitted", { zip: "", city: "Maumee\u2014Toledo" }, "I have you down for 2 dogs with weekly service. Did I get that right?", [missingZip]],
  ["missing frequency", { clean_up_frequency: "" }, "I have you down for 2 dogs in ZIP 43551. Did I get that right?", [missingFrequency]],
  ["only frequency", { number_of_dogs: null, zip: "" }, "I have you down for weekly service. Did I get that right?", [missingDogs, missingZip]],
  ["only dogs", { zip: "", clean_up_frequency: "" }, "I have you down for 2 dogs. Did I get that right?", [missingZip, missingFrequency]],
  ["only ZIP", { number_of_dogs: null, clean_up_frequency: "" }, "I have you down for cleanups in ZIP 43551. Did I get that right?", [missingDogs, missingFrequency]],
  ["missing dogs with city", { number_of_dogs: null, zip: "", city: "Maumee" }, "I have you down for weekly service in Maumee. Did I get that right?", [missingDogs, missingZip]],
  ["nothing known", { number_of_dogs: null, zip: "", clean_up_frequency: "" }, "", [missingDogs, missingZip, missingFrequency]],
]) {
  test(`Meta confirmation copy: ${label}`, () => {
    const expectedBody = [opener, summary, ...questions].filter(Boolean).join(" ");
    checkCopy(buildMetaConfirmation({ ...lead, ...overrides }), `${expectedBody}`);
  });
}

for (const [answer, normalized, phrase] of [
  ["Weekly", "Weekly", "weekly"],
  ["Every Other Week", "Biweekly", "every other week"],
  ["Bi-Weekly", "Biweekly", "every other week"],
  ["Twice A Week", "Twice Weekly", "twice a week"],
  ["Monthly", "Monthly", "monthly"],
  ["One Time", "One Time", "one-time"],
]) {
  test(`Meta confirmation frequency: ${answer}`, () => {
    const mapped = mapMetaAnswers({ clean_up_frequency: answer });
    assert.equal(mapped.clean_up_frequency, normalized);
    for (const clean_up_frequency of [answer, mapped.clean_up_frequency]) {
      checkCopy(buildMetaConfirmation({ ...lead, clean_up_frequency }), `${opener} I have you down for 2 dogs in ZIP 43551 with ${phrase} service. Did I get that right?`);
    }
  });
}

test("Meta confirmation unknown frequency uses lower-case service fallback and ASCII dashes", () => {
  checkCopy(buildMetaConfirmation({ ...lead, clean_up_frequency: "Custom\u2013Seasonal\u2014Plan" }), `${opener} I have you down for 2 dogs in ZIP 43551 with custom-seasonal-plan service. Did I get that right?`);
});

for (const name of ["", null, "123", "Jason! Example", "<script> Example", "A".repeat(41)]) {
  test(`Meta confirmation omits unusable name ${JSON.stringify(name)}`, () => {
    checkCopy(buildMetaConfirmation({ ...lead, name }), `Hi, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form. I have you down for 2 dogs in ZIP 43551 with weekly service. Did I get that right?`);
  });
}

test("Meta confirmation no name and city-only location with every-other-week frequency", () => {
  checkCopy(buildMetaConfirmation({ name: "", number_of_dogs: null, zip: "", city: "Maumee", clean_up_frequency: "Every Other Week" }), `Hi, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form. I have you down for every other week service in Maumee. Did I get that right? ${missingDogs} ${missingZip}`);
});

test("Meta confirmation no known details omits confirmation question", () => {
  checkCopy(buildMetaConfirmation({}), `Hi, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form. ${missingDogs} ${missingZip} ${missingFrequency}`);
});

test("Meta confirmation keeps the safe-name check and renders apostrophes as ASCII", () => {
  checkCopy(buildMetaConfirmation({ ...lead, name: "O\u2019Neil Example" }), `Hi O'Neil, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form. I have you down for 2 dogs in ZIP 43551 with weekly service. Did I get that right?`);
});
