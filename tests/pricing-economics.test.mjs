import assert from "node:assert/strict";
import test from "node:test";
import { calculateJobPrice, roundPriceUp } from "../lib/pricing-economics.mjs";

test("rounds recommendations upward so the calculated floor is never undercut", () => {
  assert.equal(roundPriceUp(112.01, 5), 115);
  assert.equal(roundPriceUp(115, 5), 115);
  assert.equal(roundPriceUp(0, 5), 0);
});

test("uses loaded labor and fixed costs when the margin floor is higher", () => {
  const result = calculateJobPrice({
    technicianWages: [20], jobMinutes: 60, additionalMinutes: 0,
    burdenPercent: 25, fixedJobCosts: 15, targetRevenuePerCrewHour: 20,
    targetMarginPercent: 60, roundingIncrement: 5,
  });
  assert.equal(result.directLabor, 20);
  assert.equal(result.loadedLabor, 25);
  assert.equal(result.estimatedCost, 40);
  assert.equal(result.marginFloor, 100);
  assert.equal(result.recommendedPrice, 100);
});

test("applies payroll burden to Tony only and allocates overhead by crew time", () => {
  const result = calculateJobPrice({
    technicianWages: [30, 20], jobMinutes: 60, burdenPercent: 12,
    burdenedTechnicianIndex: 0, fixedOverheadPerCrewHour: 10,
    targetRevenuePerCrewHour: 0, targetMarginPercent: 0,
  });
  assert.equal(result.directLabor, 50);
  assert.equal(result.payrollBurdenCost, 3.6);
  assert.equal(result.loadedLabor, 53.6);
  assert.equal(result.fixedJobCosts, 10);
  assert.equal(result.estimatedCost, 63.6);
});

test("accounts for every technician and additional paid time", () => {
  const result = calculateJobPrice({
    technicianWages: [20, 25], jobMinutes: 30, additionalMinutes: 10,
    burdenPercent: 20, fixedJobCosts: 10, targetRevenuePerCrewHour: 150,
    targetMarginPercent: 50, roundingIncrement: 5,
  });
  assert.equal(result.laborHours, 4 / 3);
  assert.equal(result.directLabor, 30);
  assert.equal(result.loadedLabor, 36);
  assert.equal(result.estimatedCost, 46);
  assert.equal(result.hourlyFloor, 100);
  assert.equal(result.recommendedPrice, 100);
});

test("evaluates an actual quote independently from the recommendation", () => {
  const result = calculateJobPrice({
    technicianWages: [20], jobMinutes: 60, burdenPercent: 0,
    fixedJobCosts: 0, targetRevenuePerCrewHour: 200,
    targetMarginPercent: 50, roundingIncrement: 5, actualPrice: 150,
  });
  assert.equal(result.recommendedPrice, 200);
  assert.equal(result.priceUsed, 150);
  assert.equal(result.hasActualPrice, true);
  assert.equal(result.meetsHourlyTarget, false);
});

test("bounds unsafe or nonsensical numeric inputs", () => {
  const result = calculateJobPrice({
    technicianWages: [-5, 999, 30, 40], jobMinutes: -20,
    additionalMinutes: 99999, burdenPercent: 999, fixedJobCosts: -1,
    targetRevenuePerCrewHour: Number.POSITIVE_INFINITY, targetMarginPercent: 100,
  });
  assert.deepEqual(result.technicianCount, 3);
  assert.equal(result.additionalMinutes, 480);
  assert.equal(result.loadedLabor, 4480);
  assert.ok(Number.isFinite(result.recommendedPrice));
});
