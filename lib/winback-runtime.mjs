import {recordWinbackReply, recordWinbackDelivery, reconcileWinbackDeliveryReceipts} from './winback-replies.mjs';
import {runScheduledWinback} from './winback-runner.mjs';
import {processWinbackReplies} from './winback-reply-delivery.mjs';
import {flushWinbackAirtable, reconcileWinbackConversions, reconcileMissingWinbackSentOutbox, WINBACK_ORG} from './winback-store.mjs';
import {createWinbackProviders} from './winback-providers.mjs';
import {queuePlaybookOwnerNotice, playbookOwnerNoticeReasonAllowed} from './lead-playbook-notifications.mjs';

export const winbackStorageReady = env => env?.WINBACK_STORAGE_READY === 'true';

// Queue the existing private owner-notification workflow, not a second sender.
// A disabled notification channel leaves the campaign notice pending for retry.
export async function queueWinbackOwnerReviews(db, env, {limit = 10, queueNotice = queuePlaybookOwnerNotice} = {}) {
  if (!winbackStorageReady(env)) return {queued: 0};
  const notices = await db.prepare(`SELECT n.id,n.reason,r.submission_id,c.id conversation_id FROM winback_owner_notices n
    JOIN winback_recipients r ON r.id=n.recipient_id JOIN winback_campaigns campaign ON campaign.id=r.campaign_id
    JOIN lead_conversations c ON c.submission_id=r.submission_id AND c.organization_id=?
    WHERE campaign.organization_id=? AND n.status='queued' ORDER BY n.created_at,n.id LIMIT ?`).bind(WINBACK_ORG, WINBACK_ORG, Math.max(1, Math.min(25, limit))).all();
  let queued = 0;
  for (const notice of notices.results || []) {
    const providerId = notice.id.startsWith('review:') ? notice.id.slice(7) : '';
    const trigger = providerId && await db.prepare("SELECT id FROM lead_messages WHERE provider_message_id=? AND conversation_id=? AND organization_id=? AND direction='inbound'").bind(providerId, notice.conversation_id, WINBACK_ORG).first();
    if (!trigger) continue;
    const requested = notice.reason === 'restart_interest' ? 'existing_customer' : notice.reason;
    const reason = playbookOwnerNoticeReasonAllowed(requested) ? requested : 'intent_needs_review';
    const result = await queueNotice(db, env, {kind:'lead_review', submissionId:notice.submission_id, conversationId:notice.conversation_id,
      eventKey:`winback:${reason}:${encodeURIComponent(trigger.id)}`});
    if (result?.enabled && !result.skipped) {
      await db.prepare("UPDATE winback_owner_notices SET status='acknowledged' WHERE id=? AND status='queued'").bind(notice.id).run();
      queued++;
    }
  }
  return {queued};
}

export async function handleWinbackInbound(db, env, event, options = {}) {
  if (!winbackStorageReady(env)) return {handled:false};
  const result = await recordWinbackReply(db, env, event, options);
  if (result.handled && result.decision?.handoff) await queueWinbackOwnerReviews(db, env);
  return result;
}

export async function handleWinbackReceipt(db, env, body) {
  return winbackStorageReady(env) ? recordWinbackDelivery(db, body) : {handled:false};
}

export async function runWinbackRuntime(env) {
  if (!winbackStorageReady(env) || !env.DB) return {configured:false};
  try {
    const priorReceipts = await reconcileWinbackDeliveryReceipts(env.DB);
    // Existing */10 schedule only. No new cron and no automatic activation.
    const initial = await runScheduledWinback(env);
    const replies = await processWinbackReplies(env);
    // Opt-out/failure mirrors and staff handoffs continue while sends are killed.
    const receipts = await reconcileWinbackDeliveryReceipts(env.DB);
    const sentMirrors = await reconcileMissingWinbackSentOutbox(env.DB);
    const conversions = await reconcileWinbackConversions(env.DB);
    const airtable = await flushWinbackAirtable(env.DB, createWinbackProviders(env), {limit:10});
    const owner = await queueWinbackOwnerReviews(env.DB, env);
    return {configured:true, priorReceipts, initial, replies, receipts, sentMirrors, conversions, airtable, owner};
  } catch {
    console.error(JSON.stringify({event:'winback_runtime_held', reason:'storage_or_readiness_unavailable'}));
    return {configured:false, held:'storage_or_readiness_unavailable'};
  }
}
