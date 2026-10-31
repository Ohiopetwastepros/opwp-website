import { getDb } from "./db";
import { leadOrigin, quoteSummary, sourceStage } from "./growth-desk.mjs";
import { OPWP_ORGANIZATION_ID } from "./route-partner";
import { hydrateLeadAssistant, queueLeadSync } from "./lead-assistant";
import { enrichInbox } from "./lead-inbox-store";

const RELEVANT_KINDS = "'partial_quote','question','waitlist','onboarding'";

function rows(result) {
  return result?.results || [];
}

function groupBySubmission(items) {
  const grouped = new Map();
  for (const item of items) grouped.set(item.submission_id, [...(grouped.get(item.submission_id) || []), item]);
  return grouped;
}

export async function listGrowthDesk(limit = 100, { id = "", offset = 0, query = "" } = {}) {
  const db = getDb();
  if (!db) return { configured: false, leads: [] };
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 500);
  const search = String(query).trim().slice(0,120);
  const pattern = '%' + search.replace(/[\\%_]/g, value => '\\' + value) + '%';
  const phonePattern=/^\+?[\d\s().-]{4,30}$/.test(search)?'%'+search.replace(/\D/g,'')+'%':pattern;
  const [leadResult, eventResult, deliveryResult, notificationResult, webhookResult, airtableResult, followUpResult, websiteResult] = await db.batch([
    db.prepare(
      `SELECT s.id,s.kind,s.source,s.status,s.name,s.email,s.phone,s.zip,s.payload,
              s.funnel_id,s.lifecycle_stage,s.sng_sync_state,s.sng_entity_id,s.last_activity_at,s.created_at,s.updated_at,
              g.stage growth_stage,g.priority,g.owner_email,g.next_action,g.next_action_at,g.outcome_reason,g.outcome_note,
              g.converted_at,g.lost_at,g.not_qualified_at,g.version,g.updated_at growth_updated_at,
              a.status airtable_status,a.airtable_record_id,a.error_message airtable_error
       FROM submissions s
       LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
       LEFT JOIN lead_airtable_sync a ON a.submission_id=s.id AND a.organization_id=?
       WHERE s.kind IN (${RELEVANT_KINDS}) AND s.status!='deleted'
         AND COALESCE(g.outcome_reason,'')!='not_a_lead'
         AND NOT EXISTS(SELECT 1 FROM growth_leads foreign_lead WHERE foreign_lead.submission_id=s.id AND foreign_lead.organization_id!='org-opwp')
         AND NOT EXISTS(SELECT 1 FROM lead_conversations foreign_conversation WHERE foreign_conversation.submission_id=s.id AND foreign_conversation.organization_id!='org-opwp')
         AND NOT EXISTS(SELECT 1 FROM submissions original JOIN airtable_cockpit_snapshots ow ON ow.snapshot_key=('lead_workspace:org-opwp:'||original.id) WHERE original.id!=s.id AND original.funnel_id=s.funnel_id AND original.status!='deleted' AND s.kind IN ('partial_quote','onboarding') AND json_extract(ow.payload,'$.handoffPreparedAt') IS NOT NULL)
         ${id ? 'AND s.id=?' : ''}
         ${search ? `AND (s.name LIKE ? ESCAPE '\\' OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(s.phone,'+',''),' ',''),'-',''),'(',''),')','') LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.zip LIKE ? ESCAPE '\\' OR g.next_action LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM airtable_cockpit_snapshots sw WHERE sw.snapshot_key=('lead_workspace:org-opwp:'||s.id) AND json_extract(sw.payload,'$.intake.address') LIKE ? ESCAPE '\\'))` : ''}
         AND (s.kind!='onboarding' OR s.funnel_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM submissions quote
           WHERE quote.kind='partial_quote' AND quote.funnel_id=s.funnel_id AND quote.status!='deleted'
         ))
       ORDER BY datetime(s.created_at) DESC,s.id DESC LIMIT ? OFFSET ?`
    ).bind(OPWP_ORGANIZATION_ID, OPWP_ORGANIZATION_ID, ...(id ? [id] : []), ...(search ? [pattern,phonePattern,pattern,pattern,pattern,pattern] : []), safeLimit, Math.max(0, Math.floor(Number(offset) || 0))),
    db.prepare(
      `SELECT e.id,e.submission_id,e.event_type,e.summary,e.actor_email,e.created_at
       FROM growth_lead_events e JOIN submissions s ON s.id=e.submission_id
       WHERE e.organization_id=? AND s.kind IN (${RELEVANT_KINDS}) AND s.status!='deleted'
       ORDER BY e.created_at DESC LIMIT 2000`
    ).bind(OPWP_ORGANIZATION_ID),
    db.prepare(
      `SELECT d.submission_id,d.channel,d.status,d.attempt_count,d.next_attempt_at,d.sent_at,d.failed_at,d.cancelled_at,d.error_message
       FROM quote_follow_up_deliveries d JOIN submissions s ON s.id=d.submission_id
       WHERE s.kind IN (${RELEVANT_KINDS}) AND s.status!='deleted' ORDER BY d.created_at DESC LIMIT 2000`
    ),
    db.prepare(
      `SELECT n.submission_id,n.notification_type,n.channel,n.status,n.attempt_count,n.sent_at,n.failed_at,n.cancelled_at,n.error_message
       FROM submission_notifications n JOIN submissions s ON s.id=n.submission_id
       WHERE s.kind IN (${RELEVANT_KINDS}) AND s.status!='deleted' ORDER BY n.created_at DESC LIMIT 2000`
    ),
    db.prepare(
      `SELECT provider,COUNT(*) total,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failures,
              MAX(received_at) latest_received,
              MAX(CASE WHEN status='processed' THEN processed_at END) latest_processed
       FROM lead_webhook_events WHERE organization_id=? GROUP BY provider`
    ).bind(OPWP_ORGANIZATION_ID),
    db.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
              MAX(synced_at) latest_synced
       FROM lead_airtable_sync WHERE organization_id=?`
    ).bind(OPWP_ORGANIZATION_ID),
    db.prepare(
      `SELECT SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
              SUM(CASE WHEN status IN ('queued','failed') AND due_at<=CURRENT_TIMESTAMP THEN 1 ELSE 0 END) due
       FROM lead_follow_up_jobs WHERE organization_id=?`
    ).bind(OPWP_ORGANIZATION_ID),
    db.prepare(
      `SELECT COUNT(*) total,MAX(created_at) latest_received
       FROM submissions WHERE source='website' AND kind IN (${RELEVANT_KINDS})`
    ),
  ]);
  const events = groupBySubmission(rows(eventResult));
  const deliveries = groupBySubmission(rows(deliveryResult));
  const notifications = groupBySubmission(rows(notificationResult));
  const leads = rows(leadResult).map((row) => {
    const quote = quoteSummary(row.payload);
    return {
      id: row.id,
      funnelId: row.funnel_id || "",
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
      outcomeReason: row.outcome_reason || "",
      outcomeNote: row.outcome_note || "",
      convertedAt: row.converted_at || "",
      lostAt: row.lost_at || "",
      notQualifiedAt: row.not_qualified_at || "",
      version: Number(row.version || 0),
      activityAt: row.last_activity_at || row.created_at,
      createdAt: row.created_at,
      sng: { state: row.sng_sync_state || "not_attempted", id: row.sng_entity_id || "" },
      quote,
      origin: leadOrigin(row.payload, { ...row, funnelId: row.funnel_id }),
      airtable: { status: row.airtable_status || "not_queued", recordId: row.airtable_record_id || "", error: row.airtable_error || "" },
      deliveries: deliveries.get(row.id) || [],
      notifications: notifications.get(row.id) || [],
      events: events.get(row.id) || [],
    };
  });
  const webhookHealth = new Map(rows(webhookResult).map((item) => [item.provider, item]));
  const airtableHealth = rows(airtableResult)[0] || {};
  const followUpHealth = rows(followUpResult)[0] || {};
  const websiteHealth = rows(websiteResult)[0] || {};
  const assistant = await hydrateLeadAssistant(db, leads);
  return {
    configured: true,
    ...assistant,
    leads: await enrichInbox(db, assistant.leads),
    health: {
      website: { total: Number(websiteHealth.total || 0), latestReceived: websiteHealth.latest_received || "" },
      meta: webhookHealth.get("meta") || null,
      quo: webhookHealth.get("quo") || null,
      airtable: {
        total: Number(airtableHealth.total || 0),
        queued: Number(airtableHealth.queued || 0),
        failed: Number(airtableHealth.failed || 0),
        latestSynced: airtableHealth.latest_synced || "",
      },
      followUps: {
        queued: Number(followUpHealth.queued || 0),
        failed: Number(followUpHealth.failed || 0),
        due: Number(followUpHealth.due || 0),
      },
    },
  };
}

export async function getGrowthSubmission(db, submissionId) {
  return db.prepare(
    `SELECT s.id,s.kind,s.lifecycle_stage,s.sng_sync_state,g.stage,g.priority,g.owner_email,g.next_action,g.next_action_at,
            g.outcome_reason,g.outcome_note,g.converted_at,g.lost_at,g.not_qualified_at,g.version
     FROM submissions s LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
     WHERE s.id=? AND s.kind IN (${RELEVANT_KINDS}) AND s.status!='deleted' AND COALESCE(g.outcome_reason,'')!='not_a_lead' LIMIT 1`
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
    outcomeReason: submission.outcome_reason || "",
    outcomeNote: submission.outcome_note || "",
  };
  const after = {
    stage: converted ? "won" : value.stage,
    priority: value.priority,
    owner: owner || "",
    nextAction: value.nextAction,
    nextActionAt: value.nextActionAt,
    outcomeReason: ["lost", "not_qualified"].includes(value.stage) ? value.outcomeReason : "",
    outcomeNote: value.outcomeNote || "",
  };
  const eventId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO growth_leads
        (submission_id,organization_id,stage,priority,owner_email,next_action,next_action_at,outcome_reason,outcome_note,converted_at,lost_at,not_qualified_at,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,CASE WHEN ?='won' THEN CURRENT_TIMESTAMP END,CASE WHEN ?='lost' THEN CURRENT_TIMESTAMP END,CASE WHEN ?='not_qualified' THEN CURRENT_TIMESTAMP END,?)
       ON CONFLICT(submission_id) DO UPDATE SET
         organization_id=excluded.organization_id,stage=excluded.stage,priority=excluded.priority,
         owner_email=excluded.owner_email,next_action=excluded.next_action,next_action_at=excluded.next_action_at,
         outcome_reason=excluded.outcome_reason,outcome_note=excluded.outcome_note,
         converted_at=CASE WHEN excluded.stage='won' THEN COALESCE(growth_leads.converted_at,CURRENT_TIMESTAMP) ELSE NULL END,
         lost_at=CASE WHEN excluded.stage='lost' THEN COALESCE(growth_leads.lost_at,CURRENT_TIMESTAMP) ELSE NULL END,
         not_qualified_at=CASE WHEN excluded.stage='not_qualified' THEN COALESCE(growth_leads.not_qualified_at,CURRENT_TIMESTAMP) ELSE NULL END,
         version=growth_leads.version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`
    ).bind(submission.id, OPWP_ORGANIZATION_ID, after.stage, after.priority, owner, after.nextAction || null, after.nextActionAt || null,
      after.outcomeReason || null, after.outcomeNote || null, after.stage, after.stage, after.stage, actor),
    db.prepare(
      `INSERT INTO growth_lead_events
        (id,submission_id,organization_id,event_type,summary,details,actor_email)
       VALUES (?,?,?,'state_changed','YardOps Pipeline workflow updated',?,?)`
    ).bind(eventId, submission.id, OPWP_ORGANIZATION_ID, JSON.stringify({ before, after }), actor),
    db.prepare(
      `UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE submission_id=? AND organization_id=? AND status IN ('queued','failed','sending') AND ? IN ('won','lost','not_qualified')`
    ).bind(submission.id, OPWP_ORGANIZATION_ID, after.stage),
  ]);
  await queueLeadSync(db, submission.id);
  return {
    ...after,
    convertedAt: after.stage === "won" ? submission.converted_at || new Date().toISOString() : "",
    lostAt: after.stage === "lost" ? submission.lost_at || new Date().toISOString() : "",
    notQualifiedAt: after.stage === "not_qualified" ? submission.not_qualified_at || new Date().toISOString() : "",
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
