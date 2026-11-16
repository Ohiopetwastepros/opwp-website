export const INITIAL_SMS_HEARTBEAT_KEY = "quote_initial_sms_scheduler_v1";
export const INITIAL_SMS_WATCHDOG_KEY = "quote_initial_sms_watchdog_v1";
export const INITIAL_SMS_OVERDUE_MINUTES = 2;
export const INITIAL_SMS_HEARTBEAT_MINUTES = 3;

const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const time = value => {
  const text = String(value || "").replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : text + "Z");
};

export async function recordInitialSmsHeartbeat(db, state) {
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
    VALUES (?,?,'success',CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE
    SET payload=json_set(excluded.payload,'$.firstCompletedAt',COALESCE(
      json_extract(airtable_cockpit_snapshots.payload,'$.firstCompletedAt'),
      json_extract(airtable_cockpit_snapshots.payload,'$.completedAt'),json_extract(excluded.payload,'$.completedAt'))),updated_at=CURRENT_TIMESTAMP`)
    .bind(INITIAL_SMS_HEARTBEAT_KEY, JSON.stringify({...state,firstCompletedAt:state.completedAt})).run();
}

export async function getInitialSmsHealth(db, {now = Date.now()} = {}) {
  const cutoff = new Date(now - INITIAL_SMS_OVERDUE_MINUTES * 60000).toISOString();
  const [snapshots, due] = await Promise.all([
    db.prepare("SELECT snapshot_key,payload FROM airtable_cockpit_snapshots WHERE snapshot_key IN (?,?)")
      .bind(INITIAL_SMS_HEARTBEAT_KEY, INITIAL_SMS_WATCHDOG_KEY).all(),
    db.prepare(`SELECT d.id,d.submission_id,d.status,d.attempt_count,d.error_message,d.created_at,d.sending_at,d.next_attempt_at
      FROM quote_follow_up_deliveries d JOIN submissions s ON s.id=d.submission_id
      JOIN quote_follow_ups q ON q.id=d.follow_up_id
      WHERE d.id LIKE 'quote-initial-sms-v1:%' AND d.channel='customer_sms'
        AND s.kind='partial_quote' AND s.source='website' AND s.status='follow_up_pending' AND q.status='queued'
        AND ((d.status='queued' AND julianday(d.next_attempt_at)<=julianday(?))
          OR (d.status='sending' AND julianday(d.sending_at)<=julianday(?))
          OR (d.status='failed' AND (d.attempt_count>=5 OR julianday(d.created_at)<=julianday(?)))
          OR (d.status='cancelled' AND d.error_message='initial_contact_window_expired'))
      ORDER BY EXISTS(SELECT 1 FROM airtable_cockpit_snapshots a
        WHERE a.snapshot_key='quote_initial_sms_alert:delivery:'||d.id
          AND (json_extract(a.payload,'$.status') IN ('sent','resolved') OR json_extract(a.payload,'$.attempts')>=5)),
        d.created_at,d.id LIMIT 20`).bind(cutoff,cutoff,cutoff).all(),
  ]);
  const heartbeat = parse(snapshots.results?.find(row => row.snapshot_key === INITIAL_SMS_HEARTBEAT_KEY)?.payload);
  const watchdog = parse(snapshots.results?.find(row => row.snapshot_key === INITIAL_SMS_WATCHDOG_KEY)?.payload);
  const completed = time(heartbeat.completedAt);
  const firstCheck = time(watchdog.firstCheckedAt);
  const starting = !Number.isFinite(completed) && (!Number.isFinite(firstCheck) || now - firstCheck < INITIAL_SMS_HEARTBEAT_MINUTES * 60000);
  const incidents = (due.results || []).map(row => ({
    key: "delivery:" + row.id,
    submissionId: row.submission_id,
    reason: row.error_message || (row.status === "sending" ? "send_in_progress_over_two_minutes" : "initial_text_overdue"),
    state: row.status,
  }));
  if (!starting && (heartbeat.status === "failed" || !Number.isFinite(completed) || completed > now + 60000 || now - completed > INITIAL_SMS_HEARTBEAT_MINUTES * 60000)) {
    incidents.push({key:"scheduler:" + (heartbeat.completedAt || watchdog.firstCheckedAt || "missing"),
      reason:heartbeat.status === "failed" ? "sms_scheduler_failed" : "sms_scheduler_heartbeat_missing",state:"scheduler"});
  }
  const watchdogTime = time(watchdog.lastCheckedAt || watchdog.firstCheckedAt || heartbeat.firstCompletedAt);
  if (Number.isFinite(watchdogTime) && (watchdogTime > now + 60000 || now - watchdogTime > INITIAL_SMS_HEARTBEAT_MINUTES * 60000)) {
    incidents.push({key:"watchdog:" + (watchdog.lastCheckedAt || heartbeat.firstCompletedAt),reason:"sms_watchdog_heartbeat_missing",state:"watchdog"});
  }
  return {status:incidents.length ? "attention" : starting ? "starting" : "healthy",incidents,
    scheduler:heartbeat,watchdog,overdue:due.results?.length || 0,hasMore:due.results?.length === 20,
    checkedAt:new Date(now).toISOString()};
}
