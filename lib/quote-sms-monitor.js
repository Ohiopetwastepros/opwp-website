import {getInitialSmsHealth,INITIAL_SMS_WATCHDOG_KEY} from "./quote-sms-health.mjs";
import {sendTransactionalEmail,transactionalEmailConfig} from "./submission-notifications";
import {escapeEmailHtml} from "./quote-funnel.mjs";
import {getLeadFunnelHealth} from './lead-funnel-health.mjs';
import {refreshFunnelRoutes} from './lead-funnel-routing';
import {readFunnelPreview} from './lead-funnel-admin.mjs';
import {reconcileFunnelSignups} from './lead-funnel-conversion.mjs';
import {processAirtableQueue} from './lead-assistant';

const ALERT_PREFIX = "quote_initial_sms_alert:";
const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };

async function deliverIncident(env, incident, {now,sendEmail,canSend}) {
  const db = env.DB;
  const key = ALERT_PREFIX + incident.key;
  const initial = {status:"queued",attempts:0,incident,firstSeenAt:new Date(now).toISOString()};
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
    VALUES (?,?,'success',CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO NOTHING`).bind(key,JSON.stringify(initial)).run();
  const previous = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(key).first();
  const state = parse(previous?.payload);
  if (["sent","resolved"].includes(state.status)) return "recorded";
  if (Number(state.attempts) >= 5 || Date.parse(state.retryAt) > now) return state.status === "failed" ? "failed_recorded" : "recorded";
  // A retry uses the same Resend idempotency key, including after a timed-out
  // response. Claims older than two minutes can resume their bounded retry.
  if (state.status === "sending" && now - Date.parse(state.startedAt) < 2 * 60000) return "recorded";
  if (!canSend) return "recorded";
  const claim = {...state,status:"sending",attempts:Number(state.attempts || 0)+1,startedAt:new Date(now).toISOString()};
  const claimed = await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP
    WHERE snapshot_key=? AND payload=?`).bind(JSON.stringify(claim),key,previous.payload).run();
  if (!claimed.meta?.changes) return "recorded";
  try {
    const config = transactionalEmailConfig(env);
    if (!config.configured) throw new Error("owner_email_unconfigured");
    const lines = [
      "The website's automatic initial lead text needs attention.",
      incident.submissionId ? `Lead record ${incident.submissionId}` : "The initial-text scheduler has stopped reporting successful checks.",
      `State ${incident.state}`,
      `Reason ${incident.reason}`,
      "Review the lead inbox and System health at https://www.ohiopetwastepros.com/admin/quote-funnel/ and https://www.ohiopetwastepros.com/admin/system-health/.",
      "For an unconfirmed send, check the Quo conversation before sending another text.",
    ];
    if (incident.submissionId && incident.state === 'decision') {
      const preview=await readFunnelPreview(db,incident.submissionId,{now});
      lines.push(`Review and approve at https://www.ohiopetwastepros.com/admin/quote-funnel/#lead-automation . Lead ${incident.submissionId}.`,
        `Prepared text: ${preview.text}`,`Recommended service day: ${preview.route.day || preview.route.reason || 'Address needed'}.`,
        `Sona handoff: ${preview.sonaBrief}`);
    }
    const providerId = await sendEmail(env,{to:config.recipient,subject:"Website lead text needs attention",text:lines.join("\n\n"),
      html:lines.map(line=>`<p>${escapeEmailHtml(line)}</p>`).join(""),idempotencyKey:key});
    await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?")
      .bind(JSON.stringify({...claim,status:"sent",providerId,sentAt:new Date(now).toISOString()}),key,JSON.stringify(claim)).run();
    console.info(JSON.stringify({event:"initial_sms_watchdog_alert",incident:incident.key,status:"sent"}));
    return "sent";
  } catch {
    await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?")
      .bind(JSON.stringify({...claim,status:"failed",error:"owner_alert_delivery_failed",retryAt:new Date(now+60000).toISOString()}),key,JSON.stringify(claim)).run();
    console.error(JSON.stringify({event:"initial_sms_watchdog_alert",incident:incident.key,status:"failed"}));
    return "failed";
  }
}

export async function runInitialSmsWatchdog(env, {now = Date.now(),sendEmail = sendTransactionalEmail} = {}) {
  if (!env?.DB || env.QUOTE_INITIAL_SMS_ENABLED !== "true" && env.LEAD_FUNNEL_ENABLED !== 'true') return {enabled:false};
  const db = env.DB;
  const checkedAt = new Date(now).toISOString();
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
    VALUES (?,?,'success',CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO NOTHING`)
    .bind(INITIAL_SMS_WATCHDOG_KEY,JSON.stringify({firstCheckedAt:checkedAt})).run();
  if(env.LEAD_FUNNEL_ENABLED==='true')await reconcileFunnelSignups(db);
  const health = await getInitialSmsHealth(db,{now});
  if (env.LEAD_FUNNEL_ENABLED === 'true') {
    const funnel = await getLeadFunnelHealth(db,env,{now});
    health.incidents.push(...funnel.incidents);
    if (funnel.status !== 'healthy') health.status='attention';
  }
  let sent = 0;
  let failed = 0;
  let attempts = 0;
  for (const incident of health.incidents) {
    const result = await deliverIncident(env,incident,{now,sendEmail,canSend:attempts<5});
    if (result === "sent" || result === "failed") attempts += 1;
    if (result === "sent") sent += 1;
    if (result === "failed" || result === "failed_recorded") failed += 1;
  }
  const state = {...health.watchdog,lastCheckedAt:checkedAt,status:health.status,incidents:health.incidents.length,sent,failed};
  await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?")
    .bind(JSON.stringify(state),INITIAL_SMS_WATCHDOG_KEY).run();
  if (env.LEAD_FUNNEL_ENABLED === 'true') {
    try { await refreshFunnelRoutes(env); }
    catch { console.error(JSON.stringify({event:'lead_funnel_route_refresh_failed'})); }
    const sync=await db.prepare(`SELECT a.submission_id FROM lead_airtable_sync a JOIN airtable_cockpit_snapshots j ON j.snapshot_key='lead_funnel_job:org-opwp:'||a.submission_id
      WHERE a.organization_id='org-opwp' AND a.status IN ('queued','failed') AND a.attempt_count<5 AND a.next_attempt_at<=CURRENT_TIMESTAMP
      ORDER BY a.next_attempt_at,a.submission_id LIMIT 2`).all();
    for(const row of sync.results||[])await processAirtableQueue(env,1,row.submission_id);
  }
  return {enabled:true,status:health.status,incidents:health.incidents.length,sent,failed};
}
