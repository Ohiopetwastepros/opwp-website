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
            received_at, processed_at, payload
     FROM sng_events ORDER BY received_at DESC LIMIT ?`
  ).bind(Math.min(Math.max(Number(limit) || 50, 1), 500)).all();
  return { configured: true, rows: result.results ?? [] };
}
