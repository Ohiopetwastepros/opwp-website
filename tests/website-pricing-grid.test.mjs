import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLEANUP_RANGE_EXPLANATION, PRICING, PRICING_VERSION, YARD_TIERS,
  calcLocalQuote, formatCleanupRange, haulAwayPrice, isFrequencyOffered,
} from "../app/free-quote/pricing.js";

const monthly = {
  twice_a_week:     [175, 190, 225, 245, 275, 305, 335],
  once_a_week:      [95, 110, 125, 140, 155, 170, 185],
  every_other_week: [72, 80, 92, null, null, null, null],
  once_a_month:     [55, 65, null, null, null, null, null],
};
const initial = {
  one_week:     [[20, 26], [23, 30], [25, 33], [28, 36], [29, 37]],
  two_weeks:    [[27, 34], [32, 39], [36, 43], [40, 47], [42, 49]],
  three_weeks:  [[37, 45], [45, 52], [51, 58], [57, 65], [60, 70]],
  one_month:    [[48, 58], [58, 70], [65, 75], [75, 85], [90, 105]],
  two_months:   [[65, 75], [75, 85], [90, 100], [105, 125], [140, 160]],
  "3_4_months": [[85, 95], [90, 100], [100, 110], [115, 135], [160, 185]],
};
const oneTime = {
  one_week:     [[30, 41], [36, 46], [38, 50], [42, 53], [44, 55]],
  two_weeks:    [[42, 53], [50, 60], [53, 65], [60, 70], [65, 75]],
  three_weeks:  [[58, 70], [70, 80], [75, 85], [85, 95], [90, 105]],
  one_month:    [[65, 80], [80, 110], [95, 120], [120, 150], [145, 170]],
  two_months:   [[80, 110], [105, 130], [115, 145], [145, 170], [165, 195]],
  "3_4_months": [[105, 130], [125, 155], [140, 165], [165, 195], [190, 220]],
};
const histories = [...Object.keys(initial), "5_6_months", "7_9_months", "10_plus"];
const form = readFileSync(new URL("../app/free-quote/QuoteForm.js", import.meta.url), "utf8");

test("the versioned recurring grid returns the approved total and availability for every dog count", () => {
  assert.equal(PRICING_VERSION, "sng-2026-11-18");
  assert.deepEqual(Object.keys(PRICING.monthly).sort(), Object.keys(monthly).sort());
  for (const [frequency, prices] of Object.entries(monthly)) {
    assert.deepEqual(Object.keys(PRICING.monthly[frequency]), ["1", "2", "3", "4", "5", "6", "7"]);
    for (const [index, expected] of prices.entries()) {
      const dogs = index + 1;
      const key = `${frequency} / ${dogs} dogs`;
      assert.equal(PRICING.monthly[frequency][dogs], expected, key);
      assert.equal(calcLocalQuote({ dogs, frequency, lastCleaned: "two_weeks" }).monthly, expected, key);
      assert.equal(isFrequencyOffered(frequency, dogs), expected !== null, key);
    }
  }
  assert.equal(PRICING.frequencies.find(({ id }) => id === "once_a_month").maxDogs, 2);
  assert.equal(PRICING.frequencies.find(({ id }) => id === "every_other_week").maxDogs, 3);
  assert.match(form, /const disabled = !isFrequencyOffered\(f\.id, dogs\);\s*return \([\s\S]*?disabled=\{disabled\}/);
});

test("both cleanup grids match all 60 priced cells and all 66 custom cells", () => {
  assert.deepEqual(PRICING.lastCleanedOptions.map(({ id }) => id), histories);
  for (const lastCleaned of histories) {
    for (let dogs = 1; dogs <= 7; dogs++) {
      const key = `${lastCleaned} / ${dogs} dogs`;
      const initialRange = initial[lastCleaned]?.[dogs - 1] ?? null;
      const oneTimeRange = oneTime[lastCleaned]?.[dogs - 1] ?? null;
      assert.deepEqual(PRICING.initialCleanup[lastCleaned]?.[dogs] ?? null, initialRange, key);
      assert.deepEqual(PRICING.oneTimeCleanup[lastCleaned]?.[dogs] ?? null, oneTimeRange, key);
      assert.deepEqual(calcLocalQuote({ dogs, frequency: "once_a_week", lastCleaned }).initialRange, initialRange, key);
      assert.deepEqual(calcLocalQuote({ dogs, frequency: "one_time", lastCleaned }).oneTimeRange, oneTimeRange, key);
    }
  }
});

test("seven dogs keeps its recurring service rate and eight or more requires a custom quote for all service", () => {
  assert.equal(calcLocalQuote({ frequency: "once_a_week", dogs: 7, lastCleaned: "two_weeks" }).monthly, 185);
  assert.match(form, /id="quote-dog-count"[^>]*max="7"/);
  assert.match(form, /For 8 or more dogs,[^\n]*custom quote/);
  for (const { id: frequency } of PRICING.frequencies) {
    for (const dogs of [8, 9, 20, 99]) {
      assert.equal(isFrequencyOffered(frequency, dogs), false);
      for (const lastCleaned of histories) {
        const quote = calcLocalQuote({ dogs, frequency, lastCleaned });
        assert.equal(quote.monthly, null);
        assert.equal(frequency === "one_time" ? quote.oneTimeRange : quote.initialRange, null);
      }
    }
  }
});

test("add-on prices, billing units and yard upcharges retain the approved rates", () => {
  assert.deepEqual(PRICING.addons.map(({ id, price, charge }) => [id, price, charge]), [
    ["front_yard", 21, "monthly"], ["deodorize", 25, "per_treatment"], ["haul_away", 21, "monthly"],
    ["sani_monthly", 30, "monthly"], ["sani_onetime", 35, "one_time"],
    ...["blue", "green", "pink", "red"].map((color) => [`food_${color}`, 59, "product"]),
  ]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(haulAwayPrice), [21, 21, 31, 31, 31, 31, 31]);
  assert.deepEqual(Object.fromEntries(YARD_TIERS.map(({ id, upcharge }) => [id, upcharge])), {
    tiny: 0, small: 10, medium: 20, large: 30, xlarge: null, unsure: 0,
  });
});

test("the quote result and signup summary pair every priced cleanup range with the approved explanation", () => {
  const { initialRange } = calcLocalQuote({ dogs: 1, frequency: "once_a_week", lastCleaned: "two_weeks" });
  assert.equal(formatCleanupRange(initialRange), "$27 to $34");
  assert.equal(CLEANUP_RANGE_EXPLANATION, "We provide a range which is based on how much waste is in the yard and how long it takes the technician.");
  const prices = [...form.matchAll(/formatCleanupRange\(base\.(initialRange|oneTimeRange)\)/g)];
  assert.deepEqual(prices.map((match) => match[1]), ["oneTimeRange", "initialRange", "oneTimeRange", "initialRange"]);
  for (const { index } of prices) {
    assert.match(form.slice(index, index + 400), /CLEANUP_RANGE_EXPLANATION/);
  }
  const visibleSource = form.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(visibleSource + JSON.stringify(YARD_TIERS) + CLEANUP_RANGE_EXPLANATION, /[\u2013\u2014]|Exact price confirmed on-site/);
});
