import { getRuntimeEnv } from "./cloudflare";

export function getDb() {
  return getRuntimeEnv().DB ?? null;
}

export async function saveSubmission({ kind, source = "website", status = "new", body }) {
  const db = getDb();
  const id = crypto.randomUUID();
  if (!db) return { configured: false, id };

  const name = body.name || [body.first_name, body.last_name].filter(Boolean).join(" ") || null;
  const email = body.email || body.email_address || null;
  const phone = body.phone || body.cell_phone_number || null;
  const zip = body.zip || body.zip_code || null;

  await db.prepare(
    `INSERT INTO submissions
      (id, kind, source, status, name, email, phone, zip, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, kind, source, status, name, email, phone, zip, JSON.stringify(body)).run();

  return { configured: true, id };
}

export async function markSubmissionSynced(id, response, ok) {
  const db = getDb();
  if (!db) return;
  await db.prepare(
    `UPDATE submissions
     SET sng_synced = ?, sng_response = ?, status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(ok ? 1 : 0, JSON.stringify(response), ok ? "synced" : "needs_attention", id).run();
}

export async function updateSubmissionStatus(id, status) {
  const db = getDb();
  if (!db || !id) return false;
  const result = await db.prepare(
    `UPDATE submissions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, id).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function queueDogFoodFollowUp({ submissionId, phone, consentText, delayMinutes = 15 }) {
  const db = getDb();
  if (!db) return { configured: false, queued: false };
  const id = crypto.randomUUID();
  const safeDelay = Math.min(Math.max(Number(delayMinutes) || 15, 5), 1440);
  await db.prepare(
    `INSERT INTO dog_food_follow_ups
      (id, submission_id, phone, status, consent_text, consent_at, scheduled_at)
     VALUES (?, ?, ?, 'queued', ?, CURRENT_TIMESTAMP, datetime('now', ?))
     ON CONFLICT(submission_id) DO NOTHING`
  ).bind(id, submissionId, phone, consentText, `+${safeDelay} minutes`).run();
  return { configured: true, queued: true };
}

export async function cancelDogFoodFollowUp(submissionId) {
  const db = getDb();
  if (!db || !submissionId) return false;
  await db.batch([
    db.prepare(
      `UPDATE dog_food_follow_ups
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE submission_id = ? AND status = 'queued'`
    ).bind(submissionId),
    db.prepare(
      `UPDATE submissions SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(submissionId),
  ]);
  return true;
}

export async function listSubmissions(limit = 50) {
  const db = getDb();
  if (!db) return { configured: false, rows: [] };
  const result = await db.prepare(
    `SELECT id, kind, source, status, name, email, phone, zip, sng_synced,
            created_at, updated_at
     FROM submissions ORDER BY created_at DESC LIMIT ?`
  ).bind(Math.min(Math.max(Number(limit) || 50, 1), 200)).all();
  return { configured: true, rows: result.results ?? [] };
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

export async function saveSngEvent({ eventType, body }) {
  const db = getDb();
  const id = crypto.randomUUID();
  if (!db) return { configured: false, id };

  const data = body?.data && typeof body.data === "object" ? body.data : body;
  const externalId = firstValue(
    body?.id,
    body?.event_id,
    data?.job_id,
    data?.invoice_id,
    data?.subscription_id,
    data?.shift_id,
    data?.client_id,
    data?.lead_id,
    data?.id
  );
  const customerName = firstValue(
    body?.name,
    data?.name,
    data?.full_name,
    data?.client_name,
    data?.employee_name,
    [data?.first_name, data?.last_name].filter(Boolean).join(" ")
  );
  const email = firstValue(body?.email, body?.email_address, data?.email, data?.email_address, data?.client_email);
  const phone = firstValue(
    body?.phone,
    body?.cell_phone,
    body?.cell_phone_number,
    data?.phone,
    data?.cell_phone,
    data?.cell_phone_number,
    data?.home_phone,
    data?.home_phone_number
  );

  await db.prepare(
    `INSERT INTO sng_events
      (id, event_type, external_id, customer_name, email, phone, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, eventType, externalId, customerName, email, phone, JSON.stringify(body)).run();

  return { configured: true, id };
}

export async function listSngEvents(limit = 50) {
  const db = getDb();
  if (!db) return { configured: false, rows: [] };
  const result = await db.prepare(
    `SELECT id, event_type, external_id, customer_name, email, phone, status,
            received_at, processed_at, processing_error, payload
     FROM sng_events ORDER BY received_at DESC LIMIT ?`
  ).bind(Math.min(Math.max(Number(limit) || 50, 1), 500)).all();
  return { configured: true, rows: result.results ?? [] };
}

export async function getSngEventContext(externalId, eventTypes = []) {
  const db = getDb();
  if (!db || externalId === undefined || externalId === null || !eventTypes.length) return null;
  const placeholders = eventTypes.map(() => "?").join(",");
  const row = await db.prepare(
    `SELECT payload FROM sng_events WHERE external_id = ? AND event_type IN (${placeholders}) ORDER BY received_at DESC LIMIT 1`
  ).bind(String(externalId), ...eventTypes).first();
  try { return row?.payload ? JSON.parse(row.payload) : null; } catch { return null; }
}

export async function markSngEventProcessed(id, status = "processed", processingError = null) {
  const db = getDb();
  if (!db) return;
  await db.prepare(
    `UPDATE sng_events SET status = ?, processing_error = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(status, processingError, id).run();
}

export async function listUnprocessedSngEvents(limit = 100) {
  const db = getDb();
  if (!db) return [];
  const result = await db.prepare(
    `SELECT id, event_type, external_id, payload FROM sng_events WHERE status IN ('received', 'needs_attention') ORDER BY received_at ASC LIMIT ?`
  ).bind(Math.min(Math.max(Number(limit) || 100, 1), 500)).all();
  return result.results ?? [];
}

export async function listFailedSngEvents(limit = 5, excludeId = null) {
  const db = getDb();
  if (!db) return [];
  const cappedLimit = Math.min(Math.max(Number(limit) || 5, 1), 25);
  const query = excludeId
    ? `SELECT id, event_type, external_id, payload FROM sng_events WHERE status IN ('received', 'needs_attention') AND id <> ? ORDER BY received_at ASC LIMIT ?`
    : `SELECT id, event_type, external_id, payload FROM sng_events WHERE status IN ('received', 'needs_attention') ORDER BY received_at ASC LIMIT ?`;
  const statement = db.prepare(query);
  const result = excludeId
    ? await statement.bind(excludeId, cappedLimit).all()
    : await statement.bind(cappedLimit).all();
  return result.results ?? [];
}

function parseSngTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const timestamp = Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function eventData(row) {
  try {
    const body = JSON.parse(row?.payload ?? "{}");
    return body?.data && typeof body.data === "object" ? body.data : body;
  } catch {
    return {};
  }
}

function moneyValue(value) {
  const parsed = Number(String(value ?? "0").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function upsertSngInvoice({ eventId, body }) {
  const db = getDb();
  if (!db) return { configured: false, invoiceId: null };
  const data = body?.data && typeof body.data === "object" ? body.data : body ?? {};
  const invoiceId = data.invoice_id ?? data.id;
  if (invoiceId === undefined || invoiceId === null || invoiceId === "") throw new Error("SNG finalized invoice is missing invoice_id.");
  await db.prepare(
    `INSERT INTO sng_invoices
      (invoice_id, invoice_number, sng_user_id, client_ref, client_name, invoice_type, category,
       billing_interval, total, subtotal, tax, tip_amount, paid, remaining, invoice_created_at,
       period_start, period_end, due_date, source_event_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(invoice_id) DO UPDATE SET
       invoice_number = excluded.invoice_number,
       sng_user_id = excluded.sng_user_id,
       client_ref = excluded.client_ref,
       client_name = excluded.client_name,
       invoice_type = excluded.invoice_type,
       category = excluded.category,
       billing_interval = excluded.billing_interval,
       total = excluded.total,
       subtotal = excluded.subtotal,
       tax = excluded.tax,
       tip_amount = excluded.tip_amount,
       paid = excluded.paid,
       remaining = excluded.remaining,
       invoice_created_at = excluded.invoice_created_at,
       period_start = excluded.period_start,
       period_end = excluded.period_end,
       due_date = excluded.due_date,
       source_event_id = excluded.source_event_id,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    String(invoiceId), String(data.invoice_number ?? ""), String(data.user_id ?? ""), String(data.client ?? ""),
    String(data.client_name ?? ""), String(data.type ?? ""), String(data.category ?? ""), String(data.billing_interval ?? ""),
    moneyValue(data.total ?? data.amount), moneyValue(data.subtotal), moneyValue(data.tax), moneyValue(data.tip_amount),
    String(data.paid ?? ""), moneyValue(data.remaining), data.created_at ?? null, data.period_start ?? null,
    data.period_end ?? null, data.due_date ?? null, eventId ?? null
  ).run();
  return { configured: true, invoiceId: String(invoiceId) };
}

export async function getBriaRouteAllocation(days = 31) {
  const db = getDb();
  if (!db) return { configured: false, routeMinutes: 0, officeMinutes: 0, matchedDays: [], days: [] };
  const safeDays = Math.min(Math.max(Number(days) || 31, 1), 120);
  const result = await db.prepare(
    `SELECT event_type, payload
     FROM sng_events
     WHERE event_type IN ('job:completed', 'payroll:shift_info')
       AND CAST(json_extract(payload, '$.data.employee_id') AS INTEGER) = 10080
       AND received_at >= datetime('now', ?)
     ORDER BY received_at ASC`
  ).bind(`-${safeDays + 1} days`).all();

  const byDay = new Map();
  for (const row of result.results ?? []) {
    const data = eventData(row);
    const start = parseSngTimestamp(data.start_time);
    const end = parseSngTimestamp(data.end_time);
    const date = String(data.start_time ?? data.end_time ?? "").slice(0, 10);
    if (!date || start === null || end === null || end < start) continue;
    const current = byDay.get(date) ?? { date, shiftStart: null, shiftEnd: null, lastJobEnd: null, jobs: 0 };
    if (row.event_type === "payroll:shift_info") {
      current.shiftStart = current.shiftStart === null ? start : Math.min(current.shiftStart, start);
      current.shiftEnd = current.shiftEnd === null ? end : Math.max(current.shiftEnd, end);
    } else {
      current.lastJobEnd = current.lastJobEnd === null ? end : Math.max(current.lastJobEnd, end);
      current.jobs += 1;
    }
    byDay.set(date, current);
  }

  const measured = [...byDay.values()].filter((day) => day.shiftStart !== null && day.shiftEnd !== null && day.lastJobEnd !== null).map((day) => {
    const routeEnd = Math.min(day.shiftEnd, day.lastJobEnd + 30 * 60000);
    const routeMinutes = Math.max(Math.round((routeEnd - day.shiftStart) / 60000), 0);
    const officeMinutes = Math.max(Math.round((day.shiftEnd - routeEnd) / 60000), 0);
    return {
      date: day.date,
      jobs: day.jobs,
      routeMinutes,
      officeMinutes,
      routeEnd: new Date(routeEnd).toISOString(),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  return {
    configured: true,
    routeMinutes: measured.reduce((sum, day) => sum + day.routeMinutes, 0),
    officeMinutes: measured.reduce((sum, day) => sum + day.officeMinutes, 0),
    matchedDays: measured.map((day) => day.date),
    days: measured,
  };
}

export async function getSngInvoiceMetrics(days = 30) {
  const db = getDb();
  if (!db) return { configured: false, connected: false, oneTimeInvoices: 0, oneTimeRevenue: 0, priorOneTimeRevenue: 0 };
  const safeDays = Math.min(Math.max(Number(days) || 30, 1), 120);
  const [summary, connection] = await Promise.all([
    db.prepare(
      `SELECT
         SUM(CASE WHEN lower(invoice_type) <> 'subscription' AND datetime(COALESCE(invoice_created_at, created_at)) >= datetime('now', ?) THEN 1 ELSE 0 END) one_time_invoices,
         SUM(CASE WHEN lower(invoice_type) <> 'subscription' AND datetime(COALESCE(invoice_created_at, created_at)) >= datetime('now', ?) THEN total ELSE 0 END) one_time_revenue,
         SUM(CASE WHEN lower(invoice_type) <> 'subscription' AND datetime(COALESCE(invoice_created_at, created_at)) < datetime('now', ?) THEN total ELSE 0 END) prior_one_time_revenue
       FROM sng_invoices
       WHERE datetime(COALESCE(invoice_created_at, created_at)) >= datetime('now', ?)`
    ).bind(`-${safeDays} days`, `-${safeDays} days`, `-${safeDays} days`, `-${safeDays * 2} days`).first(),
    db.prepare(`SELECT COUNT(*) count, MIN(created_at) first_received_at FROM sng_invoices`).first(),
  ]);
  return {
    configured: true,
    connected: Number(connection?.count ?? 0) > 0,
    firstReceivedAt: connection?.first_received_at ?? null,
    oneTimeInvoices: Number(summary?.one_time_invoices ?? 0),
    oneTimeRevenue: Number(summary?.one_time_revenue ?? 0),
    priorOneTimeRevenue: Number(summary?.prior_one_time_revenue ?? 0),
  };
}

export async function getSubscriptionTruth(days = 30) {
  const db = getDb();
  if (!db) return { configured: false, latest: null, snapshotDays: 0, churnedCustomers: 0, lostMrr: 0 };
  const safeDays = Math.min(Math.max(Number(days) || 30, 1), 120);
  const [latest, period] = await Promise.all([
    db.prepare(`SELECT * FROM subscription_daily_snapshots ORDER BY snapshot_date DESC LIMIT 1`).first(),
    db.prepare(
      `SELECT COUNT(*) snapshot_days, SUM(churned_customers) churned_customers, SUM(lost_mrr) lost_mrr
       FROM subscription_daily_snapshots WHERE snapshot_date >= date('now', ?)`
    ).bind(`-${safeDays - 1} days`).first(),
  ]);
  return {
    configured: true,
    latest: latest ?? null,
    snapshotDays: Number(period?.snapshot_days ?? 0),
    churnedCustomers: Number(period?.churned_customers ?? 0),
    lostMrr: Number(period?.lost_mrr ?? 0),
  };
}

export async function getSubscriptionSyncHealth() {
  const db = getDb();
  if (!db) return { configured: false, latest: null };
  const latest = await db.prepare(
    `SELECT status,snapshot_date,records_processed,error,started_at,completed_at
     FROM system_sync_runs WHERE sync_name='subscriptions_daily' ORDER BY started_at DESC LIMIT 1`
  ).first();
  return { configured: true, latest: latest ?? null };
}

export async function getSubscriptionStatusReviews() {
  const db = getDb();
  if (!db) return { configured: false, openCount: 0, coreMrrAtRisk: 0, rows: [] };
  const result = await db.prepare(
    `SELECT client_key,client_name,address,core_mrr,addon_mrr,first_missing_date,last_missing_date,consecutive_missing_days,evidence
     FROM subscription_status_reviews WHERE review_status='open' ORDER BY core_mrr DESC,client_name`
  ).all();
  const rows = result.results ?? [];
  return {
    configured: true,
    openCount: rows.length,
    coreMrrAtRisk: rows.reduce((sum, row) => sum + Number(row.core_mrr || 0), 0),
    rows: rows.map((row) => ({
      id: row.client_key,
      customer: row.client_name,
      address: row.address,
      coreMrr: Number(row.core_mrr || 0),
      addonMrr: Number(row.addon_mrr || 0),
      firstMissing: row.first_missing_date,
      lastMissing: row.last_missing_date,
      missingDays: Number(row.consecutive_missing_days || 1),
      evidence: row.evidence,
    })),
  };
}

export async function recordSubscriptionCancellation({ eventId, body, businessLine, isCustomerChurn, reasonCategory, reviewStatus, replacementSubscriptionId = "", eligibilityStatus = "Needs Validation", eligibilityEvidence = "" }) {
  const db = getDb();
  if (!db) return { configured: false };
  const data = body?.data && typeof body.data === "object" ? body.data : body ?? {};
  const subscriptionId = data.subscription_id;
  if (subscriptionId === undefined || subscriptionId === null) throw new Error("SNG cancellation is missing subscription_id.");
  const rawCanceledAt = data.canceled_at || data.terminated_at || body?.created;
  const numericCanceledAt = Number(rawCanceledAt);
  const parsedCanceledAt = Number.isFinite(numericCanceledAt) && numericCanceledAt > 0
    ? new Date(numericCanceledAt < 1e12 ? numericCanceledAt * 1000 : numericCanceledAt)
    : new Date(rawCanceledAt || Date.now());
  const canceledAt = Number.isNaN(parsedCanceledAt.getTime()) ? new Date().toISOString() : parsedCanceledAt.toISOString();
  await db.prepare(
    `INSERT INTO subscription_cancellations
      (subscription_id,source_event_id,business_line,client_ref,client_name,client_address,plan,reason,reason_category,comment,review_status,replacement_subscription_id,is_customer_churn,canceled_at,eligibility_status,eligibility_evidence,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(subscription_id) DO UPDATE SET
       source_event_id=excluded.source_event_id,business_line=excluded.business_line,client_ref=excluded.client_ref,client_name=excluded.client_name,
       client_address=excluded.client_address,plan=excluded.plan,reason=excluded.reason,reason_category=excluded.reason_category,comment=excluded.comment,
       review_status=excluded.review_status,replacement_subscription_id=excluded.replacement_subscription_id,
       is_customer_churn=excluded.is_customer_churn,canceled_at=excluded.canceled_at,eligibility_status=excluded.eligibility_status,
       eligibility_evidence=excluded.eligibility_evidence,updated_at=CURRENT_TIMESTAMP`
  ).bind(String(subscriptionId), eventId ?? null, businessLine, data.client || "", data.client_name || data.full_name || data.client || "", data.client_address || "", data.subscription_name || "", data.termination_reason || "No reason provided", reasonCategory, data.termination_comment || "", reviewStatus, replacementSubscriptionId || null, isCustomerChurn ? 1 : 0, canceledAt, eligibilityStatus, eligibilityEvidence).run();
  return { configured: true, subscriptionId: String(subscriptionId) };
}

export async function hasPaidInvoiceBeforeCancellation({ body, businessLine }) {
  const db = getDb();
  if (!db) return false;
  const data = body?.data ?? body ?? {};
  const clientRef = String(data.client || data.client_id || "");
  const clientName = String(data.client_name || data.full_name || "");
  if (!clientRef && !clientName) return false;
  const canceledAt = lifecycleTimestamp(data.canceled_at || data.terminated_at || body?.created);
  const row = await db.prepare(
    `SELECT invoice_id FROM sng_invoices
     WHERE ((?<>'' AND (client_ref=? OR sng_user_id=?)) OR (?<>'' AND lower(client_name)=lower(?)))
       AND datetime(COALESCE(invoice_created_at,created_at)) <= datetime(?)
       AND (lower(COALESCE(paid,'')) IN ('true','1','yes','paid') OR remaining<=0)
       AND (?='scooping' OR lower(COALESCE(category,'')) LIKE '%dog food%' OR lower(COALESCE(category,'')) LIKE '%extreme dog fuel%')
     LIMIT 1`
  ).bind(clientRef, clientRef, clientRef, clientName, clientName, canceledAt, businessLine).first();
  return Boolean(row?.invoice_id);
}

export async function updateSubscriptionCancellationLostMrr(subscriptionId, lostMrr) {
  const db = getDb();
  if (!db || subscriptionId === undefined || subscriptionId === null) return;
  await db.prepare(
    `UPDATE subscription_cancellations SET lost_mrr=?,updated_at=CURRENT_TIMESTAMP WHERE subscription_id=?`
  ).bind(Math.max(Number(lostMrr) || 0, 0), String(subscriptionId)).run();
}

function lifecycleTimestamp(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function plannedSubscriptionResumeDate(body) {
  const data = body?.data ?? body ?? {};
  const raw = data.planned_resume_date || data.resume_date || data.paused_until || data.pause_until || data.pause_end_date || data.unpause_date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export async function recordSubscriptionPause({ eventId, body, businessLine, reason = "Temporary", comment = "" }) {
  const db = getDb();
  if (!db) return { configured: false };
  const data = body?.data ?? body ?? {};
  const pausedAt = lifecycleTimestamp(data.paused_at || data.created_at || body?.created);
  const subscriptionId = data.subscription_id === undefined || data.subscription_id === null ? "" : String(data.subscription_id);
  const pauseId = String(eventId || `pause:${subscriptionId || data.client || data.client_name}:${pausedAt}`);
  const plannedResumeDate = plannedSubscriptionResumeDate(body);
  await db.prepare(
    `INSERT INTO subscription_pauses
      (pause_id,subscription_id,source_event_id,business_line,client_ref,client_name,plan,reason,comment,paused_at,planned_resume_date,status,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'paused',CURRENT_TIMESTAMP)
     ON CONFLICT(pause_id) DO UPDATE SET
       subscription_id=excluded.subscription_id,source_event_id=excluded.source_event_id,business_line=excluded.business_line,
       client_ref=excluded.client_ref,client_name=excluded.client_name,plan=excluded.plan,reason=excluded.reason,comment=excluded.comment,
       paused_at=excluded.paused_at,planned_resume_date=COALESCE(excluded.planned_resume_date,subscription_pauses.planned_resume_date),
       status='paused',resumed_at=NULL,updated_at=CURRENT_TIMESTAMP`
  ).bind(pauseId, subscriptionId || null, eventId || null, businessLine, data.client || data.client_id || "", data.client_name || data.full_name || "", data.subscription_name || "", reason, comment, pausedAt, plannedResumeDate).run();
  return { configured: true, pauseId, subscriptionId, pausedAt, plannedResumeDate };
}

export async function recordSubscriptionUnpause({ eventId, body, businessLine }) {
  const db = getDb();
  if (!db) return { configured: false };
  const data = body?.data ?? body ?? {};
  const subscriptionId = data.subscription_id === undefined || data.subscription_id === null ? "" : String(data.subscription_id);
  const clientRef = String(data.client || data.client_id || "");
  const clientName = String(data.client_name || data.full_name || "");
  const resumedAt = lifecycleTimestamp(data.unpaused_at || data.resumed_at || data.created_at || body?.created);
  const current = await db.prepare(
    `SELECT pause_id FROM subscription_pauses
     WHERE business_line=? AND status='paused'
       AND ((?<>'' AND subscription_id=?) OR (?<>'' AND client_ref=?) OR (?<>'' AND lower(client_name)=lower(?)))
     ORDER BY paused_at DESC LIMIT 1`
  ).bind(businessLine, subscriptionId, subscriptionId, clientRef, clientRef, clientName, clientName).first();
  if (current?.pause_id) {
    await db.prepare(
      `UPDATE subscription_pauses SET status='resumed',resumed_at=?,updated_at=CURRENT_TIMESTAMP WHERE pause_id=?`
    ).bind(resumedAt, current.pause_id).run();
    return { configured: true, matched: true, pauseId: current.pause_id, resumedAt };
  }
  const pauseId = String(eventId || `unpause:${subscriptionId || clientRef || clientName}:${resumedAt}`);
  await db.prepare(
    `INSERT INTO subscription_pauses
      (pause_id,subscription_id,source_event_id,business_line,client_ref,client_name,plan,reason,comment,paused_at,resumed_at,status,updated_at)
     VALUES (?,?,?,?,?,?,?,'Unpause received without a captured pause','','1970-01-01T00:00:00.000Z',?,'resumed',CURRENT_TIMESTAMP)
     ON CONFLICT(pause_id) DO NOTHING`
  ).bind(pauseId, subscriptionId || null, eventId || null, businessLine, clientRef, clientName, data.subscription_name || "", resumedAt).run();
  return { configured: true, matched: false, pauseId, resumedAt };
}

export async function findRecentReplacementSubscription({ body, businessLine, classifyPlan }) {
  const db = getDb();
  if (!db) return null;
  const data = body?.data ?? body ?? {};
  const clientRef = String(data.client || "");
  const clientName = String(data.client_name || "");
  if (!clientRef && !clientName) return null;
  const result = await db.prepare(
    `SELECT payload,received_at FROM sng_events
     WHERE event_type='client:subscription_created'
       AND (json_extract(payload,'$.data.client')=? OR lower(json_extract(payload,'$.data.client_name'))=lower(?))
       AND datetime(received_at) >= datetime('now','-7 days')
     ORDER BY received_at DESC LIMIT 10`
  ).bind(clientRef, clientName).all();
  for (const row of result.results ?? []) {
    let event = null;
    try { event = JSON.parse(row.payload); } catch { continue; }
    const eventData = event?.data ?? {};
    if (classifyPlan(eventData.subscription_name || "") !== businessLine) continue;
    if (String(eventData.subscription_id) === String(data.subscription_id)) continue;
    return { subscriptionId: String(eventData.subscription_id), createdAt: row.received_at };
  }
  return null;
}

export async function reconcileSubscriptionCreated({ body, businessLine }) {
  const db = getDb();
  if (!db) return { configured: false, matched: false };
  const data = body?.data ?? body ?? {};
  const clientRef = String(data.client || "");
  const clientName = String(data.client_name || "");
  const replacementId = data.subscription_id;
  if ((!clientRef && !clientName) || replacementId === undefined || replacementId === null) return { configured: true, matched: false };
  const cancellation = await db.prepare(
    `SELECT subscription_id,reason_category,is_customer_churn,eligibility_status FROM subscription_cancellations
     WHERE business_line=? AND (client_ref=? OR lower(client_name)=lower(?))
       AND datetime(canceled_at) >= datetime('now','-90 days')
     ORDER BY canceled_at DESC LIMIT 1`
  ).bind(businessLine, clientRef, clientName).first();
  if (!cancellation) return { configured: true, matched: false };
  const isReplacement = cancellation.reason_category === "Modification of subscription type" || cancellation.eligibility_status === "Needs Validation";
  await db.prepare(
    `UPDATE subscription_cancellations SET replacement_subscription_id=?,review_status=?,is_customer_churn=?,reactivated_at=?,eligibility_status=?,eligibility_evidence=?,updated_at=CURRENT_TIMESTAMP
     WHERE subscription_id=?`
  ).bind(String(replacementId), isReplacement ? "Plan Replacement" : "Complete", isReplacement ? 0 : Number(cancellation.is_customer_churn), isReplacement ? null : new Date().toISOString(), isReplacement ? "Plan Change" : cancellation.eligibility_status, isReplacement ? `Replacement subscription ${replacementId} detected.` : "Reactivation detected.", cancellation.subscription_id).run();
  return { configured: true, matched: true, cancellationId: cancellation.subscription_id, replacementId: String(replacementId), isReplacement };
}

export async function getSubscriptionCancellationMetrics(days = 30) {
  const db = getDb();
  if (!db) return { configured: false, scoopChurn: 0, dogFoodChurn: 0, addonCancellations: 0, dogFoodRows: [] };
  const safeDays = Math.min(Math.max(Number(days) || 30, 1), 120);
  const result = await db.prepare(
    `SELECT subscription_id,business_line,client_name,plan,reason,reason_category,review_status,comment,canceled_at,is_customer_churn,reactivated_at,lost_mrr
     FROM subscription_cancellations WHERE datetime(canceled_at) >= datetime('now', ?) ORDER BY canceled_at DESC`
  ).bind(`-${safeDays} days`).all();
  const rows = result.results ?? [];
  return {
    configured: true,
    scoopChurn: rows.filter((row) => row.business_line === "scooping" && Number(row.is_customer_churn) === 1).length,
    scoopReactivations: rows.filter((row) => row.business_line === "scooping" && Number(row.is_customer_churn) === 1 && row.reactivated_at).length,
    netScoopChurn: Math.max(0, rows.filter((row) => row.business_line === "scooping" && Number(row.is_customer_churn) === 1).length - rows.filter((row) => row.business_line === "scooping" && Number(row.is_customer_churn) === 1 && row.reactivated_at).length),
    dogFoodChurn: rows.filter((row) => row.business_line === "dog_food" && Number(row.is_customer_churn) === 1).length,
    addonCancellations: rows.filter((row) => row.business_line === "addon").length,
    dogFoodRows: rows.filter((row) => row.business_line === "dog_food").map((row) => ({ id: row.subscription_id, customer: row.client_name, plan: row.plan, reason: row.reason, date: String(row.canceled_at).slice(0, 10) })),
  };
}
