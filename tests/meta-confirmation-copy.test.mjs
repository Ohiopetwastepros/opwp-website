import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaConfirmation, mapMetaAnswers } from "../lib/meta-lead-policy.mjs";
import {countCraigSentences,validateCraigReply} from '../lib/craig-voice.mjs';

const lead = { name: "Jason Example", number_of_dogs: 2, zip: "43551", clean_up_frequency: "Weekly" };
const opener = "Hi Jason, this is Craig with Ohio Pet Waste Pros.";
const missingDogs = "Just to confirm, how many dogs total use the yard?";
const missingZip = "What's the ZIP code for the yard?";
const missingFrequency = "Just to check, were you thinking weekly, every other week, twice a week, monthly, or just one cleanup?";

function checkCopy(message, expected) {
  assert.equal(message, `${expected}\n\nReply STOP to opt out`);
  assert.doesNotMatch(message, /[\u2013\u2014]/);
  assert.doesNotMatch(message, /automated confirmation/i);
  assert.match(message, /^[\x00-\x7f]+$/);
  assert.equal(message.split("Reply STOP to opt out").length, 2);
  assert.equal(message.split("\n").length, 3);
  assert.equal(message, message.trim());
  assert.ok(message.length <= 1000, "confirmation fits the stored message limit");
  assert.equal((message.match(/\?/g)||[]).length,1,'ask one focused question');
  assert.ok(countCraigSentences(message)<=3);
  assert.deepEqual(validateCraigReply(message,{step:'first_contact',allowFirstContactFooter:true}),[]);
}

test("Meta confirmation full data matches Craig's approved text exactly", () => {
  checkCopy(buildMetaConfirmation(lead), `${opener} Just to make sure I have it right, you have 2 dogs in ZIP 43551 and are looking for weekly service. Did I get that right?`);
  checkCopy(buildMetaConfirmation({ ...lead, name: "Craig Bridgman", zip: "43537" }), "Hi Craig, this is Craig with Ohio Pet Waste Pros. Just to make sure I have it right, you have 2 dogs in ZIP 43537 and are looking for weekly service. Did I get that right?");
});

for (const [label, overrides, summary, questions] of [
  ["one dog and one-time cleanup", { number_of_dogs: 1, zip: "43537", clean_up_frequency: "One Time" }, "Just to make sure I have it right, you have 1 dog in ZIP 43537 and are looking for one-time service. Did I get that right?", []],
  ["missing dogs", { number_of_dogs: null }, "I have you down for weekly service in ZIP 43551.", [missingDogs]],
  ["missing ZIP with safe city", { zip: "", city: "Maumee" }, "I have you down for 2 dogs in Maumee with weekly service.", [missingZip]],
  ["ZIP preferred over city", { city: "Maumee" }, "Just to make sure I have it right, you have 2 dogs in ZIP 43551 and are looking for weekly service. Did I get that right?", []],
  ["missing ZIP and city", { zip: "" }, "I have you down for 2 dogs with weekly service.", [missingZip]],
  ["unsafe city omitted", { zip: "", city: "Maumee\u2014Toledo" }, "I have you down for 2 dogs with weekly service.", [missingZip]],
  ["missing frequency", { clean_up_frequency: "" }, "I have you down for 2 dogs in ZIP 43551.", [missingFrequency]],
  ["only frequency", { number_of_dogs: null, zip: "" }, "I have you down for weekly service.", [missingDogs]],
  ["only dogs", { zip: "", clean_up_frequency: "" }, "I have you down for 2 dogs.", [missingZip]],
  ["only ZIP", { number_of_dogs: null, clean_up_frequency: "" }, "I have you down for cleanups in ZIP 43551.", [missingDogs]],
  ["missing dogs with city", { number_of_dogs: null, zip: "", city: "Maumee" }, "I have you down for weekly service in Maumee.", [missingDogs]],
  ["nothing known", { number_of_dogs: null, zip: "", clean_up_frequency: "" }, "Thanks for filling out our Facebook form.", [missingDogs]],
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
      checkCopy(buildMetaConfirmation({ ...lead, clean_up_frequency }), `${opener} Just to make sure I have it right, you have 2 dogs in ZIP 43551 and are looking for ${phrase} service. Did I get that right?`);
    }
  });
}

test("Meta confirmation unknown frequency uses lower-case service fallback and ASCII dashes", () => {
  checkCopy(buildMetaConfirmation({ ...lead, clean_up_frequency: "Custom\u2013Seasonal\u2014Plan" }), `${opener} Just to make sure I have it right, you have 2 dogs in ZIP 43551 and are looking for custom-seasonal-plan service. Did I get that right?`);
});

for (const name of ["", null, "123", "Jason! Example", "<script> Example", "A".repeat(41)]) {
  test(`Meta confirmation omits unusable name ${JSON.stringify(name)}`, () => {
    checkCopy(buildMetaConfirmation({ ...lead, name }), `Hi, this is Craig with Ohio Pet Waste Pros. Just to make sure I have it right, you have 2 dogs in ZIP 43551 and are looking for weekly service. Did I get that right?`);
  });
}

test("Meta confirmation no name and city-only location with every-other-week frequency", () => {
  checkCopy(buildMetaConfirmation({ name: "", number_of_dogs: null, zip: "", city: "Maumee", clean_up_frequency: "Every Other Week" }), `Hi, this is Craig with Ohio Pet Waste Pros. I have you down for every other week service in Maumee. ${missingDogs}`);
});

test("Meta confirmation no known details omits confirmation question", () => {
  checkCopy(buildMetaConfirmation({}), `Hi, this is Craig with Ohio Pet Waste Pros. Thanks for filling out our Facebook form. ${missingDogs}`);
});

test("Meta confirmation keeps the safe-name check and renders apostrophes as ASCII", () => {
  checkCopy(buildMetaConfirmation({ ...lead, name: "O\u2019Neil Example" }), `Hi O'Neil, this is Craig with Ohio Pet Waste Pros. Just to make sure I have it right, you have 2 dogs in ZIP 43551 and are looking for weekly service. Did I get that right?`);
});

test('later confirmations retain the same copy without the first-contact footer',()=>{
  const first=buildMetaConfirmation(lead),later=buildMetaConfirmation(lead,{firstMessage:false});
  assert.equal(later,first.replace(/\n\nReply STOP to opt out$/,''));
  assert.deepEqual(validateCraigReply(later,{step:'first_contact'}),[]);
});
