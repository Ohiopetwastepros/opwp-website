import {FAQ_TEMPLATES, FAQ_LIBRARY_PREFIX, faqAnswerKey, seedPlaybookFaqLibrary} from './lead-playbook-faq.mjs';
import { playbookEnabled, nextPlaybookResponse, classifyPlaybookRules, renderPlaybookTemplate, leadPlaybookDetails, matchesAuditedPlaybookLocation, PLAYBOOK_POLICY_VERSION } from "./lead-playbook.mjs";
import { PRICING_VERSION } from "./lead-pricing.mjs";
import { normalizePhone } from "./lead-assistant.mjs";
import { formatCustomerSms } from "./customer-sms.mjs";
import { normalizeQuoMessageEvent } from "./quo-webhook.mjs";
import { quoLearningScope, resolveQuoAuthor, isQuoSonaAuthor } from "./playbook-ownership.mjs";
import { redactPlaybookText, redactPlaybookSlots, redactInboundPaymentDetails, hashExternalRef } from "./playbook-redaction.mjs";
import { prefillIntake } from "./lead-inbox.mjs";
import {notifyPlaybookOwner, queuePlaybookOwnerNotice, flushPlaybookOwnerNotices, playbookOwnerNoticeReasonAllowed,isPlaybookOwnerNotificationReceipt} from './lead-playbook-notifications.mjs';
import {controlledLeadRecipientAllowed as allowedLeadTestRecipient,controlledLeadTestRecipient} from './lead-rollout-policy.mjs';
import {evaluatePlaybookCustomerAdmission} from './lead-playbook-customer-policy.mjs';
import {claimEarlyAutomatedLeadReceipt} from './lead-playbook-receipts.mjs';

const ORG = "org-opwp";
const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const changes = result => Number(result?.meta?.changes || 0);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
const normalizedRouteAddress = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
function withManualReviewDraft(decision){
  if(decision.body||!decision.escalate||decision.staffOnly)return decision;
  // This acknowledgement is a suggestion for Craig to edit/approve. It has no
  // approved-template key and zero confidence, so it cannot use the auto path.
  return {...decision,confidence:0,templateKey:null,answerKey:null,body:formatCustomerSms("Thanks for your message. I'll review your question and text you personally.")};
}
async function deferCustomerReview(db, env, conversationId, submissionId, reason, {inboundMessageId=null,notificationOptions={},now=new Date()}={}) {
  const eventKey = 'directory-review:' + conversationId + ':' + reason + ':' + (inboundMessageId || 'intro');
  // Queue before recording the receipt so a storage failure can be retried.
  await queuePlaybookOwnerNotice(db,env,{kind:'lead_review',submissionId,conversationId,eventKey});
  const previous = await db.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=? AND organization_id=?').bind(conversationId, ORG).first();
  const next = JSON.stringify({ ...parse(previous?.state_json), stage: "escalated", escalation_reason: reason,...(inboundMessageId?{last_inbound_message_id:inboundMessageId}:{}) });
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO lead_playbook_state(conversation_id,submission_id,stage,state_json) VALUES (?,?,'escalated',?)`).bind(conversationId, submissionId, next),
    db.prepare(`UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage='escalated',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=?`).bind(next, conversationId, ORG),
    db.prepare(`UPDATE lead_reply_drafts SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status IN ('pending','approved','edited_approved')`).bind(conversationId, ORG),
    db.prepare(`UPDATE growth_leads SET next_action='Office: review the protected customer request before any playbook reply',next_action_at=CURRENT_TIMESTAMP,priority='high',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(submissionId, ORG),
  ]);
  // Customer matching failures must remain held, but they still need an
  // actionable owner alert. Duplicate events share one durable channel pair.
  await flushPlaybookOwnerNotices(db,env,{...notificationOptions,now,eventKey});
  return { escalated: true, reason };
}

async function matchLead(db, phone) {
  return db.prepare(`SELECT s.*,c.id conversation_id,c.owner,c.automation_mode,c.status conversation_status,c.channel conversation_channel,
    EXISTS(SELECT 1 FROM meta_lead_intakes i WHERE i.submission_id=s.id AND i.organization_id=c.organization_id) facebook_lead FROM submissions s
    JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=?
    WHERE s.status NOT IN ('deleted','trashed') AND c.status!='deleted'
    AND substr(replace(replace(replace(replace(replace(s.phone,'+',''),'(',''),')',''),'-',''),' ',''),-10)=?
    ORDER BY COALESCE(s.last_activity_at,s.created_at) DESC LIMIT 1`).bind(ORG, normalizePhone(phone).slice(-10)).first();
}

async function learningTurn(db, env, event, { sourceId, kind, participant, channel, author, lead = null, excludedReason = null }) {
  const secret = env.LEAD_PLAYBOOK_HASH_KEY || env.QUO_WEBHOOK_SIGNING_KEY || env.META_APP_SECRET;
  if (!secret || secret.length < 32) return { skipped: "learning_hash_key_missing" };
  const ref = await hashExternalRef(`${sourceId}:${participant}`, secret);
  const threadId = `playbook:${sourceId}:${ref}`;
  const sourcePayload = parse(lead?.payload);
  const redaction = { names: [lead?.name, ...String(lead?.name || "").split(/\s+/).filter(name => name.length > 1), sourcePayload.first_name, sourcePayload.last_name, sourcePayload.firstName, sourcePayload.lastName].filter(Boolean), addresses: [sourcePayload.address, sourcePayload.home_address, sourcePayload.street_address].filter(Boolean), phones: [participant, lead?.phone].filter(Boolean), emails: [lead?.email].filter(Boolean) };
  const classification = event.direction === "inbound" && env.LEAD_CONVERSATION_V2_ENABLED !== 'true' ? classifyPlaybookRules(event.text) : null;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO playbook_sources(id,kind,notes) VALUES (?,?,?)`).bind(sourceId, kind, "Live record-only capture. Unknown authors remain Sona; identity mapping requires review."),
    db.prepare(`INSERT INTO playbook_threads(id,source_id,external_ref_hash,channel,first_at,last_at,lead_submission_id,is_business,excluded_reason)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,external_ref_hash) DO UPDATE SET
      first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at),lead_submission_id=COALESCE(lead_submission_id,excluded.lead_submission_id),is_business=MAX(is_business,excluded.is_business)`)
      .bind(threadId, sourceId, ref, channel, event.createdAt || new Date().toISOString(), event.createdAt || new Date().toISOString(), lead?.id || null, lead ? 1 : 0, excludedReason),
    db.prepare(`INSERT INTO playbook_turns(id,thread_id,direction,author,provider_message_id,body_redacted,created_at,intent,slots_json)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id,provider_message_id) DO UPDATE SET author=CASE WHEN excluded.author='sona' THEN 'sona' ELSE playbook_turns.author END`).bind(`turn:${await digest(`${sourceId}:${event.providerMessageId}`)}`, threadId, event.direction, author, event.providerMessageId, redactPlaybookText(event.text, redaction), event.createdAt || new Date().toISOString(), classification?.intent || null, JSON.stringify(redactPlaybookSlots(classification?.slots || {}))),
  ]);
  return { recorded: true };
}

export async function recordPlaybookQuoEvent(db, env, event) {
  if (event.direction === 'inbound') event = {...event, text: redactInboundPaymentDetails(event.text)};
  if (!playbookEnabled(env)) return { disabled: true };
  const scope = quoLearningScope(env, event);
  if (!scope.allowed || event.isGroup) return { skipped: "outside_single_contact_scope" };
  const phone = normalizePhone(event.direction === "inbound" ? event.from : event.to);
  if (!phone) return { skipped: "invalid_participant" };
  const structured = env.LEAD_CONVERSATION_V2_ENABLED === 'true';
  if (!structured && (phone === normalizePhone(env.LEAD_PLAYBOOK_CRAIG_CELL) || /\/admin\/playbook\/d\//i.test(event.text))) return { skipped: "owner_notification" };
  if (await isPlaybookOwnerNotificationReceipt(db,env,event)) {
    if (structured) {
      const notice = await db.prepare("SELECT conversation_id FROM lead_playbook_owner_notifications WHERE organization_id=? AND provider_message_id=? AND channel='sms' LIMIT 1").bind(ORG,event.providerMessageId).first();
      if (notice) await db.prepare("INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author,created_at) VALUES (?,?,?,'internal','manual',?,?,'delivered',1,'playbook-owner-notice','backend',?)")
        .bind('staff-notice:'+event.providerMessageId,notice.conversation_id,ORG,event.providerMessageId,event.text,event.createdAt || new Date().toISOString()).run();
    }
    return { skipped: "owner_notification" };
  }
  const lead = scope.learningOnly ? null : await matchLead(db, phone);
  const earlyBackendReceipt = structured && lead && event.direction === 'outbound' ? await claimEarlyAutomatedLeadReceipt(db,env,event) : false;
  if (event.direction === "inbound" && lead) await db.prepare(`INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author,created_at)
    VALUES (?,?,?,'inbound','quo_sms',?,?,'delivered',0,'playbook-reconcile','lead',?)`).bind(crypto.randomUUID(), lead.conversation_id, ORG, event.providerMessageId, event.text, event.createdAt || new Date().toISOString()).run();
  const draft = event.direction === "outbound" && lead ? await db.prepare(`SELECT * FROM lead_reply_drafts WHERE conversation_id=? AND organization_id=?
    AND (provider_message_id=? OR (status IN ('pending','approved','edited_approved','sending') AND (body=? OR final_body=?))) ORDER BY created_at DESC LIMIT 1`)
    .bind(lead.conversation_id, ORG, event.providerMessageId, formatCustomerSms(event.text), formatCustomerSms(event.text)).first() : null;
  const known = event.direction === "outbound" && lead ? await db.prepare(`SELECT automated,created_by,author FROM lead_messages WHERE provider_message_id=? AND organization_id=?`).bind(event.providerMessageId, ORG).first() : null;
  const knownBackend = Boolean(earlyBackendReceipt || known?.automated || known?.author === 'backend' || draft?.provider_message_id === event.providerMessageId);
  const humanIds = String(env.QUO_HUMAN_USER_IDS || '').split(',').map(value=>value.trim()).filter(Boolean);
  const explicitHuman = structured && !isQuoSonaAuthor(event,env) && !knownBackend && (
    [event.userId,...(event.userIds || [])].some(id=>id && humanIds.includes(id)) ||
    [event.authorType,...(event.authorTypes || [])].some(type=>/^(human|user|manual|agent|staff)$/i.test(String(type || '')))
  );
  const resolved = explicitHuman ? 'craig' : resolveQuoAuthor(event, env, { approvedDraft: structured ? knownBackend : Boolean(draft?.provider_message_id === event.providerMessageId || draft && ["approved", "edited_approved", "sending", "sent"].includes(draft.status)), knownBackend });
  const explicitSona = isQuoSonaAuthor(event, env);
  const author = explicitSona ? "sona" : known?.author === "craig" ? "craig" : resolved;
  if (event.direction === "outbound" && lead) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author,created_at)
        VALUES (?,?,?,'outbound','quo_sms',?,?,'delivered',?,?,?,?)`).bind(crypto.randomUUID(), lead.conversation_id, ORG, event.providerMessageId, event.text, author === "backend" ? 1 : 0, `quo-${author}`, author, event.createdAt || new Date().toISOString()),
      db.prepare(`UPDATE lead_messages SET author=?,delivery_status='delivered' WHERE provider_message_id=? AND organization_id=?`).bind(author, event.providerMessageId, ORG),
      // Backend receipts may arrive after takeover. They never restore an owner
      // copied from this function's earlier snapshot.
      db.prepare(`UPDATE lead_conversations SET last_outbound_at=CASE WHEN last_outbound_at IS NULL OR last_outbound_at<? THEN ? ELSE last_outbound_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(event.createdAt || new Date().toISOString(), event.createdAt || new Date().toISOString(), lead.conversation_id, ORG),
    ]);
    // A duplicate historical receipt cannot undo a later manual handback. New
    // explicit Sona metadata may refine the same message conservatively, subject
    // to the same ordering guard. Sona wins an equal-time provider tie; explicit
    // admin actions use priority 3 and remain authoritative for that instant.
    // Facebook form threads stay under backend/Craig control. Sona or unknown
    // authorship is recorded as Sona, but never hands this sales thread to Sona.
    const facebook = lead.facebook_lead || lead.conversation_channel === 'facebook_lead';
    const applyOwnership = !(facebook && author === 'sona') && (!known?.author || explicitSona && known.author !== "sona") && author !== "backend" && !(author === "craig" && draft && !structured);
    if (applyOwnership) {
      const now = Date.now(), parsedAt = Date.parse(event.createdAt || ""), ordered = Number.isFinite(parsedAt) && parsedAt >= 0 && parsedAt <= now + 60000;
      const owner = ordered ? author : "sona", at = new Date(ordered ? parsedAt : now).toISOString(), priority = owner === "sona" ? 2 : 1;
      await db.prepare(`UPDATE lead_conversations SET owner=?,owner_event_at=?,owner_event_id=?,owner_event_priority=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=? AND (owner_event_at<? OR (owner_event_at=? AND (owner_event_priority<? OR (owner_event_priority=? AND owner_event_id<?))))`)
        .bind(owner, at, event.providerMessageId, priority, lead.conversation_id, ORG, at, at, priority, priority, event.providerMessageId).run();
      if (structured && owner === 'craig') {
        await db.batch([
          db.prepare("UPDATE lead_conversations SET automation_mode='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND owner='craig' AND owner_event_id=?").bind(lead.conversation_id,ORG,event.providerMessageId),
          db.prepare("UPDATE lead_reply_drafts SET status='superseded',rejection_reason='manual_quo_takeover',updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status IN ('pending','approved','edited_approved') AND EXISTS(SELECT 1 FROM lead_conversations WHERE id=? AND owner='craig' AND owner_event_id=?)").bind(lead.conversation_id,ORG,lead.conversation_id,event.providerMessageId),
        ]);
      }
    }
    // A manually sent exact draft must not remain available to send a second time.
    if (draft && author !== "sona" && draft.status !== "sent" && (!structured || author === 'backend' && draft.status !== 'sending')) {
      const claim = await db.prepare(`UPDATE lead_reply_drafts SET status='sent',provider_message_id=?,final_body=COALESCE(final_body,body),approver=COALESCE(approver,'quo-exact-draft'),updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('pending','approved','edited_approved','sending')`).bind(event.providerMessageId, draft.id).run();
      if (changes(claim)) await db.prepare(`UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND state_json=?`)
        .bind(draft.state_json, parse(draft.state_json).stage || "intro_sent", lead.conversation_id, draft.prior_state_json).run();
    }
  }
  return learningTurn(db, env, event, { sourceId: scope.learningOnly ? "live-quo-learning" : "live-quo-business", kind: "live_quo", participant: phone, channel: "quo_sms", author, lead, excludedReason: lead ? null : "unmatched_learning_only" });
}

export async function recordPlaybookMetaEvent(db, env, event) {
  if (!playbookEnabled(env)) return { disabled: true };
  return learningTurn(db, env, event, { sourceId: `live-${event.kind}-${event.account}`, kind: event.kind, participant: event.participant, channel: event.kind, author: event.author, excludedReason: "unmatched_record_only" });
}

async function finishPreparedDraft(db,env,result,decision,{sender,loadCustomerDirectory,textSafety,now=new Date(),notificationOptions={}}={}){
  if(!result.draft)return result;
  const {sendVerifiedPlaybookDraft,notifyPlaybookDraft}=await import('./lead-playbook-service.js');
  const delivery=await sendVerifiedPlaybookDraft(db,env,result.draft.id,{sender,loadCustomerDirectory,textSafety,now});
  if(decision.staffEventKeys?.length) {
    for(const eventKey of decision.staffEventKeys)await flushPlaybookOwnerNotices(db,env,{...notificationOptions,now,eventKey});
  } else if(decision.staffEventKey) await flushPlaybookOwnerNotices(db,env,{...notificationOptions,now,eventKey:decision.staffEventKey});
  else if(delivery.status==='pending') await notifyPlaybookDraft(db,env,result.draft.id,{...notificationOptions,now}).catch(()=>({deferred:true}));
  if(delivery.needsReview&&delivery.status!=='pending')await notifyPlaybookOwner(db,env,{kind:'lead_review',submissionId:result.draft.submission_id,conversationId:result.draft.conversation_id,eventKey:`delivery-review:${result.draft.id}`},{...notificationOptions,now}).catch(()=>({deferred:true}));
  return {...result,delivery,escalated:Boolean(decision.escalate),reason:decision.reason,draft:await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=?').bind(result.draft.id).first()};
}

// The Worker has no durable local filesystem. Save each requested pause in the
// private staff queue consumed by the winter-pause-list.csv export. Staff own
// the actual Sweep&Go pause, any extension and the March call.
async function recordWinterPause(db, {lead, conversationId, submissionId, inboundId, occurredAt, text, followUp}) {
  const time = new Date(occurredAt);
  if (!Number.isFinite(time.getTime())) return;
  const eastern = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year:'numeric', month:'numeric'}).formatToParts(time).map(part => [part.type,part.value]));
  const plannedRestart = 'March ' + (Number(eastern.year) + (Number(eastern.month) > 3 ? 1 : 0));
  const date = String(text || '').match(/\b(?:start(?:ing)?|effective|begin(?:ning)?|from|as of)\s+(?:on\s+)?((?:20\d\d-\d\d-\d\d)|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?)|(?:today|tomorrow|next week))\b/i);
  const replyDate = followUp && String(text || '').match(/^\s*((?:20\d\d-\d\d-\d\d)|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?)|(?:today|tomorrow|next week))[.!\s]*$/i);
  const rawStart = date?.[1] || replyDate?.[1] || '';
  if (followUp && !rawStart) return;
  const localDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
  let pauseStart = rawStart;
  if (/^(?:today|tomorrow)$/i.test(rawStart)) {
    const calendar = new Date(localDate + 'T12:00:00Z');
    if (rawStart.toLowerCase() === 'tomorrow') calendar.setUTCDate(calendar.getUTCDate() + 1);
    pauseStart = calendar.toISOString().slice(0,10);
  } else if (/^next week$/i.test(rawStart)) pauseStart = 'Next week (requested ' + localDate + ')';
  const key = 'winter_pause:' + ORG + ':' + conversationId, stamp = time.toISOString();
  if (followUp) {
    // Staff may already have completed or amended this task. A date reply can
    // fill the requested start while pending but cannot reopen the request.
    await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.pauseStart',?,'$.updatedAt',?,'$.inboundMessageId',?),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND json_extract(payload,'$.status')='staff_review' AND json_extract(payload,'$.updatedAt')<=? AND json_extract(payload,'$.inboundMessageId')!=?")
      .bind(pauseStart,stamp,inboundId,key,stamp,inboundId).run();
    return;
  }
  const entry = {conversationId,submissionId,name:lead.name || '',phone:normalizePhone(lead.phone),pauseStart,plannedRestart,status:'staff_review',requestedAt:stamp,updatedAt:stamp,inboundMessageId:inboundId};
  await db.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload) VALUES (?,?) ON CONFLICT(snapshot_key) DO UPDATE SET payload=CASE WHEN json_extract(airtable_cockpit_snapshots.payload,'$.status')='staff_review' AND json_extract(airtable_cockpit_snapshots.payload,'$.plannedRestart')=json_extract(excluded.payload,'$.plannedRestart') THEN json_set(airtable_cockpit_snapshots.payload,'$.pauseStart',COALESCE(NULLIF(json_extract(excluded.payload,'$.pauseStart'),''),json_extract(airtable_cockpit_snapshots.payload,'$.pauseStart'),''),'$.updatedAt',json_extract(excluded.payload,'$.updatedAt'),'$.inboundMessageId',json_extract(excluded.payload,'$.inboundMessageId')) ELSE excluded.payload END,updated_at=CURRENT_TIMESTAMP WHERE json_extract(airtable_cockpit_snapshots.payload,'$.updatedAt')<=json_extract(excluded.payload,'$.updatedAt') AND json_extract(airtable_cockpit_snapshots.payload,'$.inboundMessageId')!=json_extract(excluded.payload,'$.inboundMessageId')")
    .bind(key,JSON.stringify(entry)).run();
}

export async function processPlaybookInbound(db, env, { conversationId, submissionId, event }, { sender,loadCustomerDirectory,textSafety,now=new Date(),notificationOptions={},classifierOptions={},replyOptions={},serviceArea } = {}) {
  if (!playbookEnabled(env)) return { disabled: true };
  const structured = env.LEAD_CONVERSATION_V2_ENABLED === 'true';
  event = {...event, text: redactInboundPaymentDetails(event.text)};
  const conversation = await db.prepare(`SELECT * FROM lead_conversations WHERE id=? AND submission_id=? AND organization_id=?`).bind(conversationId, submissionId, ORG).first();
  if (!conversation) return { skipped: "conversation_missing" };
  const facebook = conversation.channel === 'facebook_lead' || await db.prepare('SELECT 1 found FROM meta_lead_intakes WHERE submission_id=? AND organization_id=?').bind(submissionId,ORG).first();
  if (!facebook && conversation.owner === "backend" && !conversation.last_outbound_at) {
    // An inbound-first thread belongs to Sona, even if a form exists. The
    // backend must have actually started the conversation to own its replies.
    await db.prepare(`UPDATE lead_conversations SET owner='sona',updated_at=CURRENT_TIMESTAMP WHERE id=? AND last_outbound_at IS NULL`).bind(conversationId).run();
    conversation.owner = "sona";
  }
  const lead = await db.prepare(`SELECT s.*,w.payload workspace_payload,i.route_guidance,i.route_audited_at,i.response_state meta_response_state FROM submissions s
    LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key=('lead_workspace:org-opwp:'||s.id)
    LEFT JOIN meta_lead_intakes i ON i.submission_id=s.id AND i.organization_id=? WHERE s.id=?`).bind(ORG, submissionId).first();
  await recordPlaybookQuoEvent(db, env, { ...event, direction: "inbound" });
  if (conversation.owner !== "backend" || !lead || ["deleted", "trashed", "converted", "synced"].includes(lead.status) || lead.lifecycle_stage === "converted") return { skipped: "owner_or_closed" };
  if (structured && !['suggest','approved'].includes(conversation.automation_mode)) return {skipped:'automation_paused'};
  if (!allowedLeadTestRecipient(env,lead.phone)) return {skipped:'controlled_test_recipient'};
  const inbound = await db.prepare(`SELECT id FROM lead_messages WHERE provider_message_id=? AND conversation_id=? AND organization_id=?`).bind(event.providerMessageId, conversationId, ORG).first();
  if (!inbound) return { skipped: "inbound_not_persisted" };
  const existingDraft = await db.prepare(`SELECT id FROM lead_reply_drafts WHERE conversation_id=? AND inbound_message_id=?`).bind(conversationId, inbound.id).first();
  if (existingDraft) return { duplicate: true };
  const workspace = parse(lead.workspace_payload), form = parse(lead.payload);
  const intake = prefillIntake({ ...lead, contactName: lead.name, workspace }, form);
  const flatLead = { ...lead, ...intake, name: lead.name || [intake.firstName, intake.lastName].filter(Boolean).join(" "), yardTier: intake.yardSize };
  const initial = JSON.stringify({ stage: "intro_sent", details_confirmed: false });
  await db.prepare(`INSERT OR IGNORE INTO lead_playbook_state(conversation_id,submission_id,state_json) VALUES (?,?,?)`).bind(conversationId, submissionId, initial).run();
  const row = await db.prepare(`SELECT * FROM lead_playbook_state WHERE conversation_id=? AND organization_id=?`).bind(conversationId, ORG).first();
  const recordedState = parse(row.state_json);
  // If storage failed between claiming a handoff and creating its draft, only
  // its own inbound may rebuild that acknowledgment from the prior state.
  const resumeHandoff = !structured && recordedState.stage === 'escalated' && recordedState.handoff_inbound_id === inbound.id;
  const state = resumeHandoff ? parse(row.prior_state_json) : recordedState;
  let priorStateJson = row.state_json;
  if(recordedState.last_inbound_message_id===inbound.id)return {duplicate:true};
  const phone = normalizePhone(lead.phone);
  const suppressed = phone ? await db.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?`).bind(ORG, await digest(phone)).first() : { blocked: 1 };
  const { classifyPlaybookIntent } = await import("./lead-playbook-classifier.mjs");
  const context = { ...state, details: leadPlaybookDetails(flatLead, state), now: event.createdAt || new Date() };
  context.hasPhoto = Boolean(event.hasPhoto);
  if (structured) {
    const recent = await db.prepare("SELECT direction,body FROM lead_messages WHERE conversation_id=? AND organization_id=? AND direction IN ('inbound','outbound') ORDER BY created_at DESC,rowid DESC LIMIT 8").bind(conversationId,ORG).all();
    context.recentMessages = (recent.results || []).reverse().map(message=>({direction:message.direction,body:redactInboundPaymentDetails(message.body).slice(0,500)}));
  }
  const {structuredOptOut} = await import('./lead-playbook-classifier.mjs');
  const safety = structured ? {intent:structuredOptOut(event.text) ? 'stop' : null} : classifyPlaybookRules(event.text, context);
  const optOut = ['stop','wrong_number'].includes(safety.intent);
  if (optOut || suppressed) {
    // The durable phone suppression is authoritative across submissions. A
    // receipt in the existing conversation state also deduplicates replays.
    const reason = optOut ? safety.intent : 'suppressed';
    const receipt = JSON.stringify({...state,last_inbound_message_id:inbound.id});
    const statements = [db.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND state_json=?")
      .bind(receipt,conversationId,row.state_json)];
    if (optOut && phone) statements.push(
      db.prepare("INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES (?,?,?,'quo_webhook','quo-webhook') ON CONFLICT(organization_id,phone_hash) DO UPDATE SET reason=excluded.reason").bind(ORG,await digest(phone),reason === 'wrong_number' ? 'wrong_number' : 'opted_out'),
      db.prepare("UPDATE lead_conversations SET automation_mode='paused',status='resolved',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(conversationId,ORG)
    );
    await db.batch(statements);
    return {escalated:false, reason};
  }
  let customerAdmission;
  const winter = safety.faq?.reason === 'winter_pause' || state.escalation_reason === 'winter_pause' && !safety.faq?.handoff;
  if (winter) await recordWinterPause(db,{lead,conversationId,submissionId,inboundId:inbound.id,occurredAt:event.createdAt || now,text:event.text,followUp:safety.faq?.reason !== 'winter_pause'});
  customerAdmission = await evaluatePlaybookCustomerAdmission(db, env, {lead, conversation}, {loadCustomerDirectory, now});
  if (!customerAdmission.allowed) {
    const reason = safety.faq?.handoff ? safety.faq.reason : winter ? 'winter_pause' : customerAdmission.reason;
    const held = await deferCustomerReview(db, env, conversationId, submissionId, reason, {inboundMessageId:inbound.id,notificationOptions,now});
    return {...held, reason: customerAdmission.reason, escalationReason: reason};
  }
  const automation = await db.prepare('SELECT assistant_enabled FROM lead_automation_settings WHERE organization_id=?').bind(ORG).first();
  if (!automation?.assistant_enabled) return {skipped:'lead_automation_paused'};
  if (structured) {
    const {prepareStructuredPlaybookInbound} = await import('./lead-playbook-structured-ingest.mjs');
    const {result,decision,stopped} = await prepareStructuredPlaybookInbound(db,env,{conversation,lead,flatLead,state,priorStateJson,inbound,event,context},{now,classifierOptions,replyOptions,serviceArea});
    if (stopped) return result;
    return finishPreparedDraft(db,env,result,decision,{sender,loadCustomerDirectory,textSafety,now,notificationOptions});
  }
  const classification = safety.faq ? safety : await classifyPlaybookIntent(event.text, context, { db, env });
  await seedPlaybookFaqLibrary(db);
  const answers = await db.prepare("SELECT * FROM lead_answer_library WHERE organization_id=? AND (approval_status='approved' OR answer_key LIKE ?)").bind(ORG,FAQ_LIBRARY_PREFIX+'%').all();
  const metaRoute = parse(lead.route_guidance), audit = workspace.routeAudit;
  // Route approval belongs to the reviewed property. A newly supplied address
  // cannot inherit the previous property's day, city, ZIP or capacity approval.
  const proposedAddress = normalizedRouteAddress(classification.slots?.address ?? context.details.address);
  const auditedDetails = lead.route_audited_at ? parse(lead.meta_response_state).details || {} : workspace.intake || {};
  const auditLocation = {city: auditedDetails.city || form.city || '', zip: auditedDetails.zip || lead.zip || form.zip || ''};
  const proposedLocation = {...context.details, ...classification.slots};
  const auditedAddress = normalizedRouteAddress(auditedDetails.address);
  const addressMatchesAudit = Boolean(proposedAddress && auditedAddress && proposedAddress === auditedAddress);
  const workspaceAuditCurrent = Boolean(audit?.handoffKey && workspace.handoffKey && audit.handoffKey === workspace.handoffKey);
  const route = !addressMatchesAudit || !matchesAuditedPlaybookLocation(auditLocation,proposedLocation) ? null : lead.route_audited_at ? { ...metaRoute, confirmed: true } : workspaceAuditCurrent && audit?.actor && audit?.day ? { day: audit.day, confirmed: true, auditedBy: audit.actor } : null;
  let decision = withManualReviewDraft(nextPlaybookResponse({ conversation, state, lead: flatLead, text: event.text, classification, route, approvedAnswers: answers.results || [], suppressed: Boolean(suppressed), existingCustomerTestException: customerAdmission?.kind === 'controlled_test' }));
  if (Object.hasOwn(FAQ_TEMPLATES, decision.templateKey)) {
    const entry = (answers.results || []).find(answer => answer.answer_key === faqAnswerKey(decision.templateKey));
    if (!entry || entry.approval_status !== 'approved' || entry.answer_template !== FAQ_TEMPLATES[decision.templateKey]) {
      // Retiring or editing a catalog row invalidates the bundled version until
      // the office approves/reconciles the change. Never revive a retired entry.
      decision = {...decision, body:'', templateKey:null, staffOnly:true, escalate:true, reason:'no_approved_library_answer',
        state:{...decision.state,stage:'escalated',escalation_reason:'no_approved_library_answer'}};
    } else {
      decision.answerKey = entry.answer_key;
      decision.answerVersion = entry.version;
    }
  }
  if (["quote_recurring", "quote_one_time", "service_day_answer"].includes(decision.templateKey)) decision.slots.route_audit_key = lead.route_audited_at || workspace.handoffKey;
  if (decision.state.access_notes_supplied && classification.faq?.topic === 'access_note') {
    decision.state.access_note_message_ids = [...new Set([...(state.access_note_message_ids || []), inbound.id])].slice(-12);
  }
  if (['referral','referral_policy'].includes(classification.faq?.topic)) decision.state.referral_message_id = inbound.id;
  if (decision.escalate) {
    // The staff outbox is independent of the customer draft lifecycle. A held,
    // superseded or unconfirmed customer reply must never discard the handoff.
    const reason = playbookOwnerNoticeReasonAllowed(decision.reason) ? decision.reason : 'intent_needs_review';
    const kind = ['signup_ready','property_walk'].includes(reason) ? reason : 'lead_review';
    decision.staffEventKey = reason + ':' + inbound.id;
    await queuePlaybookOwnerNotice(db,env,{kind,submissionId,conversationId,eventKey:decision.staffEventKey});
    if (decision.body && decision.reason !== 'route_day_requires_confirmation') {
      // Commit the sales hold before asking Quo to deliver the acknowledgment.
      // It is independent of review mode, expiration, rejection and delivery.
      if (!resumeHandoff) await db.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=json_set(state_json,'$.stage','escalated','$.escalation_reason',?,'$.handoff_inbound_id',?),stage='escalated',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND stage NOT IN ('escalated','closed_won','handoff_signup')")
        .bind(reason,inbound.id,conversationId,ORG).run();
      const held = await db.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=? AND organization_id=?').bind(conversationId,ORG).first();
      priorStateJson = held?.state_json;
      if (!priorStateJson || parse(priorStateJson).handoff_inbound_id !== inbound.id) {
        await flushPlaybookOwnerNotices(db,env,{...notificationOptions,now,eventKey:decision.staffEventKey});
        return {escalated:true,reason};
      }
    }
  }
  if (decision.needsMapMeasurement) await db.prepare(`UPDATE growth_leads SET next_action='Craig: measure the provided cleanup area on the map before quoting',next_action_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(submissionId, ORG).run();
  if (decision.escalate) await db.prepare(`UPDATE growth_leads SET next_action='Craig: review playbook escalation',next_action_at=CURRENT_TIMESTAMP,priority='high',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(submissionId, ORG).run();
  if (decision.body) {
    const { createPlaybookDraft } = await import("./lead-playbook-service.js");
    const result = await createPlaybookDraft(db, env, { conversation, lead, inboundMessageId: inbound.id, decision: { ...decision, priorState: parse(priorStateJson), priorStateJson } });
    return finishPreparedDraft(db,env,result,decision,{sender,loadCustomerDirectory,textSafety,now,notificationOptions});
  }
  await db.prepare(`UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND state_json=?`)
    .bind(JSON.stringify({ ...decision.state, last_inbound_message_id: inbound.id }), decision.state.stage, conversationId, row.state_json).run();
  if (decision.staffEventKey) await flushPlaybookOwnerNotices(db,env,{...notificationOptions,now,eventKey:decision.staffEventKey});
  return { escalated: decision.escalate, reason: decision.reason };
}

// Read-only provider reconciliation; persistence is local to the runtime D1.
// It deliberately never replays inbound messages through reply automation.
export async function reconcilePlaybookQuo(env, { now = new Date(), fetcher = fetch } = {}) {
  if (!playbookEnabled(env)) return { disabled: true };
  if (!env.DB || !env.QUO_API_KEY) return { skipped: "configuration_missing" };
  const origin = env.QUO_API_BASE_URL || "https://api.quo.com";
  if (!["https://api.quo.com", "https://api.openphone.com"].includes(origin)) throw new Error("Quo origin is not authorized.");
  const since = new Date(now.getTime() - 48 * 3600000).toISOString();
  async function read(path) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetcher(origin + path, { method: "GET", headers: { Authorization: env.QUO_API_KEY, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(12000) });
      if (response.status === 429 && attempt < 3) { await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt))); continue; }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Quo reconcile read failed (${response.status}).`); }
      const { readBoundedProviderJson } = await import("./bounded-body.mjs");
      return readBoundedProviderJson(response, 1024 * 1024);
    }
  }
  const numbers = await read("/v1/phone-numbers");
  let recorded = 0;
  for (const number of numbers.data || []) {
    const scope = quoLearningScope(env, { direction: "outbound", from: number.number });
    if (!scope.allowed) continue;
    let pageToken = null;
    const seen = new Set();
    do {
      const query = new URLSearchParams({ maxResults: "100", phoneNumbers: number.id, updatedAfter: since });
      if (pageToken) query.set("pageToken", pageToken);
      const conversations = await read("/v1/conversations?" + query);
      for (const thread of conversations.data || []) {
        if (thread.phoneNumberId !== number.id) continue;
        if (!Array.isArray(thread.participants) || thread.participants.length !== 1) continue;
        const participant = typeof thread.participants[0] === "string" ? thread.participants[0] : thread.participants[0]?.phoneNumber;
        if (!normalizePhone(participant)) continue;
        let messagePage = null;
        const messageTokens = new Set();
        do {
          const messagesQuery = new URLSearchParams({ phoneNumberId: number.id, participants: participant, maxResults: "100", createdAfter: since });
          if (messagePage) messagesQuery.set("pageToken", messagePage);
          const messages = await read("/v1/messages?" + messagesQuery);
          for (const message of messages.data || []) {
            if (message.phoneNumberId !== number.id || message.conversationId !== thread.id || normalizePhone(message.from) !== normalizePhone(message.direction === "incoming" ? participant : number.number) || !Array.isArray(message.to) || message.to.length !== 1 || normalizePhone(message.to[0]) !== normalizePhone(message.direction === "incoming" ? number.number : participant)) continue;
            const event = normalizeQuoMessageEvent({ id: `reconcile:${message.id}`, type: message.direction === "incoming" ? "message.received" : "message.delivered", data: { object: message } });
            if (!event || Date.parse(event.createdAt) < Date.parse(since)) continue;
            await recordPlaybookQuoEvent(env.DB, env, event);
            recorded++;
          }
          messagePage = messages.nextPageToken || null;
          if (messagePage && messageTokens.has(messagePage)) throw new Error("Repeated Quo message cursor.");
          messageTokens.add(messagePage);
        } while (messagePage);
      }
      pageToken = conversations.nextPageToken || null;
      if (pageToken && seen.has(pageToken)) throw new Error("Repeated Quo conversation cursor.");
      seen.add(pageToken);
    } while (pageToken);
  }
  return { recorded };
}

export async function runScheduledPlaybook(env, scheduledTime = Date.now()) {
  if (!playbookEnabled(env)) return { disabled: true };
  if (!env.DB) return { skipped: "storage_missing" };
  const { expirePlaybookDrafts } = await import("./lead-playbook-service.js");
  const { processPlaybookMirror } = await import("./lead-playbook-mirror.mjs");
  await expirePlaybookDrafts(env.DB, env);
  const intros = await preparePlaybookIntros(env.DB, env);
  if (env.LEAD_PLAYBOOK_NOTIFY_ENABLED === "true") {
    await flushPlaybookOwnerNotices(env.DB,env).catch(()=>({deferred:true}));
  }
  const mirror = await processPlaybookMirror(env.DB, env, 10);
  const { isEasternMidnight } = await import("./scheduled-time.mjs");
  if (!isEasternMidnight(scheduledTime)) return { intros, mirror };
  return { intros, mirror, reconcile: await reconcilePlaybookQuo(env, { now: new Date(scheduledTime) }) };
}

export async function preparePlaybookIntros(db, env, { submissionId = null, limit = 10,sender,loadCustomerDirectory,textSafety,now=new Date(),notificationOptions={} } = {}) {
  if (!playbookEnabled(env) || !db) return { disabled: true };
  const settings = await db.prepare(`SELECT assistant_enabled FROM lead_automation_settings WHERE organization_id=?`).bind(ORG).first();
  if (!settings?.assistant_enabled) return { skipped: "assistant_paused" };
  const controlled=env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY===true||env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY==='true';
  const approved=controlledLeadTestRecipient(env)?.slice(-10)||'';
  const rows = await db.prepare(`SELECT c.*,s.payload,s.name,s.email,s.phone,s.status submission_status FROM lead_conversations c JOIN submissions s ON s.id=c.submission_id
    WHERE c.organization_id=? AND c.owner='backend' AND c.automation_mode IN ('suggest','approved') AND c.last_inbound_at IS NULL AND c.last_outbound_at IS NULL
    AND c.channel!='facebook_lead' AND NOT EXISTS(SELECT 1 FROM meta_lead_intakes i WHERE i.submission_id=s.id AND i.organization_id=c.organization_id)
    AND (?=0 OR substr(replace(replace(replace(replace(replace(s.phone,'+',''),'(',''),')',''),'-',''),' ',''),-10)=?)
    AND c.status!='deleted' AND s.status NOT IN ('deleted','trashed','converted','synced') AND COALESCE(s.lifecycle_stage,'')!='converted'
    AND (? IS NULL OR s.id=?) AND NOT EXISTS(SELECT 1 FROM lead_reply_drafts d WHERE d.conversation_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM lead_playbook_state p WHERE p.conversation_id=c.id AND p.stage='escalated')
    AND (EXISTS(SELECT 1 FROM quote_follow_up_deliveries d JOIN quote_follow_ups q ON q.id=d.follow_up_id WHERE d.submission_id=s.id AND d.channel='customer_sms' AND d.status IN ('queued','failed') AND q.scheduled_at<=CURRENT_TIMESTAMP)
      ) LIMIT ?`)
    .bind(ORG, controlled?1:0, approved, submissionId, submissionId, limit).all();
  let drafted = 0, escalated = 0;
  const { createPlaybookDraft } = await import("./lead-playbook-service.js");
  for (const row of rows.results || []) {
    const form = parse(row.payload);
    if (!form.follow_up_consent && !form.sms_consent_evidence?.valid) continue;
    const phone = normalizePhone(row.phone);
    if (!allowedLeadTestRecipient(env,phone)) continue;
    if (!phone || await db.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?`).bind(ORG, await digest(phone)).first()) continue;
    const customerAdmission = await evaluatePlaybookCustomerAdmission(db, env, {lead: {...row,id:row.submission_id}, conversation:row}, {loadCustomerDirectory,now});
    if (!customerAdmission.allowed) { await deferCustomerReview(db, env, row.id, row.submission_id, customerAdmission.reason, {notificationOptions,now}); escalated++; continue; }
    const initial = { stage: "intro_sent", details_confirmed: false };
    await db.prepare(`INSERT OR IGNORE INTO lead_playbook_state(conversation_id,submission_id,state_json) VALUES (?,?,?)`).bind(row.id, row.submission_id, JSON.stringify(initial)).run();
    const stateRow = await db.prepare(`SELECT state_json FROM lead_playbook_state WHERE conversation_id=?`).bind(row.id).first();
    const question=String(form.pending_quote_question||form.service_question||form.question||'').trim().slice(0,4000);
    if(question){
      const questionId=`form-question:${row.submission_id}`;
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,author)
          VALUES (?,?,?,'inbound','website',?,?,'delivered',0,'website-form','lead')`).bind(questionId,row.id,ORG,questionId,question),
        db.prepare('UPDATE lead_conversations SET last_inbound_at=COALESCE(last_inbound_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(row.id),
      ]);
      const intake=prefillIntake({phone:row.phone,email:row.email,name:row.name},form),flatLead={...intake,name:row.name,yardTier:intake.yardSize};
      const prior=parse(stateRow.state_json),classification=classifyPlaybookRules(question,{...prior,details:leadPlaybookDetails(flatLead,prior)});
      const answers=await db.prepare("SELECT * FROM lead_answer_library WHERE organization_id=? AND approval_status='approved'").bind(ORG).all();
      const decision=withManualReviewDraft(nextPlaybookResponse({conversation:row,lead:flatLead,state:prior,text:question,classification,approvedAnswers:answers.results||[],existingCustomerTestException:customerAdmission.kind==='controlled_test'}));
      if(decision.body){
        const result=await createPlaybookDraft(db,env,{conversation:row,lead:{id:row.submission_id},inboundMessageId:questionId,decision:{...decision,priorState:prior}});
        if(result.draft){drafted++;await finishPreparedDraft(db,env,result,decision,{sender,loadCustomerDirectory,textSafety,now,notificationOptions});}
      }else{
        await db.batch([
          db.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage='escalated',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND state_json=?").bind(JSON.stringify({...decision.state,stage:'escalated',last_inbound_message_id:questionId}),row.id,stateRow.state_json),
          db.prepare("UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,error_message='playbook_question_review',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND channel='customer_sms' AND status IN ('queued','failed')").bind(row.submission_id),
          db.prepare("UPDATE growth_leads SET next_action='Craig: review the submitted website question',next_action_at=CURRENT_TIMESTAMP,priority='high',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?").bind(row.submission_id,ORG),
        ]);
        escalated++;
        await notifyPlaybookOwner(db,env,{kind:'lead_review',submissionId:row.submission_id,conversationId:row.id,eventKey:questionId},{...notificationOptions,now}).catch(()=>({deferred:true}));
      }
      continue;
    }
    const body = renderPlaybookTemplate("intro_form");
    const result = await createPlaybookDraft(db, env, { conversation: row, lead: { id: row.submission_id }, inboundMessageId: null, decision: { intent: "confirm_yes", confidence: 1, templateKey: "intro_form", body, slots: {}, pricingVersion: PRICING_VERSION, policyVersion: PLAYBOOK_POLICY_VERSION, priorState: parse(stateRow.state_json), state: initial, reason: "approved_form_introduction" } });
    if (result.draft) {drafted++; await finishPreparedDraft(db,env,result,{reason:'approved_form_introduction'},{sender,loadCustomerDirectory,textSafety,now,notificationOptions});}
  }
  return { drafted, escalated };
}
