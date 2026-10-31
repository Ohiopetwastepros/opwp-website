import { sngRequest } from "./sweepandgo";
import { normalizeSngDispatchJobs } from "./route-intelligence";
import { importRoutePartnerDay, getRoutePartnerDay } from "./route-partner";
import { dispatchSchedule, DISPATCH_AUTOMATION_KEY, readDispatchAutomation, saveDispatchSnapshot } from "./dispatch-automation-state.mjs";

// Temporary bridge: persist the daily optimization. SNG's documented API has no
// route-order write operation; publishing must remain visibly pending.
export async function runScheduledDispatchPreparation(env, scheduledTime) {
  const { date, due } = dispatchSchedule(scheduledTime);
  if (!due) return { skipped: true, reason: "outside_dispatch_window" };
  if (env.DISPATCH_AUTOMATION_ENABLED !== "true" || !env.DB) return { skipped: true, reason: "not_configured" };
  const db = env.DB;
  const lockKey = `dispatch_lock:org-opwp:${date}`;
  const token = crypto.randomUUID();
  const lock = await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at WHERE captured_at<? RETURNING snapshot_key`)
    .bind(lockKey, token, new Date().toISOString(), new Date(Date.now() - 300000).toISOString()).first();
  if (!lock) return { skipped: true, reason: "dispatch_busy" };
  let run;
  try {
    const previous = (await readDispatchAutomation(db, date)).run;
    if (previous && (["prepared", "needs_review", "no_work"].includes(previous.status) || previous.attempts >= 3)) {
      return { skipped: true, reason: "already_processed", status: previous.status };
    }
    run = { date, status: "running", attempts: (previous?.attempts || 0) + 1,
      startedAt: new Date().toISOString(), scheduledFor: new Date(scheduledTime).toISOString(),
      publishing: "pending_browser", planIds: [], message: "Reading today's SNG dispatch." };
    await saveDispatchSnapshot(db, DISPATCH_AUTOMATION_KEY(date), run);
    const response = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
    if (!response.ok) throw new Error("SNG dispatch is unavailable. The previous saved route is retained.");
    const sourceRows = [response.data, response.data?.data, response.data?.results, response.data?.items].find(Array.isArray);
    if (!sourceRows || sourceRows.length > 400 || sourceRows.some(row => !row || !String(row.id || row.job_id || row.uuid || "").trim())) {
      throw new Error("SNG returned incomplete dispatch data. Review the dispatch board.");
    }
    // Store the complete bounded source before deriving any new plan. Never send
    // this raw provider payload to the client, logs, or a public endpoint.
    await saveDispatchSnapshot(db, `dispatch_source:org-opwp:${date}`, { capturedAt: new Date().toISOString(), sourceRows });
    const jobs = normalizeSngDispatchJobs(sourceRows);
    if (jobs.some(job => ["started", "completed"].includes(job.sourceStatus))) {
      run.status = "needs_review";
      run.message = "SNG work has already started or completed. Existing route order is preserved.";
    } else {
      try {
        const imported = await importRoutePartnerDay({ db, date, sourceRows, actor: "dispatch-automation" });
        const day = await getRoutePartnerDay(db, date);
        const plans = day.plans.filter(plan => imported.planIds.includes(plan.id));
        run.planIds = imported.planIds;
        run.jobCount = plans.reduce((sum, plan) => sum + plan.sourceJobCount, 0);
        run.stopCount = plans.reduce((sum, plan) => sum + plan.locationCount, 0);
        run.savedMinutes = plans.reduce((sum, plan) => sum + Number(plan.optimization?.savedMinutes || 0), 0);
        run.status = plans.length && plans.every(plan => plan.optimization?.status === "optimized") ? "prepared" : "needs_review";
        run.message = run.status === "prepared" ? "Optimized plans saved. SNG route order still needs the browser publishing step." : "Plans saved with routing issues that require review before changing SNG.";
      } catch (error) {
        if (error.message !== "No dispatched scoop jobs or scheduled dog-food deliveries were found for this date.") throw error;
        run.status = "no_work";
        run.publishing = "not_required";
        run.message = "No dispatched service work or scheduled deliveries were found.";
      }
    }
  } catch (error) {
    if (!run) throw error;
    run.status = "failed";
    run.message = "Dispatch preparation could not finish. Saved routes are retained; review SNG and the routing connection.";
    console.error(JSON.stringify({ event: "dispatch_preparation_failed", date, attempt: run.attempts }));
  } finally {
    try {
      if (run) {
        run.completedAt = new Date().toISOString();
        await saveDispatchSnapshot(db, DISPATCH_AUTOMATION_KEY(date), run);
        await db.prepare(`INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,error,completed_at)
          VALUES (?,'daily_dispatch_preparation',?,?,?,?,CURRENT_TIMESTAMP)`)
          .bind(crypto.randomUUID(), run.status === "failed" || run.status === "needs_review" ? "failed" : "success", date, run.jobCount || 0,
            run.status === "failed" || run.status === "needs_review" ? run.message : null).run();
      }
    } finally {
      await db.prepare("DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?").bind(lockKey, token).run();
    }
  }
  return run;
}
