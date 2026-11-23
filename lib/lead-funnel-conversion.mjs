import {funnelPhone,funnelJobKey} from './lead-funnel-policy.mjs';
import {reconcileMetaConversions} from './meta-conversion.mjs';

// SNG success establishes signup only. Meta payment attribution remains owned
// by the existing verified-payment reconciler and is never inferred from signup.
export async function reconcileFunnelSignups(db,{limit=50}={}) {
  await reconcileMetaConversions(db);
  const rows=await db.prepare(`SELECT s.id,s.email,s.phone,j.payload FROM submissions s JOIN airtable_cockpit_snapshots j ON j.snapshot_key='lead_funnel_job:org-opwp:'||s.id
    WHERE s.status!='deleted' AND COALESCE(json_extract(j.payload,'$.status'),'')!='converted'
    ORDER BY COALESCE(json_extract(j.payload,'$.signupCheckedAt'),''),s.created_at LIMIT ?`).bind(limit).all();
  let matched=0;
  for(const row of rows.results||[]) {
    await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.signupCheckedAt',?),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?`).bind(new Date().toISOString(),funnelJobKey(row.id)).run();
    if(!row.email||!funnelPhone(row.phone))continue;
    const candidates=await db.prepare(`SELECT id,phone FROM submissions WHERE kind='onboarding' AND sng_synced=1 AND sng_sync_state='succeeded'
      AND lower(trim(email))=? AND julianday(created_at)>=julianday(json_extract(?,'$.receivedAt')) ORDER BY created_at LIMIT 10`).bind(row.email.trim().toLowerCase(),row.payload).all();
    const signups=(candidates.results||[]).filter(s=>funnelPhone(s.phone)===funnelPhone(row.phone));
    if(signups.length!==1)continue;
    await db.batch([
      db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.status','converted','$.onboardingId',?,'$.paymentVerified',json('false')),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?`).bind(signups[0].id,funnelJobKey(row.id)),
      db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',error_message='verified_signup',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed')`).bind(row.id),
      db.prepare(`UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed')`).bind(row.id),
      db.prepare(`UPDATE lead_conversations SET status='resolved',automation_mode='paused',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp'`).bind(row.id),
      db.prepare(`INSERT OR IGNORE INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email) VALUES (?,?,'org-opwp','system','Signup verified; initial contact stopped',?,'lead-funnel')`).bind('funnel-signup:'+row.id,row.id,JSON.stringify({onboardingId:signups[0].id,paymentVerified:false})),
    ]);
    matched++;
  }
  return {matched};
}
