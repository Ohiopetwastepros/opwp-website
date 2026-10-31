import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import routingPrivate from '../lib/routing-private.json' with {type:'json'};
const fixtureRouteDate=offset=>new Date(Date.parse(routingPrivate.ownerVerifiedRouteDates[0]+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildRoutePerformance, verifiedRouteTechnician, CRAIG_VERIFIED_ROUTE_DATES } from "../lib/route-performance.mjs";

const job = (technician, date, revenue = 600) => ({ technician, date, revenue, serviceMinutes: 120 });
const shift = (technician, date, minutes = 360) => ({ technician, date, minutes });

test("only primary technician and the four owner-confirmed relief technician dates are eligible", () => {
  for (const date of CRAIG_VERIFIED_ROUTE_DATES) assert.equal(verifiedRouteTechnician((" " + staffPrivate.reliefName + " "), date), staffPrivate.reliefName);
  for (const date of [(fixtureRouteDate(-1)), (fixtureRouteDate(3)), (fixtureRouteDate(5)), (fixtureRouteDate(-365)), (fixtureRouteDate(365))]) assert.equal(verifiedRouteTechnician(staffPrivate.reliefName, date), null);
  assert.equal(verifiedRouteTechnician(staffPrivate.primaryName, (fixtureRouteDate(11))), staffPrivate.primaryName);
  for (const name of [staffPrivate.inactiveNames[0], "Unassigned", (staffPrivate.reliefName + "," + staffPrivate.primaryName), staffPrivate.primaryShort]) assert.equal(verifiedRouteTechnician(name, (fixtureRouteDate(4))), null);
  assert.equal(verifiedRouteTechnician(staffPrivate.primaryName, "2026-02-30"), null);
});

test("mixed-duty relief technician days contribute neither revenue nor hours", () => {
  const result = buildRoutePerformance({ jobs: [job(staffPrivate.primaryName, (fixtureRouteDate(11))), job(staffPrivate.reliefName, (fixtureRouteDate(11)), 900)], shifts: [shift(staffPrivate.primaryName, (fixtureRouteDate(11))), shift(staffPrivate.reliefName, (fixtureRouteDate(11)), 900)] });
  assert.equal(result.totals.revenue, 600);
  assert.equal(result.totals.clockedHours, 6);
  assert.equal(result.totals.revenuePerClockedHour, 100);
  assert.equal(result.days.length, 1);
});

test("approved relief technician day and primary technician use weighted weekly totals, including multiple shifts", () => {
  const result = buildRoutePerformance({ jobs: [job(staffPrivate.reliefName, (fixtureRouteDate(4)), 200), job(staffPrivate.primaryName, (fixtureRouteDate(5)), 600)], shifts: [shift(staffPrivate.reliefName, (fixtureRouteDate(4)), 60), shift(staffPrivate.primaryName, (fixtureRouteDate(5)), 180), shift(staffPrivate.primaryName, (fixtureRouteDate(5)), 180)] });
  assert.equal(result.weeks.length, 1);
  assert.equal(result.weeks[0].week, (fixtureRouteDate(4)));
  assert.equal(result.weeks[0].revenuePerClockedHour, 114.29);
  assert.equal(result.technicians.length, 2);
});

test("missing hours or values suppress affected totals without suppressing a valid day", () => {
  for (const missing of ["hours", "value"]) {
    const result = buildRoutePerformance({ jobs: [job(staffPrivate.primaryName, (fixtureRouteDate(11))), job(staffPrivate.primaryName, (fixtureRouteDate(12)), missing === "value" ? 0 : 500)], shifts: [shift(staffPrivate.primaryName, (fixtureRouteDate(11))), ...(missing === "hours" ? [] : [shift(staffPrivate.primaryName, (fixtureRouteDate(12)))])] });
    assert.equal(result.totals.revenuePerClockedHour, null);
    assert.equal(result.weeks[0].gapToTarget, null);
    assert.equal(result.days.find(row => row.date === (fixtureRouteDate(11))).revenuePerClockedHour, 100);
  }
});

test("eligible shift-only time counts, and the cutoff excludes unfinished days", () => {
  const result = buildRoutePerformance({ jobs: [job(staffPrivate.primaryName, (fixtureRouteDate(11))), job(staffPrivate.primaryName, (fixtureRouteDate(14)), 900)], shifts: [shift(staffPrivate.primaryName, (fixtureRouteDate(11))), shift(staffPrivate.primaryName, (fixtureRouteDate(12)), 120), shift(staffPrivate.primaryName, (fixtureRouteDate(14)), 60)], throughDate: (fixtureRouteDate(13)) });
  assert.equal(result.totals.clockedHours, 8);
  assert.equal(result.totals.revenuePerClockedHour, 75);
  assert.equal(result.totals.gapToTarget, 200);
});

test("invalid shifts and an empty dataset never produce a passing benchmark", () => {
  for (const minutes of [0, -5, Infinity, "bad"]) {
    const result = buildRoutePerformance({ jobs: [job(staffPrivate.primaryName, (fixtureRouteDate(11)))], shifts: [shift(staffPrivate.primaryName, (fixtureRouteDate(11))), shift(staffPrivate.primaryName, (fixtureRouteDate(11)), minutes)] });
    assert.equal(result.totals.ready, false);
    assert.equal(result.totals.revenuePerClockedHour, null);
  }
  assert.equal(buildRoutePerformance().totals.revenuePerClockedHour, null);
});

test("cockpit totals and technician rows apply the policy and exclude today's open work", () => {
  const source = readFileSync(new URL("../lib/airtable.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [(fixtureRouteDate(14) + "T16:00:00Z")])); }
    static now() { return Date.parse((fixtureRouteDate(14) + "T16:00:00Z")); }
  };
  const data = {
    customers: [], churn: [], oneTime: [], leads: [], targets: [],
    jobs: [
      { fields: { "Job ID": staffPrivate.primaryShortKey, Date: (fixtureRouteDate(11)), Status: "Completed", "Tech Name": staffPrivate.primaryName, "Revenue ($)": 600 } },
      { fields: { "Job ID": "mixed", Date: (fixtureRouteDate(11)), Status: "Completed", "Tech Name": staffPrivate.reliefName, "Revenue ($)": 2000 } },
      { fields: { "Job ID": "verified", Date: (fixtureRouteDate(4)), Status: "Completed", "Tech Name": staffPrivate.reliefName, "Revenue ($)": 200 } },
      { fields: { "Job ID": "open", Date: (fixtureRouteDate(14)), Status: "Completed", "Tech Name": staffPrivate.primaryName, "Revenue ($)": 500 } },
    ],
    time: [
      { fields: { "Record ID": staffPrivate.primaryShortKey, Date: (fixtureRouteDate(11)), "Tech Name": staffPrivate.primaryName, "Minutes Clocked": 360 } },
      { fields: { "Record ID": "mixed", Date: (fixtureRouteDate(11)), "Tech Name": staffPrivate.reliefName, "Minutes Clocked": 900 } },
      { fields: { "Record ID": "verified", Date: (fixtureRouteDate(4)), "Tech Name": staffPrivate.reliefName, "Minutes Clocked": 60 } },
    ],
  };
  const result = runPrivateInNewContext(`${source}\nopwpMetrics(data);`, { data, buildRoutePerformance, Date: FixedDate, Intl });
  assert.equal(result.routeRevenuePerHour30, 114.29);
  assert.equal(result.technicianEconomicsReady, true);
  assert.equal(result.routePerformance.fromDate, (fixtureRouteDate(-16)));
  assert.equal(result.routePerformance.throughDate, (fixtureRouteDate(13)));
  assert.equal(result.technicians.find(row => row.name === staffPrivate.reliefName).revenue, 200);
  assert.equal(result.technicians.find(row => row.name === staffPrivate.primaryName).revenuePerClockedHour, 100);
});
