import {FAQ_REASON_LABELS} from './lead-playbook-faq.mjs';
import {redactStaffExcerpt} from './playbook-redaction.mjs';
import {normalizePhone} from './lead-assistant.mjs';
import {createPlaybookLink, playbookEnabled, playbookHash, PlaybookError} from './lead-playbook-links.mjs';

const ORG = 'org-opwp';
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
});
export const playbookOwnerNoticeReasonAllowed = reason => Object.hasOwn(EXCEPTIONS, reason);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function customerExcerpt(value, limit) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return limit > 3 ? text.slice(0, limit - 3) + '...' : '';
}

async function noticeContext(db, row) {
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
  let link = origin + '/admin/quote-funnel/';
  if (context.draft?.status === 'pending' && !row.draft_id) {
    try { link = origin + '/admin/playbook/d/' + await createPlaybookLink(db, env, context.draft, now.getTime()) + '/'; }
    catch { /* The secure lead inbox remains available for this durable handoff. */ }
  } else if (row.draft_id) {
    link = `${origin}/admin/playbook/d/${await createPlaybookLink(db, env, context.draft, now.getTime())}/`;
  }
  const title = '[OPWP STAFF ALERT] ' + (row.kind === 'signup_ready' ? 'A lead is ready for signup' : row.kind === 'property_walk' ? 'A lead needs a property walk' : row.kind === 'lead_review' ? 'A lead question needs your review' : 'A lead reply is ready for review');
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

export async function queuePlaybookOwnerNotice(db, env, {kind, submissionId, conversationId, draftId = null, eventKey}) {
  if (!enabled(env)) return {enabled: false};
  if (!KINDS.has(kind) || typeof eventKey !== 'string' || !eventKey || eventKey.length > 200) throw new PlaybookError('Invalid owner notification.', 400);
  if (!await noticeContext(db, {kind, submission_id: submissionId, conversation_id: conversationId, draft_id: draftId, event_key: eventKey})) return {enabled: true, skipped: true, reason: 'not_staff_exception'};
  const rows = ['sms', 'email'].map(channel => db.prepare(`INSERT OR IGNORE INTO lead_playbook_owner_notifications
    (id,event_key,kind,submission_id,conversation_id,draft_id,channel)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM submissions s JOIN lead_conversations c ON c.submission_id=s.id
      WHERE s.id=? AND c.id=? AND c.organization_id=? AND s.status NOT IN ('deleted','trashed') AND c.status!='deleted')`)
    .bind(crypto.randomUUID(), eventKey, kind, submissionId, conversationId, draftId, channel, submissionId, conversationId, ORG));
  await db.batch(rows);
  return {enabled: true, eventKey};
}

async function sendSms(env, to, text, fetcher) {
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
    const live = await db.prepare(`SELECT s.status,c.status conversation_status,d.status draft_status,d.expires_at,d.expires_at<=CURRENT_TIMESTAMP draft_expired
      FROM submissions s JOIN lead_conversations c ON c.id=? AND c.submission_id=s.id
      LEFT JOIN lead_reply_drafts d ON d.id=? WHERE s.id=? AND c.organization_id=?`).bind(row.conversation_id, row.draft_id, row.submission_id, ORG).first();
    if (!live || ['deleted', 'trashed'].includes(live.status) || live.conversation_status === 'deleted' || row.draft_id && (live.draft_status !== 'pending'||live.draft_expired)) {
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='lead_or_draft_changed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      cancelled++; continue;
    }
    const context = await noticeContext(db, row);
    if (!context) {
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='cancelled',error_code='not_staff_exception',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      cancelled++; continue;
    }
    const recipient = row.channel === 'sms' ? normalizePhone(env.LEAD_PLAYBOOK_CRAIG_CELL) : String(env.OWNER_NOTIFICATION_EMAIL || '').trim();
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
    try {
      // Owner alerts and actively reviewed replies are immediate at every hour.
      // Cadence automation has its own disabled gate; it never uses this outbox.
      if (!enabled(env)) {
        await db.prepare("UPDATE lead_playbook_owner_notifications SET status='queued',claim_token=NULL,sending_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'").bind(row.id, claim).run();
        deferred++; continue;
      }
      const providerId = row.channel === 'sms' ? await sendSms(env, recipient, content.text, fetcher)
        : await sendEmail(env, {to: recipient, ...content, idempotencyKey: `playbook-owner/${row.id}`, request: fetcher});
      const id = typeof providerId === 'string' ? providerId : providerId?.id;
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error('notification_delivery_unconfirmed');
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='accepted',provider_message_id=?,accepted_at=CURRENT_TIMESTAMP,error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'").bind(id, row.id, claim).run();
      if (row.draft_id && row.channel === 'sms') await db.prepare('UPDATE lead_reply_drafts SET notified_at=CURRENT_TIMESTAMP,notification_message_id=? WHERE id=?').bind(id, row.draft_id).run();
      accepted++;
    } catch {
      // A lost provider response can still have sent. Retain the claim for review.
      await db.prepare("UPDATE lead_playbook_owner_notifications SET status='uncertain',error_code='provider_acceptance_unconfirmed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=? AND status='sending'").bind(row.id, claim).run();
      uncertain++;
    }
  }
  return {enabled: true, accepted: accepted > 0, acceptedCount: accepted, uncertain, deferred, cancelled, skipped: !accepted && !uncertain && !deferred && !cancelled};
}

export async function notifyPlaybookOwner(db, env, notice, options = {}) {
  if (!enabled(env)) return {enabled: false};
  await queuePlaybookOwnerNotice(db, env, notice);
  return flushPlaybookOwnerNotices(db, env, {...options, eventKey: notice.eventKey});
}
