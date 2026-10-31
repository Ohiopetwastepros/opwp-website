import { fetchSngBillingCollection } from "./subscription-reconciliation.mjs";

const KEY = "route_subscription_source_v1";
export function subscriptionCaptureSummary(rows, capturedAt) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(capturedAt));
  let active = 0, paused = 0, activePlans = 0, pausedPlans = 0, unsupported = 0;
  const factors = { monthly: 1, annually: 1 / 12, "semi-annually": 1 / 6, quarterly: 1 / 3, every_two_months: 1 / 2, "4_weeks": 13 / 12, "bi-weekly": 26 / 12, weekly: 52 / 12 };
  for (const row of rows) {
    if (!["active", "paused", "canceled", "pending"].includes(row.status)) { unsupported++; continue; }
    if (!["active", "paused"].includes(row.status) || row.start_date > date || (row.end_date && row.end_date <= date)) continue;
    const factor = factors[row.billing_interval], price = Number(row.price);
    if (row.category !== "prepaid" || !factor || row.price == null || row.price === "" || !Number.isFinite(price) || price < 0 || price > 10000 || row.coupon_code || Number(row.coupon_total) || Number(row.coupon_percent)) { unsupported++; continue; }
    if (row.status === "paused") { paused += price * factor; pausedPlans++; }
    else { active += price * factor; activePlans++; }
  }
  return { snapshot_date: date, captured_at: capturedAt, verified: unsupported === 0, total_mrr: unsupported ? null : Math.round(active * 100) / 100, paused_mrr: Math.round(paused * 100) / 100, active_plans: activePlans, paused_plans: pausedPlans, unsupported_plans: unsupported, source: "SNG complete subscription API capture", basis: "Active prepaid plans; paused plans excluded" };
}

async function saveDailySummary(db, capture) {
  const summary = subscriptionCaptureSummary(capture.rows, capture.capturedAt);
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',error=NULL,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(`route_mrr_daily_${summary.snapshot_date}`, JSON.stringify(summary), capture.capturedAt).run();
}
// Private source evidence; never return customer-level billing data to the dashboard.
export async function refreshRouteSubscriptions(db, env, now = new Date()) {
  if (!env.SNG_API_KEY) return;
  const prior = await db.prepare("SELECT payload,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(KEY).first();
  if (prior?.payload && now - new Date(prior.captured_at) < 3600000) { await saveDailySummary(db, JSON.parse(prior.payload)); return; }
  const source = await fetchSngBillingCollection(env, "subscriptions");
  const fields = ["id", "name", "status", "category", "price", "billing_interval", "service_plan", "pricing_plan", "start_date", "end_date", "pause_start_date", "pause_end_date", "canceled_at", "coupon_code", "coupon_total", "coupon_percent"];
  const rows = source.map(row => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, typeof row[key] === "string" ? row[key].slice(0, 200) : row[key]])));
  const payload = JSON.stringify({ capturedAt: now.toISOString(), rows });
  if (new TextEncoder().encode(payload).length > 1000000) throw new Error("Subscription evidence exceeds the storage limit.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',error=NULL,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(KEY,payload,now.toISOString()).run();
  await saveDailySummary(db, JSON.parse(payload));
}
