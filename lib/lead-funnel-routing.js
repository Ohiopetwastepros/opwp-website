import {ensureFreshAirtableCockpitSnapshot} from './airtable';
import {recommendOnboardingRoute} from './route-intelligence';
import {funnelDetails,funnelJobKey,parseFunnelJson,funnelTime,funnelDigest} from './lead-funnel-policy.mjs';

export async function recommendFunnelDay(db,env,body,{now=Date.now(),refresh=ensureFreshAirtableCockpitSnapshot,recommend=recommendOnboardingRoute}={}) {
  const d=funnelDetails(body);
  if(!d.address || !d.frequency)return {reason:'Address and service frequency needed.',stale:true};
  if(d.frequency==='one_time')return {reason:'One-time scheduling needs owner review.',requiresReview:true};
  await refresh(env,15,{refreshRouteHistory:false});
  // Same engine and options as /admin/route-day-recommendation/.
  const result=await recommend(db,{home_address:d.address,address:d.address,city:d.city,state:d.state,zip:d.zip,zip_code:d.zip,frequency:d.frequency,clean_up_frequency:d.frequency},
    {allowGeographicFallback:true,closestRoadMatch:true});
  const time=funnelTime(result?.sourceSnapshotAt),day=result?.recommendedPair||result?.recommendedDay;
  if(!result?.eligible || !day || !Number.isFinite(time) || time>now+60000 || now-time>15*60000)return {reason:'Fresh route guidance unavailable. Review the address and routing source.',stale:true,requiresReview:true};
  return {day,sourceSnapshotAt:result.sourceSnapshotAt,confidence:result.confidence,basis:result.recommendationBasis,
    requiresReview:Boolean(result.requiresOwnerConfirmation || result.confidence!=='high'),staffingConfirmationRequired:true};
}
export async function refreshFunnelRoutes(env,{limit=2}={}) {
  if(env.LEAD_FUNNEL_ENABLED!=='true' || !env.DB)return;
  const db=env.DB;
  const rows=await db.prepare(`SELECT s.id,s.payload,j.payload job_payload,w.payload workspace_payload FROM submissions s
    JOIN airtable_cockpit_snapshots j ON j.snapshot_key='lead_funnel_job:org-opwp:'||s.id
    LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key='lead_workspace:org-opwp:'||s.id
    WHERE s.status IN ('new','follow_up_pending') AND (json_extract(j.payload,'$.routeCheckedAt') IS NULL OR julianday(json_extract(j.payload,'$.routeCheckedAt'))<julianday('now','-15 minutes'))
    ORDER BY COALESCE(json_extract(j.payload,'$.routeCheckedAt'),''),s.created_at LIMIT ?`).bind(limit).all();
  for(const row of rows.results||[]) {
    const original=parseFunnelJson(row.payload),intake=parseFunnelJson(row.workspace_payload).intake||{};
    const body={...original,home_address:intake.address||original.home_address||original.address,city:intake.city||original.city};
    const signature=await funnelDigest(JSON.stringify(funnelDetails(body)));
    let route;
    try{route=await recommendFunnelDay(db,env,body);}catch{route={stale:true,requiresReview:true,reason:'Route provider unavailable. Review routing health.'};}
    await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.route',json(?),'$.routeCheckedAt',?,'$.routeInputHash',?),updated_at=CURRENT_TIMESTAMP
      WHERE snapshot_key=? AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND payload=?)`)
      .bind(JSON.stringify(route),new Date().toISOString(),signature,funnelJobKey(row.id),row.id,row.payload).run();
  }
}
