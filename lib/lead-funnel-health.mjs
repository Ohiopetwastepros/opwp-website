import {funnelTime,parseFunnelJson} from './lead-funnel-policy.mjs';

export async function recordLeadFeed(db,provider,state,{now=Date.now()}={}) {
  const key='lead_feed:'+provider;
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=json_patch(airtable_cockpit_snapshots.payload,excluded.payload),updated_at=CURRENT_TIMESTAMP`)
    .bind(key,JSON.stringify({...state,lastCheckedAt:new Date(now).toISOString()})).run();
}
export async function getLeadFunnelHealth(db,env={}, {now=Date.now()}={}) {
  const [queues,emails,events,missing,decisions,polls,feeds] = await Promise.all([
    db.prepare(`SELECT COUNT(*) count,MIN(d.created_at) oldest FROM quote_follow_up_deliveries d JOIN submissions s ON s.id=d.submission_id
      WHERE d.channel='customer_sms' AND d.status IN ('queued','sending','failed') AND s.status NOT IN ('deleted','converted','cancelled','synced')
        AND ((d.status='failed' AND d.attempt_count>=5) OR julianday(d.next_attempt_at)<julianday(?,'-5 minutes')) AND NOT EXISTS(SELECT 1 FROM airtable_cockpit_snapshots j WHERE j.snapshot_key='lead_funnel_job:org-opwp:'||s.id AND json_extract(j.payload,'$.status') IN ('approval_required','consent_required','meta_release_or_consent_required','disabled'))`).bind(new Date(now).toISOString()).first(),
    db.prepare(`SELECT COUNT(*) count,MAX(error_message) error,MIN(created_at) oldest FROM submission_notifications WHERE status='failed' OR (status='sending' AND sending_at<datetime('now','-5 minutes'))`).first(),
    db.prepare(`SELECT provider,MAX(received_at) received,MAX(CASE WHEN status='processed' THEN processed_at END) processed,SUM(status='failed') failed FROM lead_webhook_events WHERE organization_id='org-opwp' GROUP BY provider`).all(),
    db.prepare(`SELECT s.id FROM submissions s LEFT JOIN quote_follow_up_deliveries d ON d.submission_id=s.id AND d.channel='customer_sms'
      WHERE s.status IN ('new','follow_up_pending') AND d.id IS NULL
        AND ((s.kind='partial_quote' AND s.source='website' AND json_extract(s.payload,'$.follow_up_consent')=1) OR json_extract(s.payload,'$.initial_sms_consent.valid')=1)
        AND julianday(s.created_at)<julianday(?,'-1 minute') ORDER BY s.created_at LIMIT 20`).bind(new Date(now).toISOString()).all(),
    db.prepare(`SELECT s.id,j.payload FROM submissions s JOIN airtable_cockpit_snapshots j ON j.snapshot_key='lead_funnel_job:org-opwp:'||s.id
      WHERE s.status IN ('new','follow_up_pending') AND (json_extract(j.payload,'$.status') IN ('approval_required','consent_required','meta_release_or_consent_required','legacy_delivery_review')
      OR json_extract(j.payload,'$.route.requiresReview')=1) ORDER BY j.captured_at LIMIT 20`).all(),
    db.prepare(`SELECT COUNT(*) count FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'lead_sms_poll:%' AND json_extract(payload,'$.status')='failed'`).first(),
    db.prepare(`SELECT snapshot_key,payload FROM airtable_cockpit_snapshots WHERE snapshot_key IN ('lead_feed:meta','lead_feed:quo')`).all(),
  ]);
  const incidents=[];
  if(env.LEAD_FUNNEL_ENABLED==='true' && env.QUOTE_INITIAL_SMS_ENABLED!=='true')incidents.push({key:'sms_sender_disabled',reason:'initial_sms_worker_disabled',state:'configuration'});
  if(env.LEAD_FUNNEL_ENABLED==='true' && !String(env.META_ALLOWED_PAGE_IDS||'').trim())incidents.push({key:'meta_page_scope_missing',reason:'facebook_page_allowlist_missing',state:'configuration'});
  const eventRows=events.results||[],meta=eventRows.find(e=>e.provider==='meta')||{},quo=eventRows.find(e=>e.provider==='quo')||{};
  const feed=provider=>parseFunnelJson(feeds.results?.find(f=>f.snapshot_key==='lead_feed:'+provider)?.payload);
  if(queues.count)incidents.push({key:'sms_backlog:'+queues.oldest,reason:'lead_sms_queue_backlog',state:'pipeline',count:queues.count});
  if(emails.count)incidents.push({key:'owner_email:'+emails.oldest,reason:'owner_email_delivery_failed',state:'owner_email',count:emails.count});
  for(const row of missing.results||[])incidents.push({key:'missing_job:'+row.id,submissionId:row.id,reason:'consented_lead_has_no_sms_job',state:'missing_job'});
  for(const row of decisions.results||[]) {
    const job=parseFunnelJson(row.payload);
    incidents.push({key:'decision:'+row.id,submissionId:row.id,reason:job.route?.requiresReview?'service_day_review_required':job.status,state:'decision'});
  }
  const silenceHours=Math.max(1,Math.min(168,Number(env.META_LEAD_SILENCE_HOURS)||24));
  if(env.META_LEADS_EXPECTED==='true' && (!Number.isFinite(funnelTime(meta.processed)) || now-funnelTime(meta.processed)>silenceHours*3600000))
    incidents.push({key:'meta_silent:'+(meta.processed||'never'),reason:'facebook_intake_quiet_check_meta_delivery',state:'meta_feed'});
  for(const [provider,record] of [['meta',meta],['quo',quo]]) {
    const current=feed(provider);
    if(record.failed || current.status==='failed')incidents.push({key:provider+'_feed_failure:'+(current.lastCheckedAt||record.received||'never'),reason:provider+'_webhook_processing_failed',state:provider+'_feed'});
  }
  if(polls.count)incidents.push({key:'quo_reconciliation_failed',reason:'quo_status_reconciliation_failed',state:'quo_feed',count:polls.count});
  const quoFeed=feed('quo');
  const waiting=await db.prepare(`SELECT COUNT(*) count,MIN(sent_at) oldest FROM quote_follow_up_deliveries d WHERE d.id LIKE 'quote-initial-sms-v1:%' AND d.provider_message_id IS NOT NULL
    AND julianday(d.sent_at)<julianday(?,'-10 minutes') AND NOT EXISTS(SELECT 1 FROM quo_delivery_receipts r WHERE r.provider_message_id=d.provider_message_id AND r.organization_id='org-opwp')`).bind(new Date(now).toISOString()).first();
  if(waiting.count && (!Number.isFinite(funnelTime(quoFeed.lastProcessedAt)) || now-funnelTime(quoFeed.lastProcessedAt)>10*60000))
    incidents.push({key:'quo_feed_quiet:'+waiting.oldest,reason:'quo_delivery_feed_quiet',state:'quo_feed',count:waiting.count});
  return {status:incidents.length?'attention':'healthy',incidents,backlog:Number(queues.count||0),emailFailures:Number(emails.count||0),missingJobs:missing.results?.length||0,metaLastProcessed:meta.processed||null,quoLastProcessed:quoFeed.lastProcessedAt||quo.processed||null,checkedAt:new Date(now).toISOString()};
}
