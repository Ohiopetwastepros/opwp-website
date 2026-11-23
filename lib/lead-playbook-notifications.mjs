import {normalizePhone} from './lead-assistant.mjs';
import {createPlaybookLink, playbookEnabled, playbookHash, PlaybookError} from './lead-playbook-links.mjs';

const ORG = 'org-opwp';
const KINDS = new Set(['pending_draft', 'signup_ready', 'property_walk', 'lead_review']);
const enabled = env => playbookEnabled(env) && env.LEAD_PLAYBOOK_NOTIFY_ENABLED === 'true';
const changed = result => Number(result?.meta?.changes || 0) === 1;

function reviewOrigin(env) {
  const origin = new URL(env.LEAD_PLAYBOOK_ADMIN_ORIGIN || env.SITE_ORIGIN || 'https://www.ohiopetwastepros.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new PlaybookError('Invalid review link origin.', 503);
  return origin.origin;
}
async function messageFor(db, env, row, now) {
  const origin = reviewOrigin(env);
  let link = origin + '/admin/quote-funnel/';
  if (row.draft_id) {
    const draft = await db.prepare('SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id=?').bind(row.draft_id, ORG).first();
    if (!draft || draft.status !== 'pending') return null;
    link = `${origin}/admin/playbook/d/${await createPlaybookLink(db, env, draft, now.getTime())}/`;
  }
  const title = '[OPWP STAFF ALERT] ' + (row.kind === 'signup_ready' ? 'A lead is ready for signup' : row.kind === 'property_walk' ? 'A lead needs a property walk' : row.kind === 'lead_review' ? 'A lead question needs your review' : 'A lead reply is ready for review');
  // Customer identity and message contents stay behind the authenticated workspace.
  return {subject: title, text: `${title}. ${link}`, html: `<p>${title}.</p><p><a href="${link}">Open secure lead review</a></p>`};
}

export async function queuePlaybookOwnerNotice(db, env, {kind, submissionId, conversationId, draftId = null, eventKey}) {
  if (!enabled(env)) return {enabled: false};
  if (!KINDS.has(kind) || typeof eventKey !== 'string' || !eventKey || eventKey.length > 200) throw new PlaybookError('Invalid owner notification.', 400);
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
    try { content = await messageFor(db, env, row, now); }
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
