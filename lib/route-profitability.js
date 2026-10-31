import staffPrivate from './staff-private.json' with {type:'json'};
import { getDb } from "./db";
import { withQuickBooksReadOnlyClient } from "./quickbooks";
import { readRouteHistory } from "./route-profitability-history";
import { closedRouteDate, shiftRouteDate } from "./route-profitability-calculations.mjs";
import { parseRouteCostReport } from "./quickbooks-route-costs.mjs";
import { readRouteReview } from "./route-data-quality";
import { readInvoiceRevenue } from "./revenue-report.mjs";

const COST_KEY = "route_profitability_qbo_costs_v1";

export async function getRouteProfitabilityData(db = getDb()) {
  if (!db) return { history: null, costs: null };
  const [history, cached, settings, review, subscriptions, roster, mrrAudit] = await Promise.all([
    readRouteHistory(db),
    db.prepare("SELECT payload,captured_at,status FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(COST_KEY).first(),
    db.prepare("SELECT books_status FROM financial_management_settings WHERE id='primary'").first().catch(() => null),
    readRouteReview(db),
    db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key GLOB 'route_mrr_daily_*' ORDER BY snapshot_key DESC LIMIT 2000").all().catch(() => ({ results: [] })),
    db.prepare("SELECT payload,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key='route_technician_roster_v1'").first().catch(() => null),
    db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='route_mrr_source_audit_v1'").first(),
  ]);
  const { decisions, ...publicReview } = review;
  let billings;
  try { billings=await readInvoiceRevenue(db, history?.fromDate || shiftRouteDate(closedRouteDate(),-399), history?.throughDate || closedRouteDate()); }
  catch { billings={ unavailable:true, facts:[] }; }
  publicReview.recentDecisions=Object.values(decisions.byJob).sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt)).slice(0,20).map(({date,customer,action,revenue,category,reason,reviewer,reviewedAt})=>({date,customer,action,revenue,category,reason,reviewer,reviewedAt}));
  return { staffing:{reliefName:staffPrivate.reliefName},history, billings, mrrAudit:mrrAudit?.payload ? JSON.parse(mrrAudit.payload) : null, technicians: roster?.payload ? { ...JSON.parse(roster.payload), capturedAt: roster.captured_at } : null, review: publicReview, subscriptions: (subscriptions.results || []).map(row => JSON.parse(row.payload)), costs: cached?.payload ? { ...JSON.parse(cached.payload), capturedAt: cached.captured_at, status: cached.status, booksStatus: settings?.books_status || "provisional" } : null };
}

export async function refreshQuickBooksRouteCosts({ force = false } = {}) {
  const db = getDb();
  if (!db) throw new Error("Route cost storage is unavailable.");
  const cached = await db.prepare("SELECT captured_at,payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(COST_KEY).first();
  if (!force && cached && JSON.parse(cached.payload)?.schemaVersion === 2 && Date.now() - Date.parse(cached.captured_at) < 6 * 3600000) return { cached: true };
  const throughDate = closedRouteDate();
  const fromDate = `${shiftRouteDate(throughDate, -365).slice(0, 7)}-01`;
  const result = await withQuickBooksReadOnlyClient(async ({ get, companyName, environment }) => {
    const months = [];
    let start = fromDate;
    // At most three reports, each with no more than six monthly columns.
    for (let index = 0; index < 3 && start <= throughDate; index++) {
      const boundary = new Date(`${start}T12:00:00Z`);
      boundary.setUTCMonth(boundary.getUTCMonth() + 6);
      const next = boundary.toISOString().slice(0, 10);
      const end = shiftRouteDate(next, -1) < throughDate ? shiftRouteDate(next, -1) : throughDate;
      const report = await get("reports/ProfitAndLoss", { start_date: start, end_date: end, accounting_method: "Accrual", summarize_column_by: "Month" });
      months.push(...parseRouteCostReport(report));
      start = next;
    }
    return { schemaVersion: 2, companyName, environment, fromDate, throughDate, months, basis: "Accrual", scope: "Company-wide QuickBooks expense accounts", allocation: "all_company_per_visit" };
  });
  const payload = JSON.stringify(result);
  if (new TextEncoder().encode(payload).length > 1500000) throw new Error("QuickBooks cost detail exceeds the storage budget.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,captured_at,updated_at)
    VALUES (?,?,'success',?,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',error=NULL,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(COST_KEY, payload, new Date().toISOString()).run();
  return { cached: false, months: result.months.length };
}
