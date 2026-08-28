import { applicationConfig } from "./app-config";
import { getDb } from "./db";
import { notificationProvider } from "./notifications";
import { submissionEmailProviderStatus } from "./submission-notifications";

async function safeFirst(db, sql, ...bindings) {
  try { return await db.prepare(sql).bind(...bindings).first() || {}; }
  catch (error) { return { _error: error instanceof Error ? error.message : "query_failed" }; }
}

function tone(configured, failed = false, warning = false) {
  if (failed) return "red";
  if (!configured || warning) return "yellow";
  return "green";
}

export async function getSystemHealth() {
  const config = applicationConfig();
  const db = getDb();
  const provider = notificationProvider();
  const emailProvider = submissionEmailProviderStatus();
  if (!db) return { generatedAt: new Date().toISOString(), rows: [{ name: "D1", tone: "red", summary: "Database binding unavailable", details: "Production must bind DB." }] };

  const notificationSql = `SELECT
    (SELECT COUNT(*) FROM dog_food_notifications WHERE status='queued') + (SELECT COUNT(*) FROM dog_food_follow_ups WHERE status='queued') + (SELECT COUNT(*) FROM route_partner_notification_outbox WHERE status='queued') + (SELECT COUNT(*) FROM quote_follow_ups WHERE status='queued') queued,
    (SELECT COUNT(*) FROM dog_food_notifications WHERE status='sending') + (SELECT COUNT(*) FROM dog_food_follow_ups WHERE status='sending') + (SELECT COUNT(*) FROM route_partner_notification_outbox WHERE status='sending') + (SELECT COUNT(*) FROM quote_follow_ups WHERE status='sending') sending,
    (SELECT COUNT(*) FROM dog_food_notifications WHERE status='sent') + (SELECT COUNT(*) FROM dog_food_follow_ups WHERE status='sent') + (SELECT COUNT(*) FROM route_partner_notification_outbox WHERE status='sent') + (SELECT COUNT(*) FROM quote_follow_ups WHERE status='sent') sent,
    (SELECT COUNT(*) FROM dog_food_notifications WHERE status='failed') + (SELECT COUNT(*) FROM dog_food_follow_ups WHERE status='failed') + (SELECT COUNT(*) FROM route_partner_notification_outbox WHERE status='failed') + (SELECT COUNT(*) FROM quote_follow_ups WHERE status='failed') failed,
    MIN(oldest) oldest FROM (
      SELECT MIN(scheduled_at) oldest FROM dog_food_notifications WHERE status IN ('queued','sending')
      UNION ALL SELECT MIN(scheduled_at) FROM dog_food_follow_ups WHERE status IN ('queued','sending')
      UNION ALL SELECT MIN(created_at) FROM route_partner_notification_outbox WHERE status IN ('queued','sending')
      UNION ALL SELECT MIN(scheduled_at) FROM quote_follow_ups WHERE status IN ('queued','sending')
    )`;
  const [sng, airtable, stripe, quickbooks, notificationCounts, emailCounts, migration, proofs, syncRuns] = await Promise.all([
    safeFirst(db, "SELECT MAX(received_at) last_webhook, SUM(CASE WHEN status IN ('needs_attention','failed') THEN 1 ELSE 0 END) failed FROM sng_events"),
    safeFirst(db, "SELECT status,error,captured_at FROM airtable_cockpit_snapshots ORDER BY captured_at DESC LIMIT 1"),
    safeFirst(db, "SELECT received_at,status,error_message FROM dog_food_payment_events WHERE provider='stripe' ORDER BY received_at DESC LIMIT 1"),
    safeFirst(db, "SELECT company_name,connected_at,refreshed_at,last_sync_at,last_error FROM quickbooks_connections ORDER BY connected_at DESC LIMIT 1"),
    safeFirst(db, notificationSql),
    safeFirst(db, "SELECT SUM(status='queued') queued,SUM(status='sending') sending,SUM(status='sent') sent,SUM(status='failed') failed,MIN(CASE WHEN status IN ('queued','sending','failed') THEN created_at END) oldest FROM submission_notifications"),
    safeFirst(db, "SELECT COUNT(*) count, MAX(name) latest FROM d1_migrations"),
    safeFirst(db, "SELECT storage_provider,COUNT(*) count,MAX(created_at) latest FROM route_partner_field_proofs GROUP BY storage_provider ORDER BY latest DESC LIMIT 1"),
    db.prepare("SELECT sync_name,status,error,completed_at,started_at FROM system_sync_runs ORDER BY started_at DESC LIMIT 50").all().catch(() => ({ results: [] })),
  ]);

  const schedules = {};
  for (const run of syncRuns.results || []) if (!schedules[run.sync_name]) schedules[run.sync_name] = run;
  const scheduleRows = [
    ["Subscription refresh", schedules.subscriptions_daily],
    ["Airtable cockpit refresh", schedules.airtable_cockpit],
    ["Route book refresh", schedules.active_route_book],
    ["Dog-food renewals", schedules.dog_food_renewals],
  ].map(([name, run]) => ({
    name,
    tone: !run ? "yellow" : run.status === "failed" ? "red" : "green",
    summary: run ? run.status + " · " + (run.completed_at || run.started_at || "time unavailable") : "No run recorded",
    details: run?.error || "",
  }));

  return {
    generatedAt: new Date().toISOString(),
    rows: [
      { name: "Sweep & Go", tone: tone(config.integrations.sweepAndGo.configured && config.integrations.sweepAndGo.webhookConfigured, Number(sng.failed) > 0), summary: "API " + (config.integrations.sweepAndGo.configured ? "configured" : "not configured") + " · webhook " + (config.integrations.sweepAndGo.webhookConfigured ? "verified-secret required" : "secret missing"), details: "Last webhook: " + (sng.last_webhook || "none") + " · failed/unprocessed: " + (Number(sng.failed) || 0) },
      { name: "Airtable", tone: tone(config.integrations.airtable.configured, airtable.status === "failed" || Boolean(airtable._error)), summary: config.integrations.airtable.configured ? "Configured" : "Not configured", details: "Latest snapshot: " + (airtable.captured_at || "none") + (airtable.error ? " · " + airtable.error : "") },
      { name: "Stripe", tone: tone(config.integrations.stripe.configured && config.integrations.stripe.webhookConfigured, stripe.status === "failed"), summary: "API " + (config.integrations.stripe.configured ? "configured" : "not configured") + " · webhook " + (config.integrations.stripe.webhookConfigured ? "configured" : "missing"), details: "Latest event: " + (stripe.received_at || "none") + " · " + (stripe.status || "no status") },
      { name: "QuickBooks", tone: tone(config.integrations.quickBooks.configured, Boolean(quickbooks.last_error), !quickbooks.connected_at), summary: (quickbooks.connected_at ? "Connected" : "Not connected") + " · " + config.integrations.quickBooks.environment, details: "Last sync: " + (quickbooks.last_sync_at || "none") + " · last refresh: " + (quickbooks.refreshed_at || "none") + (quickbooks.last_error ? " · " + quickbooks.last_error : "") },
      { name: "Geoapify", tone: tone(config.integrations.geoapify.configured), summary: config.integrations.geoapify.configured ? "Configured" : "Not configured", details: schedules.active_route_book?.error || "Latest errors appear in route-book scheduled runs." },
      { name: "SMS / notifications", tone: tone(provider.configured, Number(notificationCounts.failed) > 0, !provider.configured || Number(notificationCounts.queued) > 0), summary: "Provider: " + provider.name + " · " + (provider.configured ? "configured" : "unconfigured"), details: "Queued " + (Number(notificationCounts.queued) || 0) + " · sending " + (Number(notificationCounts.sending) || 0) + " · sent " + (Number(notificationCounts.sent) || 0) + " · failed " + (Number(notificationCounts.failed) || 0) + " · oldest unsent " + (notificationCounts.oldest || "none") },
      { name: "D1", tone: tone(!migration._error, Boolean(migration._error)), summary: migration._error ? "Migration state unavailable" : "Available · " + (Number(migration.count) || 0) + " migrations recorded", details: migration._error || "Latest: " + (migration.latest || "none") },
      { name: "Field photo storage", tone: config.integrations.fieldProofs.provider === "r2" ? "green" : "yellow", summary: config.integrations.fieldProofs.provider === "r2" ? "R2 active" : "D1 emergency fallback", details: "Latest stored provider: " + (proofs.storage_provider || "none") + " · records: " + (Number(proofs.count) || 0) },
      { name: "Owner email alerts", tone: tone(emailProvider.configured, Number(emailCounts.failed) > 0, !emailProvider.configured || Number(emailCounts.queued) > 0), summary: "Provider: " + emailProvider.name + " - " + (emailProvider.configured ? "configured" : "delivery binding pending"), details: "Queued " + (Number(emailCounts.queued) || 0) + " - sending " + (Number(emailCounts.sending) || 0) + " - sent " + (Number(emailCounts.sent) || 0) + " - failed " + (Number(emailCounts.failed) || 0) + " - oldest unsent " + (emailCounts.oldest || "none") },
      ...scheduleRows,
    ],
  };
}
