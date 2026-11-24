import { nextPlaybookResponse } from './lead-playbook.mjs';
import { classifyMetaReply } from './meta-lead-policy.mjs';
import { isStopMessage } from './lead-assistant.mjs';
import { WINBACK_ORG, queueWinbackAirtable, winbackChanges } from './winback-store.mjs';
import { winbackHash, winbackPhone, winbackCopyViolations } from './winback-policy.mjs';
import { suppressLeadPhone } from './lead-opt-out.mjs';

const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const stop = value => isStopMessage(value) || ['opted_out', 'wrong_number'].includes(classifyMetaReply(value));

async function ensureWinbackConversation(db, recipient) {
  const submissionId = recipient.submission_id || `winback-${recipient.id}`, conversationId = `conversation-${submissionId}`;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO submissions(id,kind,source,status,name,phone,payload,lifecycle_stage,sng_sync_state,last_activity_at)
      VALUES(?,'question','winback','new',?,?,?,'details_started','not_attempted',CURRENT_TIMESTAMP)`).bind(submissionId, recipient.first_name || null, recipient.phone, JSON.stringify({ source: 'winback', campaignId: recipient.campaign_id, version: recipient.version, batch: recipient.batch })),
    db.prepare(`INSERT OR IGNORE INTO lead_conversations(id,submission_id,organization_id,channel,status,automation_mode,owner) VALUES(?,?,?,'quo_sms','open','suggest','backend')`).bind(conversationId, submissionId, WINBACK_ORG),
    db.prepare(`INSERT OR IGNORE INTO growth_leads(submission_id,organization_id,stage,priority,next_action,updated_by) VALUES(?,?,'contacted','normal','Review win-back reply','winback-webhook')`).bind(submissionId, WINBACK_ORG),
    db.prepare('UPDATE winback_recipients SET submission_id=? WHERE id=?').bind(submissionId, recipient.id),
  ]);
  return { submissionId, conversationId };
}

export function sharedWinbackPlaybookResponse(args) {
  const decision = nextPlaybookResponse({ conversation: { owner: 'backend' }, ...args });
  return { ...decision, response: decision.body || '', handoff: Boolean(decision.escalate), branch: decision.intent };
}

// Campaign metadata travels with the same deterministic live Meta playbook. There
// is no separate pricing, FAQ answer library, discount or booking promise here.
export function nextWinbackResponse({ recipient, lead = {}, state = {}, text, responder = sharedWinbackPlaybookResponse }) {
  const context = { campaignId: recipient.campaign_id, version: recipient.version, batch: recipient.batch, cardVariant: recipient.card_variant };
  const base = { ...state, campaign: context };
  const handoff = outcome => ({ response: '', state: { ...base, handoff: true, ready_for_route_audit: false }, branch: outcome, outcome, handoff: true, campaign: context });
  if (stop(text)) return handoff('opted_out');
  if (/\b(?:we|i)(?:'ve| have)? (?:moved|relocated)|\bwrong (?:number|person)\b/i.test(text)) return handoff('moved');
  if (/\b(?:too expensive|too much|can.t afford|lower (?:the )?price|discount|cheaper|price is high)\b/i.test(text)) return handoff('price_pushback');
  if (/\b(?:espa[nñ]ol|habla|hablas|gracias|cu[aá]nto|precio|necesito)\b/i.test(text)) return handoff('spanish');
  const restart = recipient.version === 'V2' && /\b(?:start (?:back )?up|restart|resume|come back|start again|back on (?:the )?(?:schedule|service))\b/i.test(text);
  if (restart) return handoff('restart_interest');
  const decision = responder({ lead: { ...lead, campaign: context }, state: base, text, confirmationSent: false });
  const response = String(decision.response || '').replace(/\s*Reply STOP to opt out\.?\s*$/i, '').trim();
  if (winbackCopyViolations(response).length) return handoff('copy_review');
  const outcome = /\b(?:how much|price|pricing|cost|quote)\b/i.test(text) ? 'quote_request' : /\b(?:yes|interested|sign up|start|ready)\b/i.test(text) ? 'positive' : decision.handoff ? 'needs_craig' : 'replied';
  return { ...decision, response, outcome, campaign: context };
}

// This runs for every inbound opt-out, including unmatched or closed leads.
// Provider writeback is durable and retryable; local suppression commits first.
export async function applyWinbackOptOut(db, phone, { eventId, now = new Date(), reason = 'Customer requested no texts.', quoOptOut = false } = {}) {
  phone = winbackPhone(phone);
  if (!phone || !eventId) throw new Error('Verified opt-out identity is required.');
  const hash = await winbackHash(phone), timestamp = now.toISOString();
  // Core lead ownership, durable STOP writeback and receipt preservation have
  // one implementation. No provider credentials enter this intake-only call.
  const suppression = await suppressLeadPhone(db, { DB: db }, { phone, eventId, at: now, reason });
  if (!suppression.suppressed) throw new Error('Verified opt-out identity is required.');
  const ownedRecipients = `SELECT r.id FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE r.phone_hash=? AND c.organization_id=?`;
  await db.batch([
    db.prepare(`UPDATE winback_recipients SET status='opted_out',opted_out_at=?,skip_reason='opted_out',updated_at=CURRENT_TIMESTAMP WHERE id IN(${ownedRecipients})`).bind(timestamp, hash, WINBACK_ORG),
    db.prepare(`UPDATE winback_deliveries SET status='cancelled',error_code='opted_out',updated_at=CURRENT_TIMESTAMP WHERE recipient_id IN(${ownedRecipients}) AND status IN ('draft','reserved','sending') AND provider_message_id IS NULL`).bind(hash, WINBACK_ORG),
  ]);
  await queueWinbackAirtable(db, { id: `optout:${eventId}`, phone, outcome: quoOptOut ? 'Opted out in Quo' : 'Opted Out', doNotText: true, note: reason, now });
}

export async function recordWinbackReply(db, env, event, { now = new Date(), responder, notifyOwner } = {}) {
  if (event.direction && event.direction !== 'inbound' || event.isGroup) return { handled: false };
  const phone = winbackPhone(event.from);
  if (!phone || typeof event.providerMessageId !== 'string' || !event.providerMessageId || typeof event.text !== 'string') return { handled: false };
  let recipient;
  try { recipient = await db.prepare(`SELECT r.*,COALESCE(r.sent_at,d.attempted_at,d.created_at) contact_at FROM winback_recipients r
    JOIN winback_campaigns c ON c.id=r.campaign_id JOIN winback_deliveries d ON d.recipient_id=r.id AND d.purpose='initial'
    WHERE r.phone_hash=? AND c.organization_id=? AND (r.sent_at IS NOT NULL AND d.provider_message_id IS NOT NULL
      OR d.status IN ('sending','unknown') AND d.attempted_at IS NOT NULL)
    ORDER BY julianday(COALESCE(r.sent_at,d.attempted_at,d.created_at)) DESC,r.id DESC LIMIT 1`).bind(await winbackHash(phone), WINBACK_ORG).first(); }
  catch (error) { if (/no such table.*winback_recipients/i.test(String(error?.message))) return { handled: false, uninstalled: true }; throw error; }
  if (stop(event.text)) await applyWinbackOptOut(db, phone, { eventId: event.providerMessageId, now });
  if (!recipient) return { handled: false, stopped: stop(event.text) };
  if (!stop(event.text) && await db.prepare(`SELECT 1 active FROM meta_lead_intakes i JOIN lead_conversations c ON c.submission_id=i.submission_id AND c.organization_id=i.organization_id
    WHERE i.phone_hash=? AND i.organization_id=? AND c.status IN ('open','waiting') AND julianday(COALESCE(c.last_outbound_at,i.created_at))>julianday(?) LIMIT 1`)
    .bind(await winbackHash(phone), WINBACK_ORG, recipient.contact_at).first()) return { handled: false, reason: 'newer_meta_conversation' };
  const token = crypto.randomUUID(), started = now.toISOString(), cutoff = new Date(now.getTime() - 15 * 60000).toISOString();
  const claim = await db.prepare(`INSERT INTO winback_replies(provider_message_id,recipient_id,outcome,body,decision_json,created_at) VALUES(?,?,'processing',?,?,?)
    ON CONFLICT(provider_message_id) DO UPDATE SET decision_json=excluded.decision_json,created_at=excluded.created_at
    WHERE winback_replies.recipient_id=excluded.recipient_id AND winback_replies.outcome='processing' AND winback_replies.created_at<?`)
    .bind(event.providerMessageId, recipient.id, event.text.slice(0, 4000), JSON.stringify({ claimToken: token }), started, cutoff).run();
  if (!winbackChanges(claim)) {
    const current = await db.prepare('SELECT recipient_id,outcome FROM winback_replies WHERE provider_message_id=?').bind(event.providerMessageId).first();
    if (current?.recipient_id !== recipient.id) throw new Error('Win-back reply identity mismatch.');
    if (current.outcome === 'processing') return { handled: true, duplicate: true, processing: true };
    return { handled: true, duplicate: true };
  }
  const conversation = await ensureWinbackConversation(db, recipient);
  const previous = await db.prepare(`SELECT r.decision_json,d.status delivery_status FROM winback_replies r LEFT JOIN winback_deliveries d ON d.trigger_id=r.provider_message_id AND d.recipient_id=r.recipient_id AND d.purpose='reply' WHERE r.recipient_id=? AND r.provider_message_id!=? AND r.outcome!='processing' ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`).bind(recipient.id, event.providerMessageId).first();
  const prior = parse(previous?.decision_json);
  const priorState = prior.response && previous.delivery_status !== 'sent' ? prior.priorState || {} : prior.state || {};
  const decision = { ...nextWinbackResponse({ recipient, lead: { name: recipient.first_name }, state: priorState, text: event.text, ...(responder ? { responder } : {}) }), priorState };
  const outcome = decision.outcome, timestamp = now.toISOString();
  const statements = [
    db.prepare(`UPDATE winback_replies SET outcome=?,decision_json=? WHERE provider_message_id=? AND outcome='processing' AND json_extract(decision_json,'$.claimToken')=?`).bind(outcome, JSON.stringify(decision), event.providerMessageId, token),
    db.prepare(`INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,created_at)
      VALUES(?,?,?,'inbound','quo_sms',?,?,'delivered',0,'winback-webhook',?)`).bind(`winback-inbound:${await winbackHash(event.providerMessageId)}`, conversation.conversationId, WINBACK_ORG, event.providerMessageId, event.text.slice(0, 4000), timestamp),
    db.prepare(`UPDATE lead_conversations SET unread_count=unread_count+1,last_inbound_at=?,status=CASE WHEN ? THEN 'resolved' ELSE 'open' END,automation_mode=CASE WHEN ? THEN 'paused' ELSE automation_mode END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(timestamp, outcome === 'opted_out' ? 1 : 0, outcome === 'opted_out' ? 1 : 0, conversation.conversationId),
    db.prepare(`UPDATE winback_recipients SET status=CASE WHEN status='opted_out' THEN status WHEN ?='moved' THEN 'skipped' ELSE 'replied' END,
      replied_at=COALESCE(replied_at,?),positive_at=CASE WHEN ? IN ('positive','restart_interest') THEN COALESCE(positive_at,?) ELSE positive_at END,
      quote_requested_at=CASE WHEN ?='quote_request' THEN COALESCE(quote_requested_at,?) ELSE quote_requested_at END,
      skip_reason=CASE WHEN ?='moved' THEN 'moved' ELSE skip_reason END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(outcome, timestamp, outcome, timestamp, outcome, timestamp, outcome, recipient.id),
    db.prepare(`UPDATE winback_deliveries SET status='cancelled',error_code='customer_replied',updated_at=CURRENT_TIMESTAMP WHERE recipient_id=? AND recipient_id IN(SELECT r.id FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE c.organization_id=?) AND status IN ('draft','reserved','sending') AND provider_message_id IS NULL`).bind(recipient.id, WINBACK_ORG),
  ];
  // Reply suggestions remain local durable drafts. The existing Meta playbook
  // sender must be explicitly wired through all win-back delivery gates before
  // any automatic reply can be released. No direct send is hidden in intake.
  if (decision.response) statements.push(db.prepare(`INSERT OR IGNORE INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body) VALUES(?,?,'reply',?,'draft',?)`).bind(`reply:${event.providerMessageId}`, recipient.id, event.providerMessageId, decision.response));
  const noticeId = `review:${event.providerMessageId}`;
  if (decision.handoff) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO winback_owner_notices(id,recipient_id,reason) VALUES(?,?,?)`).bind(noticeId, recipient.id, outcome));
  }
  statements.push(db.prepare(`INSERT OR IGNORE INTO winback_airtable_outbox(id,phone,outcome,do_not_text,note,created_at) VALUES(?,?,?,?,?,?)`).bind(`reply:${event.providerMessageId}`, phone, outcome === 'opted_out' ? 'Opted Out' : 'Replied', outcome === 'opted_out' ? 1 : 0, `Win-back ${recipient.campaign_id}, ${recipient.version}: ${outcome}.`, timestamp));
  await db.batch(statements);
  if (decision.handoff && notifyOwner) await notifyOwner({ id: noticeId, recipientId: recipient.id, campaignId: recipient.campaign_id, version: recipient.version, reason: outcome });
  return { handled: true, outcome, decision, replyHeld: Boolean(decision.response) };
}

export async function recordWinbackDelivery(db, body, { now = new Date() } = {}) {
  const message = body?.data?.object;
  if (!['message.delivered','message.failed'].includes(body?.type) || message?.direction !== 'outgoing' || typeof message.id !== 'string') return { handled: false };
  let row;
  try { row = await db.prepare(`SELECT d.id delivery_id,d.recipient_id,r.phone,r.phone_hash FROM winback_deliveries d JOIN winback_recipients r ON r.id=d.recipient_id JOIN winback_campaigns c ON c.id=r.campaign_id WHERE d.provider_message_id=? AND c.organization_id=?`).bind(message.id, WINBACK_ORG).first(); }
  catch (error) { if (/no such table.*winback_deliveries/i.test(String(error?.message))) return { handled: false, uninstalled: true }; throw error; }
  if (!row) return { handled: false };
  if (body.type === 'message.failed') {
    await db.batch([
      db.prepare(`UPDATE winback_deliveries SET status='failed',error_code='quo_delivery_failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND recipient_id IN(SELECT r.id FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE c.organization_id=?)`).bind(row.delivery_id, WINBACK_ORG),
      db.prepare(`UPDATE winback_recipients SET status=CASE WHEN status='opted_out' THEN status ELSE 'failed' END,skip_reason='quo_delivery_failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND campaign_id IN(SELECT id FROM winback_campaigns WHERE organization_id=?)`).bind(row.recipient_id, WINBACK_ORG),
      db.prepare(`INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) VALUES(?,?,'Quo delivery failed','quo_webhook','winback-webhook')
        ON CONFLICT(organization_id,phone_hash) DO NOTHING`).bind(WINBACK_ORG, row.phone_hash),
      db.prepare(`UPDATE winback_recipients SET status='skipped',skip_reason='prior_delivery_failed',updated_at=CURRENT_TIMESTAMP WHERE phone_hash=? AND campaign_id IN(SELECT id FROM winback_campaigns WHERE organization_id=?) AND status='queued'`).bind(row.phone_hash, WINBACK_ORG),
      db.prepare(`UPDATE winback_deliveries SET status='cancelled',error_code='prior_delivery_failed',updated_at=CURRENT_TIMESTAMP WHERE recipient_id IN(SELECT r.id FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE r.phone_hash=? AND c.organization_id=?) AND status IN ('draft','reserved') AND provider_message_id IS NULL`).bind(row.phone_hash, WINBACK_ORG),
    ]);
    await queueWinbackAirtable(db, { id: `receipt:${message.id}`, phone: row.phone, outcome: 'Failed', doNotText: true, note: 'Quo reported a failed win-back text. All campaign sends held for review.', now });
  }
  // A late delivered receipt never revives failed/suppressed campaign work.
  return { handled: true, failed: body.type === 'message.failed' };
}

// Quo can deliver its signed failure webhook before the send request returns.
// The shared receipt ledger records that event before a campaign provider ID
// exists. Reconcile only accepted IDs owned by this organization. A stable
// outbox marker makes replay harmless, including while delivery is disabled.
export async function reconcileWinbackDeliveryReceipts(db, { limit = 50, now = new Date() } = {}) {
  if (!db) return { examined: 0, reconciled: 0 };
  const rows = (await db.prepare(`SELECT DISTINCT d.provider_message_id FROM winback_deliveries d
    JOIN winback_recipients r ON r.id=d.recipient_id
    JOIN winback_campaigns c ON c.id=r.campaign_id AND c.organization_id=?
    JOIN quo_delivery_receipts receipt ON receipt.provider_message_id=d.provider_message_id AND receipt.organization_id=c.organization_id
    WHERE receipt.status='failed' AND d.provider_message_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM winback_airtable_outbox o WHERE o.id=('receipt:'||d.provider_message_id))
    ORDER BY d.provider_message_id LIMIT ?`).bind(WINBACK_ORG, Math.max(1, Math.min(100, Number(limit) || 50))).all()).results || [];
  let reconciled = 0;
  for (const row of rows) {
    const result = await recordWinbackDelivery(db, { type: 'message.failed', data: { object: { id: row.provider_message_id, direction: 'outgoing' } } }, { now });
    if (result.handled && result.failed) reconciled++;
  }
  return { examined: rows.length, reconciled };
}
