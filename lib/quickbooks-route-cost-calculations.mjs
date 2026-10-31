import { validRouteDate } from "./route-profitability-calculations.mjs";
import { emptyRevenueMix, mergeRevenueMix } from "./route-revenue.mjs";

export const COST_GROUPS = ["Payroll & benefits", "Vehicle & travel", "Supplies & disposal", "Other operating costs"];
const amount = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const number = Number(String(value).replaceAll(",", "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(number) ? number : null;
};
const groupFor = (path) => /payroll|wages|salaries|bonus|commission|employee benefits|workers.? comp/i.test(path) ? COST_GROUPS[0]
  : /vehicle|auto|truck|fuel|gasoline|mileage|parking|tolls|transport/i.test(path) ? COST_GROUPS[1]
  : /supplies|disposal|waste|bags|materials/i.test(path) ? COST_GROUPS[2] : COST_GROUPS[3];

// Read the actual report column dates. Never infer dates from localized display labels.
export function parseRouteCostReport(report) {
  if (report?.Header?.Currency !== "USD") throw new Error("A USD QuickBooks report is required.");
  if (report?.Header?.ReportBasis !== "Accrual") throw new Error("An accrual QuickBooks report is required.");
  const columns = (report?.Columns?.Column ?? []).map((column, index) => {
    const metadata = Object.fromEntries((column.MetaData ?? []).map((item) => [item.Name, item.Value]));
    return { index, start: metadata.StartDate, end: metadata.EndDate, key: metadata.ColKey };
  }).filter((column) => column.index > 0 && column.key !== "total" && validRouteDate(column.start) && validRouteDate(column.end) && column.start.slice(0, 7) === column.end.slice(0, 7));
  if (!columns.length) throw new Error("QuickBooks monthly cost columns are unavailable.");
  return columns.map((column) => {
    const groups = Object.fromEntries(COST_GROUPS.map((group) => [group, 0]));
    const accounts = [];
    const totals = {};
    let invalid = false;
    function visit(rows = [], parent = "", costSection = false) {
      for (const row of rows) {
        const label = row.Header?.ColData?.[0]?.value || row.ColData?.[0]?.value || "";
        const path = [parent, label].filter(Boolean).join(": ");
        const isCost = costSection || ["COGS", "Expenses", "OtherExpenses"].includes(row.group);
        if (["Income", "COGS", "Expenses", "OtherExpenses"].includes(row.group)) {
          const value = amount(row.Summary?.ColData?.[column.index]?.value);
          if (value === null || !row.Summary?.ColData?.[column.index]) invalid = true;
          totals[row.group] = value;
        }
        if (isCost && row.ColData && !row.Rows?.Row?.length && row.type !== "Section") {
          const value = amount(row.ColData[column.index]?.value);
          if (value === null || !row.ColData[column.index]) invalid = true;
          const group = groupFor(path);
          groups[group] += value || 0;
          if (value) accounts.push({ id: String(row.ColData[0]?.id || ""), name: path.slice(0, 200), amount: value, group });
        }
        // QuickBooks puts amounts posted directly to a parent account in its
        // header, alongside child-account rows. Its summary includes both.
        if (isCost && row.Header?.ColData?.[0]?.id) {
          const value=amount(row.Header.ColData[column.index]?.value);
          if(value===null)invalid=true;
          const group=groupFor(path);
          groups[group]+=value||0;
          if(value)accounts.push({id:String(row.Header.ColData[0].id),name:path.slice(0,200),amount:value,group});
        }
        visit(row.Rows?.Row, path, isCost);
      }
    }
    visit(report.Rows?.Row);
    const totalCosts = (totals.COGS || 0) + (totals.Expenses || 0) + (totals.OtherExpenses || 0);
    const leafTotal = Object.values(groups).reduce((sum, value) => sum + value, 0);
    const reconciled = !invalid && totals.Income !== undefined && (totals.Expenses !== undefined || totals.COGS !== undefined) && Math.abs(leafTotal - totalCosts) < 0.05;
    return { month: column.start.slice(0, 7), start: column.start, end: column.end, income: totals.Income ?? null, totalCosts, groups, accounts, reconciled, difference: totalCosts - leafTotal };
  });
}

// Allocation uses the whole month's data before any UI date/day filtering.
// This keeps a route's costs constant when the user changes the viewing window.
export function applyQuickBooksRouteCosts(facts, costSource, { coveredFrom, coveredThrough } = {}) {
  // Owner policy: every serviced account contributes revenue and receives costs;
  // only Tony's shift time enters the hourly denominator. Preserve this distinction.
  const byDate = new Map();
  for (const fact of facts) {
    if (!byDate.has(fact.date)) byDate.set(fact.date, { id: fact.date, date: fact.date, name: "All serviced accounts", jobs: 0, revenue: 0, reportedRevenue: 0, estimatedJobs: 0, missingValues: 0, minutes: 0, invalidShifts: 0, tonyJobs: 0, tonyRevenue: 0, unassignedJobs: 0 });
    const row = byDate.get(fact.date);
    row.revenueMix ||= emptyRevenueMix();
    mergeRevenueMix(row.revenueMix, fact);
    for (const field of ["jobs", "revenue", "reportedRevenue", "estimatedJobs", "missingValues"]) row[field] += fact[field];
    if (fact.name === "Unassigned") row.unassignedJobs += fact.jobs;
    if (fact.eligible) { row.minutes += fact.minutes; row.invalidShifts += fact.invalidShifts; row.tonyJobs += fact.jobs; row.tonyRevenue += fact.revenue; }
  }
  const eligible = [...byDate.values()].filter((row) => row.jobs > 0 || row.minutes > 0 || row.invalidShifts > 0);
  const months = new Map((costSource?.months ?? []).map((row) => [row.month, row]));
  return eligible.map((row) => {
    const candidate = months.get(row.date.slice(0, 7));
    const costMonth = candidate && row.date >= candidate.start && row.date <= candidate.end ? candidate : null;
    const peers = costMonth ? eligible.filter((peer) => peer.date >= costMonth.start && peer.date <= costMonth.end) : [];
    const monthJobs = peers.reduce((sum, peer) => sum + peer.jobs, 0);
    const hours = row.minutes / 60;
    const hoursReady = hours > 0 && !row.invalidShifts;
    const hourCoverageReady = !row.invalidShifts && (hoursReady || (row.tonyJobs === 0 && row.unassignedJobs === 0));
    const revenueReady = !row.missingValues;
    const coverageReady = costMonth && coveredFrom <= costMonth.start && coveredThrough >= costMonth.end;
    const peerReady = peers.length > 0 && monthJobs > 0;
    const ready = Boolean(costMonth?.reconciled && coverageReady && peerReady && revenueReady);
    const factor = ready ? row.jobs / monthJobs : null;
    const totalCost = ready ? costMonth.totalCosts * factor : null;
    const profit = ready ? row.revenue - totalCost : null;
    return { ...row, hours, hourCoverageReady, totalCost, profit, revenuePerHour: hoursReady && revenueReady ? row.revenue / hours : null,
      profitPerHour: ready && hoursReady ? profit / hours : null, margin: ready && row.revenue > 0 ? profit / row.revenue * 100 : null,
      costGroups: ready ? Object.fromEntries(COST_GROUPS.map((group) => [group, costMonth.groups[group] * factor])) : {},
      companyCostShare: factor, costMonth: costMonth?.month,
      issues: [!hourCoverageReady && "Tony hours missing or invalid; hourly rate unavailable", hourCoverageReady && !hours && "No Tony work recorded; daily hourly rate not applicable", !revenueReady && "Service values missing", !costMonth && "QuickBooks costs not synced", costMonth && !costMonth.reconciled && "QuickBooks expense detail needs reconciliation", costMonth && !coverageReady && "Full cost-period route history needed", costMonth && coverageReady && !peerReady && "Cost-period completed visits needed"].filter(Boolean),
    };
  });
}

// Allocate against the complete company history before filtering by technician.
// A missing value on another technician's route must not hide this route's profit.
export function applyTechnicianRouteCosts(facts, costSource, coverage = {}) {
  const companyDays = new Map(applyQuickBooksRouteCosts(facts.map(fact => ({ ...fact, missingValues: 0 })), costSource, coverage).map(row => [row.date, row]));
  return facts.filter(row => row.jobs > 0 || row.minutes > 0 || row.invalidShifts > 0).map(row => {
    const company = companyDays.get(row.date);
    const owner = row.name.toLowerCase().replace(/[^a-z0-9]/g, "") === coverage.ownerKey;
    const unassigned = !row.name || row.name === "Unassigned";
    const hours = owner || unassigned ? 0 : row.minutes / 60;
    const hourCoverageReady = !owner && !unassigned && hours > 0 && !row.invalidShifts;
    const share = company?.jobs ? row.jobs / company.jobs : 0;
    const ready = !row.missingValues && company?.totalCost != null;
    const totalCost = ready ? company.totalCost * share : null;
    const profit = ready ? row.revenue - totalCost : null;
    return { ...row, hours, hoursExcluded: owner, hourCoverageReady, totalCost, profit,
      revenuePerHour: hourCoverageReady && !row.missingValues ? row.revenue / hours : null,
      profitPerHour: ready && hourCoverageReady ? profit / hours : null,
      margin: ready && row.revenue > 0 ? profit / row.revenue * 100 : null,
      companyCostShare: ready ? company.companyCostShare * share : null,
      costGroups: ready ? Object.fromEntries(COST_GROUPS.map(group => [group, company.costGroups[group] * share])) : {},
      issues: [owner ? "Owner hours excluded: mixed office and field time" : !hourCoverageReady && "Technician shift hours missing or invalid", row.missingValues > 0 && "Service values missing", ...(company?.issues || []).filter(issue => !/Tony|Service values/.test(issue))].filter(Boolean),
    };
  });
}

export function combineTechnicianDays(rows) {
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.date)) days.set(row.date, []);
    days.get(row.date).push(row);
  }
  return [...days].map(([date, group]) => {
    const sum = field => group.reduce((total, row) => total + (row[field] || 0), 0);
    const revenueMix = emptyRevenueMix();
    group.forEach(row => mergeRevenueMix(revenueMix, row));
    const hours = sum("hours"), revenue = sum("revenue"), ready = group.every(row => row.profit !== null);
    // Retain the owner's company overview policy: owner revenue contributes,
    // but mixed office/field hours do not enter the employee-hour denominator.
    const hourCoverageReady = group.every(row => row.hourCoverageReady || row.hoursExcluded);
    const profit = ready ? sum("profit") : null;
    return { id: date, date, name: group.map(row => row.name).join(", "), jobs: sum("jobs"), revenue, revenueMix, hours,
      estimatedJobs: sum("estimatedJobs"), missingValues: sum("missingValues"), hourCoverageReady,
      totalCost: ready ? sum("totalCost") : null, profit,
      revenuePerHour: hourCoverageReady && !sum("missingValues") && hours > 0 ? revenue / hours : null,
      profitPerHour: ready && hourCoverageReady && hours > 0 ? profit / hours : null,
      issues: [...new Set(group.flatMap(row => row.issues))],
    };
  });
}
