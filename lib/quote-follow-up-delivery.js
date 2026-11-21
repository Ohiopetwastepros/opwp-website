import { outboundFetch } from "./outbound-request";
import { normalizeFrequency, normalizeLastCleaned } from "./sweepandgo";
import { queueSubmissionNotificationSafe, sendTransactionalEmail, transactionalEmailConfig } from "./submission-notifications";
import { buildCustomerQuoteFollowUpEmail, buildCustomerQuoteFollowUpSms } from "./quote-funnel.mjs";
import { controlledLeadRecipientAllowed } from "./lead-rollout-policy.mjs";

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
  if (!response.ok) {
    const error = new Error(`Sweep & Go rejected the partial quote (${response.status}).`);
    error.status = response.status; error.classification = "provider_rejected";
    throw error;
  }
  return String(data?.lead_id || data?.id || data?.data?.id || `accepted:${row.submission_id}`);
}

export async function sendQuoText(env, row, { content = buildCustomerQuoteFollowUpSms(), operation = 'send_quote_follow_up', receipt = false, request } = {}) {
  const to = e164(row.phone); const from = e164(env.QUO_FROM_NUMBER);
  if (!to || !from) throw new Error("Quo sender or recipient is not a valid E.164 number.");
  const response = await outboundFetch(new URL("/v1/messages", env.QUO_API_BASE_URL || QUO_BASE), {
    method: "POST",
    headers: { Authorization: env.QUO_API_KEY, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      from, to: [to],
    }),
  }, { provider: "quo", operation, timeoutMs: 12000, retries: 0, ...(request ? { fetchProvider: request } : {}) });
  const data = await response.json().catch(() => ({}));
  const id = data?.data?.id || data?.id;
  if (!response.ok || !id) {
    const error = new Error(`Quo did not accept the message (${response.status}).`);
    error.status = response.status; error.classification = response.ok ? 'missing_provider_id' : 'provider_rejected';
    throw error;
  }
  return receipt ? { id: String(id), httpStatus: response.status } : String(id);
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
  await db.prepare("UPDATE quote_follow_ups SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='cancelled'").bind(status, followUpId).run();
}

async function fail(db, id, error, { channel, emailProvider } = {}) {
  // Rate limits reject acceptance. Resend also deduplicates by delivery ID.
  // Other 5xx responses, timeouts and missing receipts can conceal acceptance.
  const retry = error?.classification === "provider_rejected" && (error.status === 429 || (channel === "customer_email" && emailProvider === "resend" && error.status >= 500 && error.status <= 599));
  const message = error instanceof Error ? error.message : "provider_failed";
  await db.prepare(`UPDATE quote_follow_up_deliveries SET status='failed',failed_at=CURRENT_TIMESTAMP,error_message=?,
    attempt_count=CASE WHEN ? THEN attempt_count ELSE MAX(attempt_count,5) END,
    next_attempt_at=CASE WHEN ? THEN datetime('now', CASE WHEN attempt_count<=1 THEN '+5 minutes' WHEN attempt_count=2 THEN '+30 minutes' ELSE '+2 hours' END)
      ELSE datetime('now','+100 years') END,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='sending'`).bind(String(message).slice(0, 500), Number(retry), Number(retry), id).run();
}

export async function runScheduledQuoteFollowUps(env, limit = 12, { submissionId = "" } = {}) {
  const db = env?.DB;
  if (!db) return { configured: false, attempted: 0 };
  // A provider may have accepted an interrupted send. Keep the existing terminal
  // failure policy so recovery never blindly sends the same customer message.
  const recovered = await db.prepare(`UPDATE quote_follow_up_deliveries
    SET status='failed',failed_at=CURRENT_TIMESTAMP,
      error_message='Interrupted sending attempt. Verify provider before any retry.',
      attempt_count=MAX(attempt_count,5),next_attempt_at=datetime('now','+100 years'),updated_at=CURRENT_TIMESTAMP
    WHERE status='sending' AND datetime(COALESCE(sending_at,updated_at))<datetime(CURRENT_TIMESTAMP,'-15 minutes')
      AND (?='' OR submission_id=?)
    RETURNING follow_up_id`).bind(submissionId, submissionId).all();
  for (const followUpId of new Set((recovered.results || []).map((row) => row.follow_up_id))) {
    await refreshParent(db, followUpId);
  }
  const due = await db.prepare(`SELECT d.id,d.follow_up_id,d.submission_id,d.channel,s.email,s.phone,s.zip,s.payload,s.status submission_status
    FROM quote_follow_up_deliveries d JOIN quote_follow_ups q ON q.id=d.follow_up_id JOIN submissions s ON s.id=d.submission_id
    WHERE d.status IN ('queued','failed') AND d.provider_message_id IS NULL AND d.next_attempt_at<=CURRENT_TIMESTAMP AND q.scheduled_at<=CURRENT_TIMESTAMP AND d.attempt_count<5
      AND q.status IN ('queued','failed') AND s.status NOT IN ('deleted','trashed') AND (?='' OR d.submission_id=?)
    ORDER BY q.scheduled_at,d.channel LIMIT ?`).bind(submissionId, submissionId, Math.min(Math.max(Number(limit) || 12, 1), 30)).all();
  let sent = 0; let failed = 0; let pending = 0;
  const deliver = async (row) => {
    // Controlled verification authorizes texts only. Hold customer email and SNG
    // lead creation even for the test contact; owner alerts use another outbox.
    if (["customer_email", "sng_lead"].includes(row.channel) && (env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === true || env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === "true")) { pending += 1; return; }
    // Hold other SMS recipients before claims, delegation or cancellation.
    if (row.channel === "customer_sms" && !controlledLeadRecipientAllowed(env, row.phone)) { pending += 1; return; }
    if (row.submission_status !== "follow_up_pending") {
      await db.prepare("UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed')").bind(row.id).run();
      await refreshParent(db, row.follow_up_id); return;
    }
    if (row.channel === "customer_sms" && (env.LEAD_PLAYBOOK_ENABLED === true || env.LEAD_PLAYBOOK_ENABLED === "true")) {
      const { preparePlaybookIntros } = await import("./lead-playbook-ingest.js");
      await preparePlaybookIntros(db, env, { submissionId: row.submission_id, limit: 1 });
      // Even an ineligible or escalated inquiry leaves the shared legacy queue.
      // Retaining a due SMS here would starve email/SNG work and replay on rollback.
      await db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,
        error_message='playbook_review_required',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed')`).bind(row.id).run();
      await refreshParent(db, row.follow_up_id);
      pending += 1; return;
    }
    if (row.channel === "customer_email" && !transactionalEmailConfig(env).configured) { pending += 1; return; }
    if (row.channel === "customer_sms" && (String(env.SMS_PROVIDER || "").toLowerCase() !== "quo" || !env.QUO_API_KEY || !env.QUO_FROM_NUMBER)) { pending += 1; return; }
    const claim = await db.prepare(`UPDATE quote_follow_up_deliveries SET status='sending',sending_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,
      error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed') AND provider_message_id IS NULL AND attempt_count<5
        AND next_attempt_at<=CURRENT_TIMESTAMP
        AND EXISTS (SELECT 1 FROM submissions s JOIN quote_follow_ups q ON q.submission_id=s.id
          WHERE s.id=quote_follow_up_deliveries.submission_id AND s.status='follow_up_pending'
            AND q.id=quote_follow_up_deliveries.follow_up_id AND q.status IN ('queued','failed') AND q.scheduled_at<=CURRENT_TIMESTAMP)`).bind(row.id).run();
    if (!Number(claim.meta?.changes || 0)) return;
    const active = await db.prepare(`SELECT d.attempt_count FROM submissions s JOIN quote_follow_up_deliveries d ON d.submission_id=s.id
      WHERE d.id=? AND d.status='sending' AND s.status='follow_up_pending'`).bind(row.id).first();
    if (!active) {
      await db.prepare("UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(row.id).run();
      await refreshParent(db, row.follow_up_id); return;
    }
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
        failed_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('sending','cancelled') AND provider_message_id IS NULL AND attempt_count=?`).bind(providerId, row.id, active.attempt_count).run();
      sent += 1;
    } catch (error) {
      await fail(db, row.id, error, { channel: row.channel, emailProvider: transactionalEmailConfig(env).provider });
      console.error(JSON.stringify({ event: "quote_follow_up_delivery_failed", provider: row.channel, submissionId: row.submission_id, success: false, classification: "provider_error" }));
      failed += 1;
    }
    await refreshParent(db, row.follow_up_id);
  };
  if (submissionId) {
    // Start all three website channels together so a slow provider cannot delay
    // the other channels or exhaust the request's background lifetime.
    await Promise.all((due.results || []).map(deliver));
    for (const followUpId of new Set((due.results || []).map((row) => row.follow_up_id))) await refreshParent(db, followUpId);
  } else {
    for (const row of due.results || []) await deliver(row);
  }
  const result = { configured: true, attempted: (due.results || []).length, sent, failed, pending, recovered: (recovered.results || []).length };
  console.log(JSON.stringify({ event: "quote_follow_up_run", ...result }));
  return result;
}
