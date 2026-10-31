import { allowedOperationalDays } from "./route-day-policy.mjs";
import { outboundFetch } from "./outbound-request";
import { quoteSummary } from "./growth-desk.mjs";
import { findAnswerMatch, isStopMessage, normalizePhone, resolveLeadSyncId, shouldMarkNotQualifiedForNoResponse } from "./lead-assistant.mjs";
import { checkQuoCustomerDirectory, classifyQuoLeadIntent } from "./quo-lead-intake.mjs";
import { OPWP_ORGANIZATION_ID } from "./route-partner";
import { sngPaginatedRequest } from "./sweepandgo";
import { processMetaConfirmations, recordMetaReply, initializeMetaResponseLibrary, reconcileQuoReceipts, markMetaNoResponse } from "./meta-lead-workflow.mjs";
import { classifyMetaReply } from "./meta-lead-policy.mjs";
import { metaCleanupSummary } from "./meta-conversation.mjs";
import { ensureFreshAirtableCockpitSnapshot } from "./airtable";
import { reconcileMetaConversions } from "./meta-conversion.mjs";

const QUO_BASE = "https://api.openphone.com";
const AIRTABLE_BASE_ID = "appcAWPBQB8GmOrcT";
const AIRTABLE_LEADS_TABLE_ID = "tblCrdvGKkGobRWxL";

function title(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function payload(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function conversationId() {
  return crypto.randomUUID();
}

async function ensureConversation(db, submissionId, channel = "website") {
  await db.prepare(
    `INSERT INTO lead_conversations (id,submission_id,organization_id,channel,status,automation_mode)
     VALUES (?,?,?,?,'open','suggest') ON CONFLICT(submission_id) DO NOTHING`
  ).bind(conversationId(), submissionId, OPWP_ORGANIZATION_ID, channel).run();
  return db.prepare(
    `SELECT id,submission_id,channel,status,automation_mode,unread_count,last_inbound_at,last_outbound_at,deleted_at
     FROM lead_conversations WHERE submission_id=? AND organization_id=? LIMIT 1`
  ).bind(submissionId, OPWP_ORGANIZATION_ID).first();
}

export async function queueLeadSync(db, submissionId, channel = "website") {
  if (!db || !submissionId) return false;
  try {
    await ensureConversation(db, submissionId, channel);
    await db.prepare(
      `INSERT INTO lead_airtable_sync (submission_id,organization_id,status,next_attempt_at)
       VALUES (?,?,'queued',CURRENT_TIMESTAMP)
       ON CONFLICT(submission_id) DO UPDATE SET status='queued',next_attempt_at=CURRENT_TIMESTAMP,
         error_message=NULL,attempt_count=0,revision=lead_airtable_sync.revision+1,updated_at=CURRENT_TIMESTAMP`
    ).bind(submissionId, OPWP_ORGANIZATION_ID).run();
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "yardops_sync_enqueue_failed", submissionId, message: error instanceof Error ? error.message : "failed" }));
    return false;
  }
}

export async function hydrateLeadAssistant(db, leads) {
  if (!leads.length) return hydrateLeadAssistantBatch(db, leads);
  let result = null;
  for (let start = 0; start < leads.length; start += 60) {
    const part = await hydrateLeadAssistantBatch(db, leads.slice(start, start + 60));
    result = result ? { ...result, leads: [...result.leads, ...part.leads] } : part;
  }
  return result;
}

async function hydrateLeadAssistantBatch(db, leads) {
  if (!db) return { leads, answers: [], settings: null };
  if (!leads.length) {
    const [answerResult, settingsResult] = await db.batch([
      db.prepare(`SELECT answer_key,category,question,answer_template,keywords,response_mode,approval_status,auto_send_allowed,version,updated_at
        FROM lead_answer_library WHERE organization_id=? AND approval_status!='retired' ORDER BY category,question`).bind(OPWP_ORGANIZATION_ID),
      db.prepare(`SELECT * FROM lead_automation_settings WHERE organization_id=?`).bind(OPWP_ORGANIZATION_ID),
    ]);
    return { leads: [], answers: answerResult.results || [], settings: settingsResult.results?.[0] || null };
  }
  const ids = leads.map((lead) => lead.id);
  const placeholders = ids.map(() => "?").join(",");
  const [conversationResult, messageResult, jobResult, answerResult, settings, metaResult, metaJobs] = await db.batch([
    db.prepare(`SELECT * FROM lead_conversations WHERE organization_id=? AND submission_id IN (${placeholders})`).bind(OPWP_ORGANIZATION_ID, ...ids),
    db.prepare(`SELECT m.* FROM lead_messages m JOIN lead_conversations c ON c.id=m.conversation_id
      WHERE m.organization_id=? AND c.submission_id IN (${placeholders}) ORDER BY m.created_at`).bind(OPWP_ORGANIZATION_ID, ...ids),
    db.prepare(`SELECT * FROM lead_follow_up_jobs WHERE organization_id=? AND submission_id IN (${placeholders}) ORDER BY due_at`).bind(OPWP_ORGANIZATION_ID, ...ids),
    db.prepare(`SELECT answer_key,category,question,answer_template,keywords,response_mode,approval_status,auto_send_allowed,version,updated_at
      FROM lead_answer_library WHERE organization_id=? AND approval_status!='retired' ORDER BY category,question`).bind(OPWP_ORGANIZATION_ID),
    db.prepare(`SELECT * FROM lead_automation_settings WHERE organization_id=?`).bind(OPWP_ORGANIZATION_ID),
    db.prepare(`SELECT i.*,s.payload FROM meta_lead_intakes i JOIN submissions s ON s.id=i.submission_id WHERE i.organization_id=? AND i.submission_id IN (${placeholders})`).bind(OPWP_ORGANIZATION_ID, ...ids),
    db.prepare(`SELECT * FROM meta_sms_jobs WHERE organization_id=? AND submission_id IN (${placeholders}) ORDER BY created_at`).bind(OPWP_ORGANIZATION_ID, ...ids),
  ]);
  const conversations = new Map((conversationResult.results || []).map((row) => [row.submission_id, row]));
  const messages = new Map();
  for (const row of messageResult.results || []) messages.set(row.conversation_id, [...(messages.get(row.conversation_id) || []), row]);
  const jobs = new Map();
  for (const row of jobResult.results || []) jobs.set(row.submission_id, [...(jobs.get(row.submission_id) || []), row]);
  return {
    leads: leads.filter((lead) => conversations.get(lead.id)?.status !== "deleted").map((lead) => {
      const conversation = conversations.get(lead.id);
      const intake = (metaResult.results || []).find((row) => row.submission_id === lead.id);
      const form = intake ? payload(intake.payload) : {};
      return { ...lead, meta: intake ? { sourceUrl: intake.source_url, duplicateOf: intake.duplicate_of, reviewReason: intake.review_reason, replyBranch: intake.reply_branch,
        originalForm: form.original_form, consentEvidence: form.sms_consent_evidence, preferredChannel: form.preferred_channel,
        state: payload(intake.response_state), routeGuidance: payload(intake.route_guidance), routeAuditedAt: intake.route_audited_at,
        qualifiedAt: intake.qualified_at, quotedAt: intake.quoted_at, paidAt: intake.paid_at, signedUpAt: intake.signed_up_at, jobs: (metaJobs.results || []).filter((job) => job.submission_id === lead.id) } : null, conversation: conversation ? {
        id: conversation.id,
        channel: conversation.channel,
        status: conversation.status,
        automationMode: conversation.automation_mode,
        unreadCount: Number(conversation.unread_count || 0),
        lastInboundAt: conversation.last_inbound_at || "",
        lastOutboundAt: conversation.last_outbound_at || "",
        messages: messages.get(conversation.id) || [],
      } : null, followUps: jobs.get(lead.id) || [] };
    }),
    answers: answerResult.results || [],
    settings: settings.results?.[0] || null,
  };
}

async function sendQuoSms(env, to, content) {
  const from = normalizePhone(env.QUO_FROM_NUMBER);
  const recipient = normalizePhone(to);
  if (!env.QUO_API_KEY || !from || !recipient) throw new Error("Quo messaging is not configured.");
  const response = await outboundFetch(new URL("/v1/messages", env.QUO_API_BASE_URL || QUO_BASE), {
    method: "POST",
    headers: { Authorization: env.QUO_API_KEY, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ content, from, to: [recipient] }),
  }, { provider: "quo", operation: "yardops_lead_reply", timeoutMs: 12000, retries: 0 });
  const data = await response.json().catch(() => ({}));
  const providerId = data?.data?.id || data?.id;
  if (!response.ok || !providerId) throw new Error(`Quo did not accept the message (${response.status}).`);
  return String(providerId);
}

export async function getLeadRecord(db, submissionId) {
  return db.prepare(
    `SELECT s.id,s.kind,s.status,s.name,s.email,s.phone,s.zip,s.payload,s.source,s.created_at,s.last_activity_at,
            c.id conversation_id,c.status conversation_status,c.automation_mode,c.last_inbound_at,c.last_outbound_at,c.unread_count,c.deleted_at
     FROM submissions s JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=?
     WHERE s.id=? AND s.kind IN ('partial_quote','question','waitlist','onboarding')
       AND NOT EXISTS (SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND g.organization_id=c.organization_id AND g.outcome_reason='not_a_lead')
       AND s.status!='deleted' AND c.status!='deleted' LIMIT 1`
  ).bind(OPWP_ORGANIZATION_ID, submissionId).first();
}

export async function sendLeadMessage(db, env, lead, message, actor, automated = false) {
  if (lead.deleted_at || lead.conversation_status === "deleted") throw new Error("This lead was deleted.");
  const summary = quoteSummary(lead.payload);
  if (!summary.consent && !lead.last_inbound_at) throw new Error("SMS consent or an inbound customer message is required before sending from YardOps.");
  const recipient = normalizePhone(lead.phone);
  const suppressed = recipient ? await db.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=? LIMIT 1`).bind(OPWP_ORGANIZATION_ID, await sha256(recipient)).first() : null;
  if (suppressed?.blocked) throw new Error("This phone number is suppressed from YardOps messaging.");
  const providerId = await sendQuoSms(env, lead.phone, message);
  const item = { id: crypto.randomUUID(), body: message, provider_message_id: providerId, created_at: new Date().toISOString() };
  await db.batch([
    db.prepare(`INSERT INTO lead_messages
      (id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by)
      VALUES (?,?,?,'outbound','quo_sms',?,?,'sent',?,?)`).bind(item.id, lead.conversation_id, OPWP_ORGANIZATION_ID, providerId, message, automated ? 1 : 0, actor),
    db.prepare(`UPDATE lead_conversations SET channel='quo_sms',status=CASE WHEN last_inbound_at IS ? AND unread_count=? THEN 'waiting' ELSE status END,unread_count=CASE WHEN last_inbound_at IS ? AND unread_count=? THEN 0 ELSE unread_count END,last_outbound_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(lead.last_inbound_at||null,Number(lead.unread_count||0),lead.last_inbound_at||null,Number(lead.unread_count||0),lead.conversation_id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE submissions SET last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(lead.id),
  ]);
  await queueLeadSync(db, lead.id, "quo_sms");
  return { ...item, direction: "outbound", channel: "quo_sms", delivery_status: "sent", automated: automated ? 1 : 0, created_by: actor };
}

export async function setLeadAutomation(db, lead, mode, actor) {
  await db.batch([
    db.prepare(`UPDATE lead_conversations SET automation_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(mode, lead.conversation_id, OPWP_ORGANIZATION_ID),
    db.prepare(`INSERT INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email)
      VALUES (?,?,?,'system','Lead assistant mode changed',?,?)`).bind(crypto.randomUUID(), lead.id, OPWP_ORGANIZATION_ID, JSON.stringify({ mode }), actor),
  ]);
  return mode;
}

export async function scheduleLeadFollowUp(db, lead, value, actor) {
  if (lead.deleted_at || lead.conversation_status === "deleted") throw new Error("This lead was deleted.");
  const count = await db.prepare(`SELECT COUNT(*) count FROM lead_follow_up_jobs WHERE conversation_id=? AND status IN ('queued','sent')`).bind(lead.conversation_id).first();
  const step = Math.min(Number(count?.count || 0) + 1, 6);
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO lead_follow_up_jobs
    (id,submission_id,conversation_id,organization_id,sequence_step,due_at,status,message_body)
    VALUES (?,?,?,?,?,?,'queued',?)
    ON CONFLICT(conversation_id,sequence_step) DO UPDATE SET due_at=excluded.due_at,status='queued',message_body=excluded.message_body,
      attempt_count=0,error_message=NULL,cancelled_at=NULL,updated_at=CURRENT_TIMESTAMP`
  ).bind(id, lead.id, lead.conversation_id, OPWP_ORGANIZATION_ID, step, value.dueAt, value.message).run();
  await db.prepare(`INSERT INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email)
    VALUES (?,?,?,'system','Follow-up scheduled',?,?)`).bind(crypto.randomUUID(), lead.id, OPWP_ORGANIZATION_ID, JSON.stringify({ dueAt: value.dueAt, step }), actor).run();
  return { id, submission_id: lead.id, conversation_id: lead.conversation_id, sequence_step: step, due_at: value.dueAt, status: "queued", message_body: value.message };
}

export async function cancelLeadFollowUps(db, lead, actor) {
  await db.batch([
    db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='cancelled_by_admin',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','blocked')`).bind(lead.id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status IN ('queued','failed')`).bind(lead.conversation_id, OPWP_ORGANIZATION_ID),
    db.prepare(`INSERT INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,actor_email)
      VALUES (?,?,?,'system','Pending follow-ups cancelled',?)`).bind(crypto.randomUUID(), lead.id, OPWP_ORGANIZATION_ID, actor),
  ]);
  return true;
}

export async function startLeadNurture(db, lead, actor) {
  if (lead.source === "facebook") throw new Error("Facebook follow-ups use the separately approved Meta cadence.");
  if (lead.deleted_at || lead.conversation_status === "deleted") throw new Error("This lead was deleted.");
  const summary = quoteSummary(lead.payload);
  if (!summary.consent && !lead.last_inbound_at) throw new Error("SMS consent or an inbound customer message is required before starting follow-up.");
  const firstName = String(lead.name || "").trim().split(/\s+/)[0].slice(0, 60);
  const greeting = firstName ? `Hi ${firstName}, ` : "Hi, ";
  const sequence = [
    { step: 1, delay: "+1 day", body: `${greeting}this is Craig with Ohio Pet Waste Pros. I wanted to make sure you received your quote and see whether I can answer any questions about service.` },
    { step: 2, delay: "+3 days", body: `${greeting}just checking back from Ohio Pet Waste Pros. Your quote is still available, and I am happy to help with scheduling, yard access, or service questions.` },
    { step: 3, delay: "+7 days", body: `${greeting}I will close the loop for now so I do not crowd your phone. If you still want help keeping the yard clean, reply here anytime and I will pick it back up. Reply STOP to opt out.` },
  ];
  await db.batch(sequence.map((item) => db.prepare(`INSERT INTO lead_follow_up_jobs
    (id,submission_id,conversation_id,organization_id,sequence_step,due_at,status,message_body)
    VALUES (?,?,?,?,?,datetime('now',?),'queued',?)
    ON CONFLICT(conversation_id,sequence_step) DO UPDATE SET due_at=excluded.due_at,status='queued',message_body=excluded.message_body,
      attempt_count=0,error_message=NULL,cancelled_at=NULL,updated_at=CURRENT_TIMESTAMP`
  ).bind(crypto.randomUUID(), lead.id, lead.conversation_id, OPWP_ORGANIZATION_ID, item.step, item.delay, item.body)));
  await db.prepare(`INSERT INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email)
    VALUES (?,?,?,'system','OPWP nurture sequence prepared',?,?)`).bind(crypto.randomUUID(), lead.id, OPWP_ORGANIZATION_ID, JSON.stringify({ touches: 3, days: [1, 3, 7] }), actor).run();
  const result = await db.prepare(`SELECT * FROM lead_follow_up_jobs WHERE conversation_id=? ORDER BY sequence_step`).bind(lead.conversation_id).all();
  return result.results || [];
}

export async function deleteLead(db, lead, reason, actor) {
  const phone = normalizePhone(lead.phone);
  const phoneHash = phone ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone))), (byte) => byte.toString(16).padStart(2, "0")).join("") : "";
  const statements = [
    db.prepare(`UPDATE meta_sms_jobs SET status=CASE WHEN status IN ('queued','blocked') THEN 'cancelled' ELSE status END,message_body='Deleted lead',error_message=NULL WHERE submission_id=? AND organization_id=?`).bind(lead.id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE meta_reply_decisions SET response_body='',state_json='{}',prior_state_json='{}' WHERE submission_id=? AND organization_id=?`).bind(lead.id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE meta_lead_intakes SET response_state='{}',route_guidance=NULL,review_reason='deleted',phone_hash=NULL WHERE submission_id=? AND organization_id=?`).bind(lead.id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE lead_conversations SET status='deleted',automation_mode='paused',unread_count=0,deleted_at=CURRENT_TIMESTAMP,deletion_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(reason, lead.conversation_id, OPWP_ORGANIZATION_ID),
    db.prepare(`DELETE FROM lead_messages WHERE conversation_id=? AND organization_id=?`).bind(lead.conversation_id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status IN ('queued','failed','sending')`).bind(lead.conversation_id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed')`).bind(lead.id),
    db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed','sending')`).bind(lead.id),
    db.prepare(`UPDATE submissions SET status='deleted',name=NULL,email=NULL,phone=NULL,zip=NULL,payload='{"deleted":true}',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(lead.id),
    db.prepare(`DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? OR (snapshot_key LIKE 'lead_prefill:%' AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.leadId')=?)`).bind(`lead_workspace:${OPWP_ORGANIZATION_ID}:${lead.id}`,lead.id),
    db.prepare(`DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=?`).bind(`lead_manual_send:${OPWP_ORGANIZATION_ID}:${lead.id}`),
    db.prepare(`UPDATE growth_lead_events SET summary='Deleted lead activity',details=NULL WHERE submission_id=? AND organization_id=?`).bind(lead.id,OPWP_ORGANIZATION_ID),
    db.prepare(`INSERT INTO lead_airtable_sync (submission_id,organization_id,status,next_attempt_at) VALUES (?,?,'queued',CURRENT_TIMESTAMP)
      ON CONFLICT(submission_id) DO UPDATE SET status='queued',next_attempt_at=CURRENT_TIMESTAMP,error_message=NULL,updated_at=CURRENT_TIMESTAMP`).bind(lead.id, OPWP_ORGANIZATION_ID),
  ];
  if (phoneHash) statements.push(db.prepare(`INSERT INTO lead_suppressions (organization_id,phone_hash,reason,source,created_by)
    VALUES (?,?,?,'deleted_lead',?) ON CONFLICT(organization_id,phone_hash) DO UPDATE SET reason=excluded.reason,created_by=excluded.created_by`).bind(OPWP_ORGANIZATION_ID, phoneHash, reason, actor));
  await db.batch(statements);
  console.log(JSON.stringify({ event: "yardops_lead_deleted", submissionId: lead.id, actor, reason }));
  return true;
}

function airtableFields(row) {
  const workspace = payload(row.workspace_payload);
  const saved = workspace.quote;
  const quote = saved ? { ...quoteSummary(row.payload), dogs: workspace.intake?.dogs || '', frequency: workspace.intake?.frequency || '', yard: workspace.intake?.yardSize || '', monthly: saved.custom ? null : saved.monthly ?? null } : quoteSummary(row.payload);
  const source = payload(row.payload);
  const frequency = title(quote.frequency);
  const days = allowedOperationalDays({ city: source.city || "", zip: row.zip, frequency });
  const deleted = row.conversation_status === "deleted" || row.status === "deleted";
  const leadId = resolveLeadSyncId(row);
  const auditedDays = row.route_audited_at ? payload(row.route_guidance).approvedDays : null;
  const fields = {
    "YardOps Lead ID": leadId,
    "Name": deleted ? "Deleted lead" : row.name || "Name pending",
    "Email": deleted ? "" : row.email || "",
    "Phone": deleted ? "" : normalizePhone(row.phone),
    "ZIP": deleted ? "" : row.zip || "",
    "Source": row.source || "website",
    "Source Status": row.status || "new",
    "Pipeline Stage": deleted ? "Deleted" : title(row.growth_stage || "new"),
    "Priority": title(row.priority || "normal"),
    "Frequency": frequency,
    "Yard Size": title(quote.yard),
    "Service Day": row.source === "facebook" ? Array.isArray(auditedDays) && auditedDays.length ? auditedDays.join(" / ") : "Confirmed during signup" : days.length === 1 ? days[0] : "Confirmed during signup",
    "Customer Question": deleted ? "" : row.source === "facebook" ? `${quote.question}\nMeta lead: ${source.meta_lead_id || ""}\nForm: ${source.meta_form_id || ""}\nSource: ${source.meta_source_url || ""}\nContact preference: ${source.preferred_channel || "unknown"}\nConsent: ${source.sms_consent_evidence?.valid ? "verified" : "not verified"}\nResponse branch: ${source.meta_response_state?.branch || "awaiting response"}\n${metaCleanupSummary(source.meta_response_state)}`.slice(0, 4000) : quote.question,
    "SMS Consent": deleted ? false : quote.consent,
    "Owner": deleted ? "" : row.owner_email || "",
    "Next Action": deleted ? "" : row.next_action || "",
    "Outcome Reason": deleted ? "Deleted lead" : title(row.outcome_reason || ""),
    "Outcome Notes": deleted ? row.deletion_reason || "Deleted in YardOps" : row.outcome_note || "",
    "Deleted": deleted,
    "Deletion Reason": deleted ? row.deletion_reason || "Deleted in YardOps" : "",
    "Last Synced": new Date().toISOString(),
  };
  if (!deleted && quote.monthly !== null) fields["Monthly Quote"] = quote.monthly;
  else if (row.source === "facebook" || saved) fields["Monthly Quote"] = null; // Clear a superseded quote in Airtable.
  if (!deleted && quote.dogs !== "" && Number.isFinite(Number(quote.dogs))) fields.Dogs = Number(quote.dogs);
  if (row.next_action_at && !deleted) fields["Next Action Due"] = new Date(row.next_action_at).toISOString();
  if (row.last_activity_at) fields["Last Activity"] = new Date(`${row.last_activity_at}${String(row.last_activity_at).includes("Z") ? "" : "Z"}`).toISOString();
  if (row.created_at) fields["Captured At"] = new Date(`${row.created_at}${String(row.created_at).includes("Z") ? "" : "Z"}`).toISOString();
  return fields;
}

async function syncAirtableLead(env, row) {
  const apiKey = env.AIRTABLE_API_KEY;
  if (!apiKey) throw new Error("Airtable is not configured.");
  const baseId = env.AIRTABLE_BASE_ID || AIRTABLE_BASE_ID;
  const tableId = env.AIRTABLE_LEADS_TABLE_ID || AIRTABLE_LEADS_TABLE_ID;
  const response = await outboundFetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["YardOps Lead ID"] }, records: [{ fields: airtableFields(row) }], typecast: false }),
  }, { provider: "airtable", operation: "yardops_lead_upsert", timeoutMs: 12000, retries: 1, retryable: true });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.records?.[0]?.id) throw new Error(data?.error?.message || `Airtable rejected the lead (${response.status}).`);
  return data.records[0].id;
}

export async function processAirtableQueue(env, limit, submissionId = null) {
  const db = env.DB;
  if (!env.AIRTABLE_API_KEY) return { attempted: 0, synced: 0, pending: true };
  await db.prepare(`UPDATE lead_airtable_sync SET status='queued',updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND status='syncing' AND updated_at<datetime('now','-5 minutes')`).bind(OPWP_ORGANIZATION_ID).run();
  const due = await db.prepare(`SELECT q.submission_id,q.revision,s.id,s.kind,s.source,s.status,s.name,s.email,s.phone,s.zip,s.payload,s.created_at,s.last_activity_at,
      g.stage growth_stage,g.priority,g.owner_email,g.next_action,g.next_action_at,g.outcome_reason,g.outcome_note,
      c.status conversation_status,c.deletion_reason,i.route_guidance,i.route_audited_at,w.payload workspace_payload
    FROM lead_airtable_sync q JOIN submissions s ON s.id=q.submission_id
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=q.organization_id
    LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=q.organization_id
    LEFT JOIN meta_lead_intakes i ON i.submission_id=s.id AND i.organization_id=q.organization_id
    LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key=('lead_workspace:org-opwp:'||s.id)
    WHERE q.organization_id=? AND q.status IN ('queued','failed') AND q.next_attempt_at<=CURRENT_TIMESTAMP AND q.attempt_count<10
      AND (? IS NULL OR q.submission_id=?)
    ORDER BY q.next_attempt_at LIMIT ?`).bind(OPWP_ORGANIZATION_ID, submissionId, submissionId, limit).all();
  let synced = 0; let failed = 0;
  for (const row of due.results || []) {
    const claim = await db.prepare(`UPDATE lead_airtable_sync SET status='syncing',attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP
      WHERE submission_id=? AND organization_id=? AND revision=? AND status IN ('queued','failed')`).bind(row.submission_id, OPWP_ORGANIZATION_ID, row.revision).run();
    if (!Number(claim.meta?.changes || 0)) continue;
    try {
      const recordId = await syncAirtableLead(env, row);
      await db.prepare(`UPDATE lead_airtable_sync SET airtable_record_id=?,status='synced',error_message=NULL,synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND revision=? AND status='syncing'`).bind(recordId, row.submission_id, OPWP_ORGANIZATION_ID, row.revision).run();
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Airtable sync failed.";
      await db.prepare(`UPDATE lead_airtable_sync SET status='failed',error_message=?,next_attempt_at=datetime('now',printf('+%d minutes',MIN(360,attempt_count*attempt_count*5))),updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND revision=? AND status='syncing'`).bind(message.slice(0, 500), row.submission_id, OPWP_ORGANIZATION_ID, row.revision).run();
      console.error(JSON.stringify({ event: "yardops_airtable_sync_failed", submissionId: row.submission_id, message }));
      failed += 1;
    }
  }
  return { attempted: (due.results || []).length, synced, failed };
}

async function processFollowUps(env, limit) {
  const db = env.DB;
  const due = await db.prepare(`SELECT j.*,s.phone,s.payload,s.status submission_status,s.lifecycle_stage,c.last_inbound_at,c.deleted_at,c.automation_mode,g.stage growth_stage
    FROM lead_follow_up_jobs j JOIN submissions s ON s.id=j.submission_id JOIN lead_conversations c ON c.id=j.conversation_id
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=j.organization_id
    WHERE j.organization_id=? AND s.source!='facebook' AND j.status IN ('queued','failed') AND j.due_at<=CURRENT_TIMESTAMP AND j.attempt_count<5
      AND c.status!='deleted' ORDER BY j.due_at LIMIT ?`).bind(OPWP_ORGANIZATION_ID, limit).all();
  let sent = 0; let failed = 0; let skipped = 0;
  for (const row of due.results || []) {
    const settings = await db.prepare(`SELECT assistant_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,time_zone,max_follow_up_touches,human_review_required FROM lead_automation_settings WHERE organization_id=?`).bind(OPWP_ORGANIZATION_ID).first();
    const consent = quoteSummary(row.payload).consent || Boolean(row.last_inbound_at);
    const recipient = normalizePhone(row.phone);
    const suppressed = recipient ? await db.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=? LIMIT 1`).bind(OPWP_ORGANIZATION_ID, await sha256(recipient)).first() : null;
    const localTime = new Intl.DateTimeFormat("en-CA", { timeZone: settings?.time_zone || "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const quiet = Boolean(settings?.quiet_hours_enabled) && (settings.quiet_hours_start > settings.quiet_hours_end
      ? localTime >= settings.quiet_hours_start || localTime < settings.quiet_hours_end
      : localTime >= settings.quiet_hours_start && localTime < settings.quiet_hours_end);
    const converted = row.lifecycle_stage === "converted" || row.submission_status === "converted" || row.growth_stage === "won";
    if (converted || ["lost", "not_qualified"].includes(row.growth_stage) || row.submission_status === "deleted") {
      await db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run();
      skipped += 1; continue;
    }
    if (!settings?.assistant_enabled || settings.human_review_required || row.automation_mode !== "approved" || row.sequence_step > Number(settings.max_follow_up_touches) || !consent || quiet || suppressed?.blocked) { skipped += 1; continue; }
    const claim = await db.prepare(`UPDATE lead_follow_up_jobs SET status='sending',attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed')`).bind(row.id).run();
    if (!Number(claim.meta?.changes || 0)) continue;
    try {
      const providerId = await sendQuoSms(env, row.phone, row.message_body);
      await db.batch([
        db.prepare(`UPDATE lead_follow_up_jobs SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(providerId, row.id),
        db.prepare(`INSERT INTO lead_messages (id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by)
          VALUES (?,?,?,'outbound','quo_sms',?,?,'sent',1,'yardops-automation')`).bind(crypto.randomUUID(), row.conversation_id, OPWP_ORGANIZATION_ID, providerId, row.message_body),
        db.prepare(`UPDATE lead_conversations SET status='waiting',last_outbound_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.conversation_id),
      ]);
      sent += 1;
    } catch (error) {
      await db.prepare(`UPDATE lead_follow_up_jobs SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(error instanceof Error ? error.message : "delivery failed").slice(0, 500), row.id).run();
      failed += 1;
    }
  }
  return { attempted: (due.results || []).length, sent, failed, skipped };
}

async function markNoResponseLeads(env, limit) {
  const db = env.DB;
  const settings = await db.prepare(`SELECT assistant_enabled,human_review_required,max_follow_up_touches
    FROM lead_automation_settings WHERE organization_id=?`).bind(OPWP_ORGANIZATION_ID).first();
  if (!settings?.assistant_enabled || settings.human_review_required || Number(settings.max_follow_up_touches) < 1) {
    return { reviewed: 0, marked: 0, enabled: false };
  }
  const candidates = await db.prepare(`SELECT s.id,c.id conversation_id,c.status conversation_status,c.automation_mode,c.last_inbound_at,
      COALESCE(g.stage,'new') growth_stage,final.sequence_step final_sequence_step,final.sent_at final_sent_at,
      EXISTS(SELECT 1 FROM lead_follow_up_jobs pending WHERE pending.submission_id=s.id AND pending.organization_id=?
        AND pending.status IN ('queued','failed','sending')) has_pending_follow_ups
    FROM submissions s
    JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=?
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
    JOIN lead_follow_up_jobs final ON final.id=(
      SELECT sent.id FROM lead_follow_up_jobs sent
      WHERE sent.submission_id=s.id AND sent.organization_id=? AND sent.status='sent'
      ORDER BY sent.sequence_step DESC,sent.sent_at DESC LIMIT 1
    )
    WHERE s.source!='facebook' AND s.status!='deleted' AND COALESCE(s.lifecycle_stage,'')!='converted'
      AND COALESCE(g.stage,'new') IN ('new','contacted','qualified','quoted')
      AND c.status='waiting' AND c.automation_mode='approved'
      AND final.sequence_step>=? AND datetime(final.sent_at)<=datetime('now','-48 hours')
      AND (c.last_inbound_at IS NULL OR datetime(c.last_inbound_at)<=datetime(final.sent_at))
      AND NOT EXISTS(SELECT 1 FROM lead_follow_up_jobs active WHERE active.submission_id=s.id AND active.organization_id=?
        AND active.status IN ('queued','failed','sending'))
    ORDER BY final.sent_at LIMIT ?`).bind(OPWP_ORGANIZATION_ID, OPWP_ORGANIZATION_ID, OPWP_ORGANIZATION_ID, OPWP_ORGANIZATION_ID,
      Number(settings.max_follow_up_touches), OPWP_ORGANIZATION_ID, limit).all();
  let marked = 0;
  for (const row of candidates.results || []) {
    const eligible = shouldMarkNotQualifiedForNoResponse({
      settings: {
        assistantEnabled: Boolean(settings.assistant_enabled),
        humanReviewRequired: Boolean(settings.human_review_required),
        maxFollowUpTouches: Number(settings.max_follow_up_touches),
      },
      lead: {
        stage: row.growth_stage,
        automationMode: row.automation_mode,
        conversationStatus: row.conversation_status,
        lastInboundAt: row.last_inbound_at,
        hasPendingFollowUps: Boolean(row.has_pending_follow_ups),
      },
      finalFollowUp: { sequenceStep: Number(row.final_sequence_step), sentAt: row.final_sent_at },
    });
    if (!eligible) continue;
    const state = await db.prepare(`INSERT INTO growth_leads
        (submission_id,organization_id,stage,priority,outcome_reason,outcome_note,not_qualified_at,updated_by)
      VALUES (?,?,'not_qualified','normal','no_response','No response 48 hours after the final approved follow-up.',CURRENT_TIMESTAMP,'yardops-automation')
      ON CONFLICT(submission_id) DO UPDATE SET stage='not_qualified',next_action=NULL,next_action_at=NULL,
        outcome_reason='no_response',outcome_note='No response 48 hours after the final approved follow-up.',
        converted_at=NULL,lost_at=NULL,not_qualified_at=CURRENT_TIMESTAMP,version=growth_leads.version+1,
        updated_by='yardops-automation',updated_at=CURRENT_TIMESTAMP
      WHERE growth_leads.stage IN ('new','contacted','qualified','quoted')`).bind(row.id, OPWP_ORGANIZATION_ID).run();
    if (!Number(state.meta?.changes || 0)) continue;
    await db.batch([
      db.prepare(`UPDATE lead_conversations SET status='resolved',automation_mode='paused',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=? AND status='waiting'`).bind(row.conversation_id, OPWP_ORGANIZATION_ID),
      db.prepare(`INSERT INTO growth_lead_events
        (id,submission_id,organization_id,event_type,summary,details,actor_email)
        VALUES (?,?,?,'system','Lead marked Not Qualified after no response',?,'yardops-automation')`)
        .bind(crypto.randomUUID(), row.id, OPWP_ORGANIZATION_ID, JSON.stringify({ reason: "no_response", graceHours: 48, finalFollowUpAt: row.final_sent_at })),
    ]);
    await queueLeadSync(db, row.id);
    marked += 1;
  }
  return { reviewed: (candidates.results || []).length, marked, enabled: true };
}

export async function runScheduledYardOps(env, limit = 10) {
  if (!env?.DB) return { configured: false };
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  await initializeMetaResponseLibrary(env.DB);
  await reconcileQuoReceipts(env.DB);
  const conversions = await reconcileMetaConversions(env.DB);
  const meta = await processMetaConfirmations(env, { limit: safeLimit });
  const metaNoResponse = await markMetaNoResponse(env);
  const followUps = await processFollowUps(env, safeLimit);
  const noResponse = await markNoResponseLeads(env, safeLimit);
  const airtable = await processAirtableQueue(env, safeLimit);
  return { configured: true, airtable, followUps, noResponse, meta, metaNoResponse, conversions };
}

async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function automaticAnswer(lead, match) {
  const quote = quoteSummary(lead.payload);
  const source = payload(lead.payload);
  if (match.response_mode === "pricing") {
    if (quote.monthly === null) return "";
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(quote.monthly);
    const frequency = title(quote.frequency).toLowerCase();
    return `Your saved Ohio Pet Waste Pros quote is ${amount} per month${frequency ? ` for ${frequency} service` : ""}. I can also help with scheduling or signup questions.`;
  }
  if (match.response_mode === "service_day") {
    const days = allowedOperationalDays({ city: source.city || "", zip: lead.zip, frequency: title(quote.frequency) });
    return days.length === 1
      ? `Your current Ohio Pet Waste Pros route option is ${days[0]}. We confirm the final service day when signup is completed.`
      : "Service days are route-based. We confirm the best available weekday for your ZIP and service frequency during signup.";
  }
  return match.answer_template;
}

export async function recordInboundQuoMessage(db, env, event) {
  const phone = normalizePhone(event.from);
  if (!phone) throw new Error("Inbound Quo phone number is invalid.");
  const lastTen = phone.slice(-10);
  const replyBranch = classifyMetaReply(event.text);
  const stopped = isStopMessage(event.text) || ["opted_out", "wrong_number"].includes(replyBranch);
  let leadCreated = false;
  const ignored = (reason) => ({ submissionId: null, stopped, autoReplied: false, leadCreated: false, ignoredReason: reason });
  // Honor opt-outs even when the sender has never entered the sales funnel.
  if (stopped) await db.prepare(`INSERT INTO lead_suppressions (organization_id,phone_hash,reason,source,created_by)
    VALUES (?,?,?,'quo_webhook','quo-webhook')
    ON CONFLICT(organization_id,phone_hash) DO UPDATE SET reason=excluded.reason,source=excluded.source,created_by=excluded.created_by`)
    .bind(OPWP_ORGANIZATION_ID, await sha256(phone), replyBranch === "wrong_number" ? "wrong_number" : "opted_out").run();
  let submission = await db.prepare(`SELECT s.id,g.stage growth_stage,g.outcome_reason FROM submissions s
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
    WHERE s.kind IN ('partial_quote','question','waitlist','onboarding')
      AND s.status NOT IN ('deleted','converted','synced') AND COALESCE(s.lifecycle_stage,'')!='converted'
      AND COALESCE(g.stage,'new') NOT IN ('won','lost')
      AND COALESCE(g.outcome_reason,'')!='not_a_lead'
      AND substr(replace(replace(replace(replace(replace(phone,'+',''),'(',''),')',''),'-',''),' ',''),-10)=?
    ORDER BY COALESCE(s.last_activity_at,s.created_at) DESC LIMIT 1`).bind(OPWP_ORGANIZATION_ID, lastTen).first();
  if (submission) {
    const duplicate = await db.prepare(`SELECT i.duplicate_of FROM meta_lead_intakes i JOIN submissions s ON s.id=i.duplicate_of
      WHERE i.submission_id=? AND i.organization_id=? AND s.status NOT IN ('deleted','converted') AND COALESCE(s.lifecycle_stage,'')!='converted'`).bind(submission.id, OPWP_ORGANIZATION_ID).first();
    if (duplicate?.duplicate_of) submission = { ...submission, id: duplicate.duplicate_of };
  }
  if (!submission) {
    const intent = classifyQuoLeadIntent(event.text);
    if (!intent.eligible) return ignored(intent.reason);
    const suppressed = await db.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=? LIMIT 1`)
      .bind(OPWP_ORGANIZATION_ID, await sha256(phone)).first();
    if (suppressed?.blocked) return ignored("suppressed");
    const recentCustomer = await db.prepare(`SELECT 1 matched FROM sng_events
      WHERE received_at>=datetime('now','-45 days') AND payload LIKE ?
        AND event_type IN ('job:started','notification:completed_job_notification','notification:on_the_way_notification',
          'client:invoice_finalized','client:subscription_created','client:client_assigned','client:client_onboarding_recurring')
      LIMIT 1`).bind(`%${lastTen}%`).first();
    if (recentCustomer?.matched) {
      return ignored("existing_customer");
    }
    const activeCustomer = await checkQuoCustomerDirectory(phone, (path) => sngPaginatedRequest(path, { maxPages: 50, perPage: 100 }));
    if (activeCustomer) {
      return ignored("existing_customer");
    }
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO submissions
      (id,kind,source,status,phone,payload,lifecycle_stage,sng_sync_state,last_activity_at)
      VALUES (?,'question','quo','new',?,?,'details_started','not_attempted',CURRENT_TIMESTAMP)`
    ).bind(id, phone, JSON.stringify({ source: "quo_inbound", phone, question: event.text, intake: { version: 2, reason: intent.reason } })).run();
    leadCreated = true;
    await queueLeadSync(db, id, "quo_sms");
    submission = { id };
  }
  const conversation = await ensureConversation(db, submission.id, "quo_sms");
  const existingMessage = await db.prepare(`SELECT id FROM lead_messages WHERE provider_message_id=? AND organization_id=? AND channel='quo_sms'`).bind(event.providerMessageId, OPWP_ORGANIZATION_ID).first();
  if (existingMessage) {
    await recordMetaReply(db, submission.id, event, { refreshRouting: () => ensureFreshAirtableCockpitSnapshot(env, 15) });
    return { submissionId: submission.id, stopped, leadCreated: false, autoReplied: false };
  }
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO lead_messages
      (id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,created_at)
      VALUES (?,?,?,'inbound','quo_sms',?,?,'delivered',0,'quo-webhook',COALESCE(?,CURRENT_TIMESTAMP))
      `).bind(crypto.randomUUID(), conversation.id, OPWP_ORGANIZATION_ID, event.providerMessageId, event.text, event.createdAt || null),
    db.prepare(`UPDATE lead_conversations SET channel='quo_sms',external_thread_id=COALESCE(?,external_thread_id),status=CASE WHEN ? THEN 'resolved' ELSE 'open' END,
      automation_mode=CASE WHEN ? THEN 'paused' ELSE automation_mode END,unread_count=unread_count+1,
      last_inbound_at=COALESCE(?,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
      .bind(event.conversationId || null, stopped ? 1 : 0, stopped ? 1 : 0, event.createdAt || null, conversation.id, OPWP_ORGANIZATION_ID),
    db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND status IN ('queued','failed')`).bind(conversation.id),
    db.prepare(`UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed')`).bind(submission.id),
    db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed','sending')`).bind(submission.id),
    db.prepare(`UPDATE submissions SET last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(submission.id),
  ];
  if (stopped) statements.push(
    db.prepare(`INSERT INTO lead_suppressions (organization_id,phone_hash,reason,source,created_by)
      VALUES (?,?,'Customer replied STOP','quo_webhook','quo-webhook')
      ON CONFLICT(organization_id,phone_hash) DO UPDATE SET reason=excluded.reason,source=excluded.source,created_by=excluded.created_by`).bind(OPWP_ORGANIZATION_ID, await sha256(phone)),
    db.prepare(`INSERT INTO growth_leads
        (submission_id,organization_id,stage,priority,outcome_reason,outcome_note,not_qualified_at,updated_by)
      VALUES (?,?,'not_qualified','normal','opted_out','Customer opted out through Quo.',CURRENT_TIMESTAMP,'quo-webhook')
      ON CONFLICT(submission_id) DO UPDATE SET stage='not_qualified',next_action=NULL,next_action_at=NULL,
        outcome_reason='opted_out',outcome_note='Customer opted out through Quo.',converted_at=NULL,lost_at=NULL,
        not_qualified_at=CURRENT_TIMESTAMP,version=growth_leads.version+1,updated_by='quo-webhook',updated_at=CURRENT_TIMESTAMP
      WHERE growth_leads.stage!='won'`).bind(submission.id, OPWP_ORGANIZATION_ID),
    db.prepare(`INSERT INTO growth_lead_events
      (id,submission_id,organization_id,event_type,summary,details,actor_email)
      VALUES (?,?,?,'system','Lead marked Not Qualified after opt-out',?,'quo-webhook')`)
      .bind(crypto.randomUUID(), submission.id, OPWP_ORGANIZATION_ID, JSON.stringify({ reason: "opted_out", provider: "quo" })),
  );
  else statements.push(
    db.prepare(`UPDATE growth_leads SET stage='contacted',outcome_reason=NULL,outcome_note=NULL,not_qualified_at=NULL,
      version=version+1,updated_by='quo-webhook',updated_at=CURRENT_TIMESTAMP
      WHERE submission_id=? AND organization_id=? AND stage='not_qualified' AND outcome_reason='no_response'`)
      .bind(submission.id, OPWP_ORGANIZATION_ID),
  );
  await db.batch(statements);
  const metaHandled = await recordMetaReply(db, submission.id, event, { refreshRouting: () => ensureFreshAirtableCockpitSnapshot(env, 15) });
  await queueLeadSync(db, submission.id, "quo_sms");

  let autoReply = null;
  if (!metaHandled && !stopped && !(submission.growth_stage === "not_qualified" && submission.outcome_reason === "opted_out")) {
    const [settings, current, answers] = await Promise.all([
      db.prepare(`SELECT assistant_enabled,human_review_required FROM lead_automation_settings WHERE organization_id=?`).bind(OPWP_ORGANIZATION_ID).first(),
      getLeadRecord(db, submission.id),
      db.prepare(`SELECT answer_key,answer_template,keywords,response_mode,auto_send_allowed FROM lead_answer_library WHERE organization_id=? AND approval_status='approved'`).bind(OPWP_ORGANIZATION_ID).all(),
    ]);
    const match = findAnswerMatch(event.text, answers.results || []);
    const response = match ? automaticAnswer(current, match) : "";
    if (settings?.assistant_enabled && !settings.human_review_required && current?.automation_mode === "approved" && match?.auto_send_allowed && response) {
      autoReply = await sendLeadMessage(db, env, current, response, "yardops-automation", true);
      if (match.response_mode === "handoff") await setLeadAutomation(db, current, "paused", "yardops-automation");
    }
  }
  return { submissionId: submission.id, stopped, leadCreated, autoReplied: Boolean(autoReply) };
}
