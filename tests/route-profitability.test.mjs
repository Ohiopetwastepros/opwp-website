import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import { buildRouteProfitabilityFacts, closedRouteDate, mergeRouteFacts, summarizeRouteProfit } from "../lib/route-profitability.mjs";
import { applyQuickBooksRouteCosts, parseRouteCostReport, COST_GROUPS } from "../lib/quickbooks-route-costs.mjs";

const job = (id, date, name, revenue = 100) => ({ id, fields: { "Job ID": id, Date: date, "Tech Name": name, Status: "Completed", "Revenue ($)": revenue } });
const shift = (id, date, name, minutes = 60) => ({ fields: { "Record ID": id, Date: date, "Tech Name": name, "Minutes Clocked": minutes } });
const costSource = { months: [{ month: "2026-09", start: "2026-09-01", end: "2026-09-30", totalCosts: 300, income: 1000, reconciled: true, groups: Object.fromEntries(COST_GROUPS.map((group, index) => [group, index ? 0 : 300])) }] };
const coverage = { coveredFrom: "2026-09-01", coveredThrough: "2026-09-30" };
const sourceFacts = () => buildRouteProfitabilityFacts({ jobs: [job("a", "2026-09-07", staffPrivate.primaryName, 400), job("b", "2026-09-07", staffPrivate.reliefName, 200), job("c", "2026-09-08", staffPrivate.primaryName, 300)], time: [shift("a", "2026-09-07", staffPrivate.primaryName, 240), shift("b", "2026-09-07", staffPrivate.reliefName, 900), shift("c", "2026-09-08", staffPrivate.primaryName, 120)] }, { throughDate: "2026-09-30" });

test("all serviced accounts contribute revenue and costs but only primary technician contributes hours", () => {
  const rows = applyQuickBooksRouteCosts(sourceFacts(), costSource, coverage);
  assert.equal(rows[0].revenue, 600);
  assert.equal(rows[0].hours, 4);
  assert.equal(rows[0].totalCost, 200);
  assert.equal(rows[0].profit, 400);
  assert.equal(rows[0].revenuePerHour, 150);
  assert.equal(rows[0].profitPerHour, 100);
  const total = summarizeRouteProfit(rows);
  assert.equal(total.hours, 6);
  assert.equal(total.revenue, 900);
  assert.equal(total.totalCost, 300);
  assert.equal(total.profitPerHour, 100);
  // Filtering after allocation does not reassign the other day's overhead.
  assert.equal(summarizeRouteProfit(rows.slice(1)).totalCost, 100);
});

test("relief technician-only days have no daily hourly rate but remain in a blended period numerator", () => {
  const facts = buildRouteProfitabilityFacts({ jobs: [job("a", "2026-09-07", staffPrivate.reliefName)], time: [shift("a", "2026-09-07", staffPrivate.reliefName)] }, { throughDate: "2026-09-30" });
  const rows = applyQuickBooksRouteCosts(facts, costSource, coverage);
  assert.equal(rows[0].hours, 0);
  assert.equal(rows[0].profit, -200);
  assert.equal(rows[0].revenuePerHour, null);
  assert.equal(rows[0].profitPerHour, null);
  assert.equal(summarizeRouteProfit(rows).profitPerHour, null);
  const mixed = applyQuickBooksRouteCosts([...facts, ...sourceFacts().filter(row => row.date === "2026-09-08")], costSource, coverage);
  assert.equal(summarizeRouteProfit(mixed).revenuePerHour, 200);
});

test("completed skip events are excluded from visits, revenue gaps and expense allocation", () => {
  const skipped = job("skip", "2026-09-07", "", 0);
  skipped.fields["Service Type"] = "skip";
  assert.deepEqual(buildRouteProfitabilityFacts({ jobs: [skipped] }, { throughDate: "2026-09-30" }), []);
});

test("costs are not fabricated when source, full month coverage or reconciliation is missing", () => {
  for (const [costs, bounds] of [[null, coverage], [costSource, { ...coverage, coveredFrom: "2026-09-02" }], [{ months: [{ ...costSource.months[0], reconciled: false }] }, coverage]]) {
    const rows = applyQuickBooksRouteCosts(sourceFacts(), costs, bounds);
    assert.equal(rows[0].profit, null);
    assert.equal(rows[0].revenuePerHour, 150);
    assert.equal(summarizeRouteProfit(rows).profit, null);
  }
});

test("a partial-month QuickBooks report cannot allocate costs beyond its report end", () => {
  const partial = { months: [{ ...costSource.months[0], end: "2026-09-07" }] };
  const rows = applyQuickBooksRouteCosts(sourceFacts(), partial, coverage);
  assert.equal(rows[0].totalCost, 300);
  assert.equal(rows[1].totalCost, null);
  assert.equal(summarizeRouteProfit(rows).profit, null);
});

test("deduplication, missing values, invalid shifts and open days are handled conservatively", () => {
  const facts = buildRouteProfitabilityFacts({ jobs: [job("a", "2026-09-07", staffPrivate.primaryName), job("a", "2026-09-07", staffPrivate.primaryName), job("b", "2026-09-08", staffPrivate.primaryName, 0), job("c", "2026-09-09", staffPrivate.primaryName)], time: [shift("a", "2026-09-07", staffPrivate.primaryName, 0), shift("a", "2026-09-07", staffPrivate.primaryName, 0)] }, { throughDate: "2026-09-08" });
  assert.equal(facts.length, 2);
  assert.equal(facts[0].jobs, 1);
  assert.equal(facts[0].invalidShifts, 1);
  assert.equal(facts[1].missingValues, 1);
  const rows = applyQuickBooksRouteCosts(facts, costSource, coverage);
  assert.equal(rows[0].revenuePerHour, null);
  assert.equal(rows[1].profit, null);
});

test("historical revenue never substitutes a current subscription price", () => {
  const customer = { fields: { "Client Name": "Sample", "MRR ($)": 130, "Weighted Stop": 1 } };
  const sourceJob = job("x", "2026-09-07", staffPrivate.primaryName, 25);
  Object.assign(sourceJob.fields, { "Customer Name": "Sample", "Service Type": "Recurring" });
  const facts = buildRouteProfitabilityFacts({ jobs: [sourceJob], customers: [customer] }, { throughDate: "2026-09-30" });
  assert.equal(facts[0].revenue, 25);
  assert.equal(facts[0].estimatedJobs, 0);
  const missingPriceJob = { ...sourceJob, fields: { ...sourceJob.fields, "Revenue ($)": 0 } };
  const estimated = buildRouteProfitabilityFacts({ jobs: [missingPriceJob], customers: [customer] }, { throughDate: "2026-09-30" });
  assert.equal(estimated[0].revenue, 0);
  assert.equal(estimated[0].missingValues, 1);
  assert.equal(estimated[0].estimatedJobs, 0);
  const ambiguous = buildRouteProfitabilityFacts({ jobs: [sourceJob], customers: [customer, customer] }, { throughDate: "2026-09-30" });
  assert.equal(ambiguous[0].revenue, 25);
});

test("history refresh replaces its window including deleted jobs, preserving older records", () => {
  const rows = [{ date: "2026-08-01", name: "A" }, { date: "2026-09-01", name: "A" }];
  assert.deepEqual(mergeRouteFacts(rows, [], "2026-09-01", "2026-09-30", "2026-01-01"), [rows[0]]);
  assert.equal(closedRouteDate(new Date("2026-09-20T02:00:00Z")), "2026-09-18");
});

function reportFixture() {
  const line = (label, value) => ({ type: "Data", ColData: [{ value: label, id: label }, { value: String(value) }] });
  const section = (group, label, rows, total) => ({ group, type: "Section", Header: { ColData: [{ value: label }] }, Rows: { Row: rows }, Summary: { ColData: [{ value: `Total ${label}` }, { value: String(total) }] } });
  return { Header: { Currency: "USD", ReportBasis: "Accrual" }, Columns: { Column: [{ ColType: "Account" }, { MetaData: [{ Name: "StartDate", Value: "2026-09-01" }, { Name: "EndDate", Value: "2026-09-30" }] }] }, Rows: { Row: [section("Income", "Income", [line("Service income", 1000)], 1000), section("Expenses", "Expenses", [section("Payroll", "Payroll expenses", [line("Wages", 150), line("Taxes", 30)], 180), line("Vehicle fuel", 60), line("Supplies", 20), line("Software", 50), line("Vehicle refund", -10)], 300)] } };
}

test("QuickBooks cost parser counts leaves once, reconciles totals, retains credits and includes all expenses", () => {
  const [month] = parseRouteCostReport(reportFixture());
  assert.equal(month.reconciled, true);
  assert.equal(month.totalCosts, 300);
  assert.equal(month.groups["Payroll & benefits"], 180);
  assert.equal(month.groups["Vehicle & travel"], 50);
  assert.equal(month.accounts.length, 6);
  const bad = reportFixture(); bad.Rows.Row[1].Summary.ColData[1].value = "999";
  assert.equal(parseRouteCostReport(bad)[0].reconciled, false);
});

test("QuickBooks parser rejects invalid basis and malformed values, never treats missing data as actual zero", () => {
  for (const field of ["Currency", "ReportBasis"]) {
    const report = reportFixture(); delete report.Header[field];
    assert.throws(() => parseRouteCostReport(report));
  }
  const bad = reportFixture(); bad.Rows.Row[1].Rows.Row[1].ColData[1].value = "NaN";
  assert.equal(parseRouteCostReport(bad)[0].reconciled, false);
});

test("QuickBooks parent-account postings count alongside subaccounts without counting summaries twice",()=>{
  const report=reportFixture();
  const payroll=report.Rows.Row[1].Rows.Row[0];
  payroll.Header.ColData=[{value:"Payroll expenses",id:"parent"},{value:"100"}];
  payroll.Summary.ColData[1].value="280";
  report.Rows.Row[1].Summary.ColData[1].value="400";
  const [month]=parseRouteCostReport(report);
  assert.equal(month.reconciled,true);
  assert.equal(month.totalCosts,400);
  assert.equal(month.groups["Payroll & benefits"],280);
});
