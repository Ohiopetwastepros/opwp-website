import { getRuntimeEnv } from "./cloudflare";
import { buildSubmissionNotification } from "./quote-funnel.mjs";
import { outboundFetch } from "./outbound-request";

const RESEND_API_BASE = "https://api.resend.com";

export function transactionalEmailConfig(env) {
  const requested = String(env?.EMAIL_PROVIDER || "").trim().toLowerCase();
  const provider = requested || (env?.RESEND_API_KEY ? "resend" : typeof env?.EMAIL?.send === "function" ? "cloudflare_email_service" : "unconfigured");
  const from = String(env?.EMAIL_FROM || "").trim();
  const recipient = String(env?.OWNER_NOTIFICATION_EMAIL || "").trim();
  const enabled = String(env?.EMAIL_SENDING_ENABLED || "").trim().toLowerCase() === "true";
  return {
    provider,
    configured: Boolean(enabled && from && recipient && (provider === "resend" ? env?.RESEND_API_KEY : provider === "cloudflare_email_service" && typeof env?.EMAIL?.send === "function")),
    recipient,
    from,
    fromName: String(env?.EMAIL_FROM_NAME || "Ohio Pet Waste Pros Website").replace(/[\r\n]/g, " ").trim().slice(0, 100),
  };
}

export function submissionEmailProviderStatus(env = getRuntimeEnv()) {
  const config = transactionalEmailConfig(env);
  return { name: config.provider, configured: config.configured };
}

export async function sendTransactionalEmail(env, { to, subject, text, html, idempotencyKey }) {
  const config = transactionalEmailConfig(env);
  if (!config.configured) throw new Error("Transactional email provider is not configured.");
  if (config.provider === "resend") {
    const response = await outboundFetch(new URL("/emails", env.RESEND_API_BASE_URL || RESEND_API_BASE), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": String(idempotencyKey || crypto.randomUUID()).slice(0, 256),
      },
      body: JSON.stringify({
        to: [to],
        from: `${config.fromName} <${config.from}>`,
        reply_to: config.from,
        subject,
        text,
        html,
      }),
    }, { provider: "resend", operation: "send_transactional_email", timeoutMs: 12000, retries: 0 });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.id) throw new Error(`Resend did not accept the email (${response.status}).`);
    return String(data.id);
  }
  const result = await env.EMAIL.send({
    to,
    from: { email: config.from, name: config.fromName },
    replyTo: config.from,
    subject,
    text,
    html,
  });
  if (!result?.messageId) throw new Error("Email provider did not confirm acceptance.");
  return String(result.messageId);
}

async function notificationById(db, id) {
  return db.prepare(
    `SELECT id,submission_id,notification_type,recipient,subject,text_body,html_body,status,
            attempt_count,next_attempt_at,provider_message_id,error_message
     FROM submission_notifications WHERE id=?`
  ).bind(id).first();
}

export async function queueSubmissionNotification({ submissionId, type, body, providerStatus = null, env = getRuntimeEnv() }) {
  const db = env?.DB;
  const config = transactionalEmailConfig(env);
  if (!db || !submissionId) return { configured: false, status: "queued", error: "database_unavailable" };
  if (!config.recipient) return { configured: false, status: "queued", error: "recipient_unconfigured" };
  const content = buildSubmissionNotification({ type, submissionId, body, providerStatus });
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO submission_notifications
      (id,submission_id,notification_type,recipient,subject,text_body,html_body,status)
     VALUES (?,?,?,?,?,?,?,'queued')
     ON CONFLICT(submission_id,notification_type,recipient) DO NOTHING`
  ).bind(id, submissionId, type, config.recipient, content.subject, content.text, content.html).run();
  const row = await db.prepare(
    `SELECT id,status,provider_message_id,error_message FROM submission_notifications
     WHERE submission_id=? AND notification_type=? AND recipient=? LIMIT 1`
  ).bind(submissionId, type, config.recipient).first();
  if (!row) return { configured: config.configured, status: "queued", error: "notification_queue_failed" };
  if (row.status === "sent") return { configured: config.configured, status: "sent", providerMessageId: row.provider_message_id };
  return deliverSubmissionNotification(row.id, env);
}

export async function queueSubmissionNotificationSafe(options) {
  try {
    return await queueSubmissionNotification(options);
  } catch (error) {
    console.error(JSON.stringify({
      event: "submission_notification_queue_failed",
      provider: transactionalEmailConfig(options?.env || getRuntimeEnv()).provider,
      submissionId: options?.submissionId || null,
      success: false,
      classification: "queue_error",
      message: error instanceof Error ? error.message.slice(0, 300) : "queue_failed",
    }));
    return { configured: false, status: "failed", error: "queue_failed" };
  }
}

export async function deliverSubmissionNotification(id, env = getRuntimeEnv()) {
  const db = env?.DB;
  const config = transactionalEmailConfig(env);
  if (!db) return { configured: false, status: "queued", error: "database_unavailable" };
  if (!config.configured) return { configured: false, status: "queued", error: "provider_unconfigured" };

  const claim = await db.prepare(
    `UPDATE submission_notifications
     SET status='sending', sending_at=CURRENT_TIMESTAMP, attempt_count=attempt_count+1,
         error_message=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND status IN ('queued','failed') AND attempt_count < 5 AND next_attempt_at <= CURRENT_TIMESTAMP`
  ).bind(id).run();
  if (Number(claim.meta?.changes ?? 0) === 0) {
    const current = await notificationById(db, id);
    return { configured: true, status: current?.status || "cancelled", providerMessageId: current?.provider_message_id || null };
  }

  const row = await notificationById(db, id);
  try {
    const providerMessageId = await sendTransactionalEmail(env, {
      to: row.recipient,
      subject: row.subject,
      text: row.text_body,
      html: row.html_body,
      idempotencyKey: `submission/${row.id}`,
    });
    await db.prepare(
      `UPDATE submission_notifications
       SET status='sent', provider_message_id=?, sent_at=CURRENT_TIMESTAMP,
           failed_at=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='sending'`
    ).bind(providerMessageId, id).run();
    console.info(JSON.stringify({ event: "submission_notification_sent", provider: config.provider, notificationId: id, success: true }));
    return { configured: true, status: "sent", providerMessageId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "email_delivery_failed";
    await db.prepare(
      `UPDATE submission_notifications
       SET status='failed', failed_at=CURRENT_TIMESTAMP, error_message=?,
           next_attempt_at=datetime('now', CASE WHEN attempt_count <= 1 THEN '+5 minutes' WHEN attempt_count = 2 THEN '+30 minutes' ELSE '+2 hours' END),
           updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='sending'`
    ).bind(message, id).run();
    console.error(JSON.stringify({ event: "submission_notification_failed", provider: config.provider, notificationId: id, success: false, classification: "provider_error" }));
    return { configured: true, status: "failed", error: message };
  }
}

export async function flushSubmissionNotifications(env, limit = 10) {
  const db = env?.DB;
  if (!db || !transactionalEmailConfig(env).configured) return { configured: false, attempted: 0, sent: 0, failed: 0 };
  const due = await db.prepare(
    `SELECT id FROM submission_notifications
     WHERE status IN ('queued','failed') AND attempt_count < 5 AND next_attempt_at <= CURRENT_TIMESTAMP
     ORDER BY created_at ASC LIMIT ?`
  ).bind(Math.min(Math.max(Number(limit) || 10, 1), 50)).all();
  let sent = 0;
  let failed = 0;
  for (const row of due.results || []) {
    const result = await deliverSubmissionNotification(row.id, env);
    if (result.status === "sent") sent += 1;
    else if (result.status === "failed") failed += 1;
  }
  return { configured: true, attempted: (due.results || []).length, sent, failed };
}
