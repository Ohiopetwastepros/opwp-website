import { buildCustomerQuoteFollowUpSms } from "./quote-funnel.mjs";
import { readBoundedProviderJson } from "./bounded-body.mjs";

const ORG = "org-opwp";
const PREFIX = "quote-initial-sms-v1:";
export const initialQuoteSmsId = submissionId => PREFIX + submissionId;
const parse = value => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const manualKey = id => `lead_manual_send:${ORG}:${id}`;

export function initialSmsPhone(value) {
  const text = String(value || "").trim();
  if (!/^[+\d(). -]+$/.test(text)) return "";
  const digits = text.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits) || /^\d{3}55501\d{2}$/.test(digits)) return "";
  return `+1${digits}`;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readDelivery(db, id) {
  return db.prepare(`SELECT d.*,s.kind,s.source,s.funnel_id,s.status submission_status,s.phone,s.payload,s.created_at submitted_at,
    q.status parent_status,q.recipient,q.consent_at,q.consent_version,
    c.id conversation_id,c.status conversation_status,c.automation_mode,c.last_inbound_at,c.last_outbound_at,
    g.stage,g.outcome_reason,w.payload workspace_payload
    FROM quote_follow_up_deliveries d JOIN quote_follow_ups q ON q.id=d.follow_up_id
    JOIN submissions s ON s.id=d.submission_id
    LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id='org-opwp'
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id='org-opwp'
    LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key='lead_workspace:org-opwp:'||s.id
    WHERE d.id=? AND d.channel='customer_sms'`).bind(id).first();
}

async function suppressionReason(db, row, phoneHash, now, verification = false) {
  const body = parse(row.payload);
  if (row.kind !== "partial_quote" || row.source !== "website") return "ineligible_source";
  if (row.submission_status !== "follow_up_pending" || row.parent_status !== "queued" || row.status !== "sending") return "lead_or_job_cancelled";
  const age = now - Date.parse(row.submitted_at.replace(" ", "T") + "Z");
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000) return "initial_contact_window_expired";
  if (body.follow_up_allowed !== true || body.follow_up_consent !== true || body.follow_up_consent_version !== "quote_service_sms_v1" ||
      row.consent_version !== "quote_service_sms_v1" || !Number.isFinite(Date.parse(body.follow_up_consent_at)) ||
      Date.parse(body.follow_up_consent_at) < Date.parse(row.consent_at) ||
      Date.parse(body.follow_up_consent_at) > now + 60000) return "consent_missing_or_changed";
  const preference = String(body.preferred_channel || body.contact_preference || "").toLowerCase();
  if (preference && !["sms", "text", "text_message", "any", "either"].includes(preference)) return "contact_preference";
  if (body.opted_out || body.sms_opt_out || body.do_not_contact) return "opted_out";
  const phone = initialSmsPhone(row.phone);
  if (!phone || phone !== initialSmsPhone(row.recipient) || phone !== initialSmsPhone(body.phone)) return "invalid_or_changed_phone";
  if (!row.conversation_id || row.conversation_status !== "open" || row.automation_mode === "paused" ||
      row.last_inbound_at || row.last_outbound_at || (row.stage && row.stage !== "new") || row.outcome_reason ||
      parse(row.workspace_payload).handledAt) return "manual_takeover_or_existing_conversation";
  const suppressed = await db.prepare("SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?")
    .bind(ORG, phoneHash).first();
  if (suppressed) return "phone_suppressed";
  if (verification) return "";
  // Include other submissions for this phone, including converted/deleted leads.
  const handled = await db.prepare(`SELECT 1 handled FROM submissions s
    LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=?
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
    WHERE substr(replace(replace(replace(replace(replace(replace(s.phone,'+',''),'(',''),')',''),'-',''),' ',''),'.',''),-10)=?
      AND (s.status IN ('converted','synced','deleted') OR s.lifecycle_stage='converted'
        OR c.last_inbound_at IS NOT NULL OR c.last_outbound_at IS NOT NULL OR c.automation_mode='paused'
        OR COALESCE(g.stage,'new')!='new' OR g.outcome_reason IS NOT NULL
        OR EXISTS (SELECT 1 FROM lead_messages m WHERE m.conversation_id=c.id)
        OR EXISTS (SELECT 1 FROM growth_lead_events e WHERE e.submission_id=s.id AND e.organization_id='org-opwp'
          AND e.event_type IN ('note','state_changed','assigned'))
        OR EXISTS (SELECT 1 FROM airtable_cockpit_snapshots x WHERE x.snapshot_key='lead_manual_send:org-opwp:'||s.id
          AND COALESCE(json_extract(x.payload,'$.commandId'),'')!=?)) LIMIT 1`)
    .bind(ORG, ORG, phone.slice(-10), row.id).first();
  return handled ? "manual_takeover_or_existing_conversation" : "";
}

async function claimVerification(db, row, phoneHash) {
  if (!row.funnel_id) return false;
  // Only an owner-created database record can authorize a controlled production
  // test against prior conversation history. The public form cannot create it.
  const result = await db.prepare(`UPDATE airtable_cockpit_snapshots
    SET payload=json_set(payload,'$.deliveryId',?),updated_at=CURRENT_TIMESTAMP
    WHERE snapshot_key=? AND json_extract(payload,'$.phoneHash')=?
      AND json_extract(payload,'$.approvedByOwner')=1
      AND julianday(json_extract(payload,'$.expiresAt'))>julianday('now')
      AND julianday(json_extract(payload,'$.expiresAt'))<=julianday(captured_at,'+15 minutes')
      AND (json_extract(payload,'$.deliveryId') IS NULL OR json_extract(payload,'$.deliveryId')=?)`)
    .bind(row.id,"quote_initial_sms_verification:"+row.funnel_id,phoneHash,row.id).run();
  return Number(result.meta?.changes) === 1;
}

async function quoRead(env, path, fetcher) {
  const origin = env.QUO_API_BASE_URL || "https://api.openphone.com";
  if (!["https://api.openphone.com", "https://api.quo.com"].includes(origin)) throw new Error("quo_origin_invalid");
  const response = await fetcher(origin + path, {
    headers: { Authorization: env.QUO_API_KEY, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`quo_preflight_${response.status}`); }
  const result = await readBoundedProviderJson(response, 512 * 1024);
  if (!Array.isArray(result.data)) throw new Error("quo_preflight_invalid_response");
  return result;
}

async function providerHasConversation(env, phone, fetcher) {
  const numbers = await quoRead(env, "/v1/phone-numbers", fetcher);
  const inbox = numbers.data.find(number => initialSmsPhone(number.number) === initialSmsPhone(env.QUO_FROM_NUMBER));
  if (!inbox || !/^PN[A-Za-z0-9_-]+$/.test(inbox.id)) throw new Error("quo_sender_missing");
  const query = new URLSearchParams({ phoneNumberId: inbox.id, "participants[]": phone, maxResults: "1" });
  const [messages, calls] = await Promise.all([
    quoRead(env, "/v1/messages?" + query, fetcher), quoRead(env, "/v1/calls?" + query, fetcher),
  ]);
  return messages.data.length > 0 || calls.data.length > 0 || Boolean(messages.nextPageToken || calls.nextPageToken);
}

async function recordOutcome(db, row, status, reason, state, snapshotKey = "") {
  const statements = [db.prepare(`UPDATE quote_follow_up_deliveries SET status=?,error_message=?,
    cancelled_at=CASE WHEN ?='cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
    failed_at=CASE WHEN ?='failed' THEN CURRENT_TIMESTAMP ELSE failed_at END,
    sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
    provider_message_id=COALESCE(?,provider_message_id),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'`)
    .bind(status, reason || null, status, status, status, state.providerId || null, row.id),
  db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email)
    VALUES (?,?,'org-opwp','system',?,?,'quote-initial-sms')`)
    .bind(crypto.randomUUID(), row.submission_id, `Initial text ${state.status}`, JSON.stringify({deliveryId:row.id,reason,...state})),
  ];
  for (const key of [snapshotKey, manualKey(row.submission_id)].filter(Boolean)) {
    statements.push(db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP
      WHERE snapshot_key=? AND json_extract(payload,'$.commandId')=?`).bind(JSON.stringify(state), key, row.id));
  }
  await db.batch(statements);
  console.info(JSON.stringify({event:"initial_quote_sms",submissionId:row.submission_id,deliveryId:row.id,status:state.status,reason:reason||null,providerId:state.providerId||null}));
}

async function processDelivery(env, id, fetcher, now) {
  const db = env.DB;
  const claim = await db.prepare(`UPDATE quote_follow_up_deliveries SET status='sending',sending_at=CURRENT_TIMESTAMP,
    attempt_count=attempt_count+1,error_message=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND channel='customer_sms' AND status IN ('queued','failed') AND attempt_count<5 AND next_attempt_at<=CURRENT_TIMESTAMP`)
    .bind(id).run();
  if (!claim.meta?.changes) return "skipped";
  let row = await readDelivery(db, id);
  const phone = initialSmsPhone(row.phone);
  const hash = await digest(phone || String(row.phone || ""));
  let state = {commandId:id,status:"checking",submissionId:row.submission_id,startedAt:new Date(now).toISOString()};
  let snapshotKey = "";
  let dispatchStarted = false;
  try {
    const verification = await claimVerification(db, row, hash);
    state.verification = verification;
    let reason = await suppressionReason(db, row, hash, now, verification);
    if (!reason && (String(env.SMS_PROVIDER).toLowerCase() !== "quo" || !env.QUO_API_KEY || !initialSmsPhone(env.QUO_FROM_NUMBER))) throw new Error("quo_unconfigured");
    // The sender lookup and read permissions are exercised for controlled tests
    // too. Only their prior-history result receives the owner-approved allowance.
    if (!reason && await providerHasConversation(env, phone, fetcher) && !verification) reason = "existing_quo_conversation";
    if (reason) {
      await recordOutcome(db, row, "cancelled", reason, {...state,status:"suppressed"});
      return "suppressed";
    }
    // One durable reservation per normalized recipient, shared by submissions
    // and retries. Never expire an ambiguous provider send automatically.
    snapshotKey = "quote_initial_sms:org-opwp:" + hash;
    const reserved = await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
      VALUES (?,?,'success',CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO NOTHING`)
      .bind(snapshotKey, JSON.stringify(state)).run();
    if (!reserved.meta?.changes) {
      await recordOutcome(db, row, "cancelled", "duplicate_recipient", {...state,status:"suppressed"});
      return "suppressed";
    }
    const manual = await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
      VALUES (?,?,'success',CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO NOTHING`)
      .bind(manualKey(row.submission_id), JSON.stringify({...state,status:"sending"})).run();
    state.reserved = Boolean(manual.meta?.changes);
    const current = await readDelivery(db, id);
    reason = state.reserved ? await suppressionReason(db, current, hash, Date.now(), verification) : "manual_takeover";
    if (current.phone !== row.phone) reason = "lead_changed_during_preflight";
    if (reason) {
      await recordOutcome(db, row, "cancelled", reason, {...state,status:"suppressed"}, snapshotKey);
      return "suppressed";
    }
    row = current;
    const content = buildCustomerQuoteFollowUpSms(parse(row.payload));
    state = {...state,status:"sending",messageHash:await digest(content),idempotencyKey:snapshotKey};
    await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?")
      .bind(JSON.stringify(state), snapshotKey).run();
    dispatchStarted = true;
    // Quo has no documented idempotent POST. A timeout/5xx is quarantined,
    // retaining the reservation instead of risking another customer text.
    const response = await fetcher((env.QUO_API_BASE_URL || "https://api.openphone.com") + "/v1/messages", {
      method:"POST",headers:{Authorization:env.QUO_API_KEY,"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify({content,from:initialSmsPhone(env.QUO_FROM_NUMBER),to:[phone]}),
      redirect:"error",signal:AbortSignal.timeout(12000),
    });
    const data = await readBoundedProviderJson(response, 64 * 1024);
    if (!response.ok || typeof data?.data?.id !== "string") throw new Error(`quo_send_${response.status}`);
    state = {...state,status:"accepted",providerId:data.data.id,providerStatus:data.data.status||"accepted"};
    await recordOutcome(db, row, "sent", "", state, snapshotKey);
    await db.prepare(`INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,
      provider_message_id,body,delivery_status,automated,created_by)
      VALUES (?,?,'org-opwp','outbound','quo_sms',?,?,'queued',1,'quote-initial-sms')`)
      .bind(id, row.conversation_id, state.providerId, content).run();
    return "accepted";
  } catch (error) {
    const detail = /^quo_[a-z_0-9]+$/.test(error?.message || "") ? error.message : "preflight_failed";
    const reason = dispatchStarted ? "delivery_unconfirmed_check_quo_before_resending" : detail;
    if (dispatchStarted || snapshotKey) {
      await db.prepare("UPDATE quote_follow_up_deliveries SET attempt_count=5 WHERE id=?").bind(id).run();
      await recordOutcome(db, row, "failed", reason, {...state,status:dispatchStarted?"unknown":"failed"}, snapshotKey);
    } else {
      await db.prepare(`UPDATE quote_follow_up_deliveries SET status='failed',failed_at=CURRENT_TIMESTAMP,error_message=?,
        next_attempt_at=datetime('now','+1 minute'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'`).bind(reason,id).run();
      await recordOutcome(db, row, "failed", reason, {...state,status:"preflight_failed"});
    }
    return "failed";
  }
}

export async function runInitialQuoteSms(env, {submissionId = "",fetcher = fetch,now = Date.now()} = {}) {
  if (!env?.DB || env.QUOTE_INITIAL_SMS_ENABLED !== "true") return {enabled:false};
  const db = env.DB;
  const interrupted = await db.prepare(`SELECT id FROM quote_follow_up_deliveries
    WHERE id LIKE 'quote-initial-sms-v1:%' AND channel='customer_sms' AND status='sending'
      AND sending_at<datetime('now','-2 minutes') LIMIT 8`).all();
  for (const entry of interrupted.results || []) {
    const row = await readDelivery(db, entry.id);
    const snapshotKey = "quote_initial_sms:org-opwp:" + await digest(initialSmsPhone(row.phone) || String(row.phone || ""));
    const snapshot = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(snapshotKey).first();
    const state = parse(snapshot?.payload);
    await db.prepare("UPDATE quote_follow_up_deliveries SET attempt_count=5 WHERE id=?").bind(row.id).run();
    await recordOutcome(db,row,"failed","worker_interrupted_check_quo_before_resending",
      {...state,commandId:row.id,status:"unknown"},snapshotKey);
  }
  // Historical UUID delivery IDs can never enter this worker, even if their
  // timestamps or next-attempt values change. Other channels stay untouched.
  const due = await db.prepare(`SELECT id FROM quote_follow_up_deliveries
    WHERE id LIKE 'quote-initial-sms-v1:%' AND channel='customer_sms'
      AND status IN ('queued','failed') AND attempt_count<5 AND next_attempt_at<=CURRENT_TIMESTAMP
      AND (?='' OR submission_id=?) ORDER BY created_at LIMIT 8`).bind(submissionId,submissionId).all();
  const result = {enabled:true,attempted:0,accepted:0,suppressed:0,failed:0};
  for (const row of due.results || []) {
    const status = await processDelivery(env,row.id,fetcher,now);
    result.attempted += 1;
    if (status in result) result[status] += 1;
  }
  return result;
}
