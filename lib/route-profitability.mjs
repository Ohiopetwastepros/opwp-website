import staffPrivate from './staff-private.json' with {type:'json'};
import routingPrivate from './routing-private.json' with {type:'json'};
export * from './route-profitability-calculations.mjs';
export const ROUTE_MEASUREMENT_POLICY = routingPrivate.profitabilityPolicy;

import {emptyRevenueMix,routeServiceValue,summarizeRevenueMix} from './route-revenue.mjs';
import {normalizedRouteKey as key,numericRouteValue as numeric,positiveRouteValue as positive,closedRouteDate,roundRoute,routeRecordId,uniqueRouteRecords,routeDay,validRouteDate,ROUTE_DAYS} from './route-profitability-calculations.mjs';
export function buildRouteProfitabilityFacts({ jobs = [], time = [], customers = [] } = {}, { fromDate, throughDate = closedRouteDate() } = {}) {
  const rows = new Map();
  const customerMap = new Map();
  for (const customer of customers) {
    const name = key(customer.fields?.["Client Name"]);
    // Ambiguous customer names cannot safely receive a subscription allocation.
    customerMap.set(name, customerMap.has(name) ? null : customer);
  }
  const get = (record) => {
    const fields = record.fields ?? {};
    const date = String(fields.Date ?? "").slice(0, 10);
    if (!validRouteDate(date) || date > throughDate || (fromDate && date < fromDate)) return null;
    const name = key(fields["Tech Name"]) === staffPrivate.primaryKey ? staffPrivate.primaryName : null;
    const rawName = String(fields["Tech Name"] || "Unassigned").trim().slice(0, 100);
    const id = `${date}|${name || rawName}`;
    if (!rows.has(id)) rows.set(id, { id, date, name: name || rawName, eligible: Boolean(name), jobs: 0, revenue: 0, revenueMix: emptyRevenueMix(), reportedRevenue: 0, estimatedJobs: 0, missingValues: 0, minutes: 0, invalidShifts: 0, shifts: 0, miles: 0, missingMileage: 0 });
    return rows.get(id);
  };
  for (const record of uniqueRouteRecords(jobs, "Job ID")) {
    const fields = record.fields ?? {};
    if (!["completed", "jobcompleted"].includes(key(fields.Status))) continue;
    // Sweep & Go also emits completed events for skipped visits; no service occurred.
    if (["skip", "skipped"].includes(key(fields["Service Type"]))) continue;
    const row = get(record);
    if (!row) continue;
    const customer = customerMap.get(key(fields["Customer Name"]));
    const { category, revenue, components, estimated, missing } = routeServiceValue(fields, customer);
    const reported = positive(fields["Revenue ($)"]);
    row.jobs++;
    row.revenue += revenue;
    row.reportedRevenue += reported;
    row.estimatedJobs += estimated ? 1 : 0;
    row.missingValues += missing ? 1 : 0;
    const categories = new Set();
    for (const component of components) {
      const bucket = row.revenueMix[component.category] || row.revenueMix[category];
      bucket.revenue += component.revenue;
      if (!categories.has(component.category)) {
        bucket.jobs++;
        bucket.estimatedJobs += estimated ? 1 : 0;
        bucket.missingValues += missing ? 1 : 0;
        categories.add(component.category);
      }
    }
  }
  for (const record of uniqueRouteRecords(time, "Record ID")) {
    const row = get(record);
    if (!row) continue;
    const fields = record.fields ?? {};
    const minutes = positive(fields["Minutes Clocked"]);
    const miles = fields["Miles Driven"];
    row.shifts++;
    row.minutes += minutes <= 1440 ? minutes : 0;
    row.invalidShifts += minutes > 0 && minutes <= 1440 ? 0 : 1;
    if (numeric(miles) && Number(miles) >= 0 && Number(miles) <= 500) row.miles += Number(miles);
    else row.missingMileage++;
  }
  for (const row of rows.values()) if (row.minutes > 1440) row.invalidShifts++;
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
