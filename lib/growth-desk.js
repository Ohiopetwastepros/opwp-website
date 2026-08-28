import { getDb } from "./db";
import { quoteSummary, sourceStage } from "./growth-desk.mjs";
import { OPWP_ORGANIZATION_ID } from "./route-partner";

const RELEVANT_KINDS = "'partial_quote','question','waitlist','onboarding'";

function rows(result) {
  return result?.results || [];
}

function groupBySubmission(items) {
  const grouped = new Map();
  for (const item of items) grouped.set(item.submission_id, [...(grouped.get(item.submission_id) || []), item]);
  return grouped;
}

export async function listGrowthDesk(limit = 300) {
  const db = getDb();
  if (!db) return { configured: false, leads: [] };
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 500);
  const [leadResult, eventResult, deliveryResult, notificationResult] = await db.batch([
    db.prepare(
      `SELECT s.id,s.kind,s.source,s.status,s.name,s.email,s.phone,s.zip,s.payload,
              s.lifecycle_stage,s.sng_sync_state,s.sng_entity_id,s.last_activity_at,s.created_at,s.updated_at,
              g.stage growth_stage,g.priority,g.owner_email,g.next_action,g.next_action_at,g.version,g.updated_at growth_updated_at
       FROM submissions s
       LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
       WHERE s.kind IN (${RELEVANT_KINDS})
       ORDER BY COALESCE(s.last_activity_at,s.created_at) DESC LIMIT ?`
    ).bind(OPWP_ORGANIZATION_ID, safeLimit),
    db.prepare(
      `SELECT e.id,e.submission_id,e.event_type,e.summary,e.actor_email,e.created_at
       FROM growth_lead_events e JOIN submissions s ON s.id=e.submission_id
       WHERE e.organization_id=? AND s.kind IN (${RELEVANT_KINDS})
       ORDER BY e.created_at DESC LIMIT 2000`
    ).bind(OPWP_ORGANIZATION_ID),
    db.prepare(
      `SELECT d.submission_id,d.channel,d.status,d.attempt_count,d.next_attempt_at,d.sent_at,d.failed_at,d.cancelled_at,d.error_message
       FROM quote_follow_up_deliveries d JOIN submissions s ON s.id=d.submission_id
       WHERE s.kind IN (${RELEVANT_KINDS}) ORDER BY d.created_at DESC LIMIT 2000`
    ),
    db.prepare(
      `SELECT n.submission_id,n.notification_type,n.channel,n.status,n.attempt_count,n.sent_at,n.failed_at,n.cancelled_at,n.error_message
       FROM submission_notifications n JOIN submissions s ON s.id=n.submission_id
       WHERE s.kind IN (${RELEVANT_KINDS}) ORDER BY n.created_at DESC LIMIT 2000`
    ),
  ]);
  const events = groupBySubmission(rows(eventResult));
  const deliveries = groupBySubmission(rows(deliveryResult));
  const notifications = groupBySubmission(rows(notificationResult));
  const leads = rows(leadResult).map((row) => {
    const quote = quoteSummary(row.payload);
    return {
      id: row.id,
      kind: row.kind,
      source: row.source,
      sourceStatus: row.status,
      name: row.name || "Name pending",
      email: row.email || "",
      phone: row.phone || "",
      zip: row.zip || "",
      stage: sourceStage(row),
      stageLocked: row.lifecycle_stage === "converted" || (row.kind === "onboarding" && row.sng_sync_state === "succeeded"),
      priority: row.priority || "normal",
      owner: row.owner_email || "",
      nextAction: row.next_action || "",
      nextActionAt: row.next_action_at || "",
      version: Number(row.version || 0),
      activityAt: row.last_activity_at || row.created_at,
      createdAt: row.created_at,
      sng: { state: row.sng_sync_state || "not_attempted", id: row.sng_entity_id || "" },
      quote,
      deliveries: deliveries.get(row.id) || [],
      notifications: notifications.get(row.id) || [],
      events: events.get(row.id) || [],
    };
  });
  return { configured: true, leads };
}

export async function getGrowthSubmission(db, submissionId) {
  return db.prepare(
    `SELECT s.id,s.kind,s.lifecycle_stage,s.sng_sync_state,g.stage,g.priority,g.owner_email,g.next_action,g.next_action_at,g.version
     FROM submissions s LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
     WHERE s.id=? AND s.kind IN (${RELEVANT_KINDS}) LIMIT 1`
  ).bind(OPWP_ORGANIZATION_ID, submissionId).first();
}

export async function saveGrowthState(db, submission, value, actor) {
  const converted = submission.lifecycle_stage === "converted" || (submission.kind === "onboarding" && submission.sng_sync_state === "succeeded");
  if (converted && value.stage !== "won") throw new Error("A converted customer remains in the Won stage.");
  const owner = value.owner === "me" ? actor : null;
  const before = {
    stage: converted ? "won" : submission.stage || "new",
    priority: submission.priority || "normal",
    owner: submission.owner_email || "",
    nextAction: submission.next_action || "",
    nextActionAt: submission.next_action_at || "",
  };
  const after = { stage: converted ? "won" : value.stage, priority: value.priority, owner: owner || "", nextAction: value.nextAction, nextActionAt: value.nextActionAt };
  const eventId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO growth_leads
        (submission_id,organization_id,stage,priority,owner_email,next_action,next_action_at,updated_by)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(submission_id) DO UPDATE SET
         organization_id=excluded.organization_id,stage=excluded.stage,priority=excluded.priority,
         owner_email=excluded.owner_email,next_action=excluded.next_action,next_action_at=excluded.next_action_at,
         version=growth_leads.version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`
    ).bind(submission.id, OPWP_ORGANIZATION_ID, after.stage, after.priority, owner, after.nextAction || null, after.nextActionAt || null, actor),
    db.prepare(
      `INSERT INTO growth_lead_events
        (id,submission_id,organization_id,event_type,summary,details,actor_email)
       VALUES (?,?,?,'state_changed','YardOps Pipeline workflow updated',?,?)`
    ).bind(eventId, submission.id, OPWP_ORGANIZATION_ID, JSON.stringify({ before, after }), actor),
  ]);
  return {
    ...after,
    version: Number(submission.version || 0) + 1,
    event: { id: eventId, submission_id: submission.id, event_type: "state_changed", summary: "YardOps Pipeline workflow updated", actor_email: actor, created_at: new Date().toISOString() },
  };
}

export async function addGrowthNote(db, submissionId, note, actor) {
  const event = { id: crypto.randomUUID(), submission_id: submissionId, event_type: "note", summary: note, actor_email: actor };
  await db.prepare(
    `INSERT INTO growth_lead_events
      (id,submission_id,organization_id,event_type,summary,actor_email)
     VALUES (?,?,?,'note',?,?)`
  ).bind(event.id, submissionId, OPWP_ORGANIZATION_ID, note, actor).run();
  return { ...event, created_at: new Date().toISOString() };
}
