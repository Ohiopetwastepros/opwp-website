import { WINBACK_MIN_INTERVAL_MS, winbackHash, winbackWindow } from './winback-policy.mjs';
import { WINBACK_ORG, winbackSwitches, queueWinbackAirtable, winbackChanges } from './winback-store.mjs';
import { createWinbackProviders } from './winback-providers.mjs';

async function eligible(db, providers, row, now) {
  if (row.recipient_status !== 'replied' || row.owner !== 'backend' || row.automation_mode !== 'approved') return 'human_review_required';
  if (await db.prepare('SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').bind(WINBACK_ORG, await winbackHash(row.phone)).first()) return 'phone_suppressed';
  const latest = await db.prepare('SELECT provider_message_id FROM winback_replies WHERE recipient_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(row.recipient_id).first();
  if (latest?.provider_message_id !== row.trigger_id) return 'newer_customer_reply';
  try {
    const airtable = await providers.airtable(row.phone), sng = await providers.sng(row.phone), quo = await providers.quo(row.phone, now);
    if (!airtable || typeof airtable.doNotText !== 'boolean' || !sng || typeof sng.active !== 'boolean' || typeof sng.paused !== 'boolean' || !quo || typeof quo.optedOut !== 'boolean') return 'provider_verification_failed';
    if (airtable.doNotText || quo.optedOut) return 'opted_out';
    if (airtable.active || airtable.paused || airtable.seasonal || sng.active || sng.paused) return 'existing_customer_review';
    return '';
  } catch { return 'provider_verification_failed'; }
}
const query = `SELECT d.*,r.campaign_id,r.phone,r.status recipient_status,r.submission_id,c.id conversation_id,c.owner,c.automation_mode
  FROM winback_deliveries d JOIN winback_recipients r ON r.id=d.recipient_id JOIN winback_campaigns campaign ON campaign.id=r.campaign_id AND campaign.organization_id='org-opwp'
  JOIN lead_conversations c ON c.submission_id=r.submission_id AND c.organization_id='org-opwp'`;

export async function processWinbackReplies(env, { providers, getEnv = () => env, clock = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), limit = 2 } = {}) {
  const db = env.DB, result = { enabled: false, sent: 0, held: 0, failed: 0 };
  if (!db || env.WINBACK_ENABLED !== 'true' || env.WINBACK_AUTOREPLY_ENABLED !== 'true' || env.WINBACK_SEND_ENABLED !== 'true' || env.WINBACK_KILL_SWITCH !== 'false') return result;
  result.enabled = true; providers ||= createWinbackProviders(env);
  const rows = (await db.prepare(`${query} WHERE d.purpose='reply' AND d.status='draft' ORDER BY d.created_at LIMIT ?`).bind(Math.max(1, Math.min(10, limit))).all()).results || [];
  for (let index = 0; index < rows.length; index++) {
    if (index) await sleep(WINBACK_MIN_INTERVAL_MS);
    let row = rows[index];
    if (getEnv().WINBACK_AUTOREPLY_ENABLED !== 'true' || !(await winbackSwitches(db, getEnv(), row.campaign_id)).allowed || !winbackWindow(clock()).allowed) { result.held++; break; }
    let reason = await eligible(db, providers, row, clock());
    if (reason) { result.held++; continue; }
    const now = clock(), cutoff = new Date(now.getTime() - WINBACK_MIN_INTERVAL_MS).toISOString();
    const claim = await db.prepare(`UPDATE winback_deliveries SET status='sending',attempted_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'
      AND NOT EXISTS(SELECT 1 FROM winback_deliveries WHERE id!=? AND (status IN ('reserved','sending') OR attempted_at>?))`).bind(now.toISOString(), row.id, row.id, cutoff).run();
    if (!winbackChanges(claim)) { result.held++; break; }
    row = await db.prepare(`${query} WHERE d.id=?`).bind(row.id).first();
    reason = await eligible(db, providers, row, clock());
    if (reason || getEnv().WINBACK_AUTOREPLY_ENABLED !== 'true' || !(await winbackSwitches(db, getEnv(), row.campaign_id)).allowed || !winbackWindow(clock()).allowed) {
      await db.prepare(`UPDATE winback_deliveries SET status='cancelled',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'`).bind(reason || 'release_disabled', row.id).run(); result.held++; continue;
    }
    let acceptedId = null;
    try {
      const sent = await providers.send(row.phone, row.message_body, { campaignId: row.campaign_id, recipientId: row.recipient_id, deliveryId: row.id, purpose: 'reply' });
      if (!sent?.id) throw Error('Unknown outcome');
      acceptedId = sent.id;
      await db.batch([
        db.prepare(`UPDATE winback_deliveries SET status='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(sent.id, row.id),
        db.prepare(`INSERT OR IGNORE INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,automated,created_by,created_at)
          VALUES(?,?,?,'outbound','quo_sms',?,?,'sent',1,'winback-playbook',?)`).bind(`winback-outbound:${row.id}`, row.conversation_id, WINBACK_ORG, sent.id, row.message_body, clock().toISOString()),
        db.prepare(`UPDATE lead_conversations SET last_outbound_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(clock().toISOString(), row.conversation_id),
      ]);
      result.sent++;
    } catch {
      await db.prepare(`UPDATE winback_deliveries SET status='unknown',provider_message_id=COALESCE(?,provider_message_id),error_code='delivery_outcome_unknown',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'`).bind(acceptedId, row.id).run();
      await queueWinbackAirtable(db, { id: `failed:${row.id}`, phone: row.phone, outcome: 'Failed', note: 'Win-back reply delivery uncertain. Reconcile in Quo before resending.', now: clock() }); result.failed++;
    }
  }
  return result;
}
