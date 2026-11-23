import { readBoundedProviderJson } from './bounded-body.mjs';
import { funnelJobKey } from './lead-funnel-policy.mjs';

export async function reconcileInitialSmsReceipts(db) {
  await db.batch([
    db.prepare(`UPDATE quote_follow_up_deliveries SET
      status=CASE WHEN (SELECT status FROM quo_delivery_receipts r WHERE r.provider_message_id=quote_follow_up_deliveries.provider_message_id AND r.organization_id='org-opwp')='delivered' THEN 'sent' ELSE 'failed' END,
      error_message=CASE WHEN (SELECT status FROM quo_delivery_receipts r WHERE r.provider_message_id=quote_follow_up_deliveries.provider_message_id AND r.organization_id='org-opwp')='failed' THEN 'quo_delivery_failed' ELSE NULL END,
      attempt_count=CASE WHEN EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=quote_follow_up_deliveries.provider_message_id AND r.organization_id='org-opwp' AND r.status='failed') THEN 5 ELSE attempt_count END,
      updated_at=CURRENT_TIMESTAMP WHERE id LIKE 'quote-initial-sms-v1:%' AND channel='customer_sms'
      AND EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=quote_follow_up_deliveries.provider_message_id AND r.organization_id='org-opwp')`),
    db.prepare(`UPDATE lead_messages SET delivery_status=(SELECT status FROM quo_delivery_receipts r WHERE r.provider_message_id=lead_messages.provider_message_id AND r.organization_id=lead_messages.organization_id)
      WHERE organization_id='org-opwp' AND direction='outbound' AND delivery_status!='delivered'
      AND EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=lead_messages.provider_message_id AND r.organization_id=lead_messages.organization_id)`),
    db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.status',
      (SELECT status FROM quo_delivery_receipts r WHERE r.provider_message_id=json_extract(airtable_cockpit_snapshots.payload,'$.providerId') AND r.organization_id='org-opwp')),
      updated_at=CURRENT_TIMESTAMP WHERE (snapshot_key LIKE 'lead_manual_send:org-opwp:%' OR snapshot_key LIKE 'lead_funnel_job:org-opwp:%' OR snapshot_key LIKE 'quote_initial_sms:org-opwp:%')
      AND EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=json_extract(airtable_cockpit_snapshots.payload,'$.providerId') AND r.organization_id='org-opwp')`),
    db.prepare(`UPDATE quote_follow_ups SET status=(SELECT d.status FROM quote_follow_up_deliveries d WHERE d.follow_up_id=quote_follow_ups.id AND d.channel='customer_sms'),updated_at=CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM airtable_cockpit_snapshots j WHERE j.snapshot_key='lead_funnel_job:org-opwp:'||quote_follow_ups.submission_id)
        AND NOT EXISTS(SELECT 1 FROM quote_follow_up_deliveries d WHERE d.follow_up_id=quote_follow_ups.id AND d.channel!='customer_sms')
        AND EXISTS(SELECT 1 FROM quote_follow_up_deliveries d WHERE d.follow_up_id=quote_follow_ups.id AND d.provider_message_id IS NOT NULL AND d.status IN ('sent','failed'))`),
  ]);
}

// A read-only fallback for lost delivery webhooks. No send or resend occurs here.
export async function reconcileInitialSms(env, {fetcher=fetch,now=Date.now()} = {}) {
  if (!env?.DB) return {checked:0};
  const db=env.DB;
  await reconcileInitialSmsReceipts(db);
  if (!env.QUO_API_KEY) return {checked:0};
  const origin=env.QUO_API_BASE_URL || 'https://api.openphone.com';
  if (!['https://api.openphone.com','https://api.quo.com'].includes(origin)) throw new Error('quo_origin_invalid');
  const rows=await db.prepare(`SELECT d.id,d.submission_id,d.provider_message_id FROM quote_follow_up_deliveries d
    LEFT JOIN airtable_cockpit_snapshots p ON p.snapshot_key='lead_sms_poll:'||d.id
    WHERE d.id LIKE 'quote-initial-sms-v1:%' AND d.provider_message_id IS NOT NULL
      AND d.status IN ('sent','failed') AND NOT EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=d.provider_message_id AND r.organization_id='org-opwp')
      AND (p.snapshot_key IS NULL OR julianday(json_extract(p.payload,'$.checkedAt'))<julianday(?,'-2 minutes'))
    ORDER BY COALESCE(p.updated_at,d.created_at),d.id LIMIT 8`).bind(new Date(now).toISOString()).all();
  for (const row of rows.results || []) {
    let outcome='failed';
    try {
      const response=await fetcher(origin+'/v1/messages/'+encodeURIComponent(row.provider_message_id),{headers:{Authorization:env.QUO_API_KEY,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)});
      if (!response.ok) { await response.body?.cancel(); throw new Error('quo_status_unavailable'); }
      const data=(await readBoundedProviderJson(response,64*1024)).data;
      if (data?.id !== row.provider_message_id || !['queued','sent','delivered','failed','undelivered'].includes(data.status)) throw new Error('quo_status_invalid');
      outcome='success';
      if (['delivered','failed','undelivered'].includes(data.status)) {
        await db.prepare(`INSERT INTO quo_delivery_receipts(provider_message_id,organization_id,status) VALUES (?,'org-opwp',?)
          ON CONFLICT(provider_message_id) DO UPDATE SET status=CASE WHEN quo_delivery_receipts.status='delivered' THEN 'delivered' ELSE excluded.status END`)
          .bind(row.provider_message_id,data.status === 'delivered' ? 'delivered' : 'failed').run();
      }
      // Provider acceptance is represented as sent; delivered requires a receipt.
      await db.prepare(`UPDATE lead_messages SET delivery_status='sent' WHERE provider_message_id=? AND organization_id='org-opwp' AND delivery_status IN ('queued','sending')`).bind(row.provider_message_id).run();
    } catch { /* Durable probe failure is visible to the watchdog. */ }
    await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)
      ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP`)
      .bind('lead_sms_poll:'+row.id,JSON.stringify({checkedAt:new Date(now).toISOString(),status:outcome})).run();
    if (outcome === 'failed') await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.reconciliation','failed'),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?`).bind(funnelJobKey(row.submission_id)).run();
  }
  await reconcileInitialSmsReceipts(db);
  return {checked:rows.results?.length || 0};
}
