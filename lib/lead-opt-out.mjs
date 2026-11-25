import { syncAirtableTextStatus } from "./airtable-text-safety.mjs";
import { isCraigMetaTest } from "./lead-rollout-policy.mjs";

const ORG = "org-opwp";
const PREFIX = `text_status:${ORG}:`;
const MAX_EVENTS = 100;
const TABLES = ["submissions", "lead_conversations", "growth_leads", "meta_lead_intakes", "quote_follow_ups", "quote_follow_up_deliveries", "meta_sms_jobs", "lead_follow_up_jobs", "lead_reply_drafts"];
const parse = (value) => { try { return JSON.parse(value); } catch { return null; } };

function normalizedPhone(value) {
  if (typeof value !== "string" || !/^[+\d().\s-]{10,40}$/.test(value)) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? `+${digits}` : "";
}

function phoneSql(column) {
  let digits = column;
  for (const character of ["'+'", "'('", "')'", "'-'", "' '", "'.'", "char(9)", "char(10)", "char(13)", "char(160)"]) digits = `replace(${digits},${character},'')`;
  return `(CASE WHEN length(${digits})=10 THEN '1'||${digits} ELSE ${digits} END)`;
}

async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function schema(db) {
  const result = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${TABLES.map(() => "?").join(",")})`).bind(...TABLES).all();
  const entries = await Promise.all((result.results || []).map(async ({ name }) => {
    if (!TABLES.includes(name)) return [name, new Set()];
    return [name, new Set((await db.prepare(`PRAGMA table_info(${name})`).all()).results.map((column) => column.name))];
  }));
  return new Map(entries);
}

async function cancelPhoneQueues(db, phone, at) {
  const tables = await schema(db), reasons = [], statements = [];
  const has = (table, columns) => columns.every((column) => tables.get(table)?.has(column));
  if (!has("submissions", ["id", "phone"])) return { complete: true, changes: 0 };
  const ownership = [];
  for (const table of ["lead_conversations", "growth_leads", "meta_lead_intakes", "meta_sms_jobs", "lead_follow_up_jobs", "lead_reply_drafts"]) {
    if (has(table, ["submission_id", "organization_id"])) ownership.push(`NOT EXISTS(SELECT 1 FROM ${table} foreign_owner WHERE foreign_owner.submission_id=s.id AND foreign_owner.organization_id!='${ORG}')`);
  }
  if (has("submissions", ["organization_id"])) ownership.push(`s.organization_id='${ORG}'`);
  if (has("submissions", ["payload"])) ownership.push(`COALESCE(json_extract(CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END,'$.organization_id'),json_extract(CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END,'$.organizationId'),'${ORG}')='${ORG}'`);
  const owned = `SELECT s.id FROM submissions s${ownership.length ? ` WHERE ${ownership.join(" AND ")}` : ""}`;
  const targets = `SELECT s.id FROM submissions s WHERE ${phoneSql("s.phone") }=?${ownership.length ? ` AND ${ownership.join(" AND ")}` : ""}`;
  const digits = phone.slice(1);
  const add = (table, required, sql, args) => {
    if (!tables.has(table)) return;
    if (!has(table, required)) { reasons.push(`opt_out_schema_unknown:${table}`); return; }
    statements.push(db.prepare(sql).bind(...args));
  };
  if (has("submissions", ["payload", "updated_at"])) statements.push(db.prepare(`UPDATE submissions SET payload=json_set(payload,
    '$.do_not_text',json('true'),'$.follow_up_consent',json('false'),'$.text_status','Asked to stop','$.text_opted_out_at',?),updated_at=? WHERE json_valid(payload) AND id IN (${targets})`).bind(at, at, digits));
  add("lead_conversations", ["submission_id", "organization_id", "automation_mode", "status", "updated_at"], `UPDATE lead_conversations SET automation_mode='paused',status=CASE WHEN status='deleted' THEN status ELSE 'resolved' END,updated_at=?
    WHERE organization_id=? AND submission_id IN (${targets})`, [at, ORG, digits]);
  const parentMatches = has("quote_follow_ups", ["id", "submission_id", "recipient"])
    ? `SELECT q.id FROM quote_follow_ups q WHERE q.submission_id IN (${owned}) AND (q.submission_id IN (${targets}) OR ${phoneSql("q.recipient") }=?)`
    : null;
  for (const table of ["quote_follow_ups", "quote_follow_up_deliveries", "meta_sms_jobs", "lead_follow_up_jobs"]) {
    const orgScoped = has(table, ["organization_id"]);
    const assignments = ["status='cancelled'", ...(has(table, ["cancelled_at"]) ? ["cancelled_at=?"] : []), ...(has(table, ["updated_at"]) ? ["updated_at=?"] : []), ...(has(table, ["block_reason"]) ? ["block_reason='phone_suppressed'"] : [])];
    let match = `submission_id IN (${targets})`, matchArgs = [digits];
    if (parentMatches && table === "quote_follow_ups") { match = `id IN (${parentMatches})`; matchArgs = [digits, digits]; }
    if (parentMatches && table === "quote_follow_up_deliveries" && has(table, ["follow_up_id"])) { match = `(submission_id IN (${targets}) OR follow_up_id IN (${parentMatches}))`; matchArgs = [digits, digits, digits]; }
    add(table, ["submission_id", "status", "provider_message_id", "updated_at", ...(["meta_sms_jobs", "lead_follow_up_jobs"].includes(table) ? ["organization_id"] : [])], `UPDATE ${table} SET ${assignments.join(",")} WHERE status IN ('queued','blocked','sending','failed')
      ${has(table, ["provider_message_id"]) ? "AND provider_message_id IS NULL" : ""} ${orgScoped ? "AND organization_id=?" : ""} AND ${match}`,
    [...(has(table, ["cancelled_at"]) ? [at] : []), ...(has(table, ["updated_at"]) ? [at] : []), ...(orgScoped ? [ORG] : []), ...matchArgs]);
  }
  add("lead_reply_drafts", ["submission_id", "organization_id", "status", "updated_at", "provider_message_id"], `UPDATE lead_reply_drafts SET status='superseded',updated_at=?
    ${has("lead_reply_drafts", ["rejection_reason"]) ? ",rejection_reason='phone_suppressed'" : ""}
    WHERE organization_id=? AND status IN ('pending','approved','edited_approved','sending','failed') AND provider_message_id IS NULL AND submission_id IN (${targets})`, [at, ORG, digits]);
  const result = statements.length ? await db.batch(statements) : [];
  return { complete: reasons.length === 0, changes: result.reduce((sum, item) => sum + Number(item.meta?.changes || 0), 0), reasons };
}

async function enqueueStatus(db, key, command) {
  const payload = { version: 1, organizationId: ORG, phone: command.phone, doNotText: true, status: "Asked to stop", note: command.note, at: command.at, eventId: command.eventId,
    events: [command], completedIds: [], attempts: 0, nextAttemptAt: command.at, revision: 1 };
  const duplicate = `EXISTS(SELECT 1 FROM json_each(airtable_cockpit_snapshots.payload,'$.events') WHERE json_extract(value,'$.eventId')=?) OR
    EXISTS(SELECT 1 FROM json_each(airtable_cockpit_snapshots.payload,'$.completedIds') WHERE value=?)`;
  const result = await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,error) VALUES (?,?,'pending',NULL)
    ON CONFLICT(snapshot_key) DO UPDATE SET
      payload=CASE WHEN ${duplicate} THEN airtable_cockpit_snapshots.payload ELSE json_set(json_insert(airtable_cockpit_snapshots.payload,'$.events[#]',json(?)),
        '$.note',?,'$.at',?,'$.eventId',?,'$.attempts',0,'$.nextAttemptAt',?,'$.revision',COALESCE(json_extract(airtable_cockpit_snapshots.payload,'$.revision'),0)+1) END,
      status=CASE WHEN ${duplicate} THEN airtable_cockpit_snapshots.status WHEN airtable_cockpit_snapshots.status='syncing' THEN 'syncing' ELSE 'pending' END,
      error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE (${duplicate}) OR json_array_length(airtable_cockpit_snapshots.payload,'$.events')<?`)
    .bind(key, JSON.stringify(payload), command.eventId, command.eventId, JSON.stringify(command), command.note, command.at, command.eventId, command.at,
      command.eventId, command.eventId, command.eventId, command.eventId, MAX_EVENTS).run();
  if (!result.meta?.changes) throw new Error("text_status_outbox_capacity");
}

async function finishAttempt(db, row, token, event, outcome, now) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db.prepare("SELECT payload,status FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(row.snapshot_key).first();
    const payload = parse(current?.payload);
    if (!payload || payload.claimToken !== token || payload.events?.[0]?.eventId !== event.eventId) return false;
    let status = "pending", error = null;
    if (outcome?.verified === true && outcome.partial !== true) {
      payload.events.shift(); payload.completedIds = [...(payload.completedIds || []), event.eventId].slice(-1000);
      payload.attempts = 0; payload.nextAttemptAt = now.toISOString();
      status = payload.events.length ? "pending" : "synced";
      payload.lastPartial = false; payload.lastReason = "";
    } else {
      const knownReasons = ["airtable_text_status_notes_missing", "airtable_text_status_notes_capacity", "airtable_text_status_note_missing", "airtable_auth_unavailable", "airtable_contact_not_found", "airtable_schema_unknown", "airtable_pagination_incomplete", "airtable_write_unverified", "airtable_request_unavailable", "airtable_response_unverified"];
      error = knownReasons.includes(outcome?.reason) ? outcome.reason : "airtable_status_unverified";
      payload.lastReason = error; payload.lastPartial = outcome?.partial === true;
      // A new STOP arriving during HTTP keeps its immediate retry opportunity.
      if (payload.revision === row.revision) {
        payload.attempts = Math.min(12, Math.max(1, Number(payload.attempts) || 1));
        payload.nextAttemptAt = new Date(now.getTime() + Math.min(360, 5 * 2 ** (payload.attempts - 1)) * 60000).toISOString();
      }
    }
    delete payload.claimToken; delete payload.claimAt;
    const saved = await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?")
      .bind(JSON.stringify(payload), status, error, row.snapshot_key, current.payload).run();
    if (saved.meta?.changes) return true;
  }
  return false;
}

export async function processTextStatusOutbox(env, limit = 10, { syncTextStatus = syncAirtableTextStatus, now = new Date(), snapshotKey = null } = {}) {
  const db = env?.DB, date = new Date(now);
  if (!db || !Number.isFinite(date.getTime())) return { attempted: 0, synced: 0, pending: true, partial: false, reason: "text_status_outbox_unavailable" };
  const summary = { attempted: 0, synced: 0, pending: 0, partial: false, reasons: [] };
  try {
    if (snapshotKey && !new RegExp(`^${PREFIX}[a-f0-9]{64}$`).test(snapshotKey)) throw new Error("text_status_outbox_key_invalid");
    const rows = await db.prepare(`SELECT snapshot_key,payload,status FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE ? AND status IN ('pending','syncing')
      AND (? IS NULL OR snapshot_key=?) AND json_valid(payload) AND json_extract(payload,'$.nextAttemptAt')<=?
      AND (json_extract(payload,'$.claimToken') IS NULL OR json_extract(payload,'$.claimAt')<?) ORDER BY updated_at,snapshot_key LIMIT ?`)
      .bind(`${PREFIX}%`, snapshotKey, snapshotKey, date.toISOString(), new Date(date.getTime() - 5 * 60000).toISOString(), Math.max(1, Math.min(25, Number(limit) || 10))).all();
    for (const row of rows.results || []) {
      const payload = parse(row.payload), event = payload?.events?.[0];
      if (payload?.organizationId !== ORG || normalizedPhone(payload?.phone) !== payload.phone || !event?.eventId || !Array.isArray(payload.events)) { summary.pending++; summary.reasons.push("text_status_outbox_invalid"); continue; }
      const token = crypto.randomUUID();
      const claim = await db.prepare("UPDATE airtable_cockpit_snapshots SET status='syncing',payload=json_set(payload,'$.claimToken',?,'$.claimAt',?,'$.attempts',COALESCE(json_extract(payload,'$.attempts'),0)+1),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?")
        .bind(token, date.toISOString(), row.snapshot_key, row.payload).run();
      if (!claim.meta?.changes) continue;
      summary.attempted++;
      let outcome;
      try { outcome = await syncTextStatus(env, { phone: payload.phone, doNotText: true, status: "Asked to stop", note: event.note, at: event.at, eventId: event.eventId }); }
      catch { outcome = { verified: false, reason: "airtable_status_unverified" }; }
      const persisted = await finishAttempt(db, { ...row, revision: payload.revision }, token, event, outcome, date);
      if (outcome?.verified && outcome.partial !== true && persisted) summary.synced++; else { summary.pending++; summary.partial ||= outcome?.partial === true; summary.reasons.push(outcome?.reason === "airtable_text_status_notes_missing" ? outcome.reason : "airtable_status_unverified"); }
    }
    const backlog = await db.prepare("SELECT count(*) count FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE ? AND status IN ('pending','syncing') AND (? IS NULL OR snapshot_key=?)")
      .bind(`${PREFIX}%`, snapshotKey, snapshotKey).first();
    summary.pending = Math.max(summary.pending, Number(backlog?.count) || 0);
    summary.reasons = [...new Set(summary.reasons)];
    return summary;
  } catch { return { ...summary, pending: Math.max(1, summary.pending), reason: "text_status_outbox_unavailable" }; }
}

export async function suppressLeadPhone(db, env, { phone: value, eventId, at = new Date(), reason = "opted_out" } = {}, { syncTextStatus = syncAirtableTextStatus } = {}) {
  const phone = normalizedPhone(value), date = new Date(at);
  if (!db || !phone || typeof eventId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(eventId) || !Number.isFinite(date.getTime())) return { suppressed: false, verified: false, reason: "opt_out_identity_invalid" };
  const phoneHash = await hash(phone), key = `${PREFIX}${phoneHash}`, timestamp = date.toISOString();
  const reasons = [];
  // This durable suppression precedes optional schemas, queued work and HTTP.
  // For the reusable test line, even a second STOP must win over an older form.
  // Other numbers and live mode retain their existing timestamp behavior.
  const testLine = isCraigMetaTest(env, phone);
  const latestStop = testLine ? ",created_at=CASE WHEN julianday(excluded.created_at)>julianday(lead_suppressions.created_at) THEN excluded.created_at ELSE lead_suppressions.created_at END" : "";
  await db.prepare(`INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by${testLine ? ',created_at' : ''})
    VALUES (?,?,?,'quo_webhook','quo-webhook'${testLine ? ',?' : ''})
    ON CONFLICT(organization_id,phone_hash) DO UPDATE SET reason=excluded.reason,source=excluded.source,created_by=excluded.created_by${latestStop}`)
    .bind(ORG, phoneHash, reason === "wrong_number" ? "wrong_number" : "opted_out", ...(testLine ? [timestamp] : [])).run();
  let outboxQueued = false, cancellation = { complete: false, changes: 0 };
  try {
    await enqueueStatus(db, key, { phone, eventId, at: timestamp, note: reason === "wrong_number" ? "Wrong-number request received through Quo. Do not text." : "Opt-out request received through Quo. Do not text." });
    outboxQueued = true;
  } catch { reasons.push("text_status_outbox_unavailable"); }
  try { cancellation = await cancelPhoneQueues(db, phone, timestamp); if (!cancellation.complete) reasons.push(...cancellation.reasons); }
  catch { reasons.push("opt_out_queue_cancellation_incomplete"); }
  const sync = outboxQueued ? await processTextStatusOutbox({ ...env, DB: db }, 1, { syncTextStatus, now: date, snapshotKey: key }) : null;
  const pending = await db.prepare("SELECT status FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(key).first().catch(() => null);
  const verified = cancellation.complete && pending?.status === "synced";
  return { suppressed: true, verified, partial: !verified, phoneHash, outboxQueued, cancellationComplete: cancellation.complete, cancelled: cancellation.changes, sync, reasons: [...new Set([...reasons, ...(sync?.reasons || [])])] };
}
