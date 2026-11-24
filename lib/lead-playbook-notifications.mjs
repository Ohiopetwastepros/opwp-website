import {FAQ_REASON_LABELS} from './lead-playbook-faq.mjs';
import {redactStaffExcerpt} from './playbook-redaction.mjs';
import {normalizePhone} from './lead-assistant.mjs';
import {createPlaybookLink, playbookEnabled, playbookHash, PlaybookError} from './lead-playbook-links.mjs';
import {controlledLeadRecipientAllowed, controlledLeadTestRecipient, isCraigMetaTest} from './lead-rollout-policy.mjs';

const ORG = 'org-opwp';
const STAFF_PROOF_PREFIX = 'staff_sms_v2:';
const KINDS = new Set(['pending_draft', 'signup_ready', 'property_walk', 'lead_review']);
const enabled = env => playbookEnabled(env) && env.LEAD_PLAYBOOK_NOTIFY_ENABLED === 'true';
const changed = result => Number(result?.meta?.changes || 0) === 1;
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
// Ordinary detail collection belongs in the customer conversation/workspace.
// Only a named business or safety exception should interrupt the owner.
const EXCEPTIONS = Object.freeze({
  ...FAQ_REASON_LABELS,
  property_walk: 'The property needs a walk before quoting',
  signup_ready: 'The customer is ready for account setup',
  signup_handoff: 'The confirmed signup details need account setup',
  identity_question: 'The customer asked to speak with Craig about these automated texts',
  is_this_ai: 'The customer asked to speak with Craig about these automated texts',
  custom_pricing: 'The request needs a custom price',
  route_day_requires_confirmation: 'The service day needs confirmation',
  service_billing_or_anger: 'An existing service, billing issue, or complaint needs attention',
  existing_customer: 'An existing customer needs personal review',
  customer_directory_unverified: 'Existing customer status could not be verified',
  outside_service_area: 'The property is outside the approved service area',
  question_payment: 'The customer has a payment question',
  reschedule_timing: 'The customer needs a scheduling decision',
  objection_before_quote: 'A pricing objection needs review before a quote',
  second_objection: 'The customer requested personal review of the price',
  no_approved_library_answer: 'The question has no approved answer',
  signup_access_requires_review: 'The signup access details need a personal decision',
  delivery_review: 'A customer reply delivery needs review before any retry',
  price_pushback: 'The lead questioned the price or requested a discount',
  complaint: 'The lead reported a complaint and needs a personal response',
  cash: 'A cash arrangement must be handled offline by Craig',
  off_playbook: 'The request is outside the approved playbook',
  uncertain: 'The requested decision needs Craig to confirm the answer',
  spanish: 'The lead needs a personal response in Spanish',
  requested_owner: 'The lead asked to speak with Craig',
  unclear_repeated: 'The lead is still unclear after two different clarification questions',
  coverage_review: 'Craig must confirm the service-area exception',
  invalid_reply_fallback: 'Reply validation failed and the lead received a safe fallback',
  unanswered_inbound: 'The lead is awaiting a reply and needs Craig to follow up',
});
export const playbookOwnerNoticeReasonAllowed = reason => Object.hasOwn(EXCEPTIONS, reason);
export function playbookNoticeChannels(env = {}) {
  if (env.LEAD_PLAYBOOK_NOTIFY_CHANNELS === undefined) return ['sms', 'email'];
  const channels = String(env.LEAD_PLAYBOOK_NOTIFY_CHANNELS).split(',').map(value => value.trim());
  return channels.some(value => !['sms', 'email'].includes(value)) ? [] : [...new Set(channels)];
}
export function playbookOwnerSmsRecipient(env = {}, leadPhone) {
  if (env.META_TEST_MODE === 'true') {
    const controlled = env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === true || env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === 'true';
    const target = controlledLeadTestRecipient(env);
    return controlled && target && isCraigMetaTest(env, target) && normalizePhone(leadPhone) === target ? target : null;
  }
  return normalizePhone(env.LEAD_PLAYBOOK_CRAIG_CELL);
}
export function playbookNoticeLeadAllowed(env = {}, phone) {
  return env.META_TEST_MODE === 'true' ? Boolean(playbookOwnerSmsRecipient(env, phone)) : controlledLeadRecipientAllowed(env, phone);
}
export function playbookReplyWatchdogAgeMs(env = {}) {
  const seconds = Number(env.LEAD_REPLY_WATCHDOG_SECONDS);
  return (Number.isFinite(seconds) && seconds >= 60 && seconds <= 120 ? Math.trunc(seconds) : 120) * 1000;
}
const smsProof = (row, claim, recipient, from, body) => playbookHash(JSON.stringify([row.id,claim,recipient,from,String(body)]));
const parsedTime = value => Date.parse(String(value || '').replace(' ','T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value || '')) ? '' : 'Z'));

// Provider delivery webhooks can arrive before the HTTP send returns its ID.
// A claimed outbox row stores a body/recipient proof before transport, and the
// first exact receipt binds that ID atomically. A later manual message with the
// same text and a different ID cannot borrow the proof. No prefix-only bypass.
export async function isPlaybookOwnerNotificationReceipt(db, env, event, {now = new Date()} = {}) {
  if (event?.direction !== 'outbound' || event.isGroup || typeof event.providerMessageId !== 'string' || !event.providerMessageId || event.providerMessageId.length > 160) return false;
  const from = normalizePhone(event.from), recipient = normalizePhone(event.to), expectedFrom = normalizePhone(env.QUO_FROM_NUMBER);
  if (!from || from !== expectedFrom || !recipient) return false;
  const known = await db.prepare(`SELECT 1 matched FROM lead_playbook_owner_notifications WHERE organization_id=? AND channel='sms' AND provider_message_id=?
    UNION ALL SELECT 1 matched FROM lead_reply_drafts WHERE organization_id=? AND notification_message_id=? LIMIT 1`)
    .bind(ORG,event.providerMessageId,ORG,event.providerMessageId).first();
  if (known) return true;
  if (env.LEAD_CONVERSATION_V2_ENABLED !== 'true') return false;
  const date = new Date(now), eventAt = parsedTime(event.createdAt);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(eventAt) || eventAt > date.getTime() + 60000) return false;
  const rows = await db.prepare(`SELECT n.id,n.claim_token,n.sending_at,n.error_code,s.phone FROM lead_playbook_owner_notifications n
    JOIN submissions s ON s.id=n.submission_id
    WHERE n.organization_id=? AND n.channel='sms' AND n.status IN ('sending','uncertain') AND n.provider_message_id IS NULL
      AND n.claim_token IS NOT NULL AND n.error_code LIKE ? AND julianday(n.sending_at)>=julianday(?)
    ORDER BY n.sending_at DESC,n.id LIMIT 20`)
    .bind(ORG,STAFF_PROOF_PREFIX+'%',new Date(date.getTime()-5*60000).toISOString()).all();
  for (const row of rows.results || []) {
    const sentAt = parsedTime(row.sending_at);
    if (!Number.isFinite(sentAt) || eventAt < sentAt-5000 || eventAt > sentAt+120000 || playbookOwnerSmsRecipient(env,row.phone) !== recipient) continue;
    const proof = STAFF_PROOF_PREFIX + await smsProof(row,row.claim_token,recipient,from,event.text);
    if (proof !== row.error_code) continue;
    const claimed = await db.prepare(`UPDATE lead_playbook_owner_notifications SET provider_message_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=? AND claim_token=? AND error_code=? AND status IN ('sending','uncertain') AND provider_message_id IS NULL`)
      .bind(event.providerMessageId,row.id,ORG,row.claim_token,proof).run();
    if (changed(claimed)) return true;
    const prior = await db.prepare('SELECT provider_message_id FROM lead_playbook_owner_notifications WHERE id=? AND organization_id=?').bind(row.id,ORG).first();
    if (prior?.provider_message_id === event.providerMessageId) return true;
  }
  return false;
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function customerExcerpt(value, limit) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return limit > 3 ? text.slice(0, limit - 3) + '...' : '';
}

async function noticeContext(db, row, {env = {}, now = new Date()} = {}) {
  let draft = null, reason = '', messageId = null;
  const parts = String(row.event_key || row.eventKey || '').split(':');
  const referencedId = parts.at(-1);
  const draftId = row.draft_id || (parts[0] === 'delivery-review' ? referencedId : null);
  if (draftId) {
    draft = await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=? AND conversation_id=? AND submission_id=?')
      .bind(draftId, ORG, row.conversation_id, row.submission_id).first();
    if (!draft || row.draft_id && draft.status !== 'pending') return null;
    reason = parts[0] === 'delivery-review' ? 'delivery_review' : draft.reason || parse(draft.state_json).escalation_reason || '';
    messageId = draft.inbound_message_id;
  } else {
    // Persisted event keys bind the reason/message to this notification. Never
    // substitute the latest inbound: a delayed flush could quote another turn.
    reason = parts.find(playbookOwnerNoticeReasonAllowed) || (['signup_ready', 'property_walk'].includes(row.kind) ? row.kind : '');
    if (!reason) {
      const stateRow = await db.prepare('SELECT state_json FROM lead_playbook_state WHERE conversation_id=? AND organization_id=?').bind(row.conversation_id, ORG).first();
      const state = parse(stateRow?.state_json);
      if (state.last_inbound_message_id !== referencedId) return null;
      reason = state.escalation_reason || '';
    }
    messageId = referencedId;
  }
  if (!playbookOwnerNoticeReasonAllowed(reason)) return null;
  if (reason === 'unanswered_inbound' && !await playbookInboundStillUnanswered(db, env, {conversationId: row.conversation_id, submissionId: row.submission_id, inboundId: messageId, now})) return null;
  const inbound = messageId ? await db.prepare("SELECT body,rowid message_row,created_at FROM lead_messages WHERE id=? AND conversation_id=? AND organization_id=? AND direction='inbound'")
    .bind(messageId, row.conversation_id, ORG).first() : null;
  if (!draft && inbound && parts[0] !== 'directory-review') draft = await db.prepare("SELECT * FROM lead_reply_drafts WHERE reason=? AND conversation_id=? AND submission_id=? AND organization_id=? AND inbound_message_id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP LIMIT 1").bind(reason,row.conversation_id,row.submission_id,ORG,messageId).first();
  const lead = await db.prepare('SELECT name,phone FROM submissions WHERE id=?').bind(row.submission_id).first();
  // Bind the previous quote to the trigger turn. A later quote or an unsent
  // proposal cannot appear in a delayed/retried alert about an earlier SMS.
  let priorQuote = '';
  if (inbound) {
    const messages = await db.prepare("SELECT body FROM lead_messages WHERE organization_id=? AND conversation_id=? AND direction='outbound' AND delivery_status IN ('sent','delivered') AND body LIKE '%$%' AND (strftime('%Y-%m-%dT%H:%M:%S',created_at)<strftime('%Y-%m-%dT%H:%M:%S',?) OR (strftime('%Y-%m-%dT%H:%M:%S',created_at)=strftime('%Y-%m-%dT%H:%M:%S',?) AND rowid<?)) ORDER BY julianday(created_at) DESC,rowid DESC LIMIT 30")
      .bind(ORG, row.conversation_id, inbound.created_at, inbound.created_at, inbound.message_row).all();
    priorQuote = (messages.results || []).find(item => /\b(?:first|initial|one[- ]time) clean(?:up|[- ]up)|\b(?:weekly|biweekly|monthly rate|per month)\b/i.test(item.body) && !/\b(?:haul[- ]away|deodori[sz]|saniti[sz]|front yard|dog fuel)\b/i.test(item.body))?.body || '';
    if (!priorQuote) {
      // Historical reviewed drafts can predate the outbound ledger. Only use
      // a proven acceptance strictly before the trigger second. A later Quo
      // receipt must never be presented as the quote the customer replied to.
      const accepted = await db.prepare("SELECT d.final_body,d.body FROM lead_reply_drafts d WHERE d.organization_id=? AND d.conversation_id=? AND d.status='sent' AND d.template_key IN ('quote_recurring','quote_one_time') AND d.provider_message_id IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%S',d.updated_at)<strftime('%Y-%m-%dT%H:%M:%S',?) AND NOT EXISTS(SELECT 1 FROM lead_messages m WHERE m.conversation_id=d.conversation_id AND m.organization_id=d.organization_id AND m.provider_message_id=d.provider_message_id) ORDER BY d.updated_at DESC,d.rowid DESC LIMIT 1")
        .bind(ORG,row.conversation_id,inbound.created_at).first();
      priorQuote = accepted?.final_body || accepted?.body || '';
    }
  }
  return {draft, reason, name: lead?.name || '', phone: normalizePhone(lead?.phone), customerText: inbound?.body || '', priorQuote};
}

function reviewOrigin(env) {
  const origin = new URL(env.LEAD_PLAYBOOK_ADMIN_ORIGIN || env.SITE_ORIGIN || 'https://www.ohiopetwastepros.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new PlaybookError('Invalid review link origin.', 503);
  return origin.origin;
}
async function messageFor(db, env, row, now, context) {
  const origin = reviewOrigin(env);
  let link = origin + '/admin/quote-funnel/?lead=' + encodeURIComponent(row.submission_id);
  if (context.draft?.status === 'pending' && !row.draft_id) {
    try { link = origin + '/admin/playbook/d/' + await createPlaybookLink(db, env, context.draft, now.getTime()) + '/'; }
    catch { /* The secure lead inbox remains available for this durable handoff. */ }
  } else if (row.draft_id) {
    link = `${origin}/admin/playbook/d/${await createPlaybookLink(db, env, context.draft, now.getTime())}/`;
  }
  // A unique staff reference also distinguishes concurrent alerts about an
  // otherwise identical customer sentence during the pre-ID webhook race.
  if (env.LEAD_CONVERSATION_V2_ENABLED === 'true') link += (link.includes('?') ? '&' : '?') + 'alert=' + encodeURIComponent(row.id);
  const title = '[OPWP STAFF ALERT] ' + (context.reason === 'unanswered_inbound' ? 'A lead is waiting for a reply' : row.kind === 'signup_ready' ? 'A lead is ready for signup' : row.kind === 'property_walk' ? 'A lead needs a property walk' : row.kind === 'lead_review' ? 'A lead question needs your review' : 'A lead reply is ready for review');
  const explanation = `${EXCEPTIONS[context.reason]} (${context.reason}).`;
  const name = customerExcerpt(redactStaffExcerpt(context.name), 65) || 'Not provided';
  const phone = context.phone || 'Not provided';
  const prior = customerExcerpt(redactStaffExcerpt(context.priorQuote), 275) || 'None recorded';
  const base = `${title}. Reason: ${explanation} Name: ${name}. Phone: ${phone}. Prior quote: ${prior} ${link}`;
  const excerpt = customerExcerpt(redactStaffExcerpt(context.customerText), Math.min(450, Math.max(20, 970 - base.length)));
  const text = `${title}. Reason: ${explanation} Name: ${name}. Phone: ${phone}. Prior quote: ${prior}.${excerpt ? ` Customer said: "${excerpt}"` : ''} ${link}`;
  const html = `<p>${escapeHtml(title)}.</p><p>Reason: ${escapeHtml(explanation)}</p><p>Name: ${escapeHtml(name)}<br>Phone: ${escapeHtml(phone)}</p>${excerpt ? `<p>Customer said: <q>${escapeHtml(excerpt)}</q></p>` : ''}<p>Prior quote: ${escapeHtml(prior)}</p><p><a href="${escapeHtml(link)}">Open secure lead review</a></p>`;
  return {subject: title, text, html};
}

export async function queuePlaybookOwnerNotice(db, env, {kind, submissionId, conversationId, draftId = null, eventKey}, {now = new Date()} = {}) {
  if (!enabled(env)) return {enabled: false};
  if (!KINDS.has(kind) || typeof eventKey !== 'string' || !eventKey || eventKey.length > 200) throw new PlaybookError('Invalid owner notification.', 400);
  const context = await noticeContext(db, {kind, submission_id: submissionId, conversation_id: conversationId, draft_id: draftId, event_key: eventKey}, {env, now});
  if (!context) return {enabled: true, skipped: true, reason: 'not_staff_exception'};
  if (!playbookNoticeLeadAllowed(env, context.phone)) return {enabled: true, skipped: true, reason: 'controlled_test_recipient'};
  const channels = playbookNoticeChannels(env);
  if (!channels.length) return {enabled: true, skipped: true, reason: 'notification_channels_disabled'};
  const rows = channels.map(channel => db.prepare(`INSERT OR IGNORE INTO lead_playbook_owner_notifications
    (id,event_key,kind,submission_id,conversation_id,draft_id,channel)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM submissions s JOIN lead_conversations c ON c.submission_id=s.id
      WHERE s.id=? AND c.id=? AND c.organization_id=? AND s.status NOT IN ('deleted','trashed') AND c.status!='deleted')`)
    .bind(crypto.randomUUID(), eventKey, kind, submissionId, conversationId, draftId, channel, submissionId, conversationId, ORG));
  await db.batch(rows);
  return {enabled: true, eventKey};
}

async function sendSms(env, to, text, fetcher) {
  if (env.META_TEST_MODE === 'true' && playbookOwnerSmsRecipient(env, to) !== to) throw new PlaybookError('Owner SMS is outside the controlled test scope.', 503);
  const origin = env.QUO_API_BASE_URL || 'https://api.openphone.com';
  if (!['https://api.openphone.com', 'https://api.quo.com'].includes(origin)) throw new PlaybookError('Invalid Quo notification origin.', 503);
  const response = await fetcher(origin + '/v1/messages', {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12000),
    headers: {Authorization: env.QUO_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json'},
    // Staff alerts can share the controlled lead's test number, so their explicit
    // staff label stays intact and they never use the customer opt-out footer.
    body: JSON.stringify({from: normalizePhone(env.QUO_FROM_NUMBER), to: [to], content: text})});
  const {readBoundedProviderJson} = await import('./bounded-body.mjs');
  const result = await readBoundedProviderJson(response, 16384), id = result.data?.id || result.id;
  if (!response.ok || typeof id !== 'string' || !id || id.length > 200) throw new Error('notification_delivery_unconfirmed');
  return id;
}

export async function flushPlaybookOwnerNotices(db, env, {eventKey = null, fetcher = fetch, emailSender, now = new Date(), limit = 20} = {}) {
  if (!enabled(env)) return {enabled: false};
  const rows = await db.prepare(`SELECT * FROM lead_playbook_owner_notifications WHERE status='queued'
    AND (? IS NULL OR event_key=?) ORDER BY created_at,id LIMIT ?`).bind(eventKey, eventKey, Math.max(1, Math.min(40, limit))).all();
  let accepted = 0, uncertain = 0, deferred = 0, cancelled = 0;
  for (const row of rows.results || []) {
    if (!playbookNoticeChannels(env).includes(row.channel)) {
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='notification_channel_disabled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      cancelled++; continue;
    }
    const live = await db.prepare(`SELECT s.status,c.status conversation_status,d.status draft_status,d.expires_at,d.expires_at<=CURRENT_TIMESTAMP draft_expired
      FROM submissions s JOIN lead_conversations c ON c.id=? AND c.submission_id=s.id
      LEFT JOIN lead_reply_drafts d ON d.id=? WHERE s.id=? AND c.organization_id=?`).bind(row.conversation_id, row.draft_id, row.submission_id, ORG).first();
    if (!live || ['deleted', 'trashed'].includes(live.status) || live.conversation_status === 'deleted' || row.draft_id && (live.draft_status !== 'pending'||live.draft_expired)) {
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='lead_or_draft_changed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      cancelled++; continue;
    }
    const context = await noticeContext(db, row, {env, now});
    if (!context) {
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='not_staff_exception',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      cancelled++; continue;
    }
    if (!playbookNoticeLeadAllowed(env, context.phone)) {
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='controlled_test_recipient',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      cancelled++; continue;
    }
    const recipient = row.channel === 'sms' ? playbookOwnerSmsRecipient(env, context.phone) : String(env.OWNER_NOTIFICATION_EMAIL || '').trim();
    let sendEmail = emailSender;
    if (row.channel === 'sms') {
      if (!recipient || !env.QUO_API_KEY || !normalizePhone(env.QUO_FROM_NUMBER)) { deferred++; continue; }
      if (await db.prepare('SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').bind(ORG, await playbookHash(recipient)).first()) {
        await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='owner_sms_suppressed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
        cancelled++; continue;
      }
    } else {
      if (!recipient) { deferred++; continue; }
      if (!sendEmail) {
        const transport = await import('./submission-notifications.js');
        if (!transport.transactionalEmailConfig(env).configured) { deferred++; continue; }
        sendEmail = transport.sendTransactionalEmail;
      }
    }
    let content;
    try { content = await messageFor(db, env, row, now, context); }
    catch { deferred++; continue; }
    if (!content) { deferred++; continue; }
    const claim = crypto.randomUUID();
    const reserved = await db.prepare(`UPDATE lead_playbook_owner_notifications SET status='sending',claim_token=?,sending_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='queued' AND EXISTS(SELECT 1 FROM submissions s WHERE s.id=lead_playbook_owner_notifications.submission_id AND s.status NOT IN ('deleted','trashed'))
      AND (draft_id IS NULL OR EXISTS(SELECT 1 FROM lead_reply_drafts d WHERE d.id=draft_id AND d.status='pending' AND d.expires_at>CURRENT_TIMESTAMP))`).bind(claim, row.id).run();
    if (!changed(reserved)) continue;
    let staffProof = null;
    try {
      // Owner alerts and actively reviewed replies are immediate at every hour.
      // Cadence automation has its own disabled gate; it never uses this outbox.
      if (!enabled(env) || !playbookNoticeChannels(env).includes(row.channel)) {
        await db.prepare("UPDATE lead_playbook_owner_notifications SET status='queued',claim_token=NULL,sending_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'").bind(row.id, claim).run();
        deferred++; continue;
      }
      if (row.channel === 'sms' && env.LEAD_CONVERSATION_V2_ENABLED === 'true') {
        staffProof = STAFF_PROOF_PREFIX + await smsProof(row,claim,recipient,normalizePhone(env.QUO_FROM_NUMBER),content.text);
        const proved = await db.prepare("UPDATE lead_playbook_owner_notifications SET error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'").bind(staffProof,row.id,claim).run();
        if (!changed(proved)) continue;
      }
      // STOP or a manual reply may arrive while a review link/claim is being
      // prepared. Recheck immediately before transport, not only at dequeue.
      const unansweredResolved = context.reason === 'unanswered_inbound' && !await playbookInboundStillUnanswered(db, env, {conversationId: row.conversation_id, submissionId: row.submission_id, inboundId: String(row.event_key).split(':').at(-1), now});
      const smsSuppressed = row.channel === 'sms' && await db.prepare('SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').bind(ORG, await playbookHash(recipient)).first();
      if (unansweredResolved || smsSuppressed || row.channel === 'sms' && playbookOwnerSmsRecipient(env, context.phone) !== recipient) {
        await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'")
          .bind(unansweredResolved ? 'unanswered_inbound_resolved' : smsSuppressed ? 'owner_sms_suppressed' : 'controlled_test_recipient', row.id, claim).run();
        cancelled++; continue;
      }
      const providerId = row.channel === 'sms' ? await sendSms(env, recipient, content.text, fetcher)
        : await sendEmail(env, {to: recipient, ...content, idempotencyKey: `playbook-owner/${row.id}`, request: fetcher});
      const id = typeof providerId === 'string' ? providerId : providerId?.id;
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error('notification_delivery_unconfirmed');
      const received = await db.prepare("UPDATE lead_playbook_owner_notifications SET status='accepted',provider_message_id=?,accepted_at=CURRENT_TIMESTAMP,error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending' AND (provider_message_id IS NULL OR provider_message_id=?)").bind(id, row.id, claim,id).run();
      if (!changed(received)) throw new Error('notification_receipt_conflict');
      if (row.draft_id && row.channel === 'sms') await db.prepare('UPDATE lead_reply_drafts SET notified_at=CURRENT_TIMESTAMP,notification_message_id=? WHERE id=?').bind(id, row.draft_id).run();
      accepted++;
    } catch {
      // A lost provider response can still have sent. Retain the claim for review.
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='uncertain',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'").bind(staffProof || 'provider_acceptance_unconfirmed', row.id, claim).run();
      uncertain++;
    }
  }
  return {enabled: true, accepted: accepted > 0, acceptedCount: accepted, uncertain, deferred, cancelled, skipped: !accepted && !uncertain && !deferred && !cancelled};
}

export async function notifyPlaybookOwner(db, env, notice, options = {}) {
  if (!enabled(env)) return {enabled: false};
  await queuePlaybookOwnerNotice(db, env, notice, {now: options.now || new Date()});
  return flushPlaybookOwnerNotices(db, env, {...options, eventKey: notice.eventKey});
}

// The watchdog and delayed owner-notice flush share the same fresh eligibility
// check. An alert is about the latest unanswered inbound, not an old queue row.
export async function playbookInboundStillUnanswered(db, env, {conversationId, submissionId, inboundId, now = new Date()} = {}) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return false;
  const row = await db.prepare(`SELECT s.phone,s.status submission_status,s.lifecycle_stage,c.status conversation_status,m.body,m.created_at,p.state_json
    FROM lead_messages m JOIN lead_conversations c ON c.id=m.conversation_id AND c.organization_id=m.organization_id
    JOIN submissions s ON s.id=c.submission_id
    JOIN lead_playbook_state p ON p.conversation_id=c.id AND p.organization_id=c.organization_id
    WHERE m.id=? AND c.id=? AND s.id=? AND m.organization_id=? AND m.direction='inbound'
      AND julianday(m.created_at)<=julianday(?)
      AND NOT EXISTS(SELECT 1 FROM lead_messages newer WHERE newer.conversation_id=c.id AND newer.organization_id=c.organization_id AND newer.direction='inbound'
        AND (julianday(newer.created_at)>julianday(m.created_at) OR (julianday(newer.created_at)=julianday(m.created_at) AND newer.rowid>m.rowid)))
      AND NOT EXISTS(SELECT 1 FROM lead_messages reply WHERE reply.conversation_id=c.id AND reply.organization_id=c.organization_id AND reply.direction='outbound' AND reply.delivery_status IN ('sent','delivered')
        AND (julianday(reply.created_at)>julianday(m.created_at) OR (julianday(reply.created_at)=julianday(m.created_at) AND reply.rowid>m.rowid)))
      AND NOT EXISTS(SELECT 1 FROM lead_reply_drafts d WHERE d.conversation_id=c.id AND d.organization_id=c.organization_id AND d.inbound_message_id=m.id AND d.status='sent' AND d.provider_message_id IS NOT NULL)`)
    .bind(inboundId, conversationId, submissionId, ORG, new Date(date.getTime() - playbookReplyWatchdogAgeMs(env)).toISOString()).first();
  if (!row || ['deleted', 'trashed', 'converted', 'synced'].includes(row.submission_status) || row.lifecycle_stage === 'converted' || ['deleted', 'resolved'].includes(row.conversation_status)) return false;
  if (!playbookNoticeLeadAllowed(env, row.phone)) return false;
  const state = parse(row.state_json);
  if (['closed_lost', 'closed_won'].includes(state.stage)) return false;
  const {isPlaybookOptOut} = await import('./lead-playbook-classifier.mjs');
  if (isPlaybookOptOut(row.body)) return false;
  const phone = normalizePhone(row.phone);
  if (!phone || await db.prepare('SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').bind(ORG, await playbookHash(phone)).first()) return false;
  return true;
}
