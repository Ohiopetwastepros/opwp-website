import { upsertSngDispatchJobs } from "./airtable";
import { recoverFailedSngEvents } from "./sng-event-processor";
import { sngRequest, sngRows } from "./sweepandgo";

function easternDate(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function reconciliationDates(catchup) {
  const days = catchup ? 21 : 2;
  return Array.from({ length: days }, (_, index) => easternDate(index));
}

export async function runScheduledSngOperationalRecovery(env) {
  if (!env?.DB || !env?.AIRTABLE_API_KEY || !env?.SNG_API_KEY) return { skipped: true, reason: "not_configured" };
  const id = crypto.randomUUID();
  try {
    const latestEvent = await env.DB.prepare(`SELECT received_at FROM sng_events ORDER BY received_at DESC LIMIT 1`).first();
    const latestEventTime = latestEvent?.received_at ? Date.parse(String(latestEvent.received_at).includes("T") ? latestEvent.received_at : `${latestEvent.received_at}Z`) : Number.NaN;
    const webhookAgeMinutes = Number.isFinite(latestEventTime) ? Math.max(0, Math.round((Date.now() - latestEventTime) / 60000)) : null;
    const webhookStale = webhookAgeMinutes === null || webhookAgeMinutes > 180;
    const priorCatchup = await env.DB.prepare(
      `SELECT id FROM system_sync_runs WHERE sync_name='sng_dispatch_catchup_v1' AND status='success' LIMIT 1`
    ).first();
    const catchup = !priorCatchup;
    const dates = reconciliationDates(catchup);
    let jobsUpserted = 0;
    for (const date of dates) {
      const result = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
      if (!result.ok) throw new Error(`Sweep & Go dispatch reconciliation returned ${result.status} for ${date}.`);
      const backfill = await upsertSngDispatchJobs(sngRows(result), date);
      jobsUpserted += Number(backfill.upserted || 0);
    }
    const eventRecovery = await recoverFailedSngEvents({ limit: 25 });
    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at)
       VALUES (?,'sng_operational_recovery',?,?,?,CURRENT_TIMESTAMP)`
    ).bind(id, webhookStale ? "partial" : "success", easternDate(), jobsUpserted + eventRecovery.recovered).run();
    if (catchup) {
      await env.DB.prepare(
        `INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at)
         VALUES (?,'sng_dispatch_catchup_v1','success',?,?,CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), easternDate(), jobsUpserted).run();
    }
    console.log(JSON.stringify({ event: "sng_operational_recovery", completedAt, catchup, dates: dates.length, jobsUpserted, eventRecovery, webhookAgeMinutes, webhookStale }));
    return { catchup, dates: dates.length, jobsUpserted, eventRecovery, webhookAgeMinutes, webhookStale };
  } catch (error) {
    await env.DB.prepare(
      `INSERT INTO system_sync_runs (id,sync_name,status,error,completed_at)
       VALUES (?,'sng_operational_recovery','failed',?,CURRENT_TIMESTAMP)`
    ).bind(id, String(error).slice(0, 500)).run();
    console.error(JSON.stringify({ event: "sng_operational_recovery_failed", message: String(error) }));
    throw error;
  }
}
