import {playbookEnabled} from './lead-playbook-links.mjs';
import {notifyPlaybookOwner, playbookInboundStillUnanswered, playbookNoticeLeadAllowed, playbookReplyWatchdogAgeMs} from './lead-playbook-notifications.mjs';
import {controlledLeadTestRecipient} from './lead-rollout-policy.mjs';

const ORG = 'org-opwp';

// A minute schedule calls this bounded processor. The existing owner-notice
// outbox provides durable per-inbound/per-channel deduplication and delivery
// claims; no migration, retrying customer SMS, or second conversation is used.
export async function runLeadReplyWatchdog(env = {}, {db = env.DB, now = new Date(), notificationOptions = {}, limit = 25} = {}) {
  if (!playbookEnabled(env) || env.LEAD_REPLY_WATCHDOG_ENABLED !== 'true' || env.LEAD_PLAYBOOK_NOTIFY_ENABLED !== 'true') return {enabled: false};
  if (!db?.prepare) return {enabled: true, failed: true, reason: 'watchdog_store_unavailable'};
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return {enabled: true, failed: true, reason: 'watchdog_time_invalid'};
  const controlled = env.META_TEST_MODE === 'true' || env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === true || env.LEAD_AUTOMATION_CONTROLLED_TEST_ONLY === 'true';
  const scopePhone = controlled ? controlledLeadTestRecipient(env) : null;
  if (controlled && (!scopePhone || !playbookNoticeLeadAllowed(env, scopePhone))) return {enabled: true, scanned: 0, eligible: 0, acceptedCount: 0, reason: 'controlled_test_scope_invalid'};
  const cutoff = new Date(date.getTime() - playbookReplyWatchdogAgeMs(env)).toISOString();
  let scanned = 0, eligible = 0, acceptedCount = 0, deferred = 0, cancelled = 0;
  try {
    const candidates = await db.prepare(`SELECT c.id conversation_id,c.submission_id,m.id inbound_id
      FROM lead_conversations c JOIN submissions s ON s.id=c.submission_id
      JOIN lead_playbook_state p ON p.conversation_id=c.id AND p.organization_id=c.organization_id
      JOIN lead_messages m ON m.conversation_id=c.id AND m.organization_id=c.organization_id AND m.direction='inbound'
      WHERE c.organization_id=? AND c.status NOT IN ('deleted','resolved') AND s.status NOT IN ('deleted','trashed','converted','synced')
        AND (? IS NULL OR s.phone=? OR s.phone=?)
        AND COALESCE(s.lifecycle_stage,'')!='converted' AND julianday(m.created_at)<=julianday(?)
        AND NOT EXISTS(SELECT 1 FROM lead_messages newer WHERE newer.conversation_id=c.id AND newer.organization_id=c.organization_id AND newer.direction='inbound'
          AND (julianday(newer.created_at)>julianday(m.created_at) OR (julianday(newer.created_at)=julianday(m.created_at) AND newer.rowid>m.rowid)))
        AND NOT EXISTS(SELECT 1 FROM lead_messages reply WHERE reply.conversation_id=c.id AND reply.organization_id=c.organization_id AND reply.direction='outbound' AND reply.delivery_status IN ('sent','delivered')
          AND (julianday(reply.created_at)>julianday(m.created_at) OR (julianday(reply.created_at)=julianday(m.created_at) AND reply.rowid>m.rowid)))
        AND NOT EXISTS(SELECT 1 FROM lead_playbook_owner_notifications n WHERE n.organization_id=c.organization_id AND n.event_key=('unanswered:unanswered_inbound:'||m.id))
      ORDER BY julianday(m.created_at),m.rowid LIMIT ?`)
      .bind(ORG, scopePhone, scopePhone, scopePhone?.slice(2) || null, cutoff, Math.max(1, Math.min(100, Number(limit) || 25))).all();
    for (const candidate of candidates.results || []) {
      scanned++;
      if (!await playbookInboundStillUnanswered(db, env, {conversationId: candidate.conversation_id, submissionId: candidate.submission_id, inboundId: candidate.inbound_id, now: date})) continue;
      eligible++;
      const notice = await notifyPlaybookOwner(db, env, {kind: 'lead_review', submissionId: candidate.submission_id, conversationId: candidate.conversation_id,
        eventKey: 'unanswered:unanswered_inbound:' + candidate.inbound_id}, {...notificationOptions, now: date});
      acceptedCount += Number(notice.acceptedCount) || 0;
      deferred += Number(notice.deferred) || 0;
      cancelled += Number(notice.cancelled) || 0;
    }
    return {enabled: true, scanned, eligible, acceptedCount, deferred, cancelled};
  } catch {
    // No customer is retried here. A storage or provider uncertainty remains in
    // its existing durable outbox, with a bounded scheduler diagnostic.
    console.error(JSON.stringify({event: 'lead_reply_watchdog_failed', reason: 'watchdog_processing_unavailable'}));
    return {enabled: true, scanned, eligible, acceptedCount, deferred, cancelled, failed: true, reason: 'watchdog_processing_unavailable'};
  }
}
