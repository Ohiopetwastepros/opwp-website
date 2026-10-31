import { normalizeMetaLead } from "./meta-leads.mjs";
import { normalizePhone } from "./lead-assistant.mjs";
import { META_POLICY_VERSION, buildMetaConfirmation, classifyMetaReply, metaConsentEvidence, metaQuietHours, metaReplyAction, metaReviewReasons } from "./meta-lead-policy.mjs";
import { readBoundedProviderJson } from "./bounded-body.mjs";
import { META_CADENCE_VERSION, META_RESPONSES, metaFollowUpDrafts, nextMetaResponse } from "./meta-conversation.mjs";
import { refreshMetaRouteGuidance } from "./meta-route-guidance.mjs";

const ORG = "org-opwp";
const parse = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
export async function metaPhoneHash(phone) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone))), (n) => n.toString(16).padStart(2, "0")).join("");
}

export async function metaReleaseApproved(db, env, policy = META_POLICY_VERSION) {
  const testMode = env.META_TEST_MODE === "true";
  if (testMode && env.META_AUTOMATION_ENABLED === "true") return false;
  const approvalId = testMode ? env.META_TEST_APPROVAL_ID : env.META_AUTOMATION_APPROVAL_ID;
  if ((!testMode && env.META_AUTOMATION_ENABLED !== "true") || !approvalId) return false;
  const expectedPolicy = testMode ? `${policy}-test` : policy;
  const release = await db.prepare(`SELECT id FROM meta_automation_releases WHERE id=? AND organization_id=? AND policy_version=?
    AND revoked_at IS NULL AND length(approved_by)>0 AND length(evidence)>0 AND approved_at<=CURRENT_TIMESTAMP`).bind(approvalId, ORG, expectedPolicy).first();
  return Boolean(release);
}

export async function storeMetaLead(db, env, data, event) {
  const lead = normalizeMetaLead(data, event);
  if (!lead.meta_lead_id || lead.meta_lead_id !== event.leadId || lead.meta_form_id !== event.formId) throw new Error("Meta response identity mismatch.");
  lead.phone = normalizePhone(lead.phone);
  lead.sms_consent_evidence = metaConsentEvidence(lead, parse(env.META_APPROVED_SMS_FORMS));
  lead.follow_up_consent = lead.sms_consent_evidence.valid;
  lead.follow_up_consent_at = lead.sms_consent_evidence.capturedAt;
  const hash = await metaPhoneHash(`meta:${ORG}:${lead.meta_lead_id}`);
  // Deterministic valid UUID: a retry after any partial failure resolves to the same submission.
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const conversation = `meta-${id}`;
  const phoneHash = lead.phone ? await metaPhoneHash(lead.phone) : null;
  const sourceUrl = `https://business.facebook.com/latest/leads_center?asset_id=${encodeURIComponent(lead.meta_page_id)}`;
  lead.meta_source_url = sourceUrl;
  const reasons = metaReviewReasons(lead);
  const reason = reasons.join(",") || "release_review_required";
  const mode = !reasons.length && await metaReleaseApproved(db, env) ? "approved" : "suggest";
  // All operational records commit together. No best-effort enqueue or detached work.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO submissions (id,kind,source,status,name,email,phone,zip,payload,funnel_id,lifecycle_stage,sng_sync_state,last_activity_at)
      VALUES (?,'question','facebook','new',?,?,?,?,?,?,'details_started','not_attempted',CURRENT_TIMESTAMP)`)
      .bind(id, lead.name || null, lead.email || null, lead.phone || null, lead.zip || null, JSON.stringify(lead), `meta:${lead.meta_lead_id}`),
    db.prepare(`INSERT OR IGNORE INTO lead_conversations (id,submission_id,organization_id,channel,status,automation_mode,unread_count)
      VALUES (?,?,?,'facebook_lead','open',?,1)`).bind(conversation, id, ORG, mode),
    db.prepare(`INSERT OR IGNORE INTO meta_lead_intakes (submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,phone_hash,duplicate_of,review_reason)
      VALUES (?,?,?,?,?,?,?,(SELECT submission_id FROM meta_lead_intakes WHERE organization_id=? AND phone_hash=? ORDER BY created_at,submission_id LIMIT 1),?)`)
      .bind(id, ORG, lead.meta_lead_id, lead.meta_form_id, lead.meta_page_id, sourceUrl, phoneHash, ORG, phoneHash, reason),
    db.prepare(`INSERT OR IGNORE INTO meta_sms_jobs (id,submission_id,organization_id,conversation_id,purpose,trigger_id,message_body,status,block_reason)
      SELECT ?,?,?,c.id,'confirmation',?,?,CASE WHEN i.duplicate_of IS NOT NULL OR ? THEN 'blocked' ELSE 'queued' END,
        CASE WHEN i.duplicate_of IS NOT NULL THEN 'duplicate_contact' ELSE ? END
      FROM meta_lead_intakes i JOIN lead_conversations c ON c.submission_id=i.submission_id AND c.organization_id=i.organization_id
      JOIN submissions s ON s.id=i.submission_id WHERE i.submission_id=? AND s.status!='deleted'`)
      .bind(id, id, ORG, lead.meta_lead_id, buildMetaConfirmation(lead), reasons.length ? 1 : 0, reason, id),
    db.prepare(`INSERT OR IGNORE INTO growth_leads (submission_id,organization_id,stage,priority,next_action,next_action_at,updated_by)
      VALUES (?,?,'new','high',?,CURRENT_TIMESTAMP,'meta-webhook')`).bind(id, ORG, `Craig: review Facebook form (${reason}). Confirm service details before quoting.`.slice(0, 240)),
    db.prepare(`INSERT OR IGNORE INTO lead_airtable_sync (submission_id,organization_id,status) VALUES (?,?,'queued')`).bind(id, ORG),
    db.prepare(`INSERT OR IGNORE INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email)
      VALUES (?,?,?,'system','Facebook form captured; confirmation prepared',?,'meta-webhook')`).bind(`meta-intake-${id}`, id, ORG, JSON.stringify({ metaLeadId: lead.meta_lead_id, formId: lead.meta_form_id, sourceUrl, reasons, version: META_POLICY_VERSION })),
  ]);
  return { id, consent: lead.follow_up_consent, reasons };
}

async function currentJob(db, id) {
  return db.prepare(`SELECT j.*,s.phone,s.email,s.payload,s.status submission_status,s.lifecycle_stage,c.status conversation_status,c.last_inbound_at,c.last_outbound_at,c.automation_mode,
    g.stage,g.outcome_reason,i.duplicate_of,i.response_state,i.reply_branch,i.signed_up_at FROM meta_sms_jobs j
    JOIN submissions s ON s.id=j.submission_id JOIN lead_conversations c ON c.id=j.conversation_id AND c.organization_id=j.organization_id
    JOIN meta_lead_intakes i ON i.submission_id=j.submission_id AND i.organization_id=j.organization_id
    LEFT JOIN growth_leads g ON g.submission_id=j.submission_id AND g.organization_id=j.organization_id
    WHERE j.id=? AND j.organization_id=?`).bind(id, ORG).first();
}

async function safetyReason(db, row, env) {
  if (env.META_TEST_MODE === "true") {
    const recipients = String(env.META_TEST_RECIPIENTS || "").split(",").slice(0, 3).map(normalizePhone).filter(Boolean);
    const forms = String(env.META_TEST_FORM_IDS || "").split(",").slice(0, 3).map((value) => value.trim()).filter(Boolean);
    if (!recipients.includes(normalizePhone(row.phone)) || !forms.includes(parse(row.payload).meta_form_id)) return "not_an_approved_test_lead";
  }
  if (row.signed_up_at) return "signup_completed";
  if (row.email) {
    const signups = await db.prepare(`SELECT phone FROM submissions WHERE kind='onboarding' AND sng_sync_state='succeeded' AND lower(trim(email))=? AND created_at>=? LIMIT 10`).bind(row.email.trim().toLowerCase(), row.created_at).all();
    if ((signups.results || []).some((signup) => normalizePhone(signup.phone) === normalizePhone(row.phone))) return "signup_completed";
  }
  if (row.purpose === "confirmation" && (row.last_inbound_at || row.last_outbound_at)) return "conversation_already_started";
  if (row.purpose !== "follow_up" && Date.parse(`${row.created_at.replace(" ", "T")}Z`) < Date.now() - 86400000) return "stale_message_review_required";
  if (row.purpose === "reply") {
    const latest = await db.prepare(`SELECT provider_message_id FROM lead_messages WHERE conversation_id=? AND organization_id=? AND direction='inbound' ORDER BY rowid DESC LIMIT 1`).bind(row.conversation_id, ORG).first();
    if (latest?.provider_message_id !== row.trigger_id) return "newer_customer_reply";
  }
  if (row.purpose === "follow_up" && row.last_inbound_at) return "customer_replied";
  if (row.purpose === "signup") {
    const intake = await db.prepare(`SELECT route_audited_at,response_state FROM meta_lead_intakes WHERE submission_id=? AND organization_id=?`).bind(row.submission_id, ORG).first();
    if (!intake?.route_audited_at || !parse(intake.response_state).ready_for_route_audit) return "route_audit_required";
  }
  if (row.duplicate_of) return "duplicate_contact";
  if (["deleted", "converted"].includes(row.submission_status) || ["resolved", "deleted"].includes(row.conversation_status) || row.lifecycle_stage === "converted" || ["won", "lost", "not_qualified"].includes(row.stage)) return "lead_closed";
  const lead = parse(row.payload);
  // Revalidate consent against current approved forms so revoked disclosures stop queued work.
  lead.sms_consent_evidence = metaConsentEvidence(lead, parse(env.META_APPROVED_SMS_FORMS));
  const reasons = metaReviewReasons(lead);
  if (reasons.length) return reasons.join(",");
  const suppressed = await db.prepare(`SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?`).bind(ORG, await metaPhoneHash(normalizePhone(row.phone))).first();
  return suppressed ? "phone_suppressed" : "";
}

export async function processMetaConfirmations(env, { limit = 10, submissionId = null, now = new Date(), fetcher = fetch } = {}) {
  const db = env.DB;
  if (!db) return { enabled: false, sent: 0 };
  // A crash during the provider call is ambiguous; never retry an uncertain SMS automatically.
  await db.prepare(`UPDATE meta_sms_jobs SET status='unknown',error_message='Interrupted delivery; reconcile in Quo before any manual resend.',updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=? AND status='sending' AND attempted_at<datetime('now','-5 minutes')`).bind(ORG).run();
  if (!await metaReleaseApproved(db, env)) return { enabled: false, sent: 0 };
  const settings = await db.prepare(`SELECT * FROM lead_automation_settings WHERE organization_id=?`).bind(ORG).first();
  if (!settings?.assistant_enabled || settings.human_review_required || metaQuietHours(settings, now)) return { enabled: true, deferred: "review_or_quiet_hours", sent: 0 };
  if (!env.QUO_API_KEY || !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalizePhone(env.QUO_FROM_NUMBER))) return { enabled: true, deferred: "quo_configuration", sent: 0 };
  const jobs = await db.prepare(`SELECT id FROM meta_sms_jobs WHERE organization_id=? AND status='queued' AND due_at<=CURRENT_TIMESTAMP
    AND (? IS NULL OR submission_id=?) ORDER BY created_at LIMIT ?`).bind(ORG, submissionId, submissionId, Math.min(25, Math.max(1, Number(limit) || 10))).all();
  let sent = 0;
  for (const candidate of jobs.results || []) {
    let row = await currentJob(db, candidate.id);
    if (row.purpose === "follow_up" && !await metaCadenceApproved(db, env)) continue;
    if (row.purpose === "follow_up" && row.sequence_step > 1) {
      const priorTouches = await db.prepare(`SELECT COUNT(*) count FROM meta_sms_jobs WHERE submission_id=? AND organization_id=? AND purpose='follow_up' AND sequence_step<? AND status IN ('sent','delivered')`).bind(row.submission_id, ORG, row.sequence_step).first();
      if (Number(priorTouches?.count) !== row.sequence_step - 1) continue;
    }
    const reason = await safetyReason(db, row, env);
    if (reason) {
      await db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'`).bind(reason, row.id).run();
      continue;
    }
    // Individual approval is still required by YardOps, even after release approval.
    const conversation = await db.prepare(`SELECT automation_mode FROM lead_conversations WHERE id=? AND organization_id=?`).bind(row.conversation_id, ORG).first();
    if (conversation?.automation_mode !== "approved") continue;
    const claim = await db.prepare(`UPDATE meta_sms_jobs SET status='sending',attempted_at=CURRENT_TIMESTAMP,block_reason=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=? AND status='queued'`).bind(row.id, ORG).run();
    if (!claim.meta?.changes) continue;
    const budget = await db.prepare(`INSERT INTO meta_sms_daily_usage (organization_id,usage_date,attempts) VALUES (?,date('now'),1)
      ON CONFLICT(organization_id,usage_date) DO UPDATE SET attempts=attempts+1 WHERE attempts<50 RETURNING attempts`).bind(ORG).first();
    if (!budget) {
      await db.prepare(`UPDATE meta_sms_jobs SET status='queued',block_reason='daily_send_limit',attempted_at=NULL WHERE id=? AND status='sending'`).bind(row.id).run();
      break;
    }
    // Refresh after the claim to catch replies, opt-outs or conversion during processing.
    row = await currentJob(db, row.id);
    const changed = await safetyReason(db, row, env);
    const currentSettings = await db.prepare(`SELECT * FROM lead_automation_settings WHERE organization_id=?`).bind(ORG).first();
    if (row.status !== "sending" || changed || row.automation_mode !== "approved" || !currentSettings?.assistant_enabled || currentSettings.human_review_required || metaQuietHours(currentSettings, now) || !await metaReleaseApproved(db, env)) {
      await db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'`).bind(changed || "release_revoked", row.id).run();
      continue;
    }
    let acceptedId = null;
    try {
      // No provider-side idempotency guarantee is assumed for the existing v1 API.
      const response = await fetcher("https://api.openphone.com/v1/messages", { method: "POST", headers: { Authorization: env.QUO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ content: row.message_body, from: normalizePhone(env.QUO_FROM_NUMBER), to: [normalizePhone(row.phone)] }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) {
        const status = response.status >= 400 && response.status < 500 && response.status !== 408 ? "failed" : "unknown";
        await db.prepare(`UPDATE meta_sms_jobs SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status, `Quo HTTP ${response.status}; review before resending.`, row.id).run();
        continue;
      }
      const result = await readBoundedProviderJson(response);
      acceptedId = result?.data?.id || result?.id;
      if (typeof acceptedId !== "string" || !acceptedId || acceptedId.length > 120) throw new Error("Missing provider message ID");
      await db.batch([
        db.prepare(`UPDATE meta_sms_jobs SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(acceptedId, row.id),
        db.prepare(`INSERT OR IGNORE INTO lead_messages (id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by)
          VALUES (?,?,?,'outbound','quo_sms',?,?,'sent',1,'meta-confirmation')`).bind(`meta-sms-${row.id}`, row.conversation_id, ORG, acceptedId, row.message_body),
        db.prepare(`UPDATE lead_conversations SET status=CASE WHEN last_inbound_at IS NULL THEN 'waiting' ELSE status END,last_outbound_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(row.conversation_id, ORG),
        db.prepare(`UPDATE growth_leads SET stage='contacted',next_action=NULL,next_action_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND stage='new' AND ?='confirmation'`).bind(row.submission_id, ORG, row.purpose),
        db.prepare(`UPDATE lead_airtable_sync SET status='queued',attempt_count=0,revision=revision+1,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(row.submission_id, ORG),
        db.prepare(`UPDATE growth_leads SET stage='quoted',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND stage IN ('new','contacted','qualified')
          AND EXISTS(SELECT 1 FROM meta_reply_decisions d WHERE d.provider_message_id=? AND d.submission_id=growth_leads.submission_id AND json_extract(d.state_json,'$.expected')='quote_acceptance')`).bind(row.submission_id, ORG, row.trigger_id),
        db.prepare(`UPDATE meta_lead_intakes SET signup_invited_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ?='signup'`).bind(row.submission_id, ORG, row.purpose),
      ]);
      sent++;
    } catch {
      await db.prepare(`UPDATE meta_sms_jobs SET status='unknown',provider_message_id=COALESCE(?,provider_message_id),error_message='Delivery outcome uncertain; reconcile in Quo. Automatic retry disabled.',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(typeof acceptedId === "string" ? acceptedId : null, row.id).run();
    }
  }
  await reconcileQuoReceipts(db);
  const confirmations = await db.prepare(`SELECT submission_id FROM meta_sms_jobs WHERE organization_id=? AND purpose='confirmation' AND status IN ('sent','delivered') ORDER BY sent_at DESC LIMIT 25`).bind(ORG).all();
  for (const confirmation of confirmations.results || []) await queueMetaCadence(db, env, confirmation.submission_id);
  return { enabled: true, sent };
}

export async function recordMetaReply(db, submissionId, event, { refreshRouting, conflictAttempt = 0 } = {}) {
  const row = await currentJob(db, submissionId);
  if (!row) return false;
  const lead = parse(row.payload);
  const prior = await db.prepare(`SELECT provider_message_id FROM meta_reply_decisions WHERE provider_message_id=? AND organization_id=?`).bind(event.providerMessageId, ORG).first();
  if (prior) return true;
  const branch = classifyMetaReply(event.text);
  let action = metaReplyAction(branch, lead, Boolean(row.sent_at));
  const suppressed = ["opted_out", "wrong_number"].includes(branch);
  const answers = await db.prepare(`SELECT answer_template,keywords FROM lead_answer_library WHERE organization_id=? AND approval_status='approved' AND auto_send_allowed=1 AND response_mode='static'`).bind(ORG).all();
  const matches = (answers.results || []).filter((answer) => { const words = parse(answer.keywords); return Array.isArray(words) && words.some((word) => String(event.text).toLowerCase().includes(String(word).toLowerCase())); });
  let decision = nextMetaResponse({ lead, state: parse(row.response_state), text: event.text, confirmationSent: Boolean(row.sent_at), staticAnswer: matches.length === 1 ? matches[0].answer_template : null });
  const pendingPrompt = await db.prepare(`SELECT id FROM meta_sms_jobs WHERE submission_id=? AND organization_id=? AND purpose='reply' AND trigger_id!=? AND status NOT IN ('sent','delivered') LIMIT 1`).bind(submissionId, ORG, event.providerMessageId).first();
  if ((conflictAttempt || pendingPrompt) && !["opted_out", "wrong_number", "channel_change", "declined"].includes(branch)) {
    // A second text may refer to the previous question, not an unsent new prompt.
    // Preserve the latest committed facts and let Craig interpret the whole thread.
    decision = { branch, response: "", state: { ...parse(row.response_state), handoff: true, expected: "", ready_for_route_audit: false } };
    action = "Craig: review overlapping replies before continuing the text conversation.";
  }
  const replyId = `reply-${event.providerMessageId}`;
  const evidence = lead.sms_consent_evidence?.valid && lead.preferred_channel === "sms";
  if (decision.response === META_RESPONSES.custom_cleanup) action = `Craig: custom quote required. Last thorough cleanup: ${decision.state.details?.last_cleaned_answer || "not confirmed"}. Review the full reply.`;
  const statements = [
    db.prepare(`INSERT INTO meta_reply_decisions (provider_message_id,submission_id,organization_id,branch,response_body,state_json,prior_state_json,policy_version) VALUES (?,?,?,?,?,?,?,?)`).bind(event.providerMessageId, submissionId, ORG, branch, decision.response, JSON.stringify(decision.state), row.response_state, META_POLICY_VERSION),
    db.prepare(`UPDATE meta_lead_intakes SET reply_branch=?,review_reason=?,response_state=?,confirmed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
      route_audited_at=CASE WHEN ? THEN route_audited_at ELSE NULL END,route_audited_by=CASE WHEN ? THEN route_audited_by ELSE NULL END,route_guidance=CASE WHEN ? THEN route_guidance ELSE NULL END,
      updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(branch, action, JSON.stringify(decision.state), decision.state.details_confirmed ? 1 : 0, decision.state.ready_for_route_audit ? 1 : 0, decision.state.ready_for_route_audit ? 1 : 0, decision.state.ready_for_route_audit ? 1 : 0, submissionId, ORG),
    db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='customer_replied',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','blocked')`).bind(submissionId, ORG),
    db.prepare(`UPDATE growth_leads SET next_action=?,next_action_at=CURRENT_TIMESTAMP,priority='high',updated_by='meta-reply',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND stage NOT IN ('won','lost','not_qualified')`).bind(action.slice(0, 240), submissionId, ORG),
    db.prepare(`INSERT OR IGNORE INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email) VALUES (?,?,?,'system',?,?,'meta-reply')`).bind(`meta-reply-${event.providerMessageId}`, submissionId, ORG, action, JSON.stringify({ branch, providerMessageId: event.providerMessageId })),
    db.prepare(`UPDATE lead_airtable_sync SET status='queued',attempt_count=0,revision=revision+1,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(submissionId, ORG),
  ];
  // Preserve every form answer while structured fields record verified corrections.
  const updated = { ...lead, ...decision.state.details, meta_response_state: decision.state };
  if (branch === "channel_change") { updated.preferred_channel = /email/i.test(event.text) ? "email" : "phone"; }
  if (decision.state.quote?.monthly != null) updated.quoted_monthly_total = decision.state.quote.monthly;
  else delete updated.quoted_monthly_total;
  statements.push(db.prepare(`UPDATE submissions SET payload=?,zip=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND source='facebook'`).bind(JSON.stringify(updated), updated.zip || null, submissionId));
  if (decision.response && !suppressed && branch !== "channel_change") statements.push(
    db.prepare(`INSERT OR IGNORE INTO meta_sms_jobs (id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status,block_reason)
      VALUES (?,'reply',?,?,?,?,?,?,?)`).bind(replyId, event.providerMessageId, submissionId, ORG, row.conversation_id, `${decision.response}${decision.response.includes("Reply STOP") ? "" : " Reply STOP to opt out."}`.slice(0, 1000), evidence ? "queued" : "blocked", evidence ? "release_review_required" : "consent_unverified"),
  );
  if (suppressed || branch === "channel_change") statements.push(db.prepare(`UPDATE lead_conversations SET automation_mode='paused' WHERE id=? AND organization_id=?`).bind(row.conversation_id, ORG));
  if (branch === "declined") statements.push(
    db.prepare(`UPDATE growth_leads SET stage='lost',outcome_reason='service_fit',outcome_note='Customer declined by text.',lost_at=CURRENT_TIMESTAMP,next_action=NULL,next_action_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND stage!='won'`).bind(submissionId, ORG),
    db.prepare(`UPDATE lead_conversations SET automation_mode='paused' WHERE id=? AND organization_id=?`).bind(row.conversation_id, ORG),
  );
  if (decision.state.details_confirmed) statements.push(db.prepare(`UPDATE growth_leads SET stage='qualified',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND stage IN ('new','contacted')`).bind(submissionId, ORG));
  if (suppressed) statements.push(
    db.prepare(`INSERT INTO lead_suppressions (organization_id,phone_hash,reason,source,created_by) VALUES (?,?,?,'quo_webhook','meta-reply')
      ON CONFLICT(organization_id,phone_hash) DO UPDATE SET reason=excluded.reason`).bind(ORG, await metaPhoneHash(normalizePhone(event.from)), branch),
    db.prepare(`UPDATE growth_leads SET stage='not_qualified',outcome_reason=?,outcome_note=?,not_qualified_at=CURRENT_TIMESTAMP,next_action=NULL,next_action_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND stage!='won'`).bind(branch, action, submissionId, ORG),
  );
  try { await db.batch(statements); }
  catch (error) {
    const recorded = await db.prepare(`SELECT provider_message_id FROM meta_reply_decisions WHERE provider_message_id=? AND organization_id=?`).bind(event.providerMessageId, ORG).first();
    if (recorded) return true;
    if (String(error?.message).includes("meta_reply_state_conflict") && conflictAttempt < 3) return recordMetaReply(db, submissionId, event, { refreshRouting, conflictAttempt: conflictAttempt + 1 });
    throw error;
  }
  if (decision.state.ready_for_route_audit) {
    if (refreshRouting) { try { await refreshRouting(); } catch { /* Failed refresh leaves the audit blocked on stale data. */ } }
    await refreshMetaRouteGuidance(db, submissionId);
  }
  return true; // Meta replies use their own consent-gated outbox, never the website responder.
}

export async function recordQuoDelivery(db, event) {
  const message = event?.data?.object;
  if (!["message.delivered", "message.failed"].includes(event?.type) || message?.direction !== "outgoing" || typeof message.id !== "string" || !message.id || message.id.length > 120) return false;
  const status = event.type === "message.delivered" ? "delivered" : "failed";
  await db.prepare(`INSERT INTO quo_delivery_receipts (provider_message_id,organization_id,status) VALUES (?,?,?)
    ON CONFLICT(provider_message_id) DO UPDATE SET status=CASE WHEN quo_delivery_receipts.status='delivered' THEN 'delivered' ELSE excluded.status END`).bind(message.id.slice(0, 120), ORG, status).run();
  await db.batch([
    db.prepare(`UPDATE meta_sms_jobs SET status=?,delivered_at=CASE WHEN ?='delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,error_message=CASE WHEN ?='failed' THEN 'Quo reported delivery failure.' ELSE NULL END,updated_at=CURRENT_TIMESTAMP
      WHERE provider_message_id=? AND organization_id=? AND status IN ('sent','unknown','failed')`).bind(status, status, status, message.id, ORG),
    db.prepare(`UPDATE lead_messages SET delivery_status=? WHERE provider_message_id=? AND organization_id=? AND direction='outbound' AND delivery_status!='delivered'`).bind(status, message.id, ORG),
  ]);
  return true;
}

export async function reconcileQuoReceipts(db) {
  await db.batch([
    db.prepare(`UPDATE meta_sms_jobs SET status=(SELECT status FROM quo_delivery_receipts r WHERE r.provider_message_id=meta_sms_jobs.provider_message_id AND r.organization_id=meta_sms_jobs.organization_id),
      delivered_at=CASE WHEN EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=meta_sms_jobs.provider_message_id AND r.status='delivered') THEN COALESCE(delivered_at,CURRENT_TIMESTAMP) ELSE delivered_at END
      WHERE organization_id=? AND status IN ('sent','unknown','failed') AND EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=meta_sms_jobs.provider_message_id AND r.organization_id=meta_sms_jobs.organization_id)`).bind(ORG),
    db.prepare(`UPDATE lead_messages SET delivery_status=(SELECT status FROM quo_delivery_receipts r WHERE r.provider_message_id=lead_messages.provider_message_id AND r.organization_id=lead_messages.organization_id)
      WHERE organization_id=? AND direction='outbound' AND delivery_status!='delivered' AND EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=lead_messages.provider_message_id AND r.organization_id=lead_messages.organization_id)`).bind(ORG),
  ]);
}

export async function metaCadenceApproved(db, env) {
  if (!env.META_CADENCE_APPROVAL_ID || !await metaReleaseApproved(db, env)) return false;
  return Boolean(await db.prepare(`SELECT id FROM meta_automation_releases WHERE id=? AND organization_id=? AND policy_version=? AND revoked_at IS NULL AND length(approved_by)>0 AND length(evidence)>0 AND approved_at<=CURRENT_TIMESTAMP`).bind(env.META_CADENCE_APPROVAL_ID, ORG, META_CADENCE_VERSION).first());
}

export async function queueMetaCadence(db, env, submissionId) {
  if (!await metaCadenceApproved(db, env)) return false;
  const row = await currentJob(db, submissionId);
  if (!row?.sent_at || row.last_inbound_at) return false;
  const lead = parse(row.payload);
  await db.batch(metaFollowUpDrafts(lead.name).map((touch) => db.prepare(`INSERT OR IGNORE INTO meta_sms_jobs
    (id,purpose,trigger_id,sequence_step,due_at,submission_id,organization_id,conversation_id,message_body,status)
    VALUES (?,'follow_up',?,?,datetime(?,?),?,?,?,?,'queued')`).bind(`${submissionId}-follow-${touch.step}`, `${submissionId}:${touch.step}`, touch.step, row.sent_at, `+${touch.day} days`, submissionId, ORG, row.conversation_id, touch.body)));
  return true;
}

export async function initializeMetaResponseLibrary(db) {
  await db.batch(Object.entries(META_RESPONSES).map(([key, body]) => db.prepare(`INSERT OR IGNORE INTO meta_response_library (response_key,organization_id,body,policy_version) VALUES (?,?,?,?)`).bind(`${META_POLICY_VERSION}:${key}`, ORG, body, META_POLICY_VERSION)));
}

export async function markMetaNoResponse(env) {
  const db = env.DB;
  if (!db || !await metaCadenceApproved(db, env)) return { marked: 0 };
  const settings = await db.prepare(`SELECT assistant_enabled,human_review_required FROM lead_automation_settings WHERE organization_id=?`).bind(ORG).first();
  if (!settings?.assistant_enabled || settings.human_review_required) return { marked: 0 };
  const result = await db.prepare(`UPDATE growth_leads SET stage='not_qualified',outcome_reason='no_response',outcome_note='No reply after all three approved Meta follow-ups were delivered and the 48-hour grace period elapsed.',
    not_qualified_at=CURRENT_TIMESTAMP,next_action=NULL,next_action_at=NULL,updated_by='meta-cadence',updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=? AND stage IN ('new','contacted','qualified','quoted')
      AND EXISTS(SELECT 1 FROM lead_conversations c JOIN submissions s ON s.id=c.submission_id WHERE c.submission_id=growth_leads.submission_id AND c.organization_id=growth_leads.organization_id
        AND c.automation_mode='approved' AND c.last_inbound_at IS NULL AND c.status='waiting' AND s.status NOT IN ('converted','deleted') AND COALESCE(s.lifecycle_stage,'')!='converted')
      AND (SELECT COUNT(*) FROM meta_sms_jobs j WHERE j.submission_id=growth_leads.submission_id AND j.organization_id=growth_leads.organization_id AND j.purpose='follow_up' AND j.status='delivered')=3
      AND EXISTS(SELECT 1 FROM meta_sms_jobs j WHERE j.submission_id=growth_leads.submission_id AND j.purpose='follow_up' AND j.sequence_step=3 AND datetime(j.delivered_at)<=datetime('now','-48 hours'))
      AND NOT EXISTS(SELECT 1 FROM meta_sms_jobs j WHERE j.submission_id=growth_leads.submission_id AND j.status IN ('queued','sending','failed','unknown'))
    RETURNING submission_id`).bind(ORG).all();
  for (const row of result.results || []) await db.batch([
    db.prepare(`INSERT OR IGNORE INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,actor_email) VALUES (?, ?,?,'system','Not Qualified after approved Meta cadence and grace period','meta-cadence')`).bind(`meta-no-response-${row.submission_id}`, row.submission_id, ORG),
    db.prepare(`UPDATE lead_airtable_sync SET status='queued',attempt_count=0,revision=revision+1,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?`).bind(row.submission_id, ORG),
  ]);
  return { marked: (result.results || []).length };
}
