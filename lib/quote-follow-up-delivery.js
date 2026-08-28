import { outboundFetch } from "./outbound-request";
import { normalizeFrequency, normalizeLastCleaned } from "./sweepandgo";
import { queueSubmissionNotificationSafe, sendTransactionalEmail, transactionalEmailConfig } from "./submission-notifications";
import { buildCustomerQuoteFollowUpEmail } from "./quote-funnel.mjs";

const SNG_PUBLIC_BASE = "https://api.sweepandgo.com";
const QUO_BASE = "https://api.openphone.com";

function payload(row) { try { return JSON.parse(row.payload || "{}"); } catch { return {}; } }
function e164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

async function createSngPartialLead(env, row) {
  const body = payload(row);
  const context = body.quote_context || {};
  const url = new URL("/api/client_on_boarding/price_registration_form", env.SNG_PUBLIC_API_BASE_URL || SNG_PUBLIC_BASE);
  const fields = {
    organization: env.SNG_ORGANIZATION_SLUG || "ohio-pet-waste-pros-qkr3c",
    organization_form_id: env.SNG_ORGANIZATION_FORM_ID || "7063",
    zip_code: row.zip || body.zip,
    number_of_dogs: context.dogs,
    clean_up_frequency: normalizeFrequency(context.frequency),
    last_time_yard_was_thoroughly_cleaned: normalizeLastCleaned(context.last_cleaned),
    email: row.email,
    cell_phone_number: e164(row.phone).replace(/^\+1/, ""),
    // Quote/service follow-up consent is not blanket marketing consent.
    marketing_allowed: "no",
    marketing_allowed_source: "website_quote_follow_up_transactional",
  };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  const response = await outboundFetch(url, { method: "GET", headers: { Accept: "application/json", "x-sng-frontend": "true" }, cache: "no-store" },
    { provider: "sweep_and_go", operation: "partial_quote_lead", timeoutMs: 12000, retries: 0 });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sweep & Go rejected the partial quote (${response.status}).`);
  return String(data?.lead_id || data?.id || data?.data?.id || `accepted:${row.submission_id}`);
}

async function sendQuoText(env, row) {
  const to = e164(row.phone); const from = e164(env.QUO_FROM_NUMBER);
  if (!to || !from) throw new Error("Quo sender or recipient is not a valid E.164 number.");
  const response = await outboundFetch(new URL("/v1/messages", env.QUO_API_BASE_URL || QUO_BASE), {
    method: "POST",
    headers: { Authorization: env.QUO_API_KEY, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "Hello, this is Craig with Ohio Pet Waste Pros. I saw that you filled out a quote form on our website. Did you have any questions about our service, or would you like help getting signed up? Reply STOP to opt out.",
      from, to: [to],
    }),
  }, { provider: "quo", operation: "send_quote_follow_up", timeoutMs: 12000, retries: 0 });
  const data = await response.json().catch(() => ({}));
  const id = data?.data?.id || data?.id;
  if (!response.ok || !id) throw new Error(`Quo did not accept the message (${response.status}).`);
  return String(id);
}

async function sendCustomerEmail(env, row) {
  const recipient = String(row.email || "").trim();
  if (!recipient || recipient.length > 254 || !recipient.includes("@")) throw new Error("Customer email address is invalid.");
  const content = buildCustomerQuoteFollowUpEmail();
  return sendTransactionalEmail(env, {
    to: recipient,
    ...content,
    idempotencyKey: `quote-follow-up/${row.id}`,
  });
}

async function refreshParent(db, followUpId) {
  const result = await db.prepare("SELECT status FROM quote_follow_up_deliveries WHERE follow_up_id=?").bind(followUpId).all();
  const states = (result.results || []).map((row) => row.status);
  const status = states.length && states.every((value) => ["sent", "cancelled"].includes(value)) ? "sent" : states.includes("failed") ? "failed" : "queued";
  await db.prepare("UPDATE quote_follow_ups SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, followUpId).run();
}

async function fail(db, id, message) {
  await db.prepare(`UPDATE quote_follow_up_deliveries SET status='failed',failed_at=CURRENT_TIMESTAMP,error_message=?,
    attempt_count=5,next_attempt_at=datetime('now','+100 years'),updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='sending'`).bind(String(message).slice(0, 500), id).run();
}

export async function runScheduledQuoteFollowUps(env, limit = 12) {
  const db = env?.DB;
  if (!db) return { configured: false, attempted: 0 };
  const due = await db.prepare(`SELECT d.id,d.follow_up_id,d.submission_id,d.channel,s.email,s.phone,s.zip,s.payload,s.status submission_status
    FROM quote_follow_up_deliveries d JOIN quote_follow_ups q ON q.id=d.follow_up_id JOIN submissions s ON s.id=d.submission_id
    WHERE d.status IN ('queued','failed') AND d.next_attempt_at<=CURRENT_TIMESTAMP AND q.scheduled_at<=CURRENT_TIMESTAMP AND d.attempt_count<5
    ORDER BY q.scheduled_at,d.channel LIMIT ?`).bind(Math.min(Math.max(Number(limit) || 12, 1), 30)).all();
  let sent = 0; let failed = 0; let pending = 0;
  for (const row of due.results || []) {
    if (row.submission_status !== "follow_up_pending") {
      await db.prepare("UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
      await refreshParent(db, row.follow_up_id); continue;
    }
    if (row.channel === "customer_email" && !transactionalEmailConfig(env).configured) { pending += 1; continue; }
    if (row.channel === "customer_sms" && (String(env.SMS_PROVIDER || "").toLowerCase() !== "quo" || !env.QUO_API_KEY || !env.QUO_FROM_NUMBER)) { pending += 1; continue; }
    const claim = await db.prepare(`UPDATE quote_follow_up_deliveries SET status='sending',sending_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,
      error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed') AND attempt_count<5`).bind(row.id).run();
    if (!Number(claim.meta?.changes || 0)) continue;
    try {
      let providerId;
      if (row.channel === "sng_lead") {
        providerId = await createSngPartialLead(env, row);
        await queueSubmissionNotificationSafe({
          submissionId: row.submission_id,
          type: "partial_quote",
          body: payload(row),
          providerStatus: "accepted",
          env,
        });
      } else if (row.channel === "customer_email") {
        providerId = await sendCustomerEmail(env, row);
      } else {
        providerId = await sendQuoText(env, row);
      }
      await db.prepare(`UPDATE quote_follow_up_deliveries SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP,
        failed_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'`).bind(providerId, row.id).run();
      sent += 1;
    } catch (error) {
      await fail(db, row.id, error instanceof Error ? error.message : "provider_failed");
      console.error(JSON.stringify({ event: "quote_follow_up_delivery_failed", provider: row.channel, submissionId: row.submission_id, success: false, classification: "provider_error" }));
      failed += 1;
    }
    await refreshParent(db, row.follow_up_id);
  }
  return { configured: true, attempted: (due.results || []).length, sent, failed, pending };
}
