import staffPrivate from './staff-private.json' with {type:'json'};
import routingPrivate from './routing-private.json' with {type:'json'};
// Owner-confirmed scooping-only days. Other Craig shifts mix field and office work.
export const CRAIG_VERIFIED_ROUTE_DATES = Object.freeze([...routingPrivate.ownerVerifiedRouteDates]);

export const ROUTE_MEASUREMENT_POLICY = routingPrivate.performancePolicy;

const key = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

function serviceDate(value) {
  const date = String(value ?? "").slice(0, 10);
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function verifiedRouteTechnician(technician, date) {
  if (!serviceDate(date)) return null;
  if (key(technician) === staffPrivate.primaryKey) return staffPrivate.primaryName;
  if (key(technician) === staffPrivate.reliefKey && CRAIG_VERIFIED_ROUTE_DATES.includes(serviceDate(date))) return staffPrivate.reliefName;
  return null;
}

function weekStart(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function summarize(rows) {
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  const revenue = sum("revenue"), paidMinutes = sum("paidMinutes"), jobs = sum("jobs");
  const missingValues = sum("missingValues"), invalidShifts = sum("invalidShifts");
  const missingShiftDays = rows.filter((row) => row.jobs > 0 && row.paidMinutes <= 0).length;
  const ready = jobs > 0 && paidMinutes > 0 && !missingValues && !missingShiftDays && !invalidShifts;
  return {
    jobs, revenue: round(revenue), reportedRevenue: round(sum("reportedRevenue")),
    jobHours: round(sum("serviceMinutes") / 60), clockedHours: round(paidMinutes / 60),
    measurementDays: rows.length, missingValues, missingShiftDays, invalidShifts,
    revenueCoverage: jobs ? round((jobs - missingValues) * 100 / jobs) : 0,
    ready, revenuePerClockedHour: ready ? round(revenue * 60 / paidMinutes) : null,
    gapToTarget: ready ? round(Math.max(0, paidMinutes * 100 / 60 - revenue)) : null,
  };
}

// Inputs must be deduplicated completed jobs and shift records from the same period.
// Revenue and hours use the same technician/date eligibility policy.
export function buildRoutePerformance({ jobs = [], shifts = [], throughDate = null } = {}) {
  const rows = new Map();
  const getRow = (record) => {
    const date = serviceDate(record.date);
    const technician = verifiedRouteTechnician(record.technician, date);
    if (!technician || (throughDate && date > throughDate)) return null;
    const id = `${date}|${technician}`;
    if (!rows.has(id)) rows.set(id, { id, date, name: technician, jobs: 0, revenue: 0, reportedRevenue: 0, serviceMinutes: 0, paidMinutes: 0, missingValues: 0, invalidShifts: 0 });
    return rows.get(id);
  };
  for (const job of jobs) {
    const row = getRow(job);
    if (!row) continue;
    row.jobs += 1;
    row.revenue += positive(job.revenue);
    row.reportedRevenue += positive(job.reportedRevenue);
    row.serviceMinutes += positive(job.serviceMinutes);
    row.missingValues += positive(job.revenue) ? 0 : 1;
  }
  for (const shift of shifts) {
    const row = getRow(shift);
    if (!row) continue;
    row.paidMinutes += positive(shift.minutes);
    row.invalidShifts += positive(shift.minutes) ? 0 : 1;
  }
  const raw = [...rows.values()];
  const grouped = (field) => {
    const groups = new Map();
    for (const row of raw) {
      const value = field === "week" ? weekStart(row.date) : row[field];
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return [...groups].map(([value, group]) => ({ [field]: value, ...summarize(group) }));
  };
  return {
    policy: ROUTE_MEASUREMENT_POLICY,
    totals: summarize(raw),
    technicians: grouped("name"),
    days: raw.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)).map((row) => ({ id: row.id, date: row.date, name: row.name, ...summarize([row]) })),
    weeks: grouped("week").sort((a, b) => b.week.localeCompare(a.week)),
  };
}
