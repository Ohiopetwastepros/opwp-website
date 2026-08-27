import test from "node:test";
import assert from "node:assert/strict";
import { deriveQuickBooksPricingActuals } from "../lib/quickbooks-pricing.mjs";

const section = (label, children, total) => ({
  Header: { ColData: [{ value: label }, { value: "" }] },
  Rows: { Row: children },
  Summary: { ColData: [{ value: `Total ${label}` }, { value: String(total) }] },
});
const line = (label, amount) => ({ ColData: [{ value: label }, { value: String(amount) }] });

test("derives Tony-only burden and fixed overhead from a QuickBooks P&L", () => {
  const report = { Rows: { Row: [
    section("Cost of Goods Sold", [line("Scooping supplies", 1000)], 1000),
    section("Expenses", [
      section("Payroll expenses", [line("Wages", 30000), line("Taxes", 2400)], 32400),
      section("Employee benefits", [line("Workers' compensation insurance", 600)], 600),
      line("Vehicle expenses", 5000),
      line("Software Subscriptions", 2000),
    ], 40000),
  ] } };

  const actuals = deriveQuickBooksPricingActuals(report, {
    periodStart: "2025-01-01", periodEnd: "2025-12-31", tonyWeeklyHours: 40,
  });
  assert.equal(actuals.directPayroll, 30000);
  assert.equal(actuals.burdenCost, 3000);
  assert.equal(actuals.burdenPercent, 10);
  assert.equal(actuals.fixedOperatingCosts, 8000);
  assert.ok(Math.abs(actuals.fixedOverheadPerCrewHour - (8000 / (40 * 365 / 7))) < 0.000001);
});
