import { emptyRevenueMix, routeServiceValue, summarizeRevenueMix } from "./route-revenue.mjs";

export const ROUTE_HISTORY_VERSION = 4;
export const TECHNICIAN_MEASUREMENT_POLICY = "Service revenue follows the technician recorded on each historical visit. Employee hourly rates use that technician's recorded shifts. Craig's mixed office/field hours are excluded. Company expenses are allocated across all completed visits.";

export const ROUTE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const key = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const numeric = (value) => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
const positive = (value) => numeric(value) && Number(value) > 0 ? Number(value) : 0;
export const roundRoute = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
export function validRouteDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function shiftRouteDate(date, days) {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
export function routeDay(date) { return ROUTE_DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]; }
export function routeWeek(date) { return shiftRouteDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)); }
export function closedRouteDate(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return shiftRouteDate(date, -1);
}

export const routeRecordId = (value) => String(value || "").trim().replace(/^(\d+)\.0+$/, "$1");
export function uniqueRouteRecords(records, field) {
  const map = new Map();
  for (const record of records) {
    const rawId = routeRecordId(record.fields?.[field] || record.id);
    // Legacy CSV imports used SHIFT-123; payroll webhooks use the same SNG ID as 123.
    const id = field === "Record ID" ? rawId.replace(/^SHIFT-/i, "") : rawId;
    if (!id) continue;
    const score = (row) => Object.values(row.fields ?? {}).filter((value) => value !== null && value !== undefined && value !== "").length;
    if (!map.has(id) || score(record) > score(map.get(id))) map.set(id, record);
  }
  const unique = [...map.values()];
  if (field !== "Job ID") return unique;
  // Earlier CSV imports used one synthetic HIST/LIVE ID per customer/day.
  // Once SNG job IDs exist, those original jobs replace the synthetic copy,
  // including its sometimes stale technician assignment. Distinct SNG IDs
  // (scooping, add-ons, re-cleans, multiple locations) must all survive.
  const identity = record => {
    const f = record.fields ?? {}, date = String(f.Date || "").slice(0, 10);
    const customer = key(f["Customer Name"]);
    return validRouteDate(date) && customer ? `${date}|${customer}` : null;
  };
  const originals = new Set(unique.filter(record => /^\d+$/.test(routeRecordId(record.fields?.[field])))
    .map(identity).filter(Boolean));
  return unique.filter(record => !/^(?:HIST|LIVE)-\d{4}-\d{2}-\d{2}-/i.test(String(record.fields?.[field] || ""))
    || !originals.has(identity(record)));
}

// Compact daily facts only: no customer names, addresses, or raw provider payloads.


export function mergeRouteFacts(prior, incoming, fromDate, throughDate, retainFrom) {
  return [...prior.filter((row) => row.date >= retainFrom && (row.date < fromDate || row.date > throughDate)), ...incoming]
    .filter((row) => row.date >= retainFrom).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function summarizeRouteProfit(rows) {
  const sum = (field) => rows.reduce((total, row) => total + (row[field] || 0), 0);
  const serviceRows = rows.filter(row => row.jobs > 0);
  const revenue = sum("revenue"), hours = sum("hours");
  const ready = rows.length > 0 && rows.every((row) => row.profit !== null);
  const rateReady = rows.length > 0 && hours > 0 && rows.every((row) => !row.missingValues && (row.hourCoverageReady ?? row.revenuePerHour !== null));
  const profit = ready ? sum("profit") : null;
  return { revenue, revenueMix: summarizeRevenueMix(rows), hours, jobs: sum("jobs"), routeDays: serviceRows.length, operatingDays: new Set(serviceRows.map((row) => row.date)).size,
    estimatedJobs: sum("estimatedJobs"), missingValues: sum("missingValues"), profit, totalCost: ready ? sum("totalCost") : null,
    revenuePerHour: rateReady ? revenue / hours : null, profitPerHour: ready && rateReady ? profit / hours : null,
    margin: ready && revenue > 0 ? profit / revenue * 100 : null, ready,
    averageRevenue: serviceRows.length ? revenue / serviceRows.length : null, averageProfit: ready && serviceRows.length ? profit / serviceRows.length : null,
  };
}

// One reporting window for cards, categories, and the ledger.
export function selectRouteWindow(rows, from, through, weekday = "All days") {
  return rows.filter(row => row.date >= from && row.date <= through && (weekday === "All days" || routeDay(row.date) === weekday));
}

export { key as normalizedRouteKey, numeric as numericRouteValue, positive as positiveRouteValue };
