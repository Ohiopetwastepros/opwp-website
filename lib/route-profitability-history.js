import { buildRouteProfitabilityFacts, closedRouteDate, mergeRouteFacts, shiftRouteDate, ROUTE_HISTORY_VERSION, TECHNICIAN_MEASUREMENT_POLICY } from "./route-profitability.mjs";
import { readRouteReview, reconcileRouteRecords } from "./route-data-quality";
import { applyRouteDecisions } from "./route-data-quality.mjs";
import { ROUTE_REVENUE_VERSION } from "./route-revenue.mjs";
import { enrichRouteSourceEvidence } from "./route-source-evidence.mjs";
import { refreshRouteSubscriptions } from "./route-subscriptions.mjs";
import { getRuntimeEnv } from "./cloudflare";

const HISTORY_KEY = "route_profitability_history_v1";

export async function readRouteHistory(db) {
  if (!db) return null;
  const [archive, current] = await Promise.all([
    db.prepare("SELECT payload,captured_at,status FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(HISTORY_KEY).first(),
    db.prepare("SELECT payload,captured_at,status FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first(),
  ]);
  const history = archive?.payload ? JSON.parse(archive.payload) : null;
  const source = current?.payload ? JSON.parse(current.payload)?.opwp : null;
  if (!history && !source) return null;
  const throughDate = closedRouteDate();
  const capturedAt = String(current?.captured_at || "");
  const capturedTime = Date.parse(capturedAt.includes("T") ? capturedAt : `${capturedAt.replace(" ", "T")}Z`);
  const currentThrough = Number.isFinite(capturedTime) ? [closedRouteDate(new Date(capturedTime)), throughDate].sort()[0] : throughDate;
  const currentFrom = shiftRouteDate(currentThrough, -29);
  const useCurrent = source && (!archive || String(current.captured_at) > String(archive.captured_at));
  const review = useCurrent ? await readRouteReview(db) : null;
  const enriched = useCurrent ? await enrichRouteSourceEvidence(db, source, currentFrom, currentThrough) : null;
  const rows = useCurrent ? mergeRouteFacts(history?.rows ?? [], buildRouteProfitabilityFacts(applyRouteDecisions(enriched, review.decisions.byJob), { fromDate: currentFrom, throughDate: currentThrough }), currentFrom, currentThrough, history?.fromDate || currentFrom) : history?.rows ?? [];
  return {
    rows, fromDate: history?.fromDate || currentFrom,
    throughDate: useCurrent ? currentThrough : history.throughDate,
    capturedAt: useCurrent ? current.captured_at : archive.captured_at,
    status: useCurrent ? current.status : archive.status,
    backfilled: Boolean(history?.backfilled), technicianHoursBackfilled: history?.historyVersion === ROUTE_HISTORY_VERSION, policy: TECHNICIAN_MEASUREMENT_POLICY,
  };
}

export async function refreshRouteHistory(db, loadRecords, now = new Date(), options = {}) {
  // Source failures must preserve route history and the last complete subscription capture.
  try { await refreshRouteSubscriptions(db, getRuntimeEnv(), now); }
  catch { console.warn("Route subscription source refresh is unavailable."); }
  const throughDate = closedRouteDate(now);
  // Include the first full month so month-based expense allocations have a complete denominator.
  const initialFrom = `${shiftRouteDate(throughDate, -365).slice(0, 7)}-01`;
  const current = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(HISTORY_KEY).first();
  const prior = current?.payload ? JSON.parse(current.payload) : null;
  // Retain historical facts as time advances; the rolling window only bounds refresh work.
  const fromDate = prior?.fromDate && prior.fromDate < initialFrom ? prior.fromDate : initialFrom;
  const routineFrom = prior?.backfilled && prior?.revenueVersion === ROUTE_REVENUE_VERSION && prior?.historyVersion === ROUTE_HISTORY_VERSION ? `${shiftRouteDate(throughDate, -31).slice(0, 7)}-01` : fromDate;
  const refreshFrom = options.reviewDate && options.reviewDate < routineFrom ? [fromDate, `${options.reviewDate.slice(0,7)}-01`].sort().at(-1) : routineFrom;
  // Initial-invoice uniqueness needs surrounding visits, even on a short refresh.
  // Build only the requested facts, but reconcile with the same evidence context
  // as a full-history rebuild so valid prior allocations cannot disappear.
  const evidenceFrom = [fromDate, shiftRouteDate(refreshFrom,-45)].sort().at(-1);
  const records = await enrichRouteSourceEvidence(db, await loadRecords(evidenceFrom, throughDate), evidenceFrom, throughDate);
  const reconciled = await reconcileRouteRecords(db, records, evidenceFrom, throughDate);
  const incoming = buildRouteProfitabilityFacts(reconciled, { fromDate: refreshFrom, throughDate });
  let rows = mergeRouteFacts(prior?.rows ?? [], incoming, refreshFrom, throughDate, fromDate);
  let nextAuditMonth = prior?.nextAuditMonth || fromDate;
  // Recheck one retained month on each routine refresh. Old invoice/source
  // corrections must not wait forever behind the recent reporting window.
  if (refreshFrom > fromDate) {
    const auditFrom = nextAuditMonth >= fromDate && nextAuditMonth < refreshFrom ? nextAuditMonth : fromDate;
    const next = new Date(`${auditFrom}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    nextAuditMonth = next.toISOString().slice(0,10);
    const auditThrough = shiftRouteDate(nextAuditMonth,-1);
    const contextFrom = [fromDate,shiftRouteDate(auditFrom,-45)].sort().at(-1);
    const contextThrough = [throughDate,shiftRouteDate(auditThrough,34)].sort()[0];
    const older = await enrichRouteSourceEvidence(db, await loadRecords(contextFrom,contextThrough),contextFrom,contextThrough);
    const corrected = await reconcileRouteRecords(db,older,contextFrom,contextThrough);
    rows = mergeRouteFacts(rows,buildRouteProfitabilityFacts(corrected,{fromDate:auditFrom,throughDate:auditThrough}),auditFrom,auditThrough,fromDate);
  }
  const data = { rows, fromDate, throughDate, nextAuditMonth, backfilled: true, revenueVersion: ROUTE_REVENUE_VERSION, historyVersion: ROUTE_HISTORY_VERSION };
  const payload = JSON.stringify(data);
  if (new TextEncoder().encode(payload).length > 1500000) throw new Error("Route history exceeds its safe storage budget.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,captured_at,updated_at)
    VALUES (?,?,'success',?,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',error=NULL,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(HISTORY_KEY, payload, now.toISOString()).run();
  return data;
}
