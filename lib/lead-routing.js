import { readInboxRow, inboxVersion, LeadInboxError } from './lead-inbox-store';
import { ensureFreshAirtableCockpitSnapshot } from './airtable';
import { recommendOnboardingRoute } from './route-intelligence';
import { leadTime } from './lead-inbox.mjs';
export async function reviewLeadDay(db,env,id,body,actor){
  const owner=String(env.ADMIN_USERNAME||'').trim().toLowerCase();
  if(!owner||actor.toLowerCase()!==owner)throw new LeadInboxError('Craig must review the service day.',403);
  if(body.staffingConfirmed!==true||typeof body.reviewNote!=='string'||!body.reviewNote.trim()||body.reviewNote.length>500)throw new LeadInboxError('Confirm staffing and record your service-day review.');
  const row=await readInboxRow(db,id);if(!row)throw new LeadInboxError('Lead not found.',404);
  if(body.version!==await inboxVersion(row))throw new LeadInboxError('The lead changed. Reload before reviewing the day.',409);
  const ws=JSON.parse(row.workspace_payload||'{}'),i=ws.intake||{};
  if(!i.address||!i.city||!i.zip||!ws.quote||ws.quote.custom)throw new LeadInboxError('Save the full address and standard quote details first.');
  let day=i.serviceDay,evidence;
  if(i.frequency==='one_time'){
    if(!i.startDate||Date.parse(i.startDate+'T23:59:59Z')<Date.now())throw new LeadInboxError('Choose a future first-cleanup date before reviewing a one-time job.');
    day=i.startDate;evidence={basis:'Owner-reviewed one-time scheduling',capturedAt:new Date().toISOString()};
  }else{
    if(!day)throw new LeadInboxError('Save the proposed service day first.');
    await ensureFreshAirtableCockpitSnapshot(env,15,{refreshRouteHistory:false});
    const recommendation=await recommendOnboardingRoute(db,{home_address:i.address,address:i.address,city:i.city,state:i.state,zip:i.zip,zip_code:i.zip,frequency:i.frequency,clean_up_frequency:i.frequency,monthly_revenue:ws.quote.monthly},{allowGeographicFallback:true,closestRoadMatch:true});
    const days=String(day).split(' / '),expected=i.frequency==='twice_a_week'?2:1;
    if(!recommendation?.eligible||days.length!==expected||days.some(d=>!recommendation.rankedDays?.some(r=>r.day===d&&r.allowed))||!leadTime(recommendation.sourceSnapshotAt)||leadTime(recommendation.sourceSnapshotAt)>Date.now()+60000||Date.now()-leadTime(recommendation.sourceSnapshotAt)>15*60000)throw new LeadInboxError('The selected day is not supported by fresh route guidance. Review the saved address and recommendation.');
    if(days.length===2&&!['Monday / Thursday','Tuesday / Thursday','Tuesday / Friday'].includes(day))throw new LeadInboxError('Choose a supported twice-weekly pair.');
    evidence={basis:recommendation.recommendationBasis,capturedAt:recommendation.sourceSnapshotAt,region:recommendation.region,confidence:recommendation.confidence,roadCapacityUnverified:Boolean(recommendation.requiresOwnerConfirmation),warnings:recommendation.routeWarnings||[]};
  }
  return {actor,day,at:new Date().toISOString(),handoffKey:ws.handoffKey,note:body.reviewNote.trim(),staffingConfirmed:true,evidence};
}
