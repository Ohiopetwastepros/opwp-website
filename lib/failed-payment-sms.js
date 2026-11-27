import { reconcileRecordedPayments } from './failed-payment-reconciliation.js';

export const FAILED_PAYMENT_BATCH_LIMIT = 25;
export const FAILED_PAYMENT_SMS_DISABLED_REASON = "manual via Quo, owner decision 2026-11-27";

// SNG payment-accepted webhooks do not include an invoice ID. Match only a
// verified, same-customer, same-amount payment after the latest decline for
// this invoice. Such a match suppresses messaging without claiming the invoice
// ledger itself has been settled.
const PAYMENT_EVIDENCE_SQL = `
  EXISTS (SELECT 1 FROM failed_payment_reconciliation r WHERE r.sms_id=f.id
    AND r.payment_state IN ('paid','voided','settled','payment_recorded')) OR
  EXISTS (
    SELECT 1 FROM sng_invoices i
    WHERE i.invoice_id=f.invoice_id AND i.total>0 AND i.remaining<=0
      AND CAST(i.paid AS REAL)>=i.total
  ) OR EXISTS (
    SELECT 1 FROM sng_events p
    JOIN sng_events original_decline ON original_decline.id=f.source_event_id
    WHERE p.event_type='client:client_payment_accepted'
      AND p.status='processed'
      AND f.client_ref IS NOT NULL
      AND json_extract(p.payload,'$.data.client')=f.client_ref
      AND CAST(json_extract(original_decline.payload,'$.data.total') AS REAL)>0
      AND ROUND(CAST(json_extract(p.payload,'$.data.amount') AS REAL)*100)
          =ROUND(CAST(json_extract(original_decline.payload,'$.data.total') AS REAL)*100)
      AND p.received_at>COALESCE((
        SELECT MAX(d.received_at) FROM sng_events d
        WHERE d.event_type='client:client_payment_declined'
          AND CAST(json_extract(d.payload,'$.data.invoice_id') AS TEXT)=f.invoice_id
          AND json_extract(d.payload,'$.data.client')=f.client_ref
      ),original_decline.received_at)
  )`;

function text(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function e164(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

export function failedPaymentMessage(clientName) {
  const firstName = text(clientName, 80).split(/\s+/)[0];
  const greeting = firstName ? `Hello, ${firstName}.` : "Hello.";
  return `${greeting} This is Craig with Ohio Pet Waste Pros. We submitted our monthly billing, but the card on file failed. Let me know when we can resubmit the billing or if we need to update the card on file. Thank you!`;
}

function eventData(body) {
  return body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body ?? {};
}

function boundedIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > FAILED_PAYMENT_BATCH_LIMIT) return null;
  const unique = [...new Set(ids.map((id) => text(id, 40)))];
  return unique.length === ids.length && unique.every((id) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) ? unique : null;
}

export async function queueFailedPaymentSms({ db, eventId, body }) {
  if (!db) return { configured: false, awaitingApproval: false };
  const data = eventData(body);
  const invoiceId = text(data.invoice_id ?? data.invoice_no, 128);
  if (!invoiceId) throw new Error("SNG declined payment is missing invoice_id.");

  const clientRef = text(data.client ?? data.client_id, 128);
  const clientName = text(data.client_name ?? data.full_name ?? data.name, 200);
  const recipient = e164(data.cell_phone ?? data.cell_phone_number ?? data.phone ?? data.home_phone);
  // Record the decline for reconciliation. Never leave a row that a sender could pick up.
  const status = "cancelled";
  const id = crypto.randomUUID();

  const inserted = await db.prepare(
    `INSERT INTO failed_payment_sms
      (id,invoice_id,source_event_id,client_ref,client_name,recipient,status,next_attempt_at,cancelled_at,error_message)
     VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)
     ON CONFLICT(invoice_id) DO NOTHING`
  ).bind(
    id, invoiceId, text(eventId, 128), clientRef || null, clientName || null, recipient, status,
    FAILED_PAYMENT_SMS_DISABLED_REASON
  ).run();

  return {
    configured: true,
    awaitingApproval: false,
    duplicate: Number(inserted.meta?.changes || 0) === 0,
    invoiceId,
    status,
    sendingDisabled: true,
  };
}

export async function listFailedPaymentSms(db, limit = 200) {
  if (!db) return { configured: false, rows: [] };
  await reconcileRecordedPayments(db);
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 250);
  const result = await db.prepare(
    `SELECT f.id,f.invoice_id,f.client_ref,f.client_name,f.recipient,
            CASE WHEN (${PAYMENT_EVIDENCE_SQL})
                 THEN 'payment_recorded' ELSE f.status END status,
            f.status sms_status,r.payment_state,r.evidence,r.evidence_at,r.airtable_confirmed_at,r.sync_error,
            f.attempt_count,
            f.sent_at,f.failed_at,f.cancelled_at,f.error_message,f.created_at,f.actioned_by,
            json_extract(e.payload,'$.data.total') amount,
            json_extract(e.payload,'$.data.decline_code') decline_code,
            json_extract(e.payload,'$.data.message') decline_message,
            json_extract(e.payload,'$.data.count_failed_charges') failed_charge_count
     FROM failed_payment_sms f
     LEFT JOIN sng_events e ON e.id=f.source_event_id
     LEFT JOIN failed_payment_reconciliation r ON r.sms_id=f.id
     ORDER BY CASE WHEN (${PAYMENT_EVIDENCE_SQL}) THEN 3 WHEN f.status='awaiting_approval' THEN 0 WHEN f.status='failed' THEN 1 ELSE 2 END,
              f.created_at DESC LIMIT ?`
  ).bind(safeLimit).all();
  return {
    configured: true,
    rows: (result.results || []).map((row) => ({ ...row, preview: failedPaymentMessage(row.client_name) })),
  };
}

export async function sendFailedPaymentSmsBatch() {
  // Owner decision 2026-11-27: failed-payment texts are handled by a person in Quo.
  // This returns before any database update or provider call, including rows that
  // are still awaiting_approval.
  return { ok: false, code: "SMS_DISABLED", results: [], sent: 0, failed: 0, skipped: 0, reason: FAILED_PAYMENT_SMS_DISABLED_REASON };
}

export async function dismissFailedPaymentSmsBatch({ db, ids, actor }) {
  const safeIds = boundedIds(ids);
  if (!db) return { ok: false, code: "DATABASE_UNAVAILABLE", dismissed: 0 };
  if (!safeIds) return { ok: false, code: "INVALID_SELECTION", dismissed: 0 };
  const results = await db.batch(safeIds.map((id) => db.prepare(
    `UPDATE failed_payment_sms
     SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,actioned_at=CURRENT_TIMESTAMP,
         actioned_by=?,updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND status='awaiting_approval'`
  ).bind(text(actor, 254), id)));
  return { ok: true, dismissed: results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0) };
}
