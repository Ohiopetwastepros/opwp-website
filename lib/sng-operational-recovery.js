import { upsertSngDispatchJobs } from "./airtable";
import { recoverFailedSngEvents } from "./sng-event-processor";
import { sngRequest, sngRows } from "./sweepandgo";

const BACKFILL_KEY = "sng_dispatch_backfill_v2";
const BACKFILL_DAYS_PER_RUN = 3;
const HISTORY_DAYS = 365;

function easternDate(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function saveBackfillState(db, payload, status = "success", error = null) {
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,error,captured_at,updated_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,error=excluded.error,captured_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .bind(BACKFILL_KEY, JSON.stringify(payload), status, error).run();
}

async function readBackfillState(db) {
  const row = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(BACKFILL_KEY).first();
  try { return row?.payload ? JSON.parse(row.payload) : null; } catch { return null; }
}

async function saveDispatchSource(env, row, date) {
  const id = `sng-dispatch-job-${String(row.id)}`;
  const payload = JSON.stringify({ data: { ...row, job_id: row.id }, source: { endpoint: "dispatch_board/jobs_for_date", date, recovered_at: new Date().toISOString() } });
  await env.DB.prepare(`INSERT OR IGNORE INTO sng_events
    (id,event_type,source,external_id,customer_name,status,payload,processed_at)
    VALUES (?,'job:completed','sweep_and_go_dispatch_api',?,?, 'processed', ?,CURRENT_TIMESTAMP)`)
    .bind(id, String(row.id), String(row.full_name || ""), payload).run();
}

async function reconcileDispatchDate(env, date) {
  const result = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
  if (!result.ok) throw new Error(`Sweep & Go dispatch reconciliation returned ${result.status} for ${date}.`);
  const rows = sngRows(result);
  const completed = rows.filter((row) => Number(row.id) > 0 && (String(row.status_name).toLowerCase() === "completed" || Number(row.status_id) === 2));
  for (const row of completed) await saveDispatchSource(env, row, date);
  const airtable = await upsertSngDispatchJobs(rows, date);
  return { date, sourceRecords: completed.length, ...airtable };
}

export async function runSngDispatchBackfillBatch(env, { days = BACKFILL_DAYS_PER_RUN } = {}) {
  if (!env?.DB || !env?.AIRTABLE_API_KEY || !env?.SNG_API_KEY) return { skipped: true, reason: "not_configured" };
  const today = easternDate();
  const earliest = shiftDate(today, -HISTORY_DAYS + 1);
  const state = await readBackfillState(env.DB);
  // Completed history does not restart a 365-day sweep every hour. Recent
  // dates already have their own recovery pass.
  if (state?.complete) return { ...state, skipped: true, reason: 'history_complete' };
  const startDate = state?.nextDate && state.nextDate >= earliest && state.nextDate <= today ? state.nextDate : earliest;
  const count = Math.min(Math.max(Number(days) || BACKFILL_DAYS_PER_RUN, 1), BACKFILL_DAYS_PER_RUN);
  const dates = Array.from({ length: count }, (_, index) => shiftDate(startDate, index)).filter((date) => date <= today);
  const results = [];
  for (const date of dates) {
    results.push(await reconcileDispatchDate(env, date));
    await saveBackfillState(env.DB, {
      version: 2, windowStart: earliest, windowEnd: today,
      nextDate: shiftDate(date, 1), complete: shiftDate(date, 1) > today,
      lastRunAt: new Date().toISOString(),
      lastRun: { dates: results.map(row => row.date), sourceRecords: results.reduce((sum, row) => sum + row.sourceRecords, 0), verified: results.reduce((sum, row) => sum + row.verified, 0) },
    });
  }
  const nextDate = shiftDate(dates.at(-1) || startDate, 1);
  const complete = nextDate > today;
  const summary = {
    version: 2,
    windowStart: earliest,
    windowEnd: today,
    nextDate,
    complete,
    lastRunAt: new Date().toISOString(),
    lastRun: { dates: results.map((row) => row.date), sourceRecords: results.reduce((sum, row) => sum + row.sourceRecords, 0), verified: results.reduce((sum, row) => sum + row.verified, 0) },
  };
  await saveBackfillState(env.DB, summary);
  return summary;
}

export async function runScheduledSngOperationalRecovery(env) {
  if (!env?.DB || !env?.AIRTABLE_API_KEY || !env?.SNG_API_KEY) return { skipped: true, reason: "not_configured" };
  const id = crypto.randomUUID();
  try {
    const latestEvent = await env.DB.prepare(`SELECT received_at FROM sng_events ORDER BY received_at DESC LIMIT 1`).first();
    const latestEventTime = latestEvent?.received_at ? Date.parse(String(latestEvent.received_at).includes("T") ? latestEvent.received_at : `${latestEvent.received_at}Z`) : Number.NaN;
    const webhookAgeMinutes = Number.isFinite(latestEventTime) ? Math.max(0, Math.round((Date.now() - latestEventTime) / 60000)) : null;
    const webhookStale = webhookAgeMinutes === null || webhookAgeMinutes > 180;
    const recent = [];
    for (const date of [easternDate(1), easternDate()]) recent.push(await reconcileDispatchDate(env, date));
    const [backfill, eventRecovery] = await Promise.all([runSngDispatchBackfillBatch(env), recoverFailedSngEvents({ limit: 25 })]);
    const jobsUpserted = recent.reduce((sum, row) => sum + Number(row.upserted || 0), 0);
    const verified = recent.reduce((sum, row) => sum + Number(row.verified || 0), 0);
    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at)
       VALUES (?,'sng_operational_recovery',?,?,?,CURRENT_TIMESTAMP)`
    ).bind(id, webhookStale ? "partial" : "success", easternDate(), jobsUpserted + eventRecovery.recovered).run();
    console.log(JSON.stringify({ event: "sng_operational_recovery", completedAt, recent, backfill, eventRecovery, verified, webhookAgeMinutes, webhookStale }));
    return { recent, backfill, eventRecovery, verified, webhookAgeMinutes, webhookStale };
  } catch (error) {
    await env.DB.prepare(
      `INSERT INTO system_sync_runs (id,sync_name,status,error,completed_at)
       VALUES (?,'sng_operational_recovery','failed',?,CURRENT_TIMESTAMP)`
    ).bind(id, String(error).slice(0, 500)).run();
    console.error(JSON.stringify({ event: "sng_operational_recovery_failed", message: String(error) }));
    throw error;
  }
}
