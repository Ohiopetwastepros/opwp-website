import { WINBACK_MAX_BATCH, WINBACK_MIN_INTERVAL_MS, renderWinbackMessage, validateWinbackCopy, winbackWindow } from './winback-policy.mjs';
import { WINBACK_ORG, localWinbackReasons, queueWinbackAirtable, winbackCampaign, winbackSwitches } from './winback-store.mjs';
import { createWinbackProviders } from './winback-providers.mjs';
import { applyWinbackOptOut, reconcileWinbackDeliveryReceipts } from './winback-replies.mjs';

export async function checkWinbackEligibility(db, providers, row, now = new Date(), { claimed = false } = {}) {
  const evidence = {}, reasons = await localWinbackReasons(db, row, now, null, { claimed });
  if (reasons.length) return { allowed: false, reasons, evidence };
  try {
    evidence.airtable = await providers.airtable(row.phone);
    if (evidence.airtable?.doNotText === true) reasons.push('airtable_do_not_text');
    if (evidence.airtable?.active === true) reasons.push('airtable_active_customer');
    if (evidence.airtable?.paused === true) reasons.push('airtable_paused_customer');
    if (evidence.airtable?.seasonal === true) reasons.push('seasonal_pauser');
    if (!evidence.airtable || !Array.isArray(evidence.airtable.matches) || typeof evidence.airtable.doNotText !== 'boolean') reasons.push('airtable_unverified');
    if (!reasons.length) {
      evidence.sng = await providers.sng(row.phone);
      if (evidence.sng?.active === true) reasons.push('sng_active_customer');
      if (evidence.sng?.paused === true) reasons.push('sng_paused_customer');
      if (!evidence.sng || typeof evidence.sng.active !== 'boolean' || typeof evidence.sng.paused !== 'boolean') reasons.push('sng_unverified');
    }
    if (!reasons.length) {
      evidence.quo = await providers.quo(row.phone, now);
      if (evidence.quo?.optedOut === true) reasons.push('quo_opted_out');
      if (evidence.quo?.recentOutbound === true) reasons.push('recent_opwp_text');
      if (!evidence.quo || typeof evidence.quo.optedOut !== 'boolean' || typeof evidence.quo.recentOutbound !== 'boolean' || typeof evidence.quo.firstMessage !== 'boolean') reasons.push('quo_unverified');
    }
    reasons.push(...await localWinbackReasons(db, row, now, evidence, { claimed }));
  } catch (error) { reasons.push(/^[a-z0-9_]{1,100}$/.test(error?.code || '') ? error.code : 'provider_verification_failed'); }
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], evidence };
}

async function markSkipped(db, row, reasons, deliveryId = null) {
  const optedOut = reasons.some(reason => ['airtable_do_not_text', 'quo_opted_out', 'phone_suppressed'].includes(reason));
  if (optedOut) await applyWinbackOptOut(db, row.phone, { eventId: `preflight:${row.id}`, reason: `Win-back send-time suppression: ${reasons.join(', ')}.`, quoOptOut: reasons.includes('quo_opted_out') });
  await db.prepare(`UPDATE winback_recipients SET status=?,skip_reason=?,opted_out_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE opted_out_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'`).bind(optedOut ? 'opted_out' : 'skipped', reasons.join(','), optedOut ? 1 : 0, row.id).run();
  if (deliveryId) await db.prepare(`UPDATE winback_deliveries SET status='cancelled',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('reserved','sending')`).bind(reasons.join(','), deliveryId).run();
}

async function reserve(db, row, window, now, body) {
  const id = crypto.randomUUID(), timestamp = now.toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO winback_days(organization_id,local_date,campaign_id,batch) VALUES(?,?,?,?)`).bind(WINBACK_ORG, window.date, row.campaign_id, row.batch),
    db.prepare(`INSERT OR IGNORE INTO winback_deliveries(id,recipient_id,purpose,trigger_id,status,message_body,attempted_at)
      SELECT ?,r.id,'initial','initial','reserved',?,? FROM winback_recipients r JOIN winback_days d ON d.organization_id=? AND d.local_date=?
      WHERE r.id=? AND r.status='queued' AND r.attempted_at IS NULL AND d.campaign_id=r.campaign_id AND d.batch=r.batch AND d.attempts<? AND d.last_attempt_ms<=?
      AND NOT EXISTS(SELECT 1 FROM winback_deliveries WHERE status IN ('reserved','sending') OR attempted_at>?)`).bind(id, body, timestamp, WINBACK_ORG, window.date, row.id, WINBACK_MAX_BATCH, now.getTime() - WINBACK_MIN_INTERVAL_MS, new Date(now.getTime() - WINBACK_MIN_INTERVAL_MS).toISOString()),
    db.prepare(`UPDATE winback_days SET attempts=attempts+1,last_attempt_ms=? WHERE organization_id=? AND local_date=? AND EXISTS(SELECT 1 FROM winback_deliveries WHERE id=? AND status='reserved')`).bind(now.getTime(), WINBACK_ORG, window.date, id),
    db.prepare(`UPDATE winback_recipients SET attempted_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM winback_deliveries WHERE id=? AND status='reserved')`).bind(timestamp, row.id, id),
  ]);
  return await db.prepare('SELECT id FROM winback_deliveries WHERE id=?').bind(id).first() ? id : null;
}

// No automatic retry follows an ambiguous provider call, including process death.
// A resumed run may continue other queued recipients after reconciliation hold.
export async function recoverWinbackDeliveries(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 15 * 60000).toISOString();
  await db.batch([
    db.prepare(`UPDATE winback_recipients SET status='failed',skip_reason='delivery_outcome_unknown',updated_at=CURRENT_TIMESTAMP
      WHERE id IN(SELECT d.recipient_id FROM winback_deliveries d JOIN winback_recipients r ON r.id=d.recipient_id JOIN winback_campaigns c ON c.id=r.campaign_id
        WHERE c.organization_id=? AND d.status IN ('reserved','sending') AND d.attempted_at<?) AND status='queued'`).bind(WINBACK_ORG, cutoff),
    db.prepare(`UPDATE winback_deliveries SET status='unknown',error_code='delivery_outcome_unknown',updated_at=CURRENT_TIMESTAMP WHERE status IN ('reserved','sending') AND attempted_at<?
      AND recipient_id IN(SELECT r.id FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE c.organization_id=?)`).bind(cutoff, WINBACK_ORG),
  ]);
}

export async function runWinbackBatch(env, { campaignId, limit = 1, providers, getEnv = () => env, clock = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const db = env.DB, result = { enabled: false, sent: 0, skipped: 0, failed: 0, held: null };
  if (!db || getEnv().WINBACK_ENABLED !== 'true' || getEnv().WINBACK_SEND_ENABLED !== 'true' || getEnv().WINBACK_KILL_SWITCH !== 'false') return result;
  result.enabled = true;
  if (!campaignId) return { ...result, held: 'campaign_required' };
  let switches = await winbackSwitches(db, getEnv(), campaignId);
  if (!switches.allowed) return { ...result, held: switches.reason };
  const campaign = await winbackCampaign(db, campaignId);
  try { await validateWinbackCopy(campaign?.copy); } catch { return { ...result, held: 'approved_copy_unavailable' }; }
  providers ||= createWinbackProviders(getEnv());
  await recoverWinbackDeliveries(db, clock());
  for (let index = 0; index < Math.max(1, Math.min(WINBACK_MAX_BATCH, Number(limit) || 1)); index++) {
    if (index) await sleep(WINBACK_MIN_INTERVAL_MS);
    switches = await winbackSwitches(db, getEnv(), campaignId);
    if (!switches.allowed) { result.held = switches.reason; break; }
    const window = winbackWindow(clock());
    if (!window.allowed) { result.held = window.reason; break; }
    // Assign the day's single batch before eligibility checks. A wholly
    // suppressed batch still occupies its day and cannot expose the next one.
    await db.prepare(`INSERT OR IGNORE INTO winback_days(organization_id,local_date,campaign_id,batch)
      SELECT ?,?,campaign_id,MIN(batch) FROM winback_recipients WHERE campaign_id=? AND status='queued' AND attempted_at IS NULL HAVING COUNT(*)>0`)
      .bind(WINBACK_ORG, window.date, campaignId).run();
    const day = await db.prepare('SELECT * FROM winback_days WHERE organization_id=? AND local_date=?').bind(WINBACK_ORG, window.date).first();
    if (day && (day.campaign_id !== campaignId || day.attempts >= WINBACK_MAX_BATCH)) { result.held = 'daily_batch_limit'; break; }
    const row = await db.prepare(`SELECT * FROM winback_recipients WHERE campaign_id=? AND status='queued' AND attempted_at IS NULL AND (? IS NULL OR batch=?) ORDER BY batch,id LIMIT 1`).bind(campaignId, day?.batch ?? null, day?.batch ?? null).first();
    if (!row) break;
    let eligibility = await checkWinbackEligibility(db, providers, row, clock());
    if (!eligibility.allowed) {
      const businessReasons = new Set(['already_attempted','phone_suppressed','another_active_campaign','open_meta_conversation','recent_opwp_text','seasonal_pauser','airtable_do_not_text','airtable_active_customer','airtable_paused_customer','sng_active_customer','sng_paused_customer','quo_opted_out']);
      if (eligibility.reasons.some(reason => !businessReasons.has(reason))) {
        await db.prepare(`UPDATE winback_recipients SET skip_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued' AND attempted_at IS NULL`).bind(eligibility.reasons.join(','), row.id).run();
        result.held = eligibility.reasons.join(','); break;
      }
      await markSkipped(db, row, eligibility.reasons); result.skipped++; continue;
    }
    const body = renderWinbackMessage(row, campaign.copy, { firstMessage: eligibility.evidence.quo.firstMessage });
    const reservationTime = clock(), currentWindow = winbackWindow(reservationTime);
    if (!currentWindow.allowed) { result.held = currentWindow.reason; break; }
    const deliveryId = await reserve(db, row, currentWindow, reservationTime, body);
    if (!deliveryId) { result.held = 'throttle_or_concurrent_claim'; break; }
    // Everything is re-read after the durable claim and immediately before send.
    const current = await db.prepare('SELECT * FROM winback_recipients WHERE id=?').bind(row.id).first();
    eligibility = await checkWinbackEligibility(db, providers, current, clock(), { claimed: true });
    switches = await winbackSwitches(db, getEnv(), campaignId);
    const finalWindow = winbackWindow(clock());
    if (!eligibility.allowed || !switches.allowed || !finalWindow.allowed || finalWindow.date !== currentWindow.date) {
      await markSkipped(db, current, eligibility.reasons.length ? eligibility.reasons : [switches.reason || finalWindow.reason || 'send_day_changed'], deliveryId);
      result.skipped++; if (!switches.allowed) { result.held = switches.reason; break; } continue;
    }
    const finalBody = renderWinbackMessage(current, campaign.copy, { firstMessage: eligibility.evidence.quo.firstMessage });
    await db.prepare(`UPDATE winback_deliveries SET status='sending',message_body=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'`).bind(finalBody, deliveryId).run();
    let acceptedId = null, sentRecorded = false;
    try {
      const accepted = await providers.send(current.phone, finalBody, { campaignId, recipientId: current.id, deliveryId });
      if (typeof accepted?.id !== 'string' || !accepted.id) throw new Error('Uncertain delivery.');
      acceptedId = accepted.id;
      await db.batch([
        db.prepare(`UPDATE winback_recipients SET status='sent',provider_message_id=?,sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'`).bind(accepted.id, clock().toISOString(), current.id),
        db.prepare(`UPDATE winback_deliveries SET status='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(accepted.id, deliveryId),
      ]);
      sentRecorded = true;
      result.sent++;
    } catch (error) {
      const rejected = /^send_rejected_\d{3}$/.test(error?.code || ''), reason = rejected ? error.code : 'delivery_outcome_unknown';
      await db.batch([
        db.prepare(`UPDATE winback_recipients SET status='failed',skip_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'`).bind(reason, current.id),
        db.prepare(`UPDATE winback_deliveries SET status=?,error_code=?,provider_message_id=COALESCE(?,provider_message_id),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('reserved','sending')`).bind(rejected ? 'failed' : 'unknown', reason, acceptedId, deliveryId),
      ]);
      await queueWinbackAirtable(db, { id: `failed:${deliveryId}`, phone: current.phone, outcome: 'Failed', note: `Win-back delivery held: ${reason}. Reconcile in Quo before resending.`, now: clock() });
      result.failed++;
    }
    if (sentRecorded) {
      // A signed failure receipt may have arrived before the HTTP response was
      // persisted. Its durable provider receipt remains authoritative.
      try { await reconcileWinbackDeliveryReceipts(db, {now:clock()}); }
      catch { result.receiptReconciliationDeferred = true; }
      // An unavailable mirror must never turn a durable provider acceptance into
      // a failed/unknown delivery. The runtime reconciles missing sent outbox
      // rows from this receipt even when campaign sending has been killed.
      try {
        await queueWinbackAirtable(db, { id: `sent:${deliveryId}`, phone: current.phone, outcome: 'Sent', note: `Win-back ${campaignId}, ${current.version}, batch ${current.batch}, variant ${current.card_variant}: sent.`, now: clock() });
      } catch { result.mirrorDeferred = (result.mirrorDeferred || 0) + 1; }
    }
  }
  return result;
}

export async function runScheduledWinback(env, options = {}) {
  if (env.WINBACK_ENABLED !== 'true' || env.WINBACK_SEND_ENABLED !== 'true' || env.WINBACK_KILL_SWITCH !== 'false') return { enabled: false, sent: 0 };
  return runWinbackBatch(env, { campaignId: env.WINBACK_CAMPAIGN_ID, limit: 3, ...options });
}
