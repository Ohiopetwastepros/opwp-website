import {FAQ_TEMPLATES, faqAnswerKey} from './lead-playbook-faq.mjs';
import {readAirtableTextSafety} from './airtable-text-safety.mjs';
import {formatCustomerSms,stripSmsOptOutFooter} from './customer-sms.mjs';
import {normalizePhone} from './lead-assistant.mjs';
import {PlaybookError, playbookEnabled, playbookHash, createPlaybookLink, readPlaybookLink} from './lead-playbook-links.mjs';
import {queuePlaybookMirrorStatement} from './lead-playbook-mirror.mjs';
import {redactPlaybookText} from './playbook-redaction.mjs';
import {lintPlaybookText, renderPlaybookTemplate, matchesAuditedPlaybookLocation, PLAYBOOK_POLICY_VERSION, TEMPLATES} from './lead-playbook.mjs';
import {notifyPlaybookOwner,signupReadyNoticeStatements} from './lead-playbook-notifications.mjs';
import {controlledLeadRecipientAllowed as allowedLeadTestRecipient} from './lead-rollout-policy.mjs';
import {evaluatePlaybookCustomerAdmission} from './lead-playbook-customer-policy.mjs';
import {validateStructuredPlaybookDecision,STRUCTURED_SAFE_FALLBACK} from './lead-playbook-replies-v2.mjs';
import {loadPlaybookServiceAreaFacts} from './lead-playbook-service-area.mjs';
import {craigSignupEnabled,craigSignupMetaScopeAllowed,validateCraigSignupReply,CRAIG_READY_LABEL} from './lead-craig-signup.mjs';

const ORG = 'org-opwp';
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const isoTime = value => Date.parse(String(value || '').replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value || '')) ? '' : 'Z'));
function requireEnabled(env) { if (!playbookEnabled(env)) throw new PlaybookError('The playbook is disabled.', 503); }
export {playbookEnabled, PlaybookError};
export function editDistance(before, after) {
  let previous = Array.from({length: after.length + 1}, (_, i) => i);
  for (let i = 1; i <= before.length; i++) {
    const next = [i]; for (let j = 1; j <= after.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (before[i - 1] === after[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[after.length];
}
export function isPlaybookQuiet(settings, now = new Date()) {
  // The established settings may make quiet hours stricter, never remove 20:00-08:00 ET.
  const eastern = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now);
  if (eastern >= '20:00' || eastern < '08:00') return true;
  if (!settings?.quiet_hours_enabled) return false;
  let local; try { local = new Intl.DateTimeFormat('en-CA', {timeZone: settings.time_zone || 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now); } catch { return true; }
  const start = settings.quiet_hours_start || '20:00', end = settings.quiet_hours_end || '08:00';
  return start > end ? local >= start || local < end : local >= start && local < end;
}
async function currentLead(db, conversationId) {
  return db.prepare(`SELECT s.*,c.id conversation_id,c.owner,c.automation_mode,c.status conversation_status,c.last_inbound_at,c.deleted_at conversation_deleted_at,
    g.stage growth_stage FROM lead_conversations c JOIN submissions s ON s.id=c.submission_id LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=c.organization_id
    WHERE c.id=? AND c.organization_id=?`).bind(conversationId, ORG).first();
}
const routeAddress = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
async function assertCurrentQuoteRoute(db, draft) {
  if (!['quote_recurring','quote_one_time','service_day_answer'].includes(draft.template_key)) return;
  const slots = parse(draft.slots_json);
  const row = await db.prepare(`SELECT s.payload form_payload,s.zip form_zip,w.payload workspace_payload,i.route_guidance,i.route_audited_at,i.response_state FROM submissions s
    LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key=('lead_workspace:org-opwp:'||s.id)
    LEFT JOIN meta_lead_intakes i ON i.submission_id=s.id AND i.organization_id=? WHERE s.id=?`).bind(ORG, draft.submission_id).first();
  const workspace = parse(row?.workspace_payload), meta = parse(row?.route_guidance), metaState = parse(row?.response_state);
  let day = '', address = '', key = '';
  if (row?.route_audited_at && Array.isArray(meta.approvedDays) && meta.approvedDays.length === 1) {
    day = meta.approvedDays[0]; address = metaState.details?.address; key = row.route_audited_at;
  } else if (workspace.routeAudit?.actor && workspace.routeAudit?.day && workspace.handoffKey && workspace.routeAudit.handoffKey === workspace.handoffKey) {
    day = workspace.routeAudit.day; address = workspace.intake?.address; key = workspace.handoffKey;
  }
  const auditDetails = row?.route_audited_at ? metaState.details || {} : workspace.intake || {};
  const form = parse(row?.form_payload);
  const location = {city:auditDetails.city || form.city || '', zip:auditDetails.zip || row?.form_zip || form.zip || ''};
  if (!matchesAuditedPlaybookLocation(location, slots) || !key || key !== slots.route_audit_key || day !== slots.day || !routeAddress(address) || routeAddress(address) !== routeAddress(slots.address)) throw new PlaybookError('The address or route approval changed. Prepare a fresh quote before sending.');
}
async function assertEligible(db, env, lead) {
  requireEnabled(env);
  if (!lead || lead.owner !== 'backend' || !['suggest', 'approved'].includes(lead.automation_mode) || ['deleted', 'trashed', 'converted', 'synced'].includes(lead.status) || ['deleted', 'opted_out'].includes(lead.conversation_status) || lead.conversation_deleted_at || lead.lifecycle_stage === 'converted' || ['won', 'lost', 'not_qualified'].includes(lead.growth_stage)) throw new PlaybookError('This thread is not available to the playbook.');
  const settings = await db.prepare('SELECT * FROM lead_automation_settings WHERE organization_id=?').bind(ORG).first();
  if (!settings?.assistant_enabled) throw new PlaybookError('Lead assistant settings are paused.');
  const phone = normalizePhone(lead.phone);
  if (!phone || await db.prepare('SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').bind(ORG, await playbookHash(phone)).first()) throw new PlaybookError('This phone number is suppressed or unavailable.');
  if (!allowedLeadTestRecipient(env, phone)) throw new PlaybookError('Customer texting is limited to the approved controlled-test recipient.', 409);
  // This path sends only a freshly reviewed response, never a day-1/3/7 cadence
  // message. Active lead conversations remain available overnight.
  return settings;
}
function safeBody(body, draft, now = new Date()) {
  if (typeof body !== 'string' || !body.trim() || body.length > 1000 || /[\u2013\u2014]/.test(body)) throw new PlaybookError('Use up to 1,000 characters without long dashes.', 400);
  const prose = stripSmsOptOutFooter(body);
  const formatted = formatCustomerSms(body);
  if (draft.template_key === 'structured_playbook_v2') {
    const slots=parse(draft.slots_json);
    const violations = slots.craigSignupContext ? validateCraigSignupReply(formatted,slots.craigSignupContext) : validateStructuredPlaybookDecision(stripSmsOptOutFooter(formatted),slots,{now});
    if (violations.length) throw new PlaybookError('This reply does not match the current approved playbook: '+violations.join(', '),400);
    return formatted;
  }
  if (draft.template_key === 'confirm_details') {
    let canonical;
    try { canonical = renderPlaybookTemplate('confirm_details', parse(draft.slots_json)).replace(/\s*Reply STOP to opt out\s*$/, '').trim(); }
    catch { throw new PlaybookError('The form details changed. Prepare a fresh confirmation draft.', 400); }
    if (!prose.includes(canonical)) throw new PlaybookError('Keep the full form-details confirmation and its question when editing this draft.', 400);
  }
  const prior = parse(draft.prior_state_json), proposed = parse(draft.state_json);
  const state = ['quote_recurring','quote_one_time'].includes(draft.template_key) && draft.intent === 'confirm_yes' && prior.stage === 'confirm_details_sent' && proposed.details_confirmed === true ? {...prior, details_confirmed: true} : prior;
  const violations = lintPlaybookText(formatted, {intent: draft.intent, templateKey: draft.template_key, slots: parse(draft.slots_json), state});
  if (violations.length) throw new PlaybookError('This text does not pass playbook policy: ' + violations.join(', '), 400);
  return formatted;
}
export async function expirePlaybookDrafts(db, env) {
  if (!playbookEnabled(env)) return {enabled: false};
  await db.prepare("UPDATE lead_reply_drafts SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND expires_at<=CURRENT_TIMESTAMP").run();
  return {enabled: true};
}
export async function supersedePlaybookDrafts(db, env, conversationId) {
  if (!playbookEnabled(env)) return;
  await db.prepare("UPDATE lead_reply_drafts SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status='pending'").bind(conversationId, ORG).run();
}
export async function createPlaybookDraft(db, env, {conversation, lead, inboundMessageId, decision, classification = {}}) {
  if (!playbookEnabled(env)) return {enabled: false, draft: null};
  const live = await currentLead(db, conversation.id || conversation.conversation_id);
  await assertEligible(db, env, live);
  if (!decision?.body) return {enabled: true, draft: null};
  const id = crypto.randomUUID(), proposed = decision.state || decision.nextState || {}, prior = decision.priorState || decision.currentState || {};
  const priorJson = decision.priorStateJson || JSON.stringify(prior);
  const draft = {intent: decision.intent || classification.intent || 'other', template_key: decision.templateKey || null, slots_json: JSON.stringify(decision.slots || classification.slots || {}), prior_state_json: priorJson, state_json: JSON.stringify(proposed)};
  const body = safeBody(decision.body, draft);
  await db.batch([
    db.prepare(`INSERT INTO lead_reply_drafts(id,conversation_id,submission_id,organization_id,inbound_message_id,intent,confidence,template_key,answer_key,template_version,answer_version,slots_json,body,pricing_version,policy_version,status,reason,prior_state_json,state_json)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM lead_conversations WHERE id=? AND owner='backend' AND organization_id=?)
      AND (? IS NULL OR ?=(SELECT id FROM lead_messages WHERE conversation_id=? AND direction='inbound' ORDER BY created_at DESC,rowid DESC LIMIT 1))`)
      .bind(id, live.conversation_id, live.id || lead.id, ORG, inboundMessageId || null, draft.intent, decision.confidence ?? classification.confidence ?? 1, draft.template_key, decision.answerKey || null, String(decision.templateVersion || '1'), decision.answerVersion || null, draft.slots_json, body, decision.pricingVersion || null, decision.policyVersion || PLAYBOOK_POLICY_VERSION, decision.reason || '', priorJson, JSON.stringify(proposed), live.conversation_id, ORG, inboundMessageId || null, inboundMessageId || null, live.conversation_id),
    // A slow classification for an older inbound must not invalidate the newest
    // pending reply. The INSERT trigger queues a mirror only for an actual row.
    db.prepare("UPDATE lead_reply_drafts SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status='pending' AND id!=? AND EXISTS(SELECT 1 FROM lead_reply_drafts WHERE id=?)").bind(live.conversation_id, ORG, id, id),
    // Delegation is durable, including when rollout is later disabled. A legacy
    // queue must never replay a first text already reviewed through the playbook.
    db.prepare("UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND channel='customer_sms' AND status IN ('queued','failed') AND EXISTS(SELECT 1 FROM lead_reply_drafts WHERE id=?)").bind('playbook_delegated:' + id, live.id, id),
    db.prepare("UPDATE meta_sms_jobs SET status='cancelled',block_reason=?,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','blocked','failed') AND (? OR purpose='confirmation') AND EXISTS(SELECT 1 FROM lead_reply_drafts WHERE id=?)").bind('playbook_delegated:' + id, live.id, ORG, inboundMessageId ? 1 : 0, id),
    db.prepare("UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND status IN ('queued','failed') AND EXISTS(SELECT 1 FROM lead_reply_drafts WHERE id=?)").bind('playbook_delegated:' + id, live.conversation_id, ORG, id),
  ]);
  // D1 changes includes mirror-trigger writes. Prove this conditional INSERT by
  // its fresh ID instead of treating the aggregate write count as a row count.
  const created = await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=? AND conversation_id=?').bind(id, ORG, live.conversation_id).first();
  if (!created) return {enabled: true, draft: null, superseded: true};
  return {enabled: true, draft: created};
}
async function automaticDraftEligible(db,env,lead,draft,now=new Date()){
  if(env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED!=='true'||lead?.automation_mode!=='approved'||draft.policy_version!==PLAYBOOK_POLICY_VERSION)return false;
  const settings=await db.prepare('SELECT assistant_enabled,human_review_required FROM lead_automation_settings WHERE organization_id=?').bind(ORG).first();
  if(!settings?.assistant_enabled||settings.human_review_required)return false;
  if(draft.template_key==='structured_playbook_v2'){
    if(env.LEAD_CONVERSATION_V2_ENABLED!=='true')return false;
    const slots=parse(draft.slots_json);
    if(slots.craigSignupContext) return craigSignupEnabled(env) && !validateCraigSignupReply(draft.body,slots.craigSignupContext).length;
    const serviceArea=await loadPlaybookServiceAreaFacts(db,{now});
    slots.structuredContext={...slots.structuredContext,serviceArea};
    return validateStructuredPlaybookDecision(stripSmsOptOutFooter(draft.body),slots,{now}).length===0;
  }
  if(Number(draft.confidence)<0.8)return false;
  if (draft.answer_key && Object.hasOwn(FAQ_TEMPLATES,draft.template_key)) {
    const entry = await db.prepare('SELECT * FROM lead_answer_library WHERE answer_key=? AND organization_id=?').bind(draft.answer_key,ORG).first();
    if (draft.answer_key !== faqAnswerKey(draft.template_key) || !entry || !entry.auto_send_allowed || entry.approval_status !== 'approved' || Number(entry.version) !== Number(draft.answer_version) || entry.answer_template !== FAQ_TEMPLATES[draft.template_key]) return false;
  }
  if(draft.template_key){
    if(!Object.hasOwn(TEMPLATES,draft.template_key))return false;
    try{return renderPlaybookTemplate(draft.template_key,parse(draft.slots_json))===draft.body;}catch{return false;}
  }
  if(!draft.answer_key)return false;
  const answer=await db.prepare('SELECT * FROM lead_answer_library WHERE answer_key=? AND organization_id=?').bind(draft.answer_key,ORG).first();
  if(!answer||answer.approval_status!=='approved'||!answer.auto_send_allowed||Number(answer.version)!==Number(draft.answer_version))return false;
  const slots=parse(draft.slots_json);
  const rendered=formatCustomerSms(String(answer.answer_template).replace(/\{([a-z_]+)\}/g,(_,key)=>String(slots[key]??'').replace(/[\r\n\t]/g,' ').slice(0,200)));
  return rendered===draft.body;
}
export async function sendVerifiedPlaybookDraft(db,env,draftId,{sender,now=new Date(),loadCustomerDirectory,textSafety=readAirtableTextSafety}={}){
  if(!playbookEnabled(env))return {automatic:false,status:'disabled'};
  let draft=await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=?').bind(draftId,ORG).first();
  if(!draft||draft.status!=='pending')return {automatic:false,status:draft?.status||'missing'};
  const lead=await currentLead(db,draft.conversation_id);
  if(draft.template_key==='structured_playbook_v2'&&!parse(draft.slots_json).craigSignupContext&&env.LEAD_CONVERSATION_V2_ENABLED==='true'&&env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED==='true'&&lead?.owner==='backend'&&lead.automation_mode==='approved'){
    const slots=parse(draft.slots_json),freshArea=await loadPlaybookServiceAreaFacts(db,{now});
    const currentSlots={...slots,structuredContext:{...slots.structuredContext,serviceArea:freshArea}};
    const createdAt=new Date(isoTime(draft.created_at));
    if(validateStructuredPlaybookDecision(stripSmsOptOutFooter(draft.body),currentSlots,{now}).length&&
       !validateStructuredPlaybookDecision(stripSmsOptOutFooter(draft.body),slots,{now:createdAt}).length){
      const next=parse(draft.state_json);
      next.topic_holds=[...new Set([...(next.topic_holds||[]),'invalid_reply_fallback'])];
      const replacement={...currentSlots,structuredFallback:true};
      await db.prepare("UPDATE lead_reply_drafts SET body=?,slots_json=?,state_json=?,confidence=1,reason='invalid_reply_fallback',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending' AND body=? AND slots_json=?")
        .bind(STRUCTURED_SAFE_FALLBACK,JSON.stringify(replacement),JSON.stringify(next),draft.id,ORG,draft.body,draft.slots_json).run();
      draft=await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=?').bind(draftId,ORG).first();
      await notifyPlaybookOwner(db,env,{kind:'lead_review',submissionId:lead.id,conversationId:lead.conversation_id,eventKey:'invalid_reply_fallback:'+draft.inbound_message_id},{now}).catch(()=>({deferred:true}));
      console.warn(JSON.stringify({event:'structured_reply_authority_changed',draftId:draft.id,action:'safe_fallback'}));
    }
  }
  if(!await automaticDraftEligible(db,env,lead,draft,now))return {automatic:false,status:'pending'};
  try{return {...await actOnPlaybookDraft(db,env,draftId,{action:'approve'},'playbook-automatic',{sender,now,automatic:true,loadCustomerDirectory,textSafety}),automatic:true};}
  catch{
    const latest=await db.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').bind(draftId).first();
    return {automatic:true,status:latest?.status||'failed',needsReview:true};
  }
}
export async function listPlaybookWorkspace(db, env, {draftId = null, token = null} = {}) {
  if (!playbookEnabled(env)) return {enabled: false, drafts: [], candidates: [], alerts: [], stats: []};
  let capability;
  if (token) { capability = await readPlaybookLink(db, env, token); draftId = capability.draft_id; }
  await expirePlaybookDrafts(db, env);
  const draftResult = await db.prepare(`SELECT d.*,s.name lead_name,c.owner FROM lead_reply_drafts d JOIN submissions s ON s.id=d.submission_id JOIN lead_conversations c ON c.id=d.conversation_id WHERE d.organization_id=? AND (? IS NULL OR d.id=?) AND (d.status IN ('pending','sending','failed') OR ? IS NOT NULL) ORDER BY d.created_at DESC LIMIT 100`).bind(ORG, draftId, draftId, draftId).all();
  const drafts = draftResult.results || [];
  if (capability && (!drafts[0] || await playbookHash(drafts[0].body) !== capability.body_hash || drafts[0].status !== 'pending')) throw new PlaybookError('This draft changed or is no longer available.', 410);
  for (const draft of drafts) {
    draft.thread = (await db.prepare("SELECT direction,body,created_at,created_by FROM lead_messages WHERE conversation_id=? AND organization_id=? ORDER BY created_at DESC LIMIT 30").bind(draft.conversation_id, ORG).all()).results?.reverse() || [];
    draft.slots = parse(draft.slots_json);
  }
  if (capability) return {enabled: true, drafts, candidates: [], alerts: [], stats: [], pausedThreads: []};
  const [candidates, alerts, stats, pausedThreads, leadAlerts, ownerAlerts] = await Promise.all([
    db.prepare("SELECT * FROM playbook_candidates WHERE organization_id=? AND status='pending_review' ORDER BY support_count DESC,created_at LIMIT 100").bind(ORG).all(),
    db.prepare("SELECT kind,record_id,status,mismatch_json,error_message FROM playbook_airtable_sync WHERE organization_id=? AND status IN ('mismatch','failed') ORDER BY updated_at DESC LIMIT 50").bind(ORG).all(),
    db.prepare("SELECT intent,approvals,edits,rejections FROM lead_playbook_intent_stats WHERE organization_id=? ORDER BY intent").bind(ORG).all(),
    db.prepare("SELECT c.id conversation_id,s.name FROM lead_conversations c JOIN submissions s ON s.id=c.submission_id WHERE c.organization_id=? AND c.owner='craig' AND c.status!='deleted' ORDER BY c.updated_at DESC LIMIT 100").bind(ORG).all(),
    db.prepare("SELECT 'lead' kind,submission_id record_id,'mismatch' status,mismatch_json,error_message FROM lead_airtable_sync WHERE organization_id=? AND verification_status='mismatch' ORDER BY verified_at DESC LIMIT 50").bind(ORG).all(),
    db.prepare("SELECT 'owner_'||channel kind,id record_id,status,error_code error_message,NULL mismatch_json FROM lead_playbook_owner_notifications WHERE organization_id=? AND (status='uncertain' OR (status='sending' AND sending_at<datetime('now','-15 minutes'))) ORDER BY created_at DESC LIMIT 50").bind(ORG).all(),
  ]);
  return {enabled: true, drafts, candidates: candidates.results || [], alerts: [...(alerts.results || []), ...(leadAlerts.results || []),...(ownerAlerts.results||[])], stats: stats.results || [], pausedThreads: pausedThreads.results || []};
}
export async function actOnPlaybookDraft(db, env, id, command, actor, {sender, now = new Date(),automatic=false,loadCustomerDirectory,textSafety=readAirtableTextSafety} = {}) {
  requireEnabled(env);
  if (!['approve', 'edit_send', 'reject', 'take_over', 'hand_back'].includes(command.action)) throw new PlaybookError('Invalid review action.', 400);
  const draft = await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=?').bind(id, ORG).first();
  if (!draft) throw new PlaybookError('Draft not found.', 404);
  if (command.action === 'hand_back') {
    return setPlaybookOwner(db, env, draft.conversation_id, 'backend', {now});
  }
  if (draft.status !== 'pending' || isoTime(draft.expires_at) <= now.getTime()) { await expirePlaybookDrafts(db, env); throw new PlaybookError('This draft expired or was already reviewed.', 410); }
  let link = null;
  if (command.token) {
    link = await readPlaybookLink(db, env, command.token, now.getTime());
    if (link.draft_id !== id || link.body_hash !== await playbookHash(draft.body)) throw new PlaybookError('This review link does not match the draft.', 410);
  }
  const sends = ['approve', 'edit_send'].includes(command.action);
  const live = await currentLead(db, draft.conversation_id);
  const craigContext=parse(draft.slots_json).craigSignupContext;
  if (sends && craigContext) {
    if (!craigSignupEnabled(env)) throw new PlaybookError('Craig signup is disabled.');
    if (live?.source==='facebook') {
      const {metaReleaseApproved} = await import('./meta-lead-workflow.mjs');
      if (!craigSignupMetaScopeAllowed(env,parse(live.payload))||!await metaReleaseApproved(db,env)) throw new PlaybookError('The Craig signup release is unapproved.');
    }
  }
  const protectedAcknowledgment = admission => craigContext?.activeCustomer===true && admission.reason==='existing_customer';
  if (sends) await assertEligible(db, env, live, {sending: true, now});
  if(automatic&&(!sends||command.action!=='approve'||!await automaticDraftEligible(db,env,live,draft,now)))throw new PlaybookError('This reply requires owner review.');
  if (automatic) {
    const admission = await evaluatePlaybookCustomerAdmission(db, env, {lead: live, conversation: {id: live.conversation_id, organization_id: ORG}}, {loadCustomerDirectory, now});
    if (!admission.allowed && !protectedAcknowledgment(admission)) throw new PlaybookError(`Automatic reply held for owner review: ${admission.reason}.`);
  }
  if (command.action === 'reject' && (typeof command.reason !== 'string' || !command.reason.trim() || command.reason.length > 500)) throw new PlaybookError('Add a rejection reason up to 500 characters.', 400);
  const finalBody = sends ? safeBody(command.action === 'edit_send' ? command.body : draft.body, draft,now) : draft.body;
  const claim = crypto.randomUUID(), distance = editDistance(draft.body, finalBody);
  const claims = [db.prepare(`UPDATE lead_reply_drafts SET status='sending',send_claim=?,claimed_at=CURRENT_TIMESTAMP,approver=?,approved_at=CURRENT_TIMESTAMP,final_body=?,edit_distance=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP
    AND (? IS NULL OR EXISTS(SELECT 1 FROM lead_playbook_links l WHERE l.jti=? AND l.used_at IS NULL AND l.expires_at>?))
    AND (inbound_message_id IS NULL OR inbound_message_id=(SELECT id FROM lead_messages WHERE conversation_id=lead_reply_drafts.conversation_id AND direction='inbound' ORDER BY created_at DESC,rowid DESC LIMIT 1))`)
    .bind(claim, actor, finalBody, distance, id, ORG, link?.jti || null, link?.jti || null, Math.floor(now.getTime() / 1000))];
  if (link) claims.push(db.prepare("UPDATE lead_playbook_links SET used_at=? WHERE jti=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM lead_reply_drafts WHERE id=? AND send_claim=?)").bind(Math.floor(now.getTime() / 1000), link.jti, id, claim));
  if (command.action === 'take_over') claims.push(db.prepare("UPDATE lead_conversations SET owner='craig',owner_event_at=?,owner_event_id=?,owner_event_priority=3,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND EXISTS(SELECT 1 FROM lead_reply_drafts WHERE id=? AND send_claim=?)").bind(now.toISOString(), 'manual:' + crypto.randomUUID(), draft.conversation_id, ORG, id, claim));
  await db.batch(claims);
  // A status update also queues its mirror. The unique claim proves this action
  // won the conditional update, and a signed review must have consumed its link.
  const claimed = await db.prepare(`SELECT id FROM lead_reply_drafts WHERE id=? AND organization_id=? AND status='sending' AND send_claim=?
    AND (? IS NULL OR EXISTS(SELECT 1 FROM lead_playbook_links l WHERE l.jti=? AND l.draft_id=lead_reply_drafts.id AND l.used_at=?))`)
    .bind(id, ORG, claim, link?.jti || null, link?.jti || null, Math.floor(now.getTime() / 1000)).first();
  if (!claimed) throw new PlaybookError('A newer message or another review changed this draft. Reload before continuing.');
  async function finish(status, rejection = null) {
    await db.batch([db.prepare("UPDATE lead_reply_drafts SET status=?,rejection_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND send_claim=? AND status='sending'").bind(status, rejection, id, claim), queuePlaybookMirrorStatement(db, 'draft', id)]);
  }
  if (!sends) {
    await finish(command.action === 'take_over' ? 'superseded' : 'rejected', command.reason?.trim() || null);
    if (command.action === 'take_over') {
      await db.prepare("UPDATE lead_reply_drafts SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND status='pending'").bind(draft.conversation_id).run();
    } else if (draft.answer_key) {
      await db.batch([db.prepare('UPDATE lead_answer_library SET rejections=rejections+1 WHERE answer_key=? AND organization_id=?').bind(draft.answer_key, ORG), queuePlaybookMirrorStatement(db, 'library', draft.answer_key)]);
    }
    if (command.action === 'reject') await db.prepare(`INSERT INTO lead_playbook_intent_stats(organization_id,intent,rejections) VALUES (?,?,1) ON CONFLICT(organization_id,intent) DO UPDATE SET rejections=rejections+1`).bind(ORG, draft.intent).run();
    return {ok: true, status: command.action === 'take_over' ? 'taken_over' : 'rejected'};
  }
  try {
    // Recheck every gate after the durable claim and immediately before the provider.
    const beforeSend = await currentLead(db, draft.conversation_id);
    await assertEligible(db, env, beforeSend, {sending: true, now});
    if(automatic&&!await automaticDraftEligible(db,env,beforeSend,draft,now))throw new PlaybookError('Automatic reply approval changed.');
    const stillLatest = await db.prepare("SELECT id FROM lead_messages WHERE conversation_id=? AND direction='inbound' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(draft.conversation_id).first();
    if (draft.inbound_message_id && stillLatest?.id !== draft.inbound_message_id) throw new PlaybookError('A newer reply arrived. Review its new draft first.');
    const currentState = await db.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=? AND organization_id=?').bind(draft.conversation_id, ORG).first();
    if (!currentState || currentState.state_json !== draft.prior_state_json) throw new PlaybookError('The conversation state changed. Prepare a fresh draft.');
    await assertCurrentQuoteRoute(db, draft);
    if (automatic) {
      // A draft or ownership handback cannot substitute for current admission.
      // Recheck after the durable claim immediately before contacting Quo.
      const admission = await evaluatePlaybookCustomerAdmission(db, env, {lead: beforeSend, conversation: {id: beforeSend.conversation_id, organization_id: ORG}}, {loadCustomerDirectory, now});
      if (!admission.allowed && !protectedAcknowledgment(admission)) throw new PlaybookError(`Automatic reply held for owner review: ${admission.reason}.`);
    }
    if (draft.answer_key) {
      const currentAnswer = await db.prepare('SELECT version,approval_status FROM lead_answer_library WHERE answer_key=? AND organization_id=?').bind(draft.answer_key, ORG).first();
      if (!currentAnswer || currentAnswer.approval_status !== 'approved' || Number(currentAnswer.version) !== Number(draft.answer_version)) throw new PlaybookError('The approved answer changed. Prepare a fresh draft.');
    }
    const send = sender || (await import('./lead-assistant')).sendLeadMessage;
    const permission = await textSafety(env, beforeSend.phone, {now});
    if (!permission?.verified || permission.doNotText) throw new PlaybookError('Current contact texting permission is blocked or unverified.');
    await assertEligible(db, env, await currentLead(db, draft.conversation_id), {sending: true, now});
    // Explicit human approval permits suggest mode. Existing consent and suppression checks run again in sendLeadMessage.
    const message = await send(db, env, beforeSend, finalBody, 'playbook-approved:' + actor, automatic, {templateKey: draft.template_key,structuredSlots:draft.template_key==='structured_playbook_v2'?parse(draft.slots_json):undefined,now,textSafety});
    const receipt = draft.template_key==='structured_playbook_v2' ? await db.prepare('SELECT provider_message_id FROM lead_reply_drafts WHERE id=? AND send_claim=?').bind(id,claim).first() : null;
    if(receipt?.provider_message_id&&receipt.provider_message_id!==message.provider_message_id){
      await db.batch([
        db.prepare("UPDATE lead_reply_drafts SET status='failed',rejection_reason='provider_receipt_conflict',updated_at=CURRENT_TIMESTAMP WHERE id=? AND send_claim=? AND status='sending'").bind(id,claim),
        db.prepare("UPDATE lead_conversations SET owner='craig',automation_mode='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(draft.conversation_id,ORG),
        db.prepare("UPDATE growth_leads SET next_action='Craig: check conflicting SMS provider receipts before replying',next_action_at=CURRENT_TIMESTAMP,priority='high',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?").bind(draft.submission_id,ORG),
      ]);
      throw new PlaybookError('SMS provider receipts conflict. Check Quo before sending again.',409);
    }
    const updates = [db.prepare("UPDATE lead_reply_drafts SET status='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND send_claim=? AND status='sending'").bind(message.provider_message_id, id, claim), queuePlaybookMirrorStatement(db, 'draft', id),
      db.prepare(`INSERT INTO lead_playbook_intent_stats(organization_id,intent,approvals,edits) VALUES (?,?,?,?) ON CONFLICT(organization_id,intent) DO UPDATE SET approvals=approvals+excluded.approvals,edits=edits+excluded.edits`).bind(ORG, draft.intent, automatic?0:distance ? 0 : 1, distance ? 1 : 0)];
    if (draft.answer_key) updates.push(db.prepare(`UPDATE lead_answer_library SET approvals=approvals+?,edits=edits+?,last_used_at=CURRENT_TIMESTAMP WHERE answer_key=? AND organization_id=?`).bind(automatic?0:distance ? 0 : 1, distance ? 1 : 0, draft.answer_key, ORG), queuePlaybookMirrorStatement(db, 'library', draft.answer_key));
    if (distance) {
      const body = parse(beforeSend.payload), context = {names: [beforeSend.name, body.first_name, body.last_name].filter(Boolean), emails: [beforeSend.email], phones: [beforeSend.phone], addresses: [body.address, body.street_address].filter(Boolean)};
      const redacted = redactPlaybookText(finalBody, context);
      updates.push(db.prepare(`INSERT INTO playbook_candidates(id,kind,intent,question_redacted,answer_redacted,outcome,support_count,example_turn_ids,proposed_template,status,source,rule_violations_json)
        VALUES (?,'qa',?,? ,?,'unknown',1,?,?,'pending_review','approved_edit','[]')`).bind(crypto.randomUUID(), draft.intent, redactPlaybookText((await db.prepare('SELECT body FROM lead_messages WHERE id=?').bind(draft.inbound_message_id).first())?.body || '', context), redacted, JSON.stringify([draft.inbound_message_id].filter(Boolean)), redacted));
    }
    const next = parse(draft.state_json);
    updates.push(db.prepare(`UPDATE lead_playbook_state SET stage=?,prior_state_json=state_json,state_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND state_json=?`).bind(next.stage || 'escalated', draft.state_json, draft.conversation_id, draft.prior_state_json));
    const stateUpdateIndex=updates.length-1;
    const signupReady=craigContext && next.craigSignup?.readyForAccountSetup===true && !craigContext.state?.craigSignup?.readyForAccountSetup;
    if (signupReady) {
      const confirmed="EXISTS(SELECT 1 FROM lead_playbook_state WHERE conversation_id=? AND organization_id=? AND state_json=?)";
      updates.push(db.prepare(`UPDATE growth_leads SET next_action=?,next_action_at=CURRENT_TIMESTAMP,priority='high',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${confirmed}`)
        .bind(CRAIG_READY_LABEL,draft.submission_id,ORG,draft.conversation_id,ORG,draft.state_json));
      updates.push(db.prepare(`UPDATE lead_airtable_sync SET status='queued',revision=revision+1,attempt_count=0,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${confirmed}`)
        .bind(draft.submission_id,ORG,draft.conversation_id,ORG,draft.state_json));
      updates.push(...signupReadyNoticeStatements(db,env,draft,beforeSend.phone));
    }
    const completed = await db.batch(updates);
    const stateConflict = completed[stateUpdateIndex].meta?.changes !== 1 && (await db.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=?').bind(draft.conversation_id).first())?.state_json !== draft.state_json;
    if (stateConflict) await db.batch([
      db.prepare("UPDATE lead_reply_drafts SET rejection_reason='sent_state_conflict_check_thread' WHERE id=? AND send_claim=?").bind(id, claim),
      db.prepare("UPDATE lead_conversations SET owner='craig',owner_event_at=?,owner_event_id=?,owner_event_priority=3,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(new Date().toISOString(), 'manual:state-conflict:' + crypto.randomUUID(), draft.conversation_id, ORG),
      queuePlaybookMirrorStatement(db, 'draft', id),
    ]);
    if(craigContext && draft.reason==='wrong_number'){
      const {suppressLeadPhone} = await import('./lead-opt-out.mjs');
      const inbound=await db.prepare("SELECT provider_message_id,created_at FROM lead_messages WHERE id=? AND conversation_id=? AND direction='inbound'").bind(draft.inbound_message_id,draft.conversation_id).first();
      await suppressLeadPhone(db,env,{phone:beforeSend.phone,eventId:inbound?.provider_message_id||draft.inbound_message_id,at:inbound?.created_at||now,reason:'wrong_number'}).catch(()=>{
        console.error(JSON.stringify({event:'craig_signup_opt_out_mirror_failed',draftId:draft.id}));
      });
    }
    return {ok: true, status: 'sent', providerMessageId: message.provider_message_id, stateConflict};
  } catch (error) {
    // A timeout may have reached Quo. No automatic retry is offered for a claimed draft.
    await finish('failed', error instanceof PlaybookError ? 'policy_changed_before_send' : 'delivery_unconfirmed_check_quo');
    if (error instanceof PlaybookError) throw error;
    throw new PlaybookError('The text outcome is unconfirmed. Check Quo before sending anything else.', 502);
  }
}
export async function reviewPlaybookCandidate(db, env, id, command, actor) {
  requireEnabled(env);
  const row = await db.prepare("SELECT * FROM playbook_candidates WHERE id=? AND organization_id=? AND status='pending_review'").bind(id, ORG).first();
  if (!row) throw new PlaybookError('Candidate was already reviewed or does not exist.', 404);
  if (!['approve', 'reject'].includes(command.action)) throw new PlaybookError('Invalid library review action.', 400);
  const proposed = command.body ?? row.proposed_template;
  if (command.action === 'reject') {
    if (typeof command.reason !== 'string' || !command.reason.trim() || command.reason.length > 500) throw new PlaybookError('Add a rejection reason.', 400);
    const changed = await db.prepare("UPDATE playbook_candidates SET status='rejected',reviewer=?,reviewed_at=CURRENT_TIMESTAMP,rejection_reason=?,rule_violations_json=? WHERE id=? AND status='pending_review'").bind(actor, command.reason.trim(), JSON.stringify(['review_rejected']), id).run();
    if (changed.meta?.changes !== 1) throw new PlaybookError('This candidate changed. Reload it.');
    return {ok: true, status: 'rejected'};
  }
  if (typeof proposed !== 'string' || !proposed.trim() || proposed.length > 950 || /[\u2013\u2014]/.test(proposed)) throw new PlaybookError('The answer must fit one text without long dashes.', 400);
  if (/\{[^}]*\}|\[(?:NAME|EMAIL|PHONE|ADDRESS|NUMBER)\]/.test(proposed)) throw new PlaybookError('Remove personal placeholders before approving this reusable answer.', 400);
  const approved = formatCustomerSms(proposed);
  const violations = lintPlaybookText(approved, {intent: row.intent, templateKey: row.kind === 'objection' ? 'objection_discount' : null});
  if (violations.length) throw new PlaybookError('Resolve candidate policy violations before approving: ' + violations.join(', '), 400);
  const answerKey = 'playbook_' + id.replace(/[^a-zA-Z0-9]/g, '');
  const results = await db.batch([
    db.prepare("UPDATE playbook_candidates SET status='approved',proposed_template=?,reviewer=?,reviewed_at=CURRENT_TIMESTAMP,answer_key=?,rule_violations_json='[]' WHERE id=? AND status='pending_review'").bind(approved, actor, answerKey, id),
    db.prepare(`INSERT OR IGNORE INTO lead_answer_library(answer_key,organization_id,category,question,answer_template,keywords,response_mode,approval_status,auto_send_allowed,updated_by,intent,stage,source)
      SELECT ?,?,'playbook',COALESCE(question_redacted,''),?,'[]','static','approved',0,?,intent,NULL,CASE WHEN source='approved_edit' THEN 'approved_edit' ELSE 'mined' END FROM playbook_candidates WHERE id=? AND status='approved' AND reviewer=?`).bind(answerKey, ORG, approved, actor, id, actor),
    queuePlaybookMirrorStatement(db, 'library', answerKey),
  ]);
  if (results[0].meta?.changes !== 1) throw new PlaybookError('This candidate changed. Reload it.');
  return {ok: true, status: 'approved', answerKey};
}
export async function preparePlaybookNotification(db, env, draftId, now = Date.now()) {
  requireEnabled(env);
  const draft = await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=?').bind(draftId, ORG).first();
  if (!draft) throw new PlaybookError('Draft not found.', 404);
  const recipient = normalizePhone(env.LEAD_PLAYBOOK_CRAIG_CELL);
  if (!recipient) throw new PlaybookError('Playbook notifications are not configured.', 503);
  const token = await createPlaybookLink(db, env, draft, now);
  const origin = new URL(env.LEAD_PLAYBOOK_ADMIN_ORIGIN || 'https://www.ohiopetwastepros.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new PlaybookError('Invalid review link origin.', 503);
  return {recipient, token, body: `A lead reply is ready for review: ${origin.origin}/admin/playbook/d/${token}/`};
}
export async function setPlaybookOwner(db, env, conversationId, owner, {now = new Date()} = {}) {
  requireEnabled(env);
  if (!['backend', 'craig'].includes(owner)) throw new PlaybookError('Invalid conversation owner.', 400);
  const eventId = 'manual:' + crypto.randomUUID();
  await db.prepare("UPDATE lead_conversations SET owner=?,owner_event_at=?,owner_event_id=?,owner_event_priority=3,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND owner IN ('backend','craig') AND status!='deleted'").bind(owner, now.toISOString(), eventId, conversationId, ORG).run();
  // Taking ownership can supersede several drafts and queue their mirrors.
  const updated = await db.prepare('SELECT id FROM lead_conversations WHERE id=? AND organization_id=? AND owner=? AND owner_event_id=?').bind(conversationId, ORG, owner, eventId).first();
  if (!updated) throw new PlaybookError('This conversation cannot be handed to the playbook.');
  return {ok: true, status: owner === 'craig' ? 'taken_over' : 'handed_back'};
}
export async function notifyPlaybookDraft(db, env, draftId, {fetcher = fetch,emailSender, now = new Date()} = {}) {
  // Notifications are independently gated so local import/review never contacts the owner.
  if (!playbookEnabled(env) || env.LEAD_PLAYBOOK_NOTIFY_ENABLED !== 'true') return {enabled: false};
  const draft = await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=?').bind(draftId, ORG).first();
  if (!draft || draft.status !== 'pending') return {enabled: true, skipped: true};
  return notifyPlaybookOwner(db, env, {kind: 'pending_draft', submissionId: draft.submission_id, conversationId: draft.conversation_id, draftId, eventKey: `draft:${draftId}`}, {fetcher,emailSender, now});
}
