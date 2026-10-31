import { readInboxRow, leadDigest, intakeQuote, LeadInboxError } from './lead-inbox-store';
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const currentQuote=q=>JSON.stringify({custom:q.custom,monthly:q.monthly,cleanupRange:q.cleanupRange,dogs:q.dogs,frequency:q.frequency,yard:q.yard,lastCleaned:q.lastCleaned,addons:q.addons});
export async function createLeadHandoff(db,id,actor){
  const row=await readInboxRow(db,id),ws=parse(row?.workspace_payload);
  if(!row||!ws.quote||ws.quote.custom||!ws.routeAudit||ws.routeAudit.handoffKey!==ws.handoffKey)throw new LeadInboxError('Review the quote and service day before preparing signup.');
  if(currentQuote(ws.quote)!==currentQuote(intakeQuote(ws.intake)))throw new LeadInboxError('Pricing changed. Save and review a fresh quote before preparing signup.',409);
  const bytes=crypto.getRandomValues(new Uint8Array(32)),token=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
  const expiresAt=new Date(Date.now()+72*3600000).toISOString();
  await db.batch([
    db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)`).bind('lead_prefill:'+await leadDigest(token),JSON.stringify({leadId:id,handoffKey:ws.handoffKey,expiresAt,createdBy:actor,quote:currentQuote(ws.quote)})),
    db.prepare(`UPDATE submissions SET funnel_id=COALESCE(funnel_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(crypto.randomUUID(),id),
  ]);
  return {url:'https://www.ohiopetwastepros.com/free-quote/#lead='+token,expiresAt};
}
export async function readLeadHandoff(db,token){
  if(typeof token!=='string'||! /^[0-9a-f]{64}$/.test(token))throw new LeadInboxError('This signup link is unavailable.',404);
  const stored=await db.prepare(`SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND status='success' LIMIT 1`).bind('lead_prefill:'+await leadDigest(token)).first();
  const handoff=parse(stored?.payload);if(!handoff.expiresAt||Date.parse(handoff.expiresAt)<=Date.now())throw new LeadInboxError('This signup link has expired. Please request a new link.',410);
  const row=await readInboxRow(db,handoff.leadId),ws=parse(row?.workspace_payload);
  if(!row||['won','lost','not_qualified'].includes(row.office_stage)||row.lifecycle_stage==='converted'||handoff.handoffKey!==ws.handoffKey||!ws.routeAudit||ws.routeAudit.handoffKey!==ws.handoffKey||handoff.quote!==currentQuote(intakeQuote(ws.intake||{})))throw new LeadInboxError('The quote or customer details changed. Please request a fresh signup link.',410);
  const i=ws.intake||{};
  // Capability grants these fields only: never consent, gate codes, payment, internal notes or an account session.
  return {firstName:i.firstName,lastName:i.lastName,phone:row.phone,email:row.email,address:i.address,city:i.city,state:i.state,zip:row.zip,dogs:i.dogs,frequency:i.frequency,lastCleaned:i.lastCleaned,yardSize:i.yardSize,addons:i.addons||[],funnelId:row.funnel_id,serviceDay:ws.routeAudit.day};
}

// Called only after the backend records a successful SNG signup. A browser flag or
// matching funnel alone cannot establish a customer or payment.
export async function completeInboxHandoff(db,onboardingId){
  if(!db)return {matched:false};
  const signup=await db.prepare(`SELECT id,funnel_id,email,phone,sng_entity_id FROM submissions WHERE id=? AND kind='onboarding' AND sng_sync_state='succeeded' AND sng_synced=1 LIMIT 1`).bind(onboardingId).first();
  if(!signup?.funnel_id||!signup.email||!signup.phone)return {matched:false};
  const rows=await db.prepare(`SELECT s.id,s.source,s.email,s.phone,w.payload FROM submissions s JOIN airtable_cockpit_snapshots w ON w.snapshot_key=('lead_workspace:org-opwp:'||s.id) WHERE s.funnel_id=? AND s.id!=? AND s.status!='deleted' AND json_extract(w.payload,'$.handoffPreparedAt') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND g.organization_id!='org-opwp') AND NOT EXISTS(SELECT 1 FROM lead_conversations c WHERE c.submission_id=s.id AND (c.organization_id!='org-opwp' OR c.status='deleted')) LIMIT 3`).bind(signup.funnel_id,signup.id).all();
  const phone=v=>String(v||'').replace(/\D/g,'').slice(-10);
  const matches=(rows.results||[]).filter(r=>r.email?.toLowerCase()===signup.email.toLowerCase()&&phone(r.phone).length===10&&phone(r.phone)===phone(signup.phone));
  if(matches.length!==1)return {matched:false,needsReview:rows.results?.length>0};
  const lead=matches[0],eventId='inbox-signup:'+signup.id+':'+lead.id;
  // Meta's existing reconciler owns signup matching and payment-qualified Won attribution.
  if(lead.source==='facebook')return {matched:false,delegated:'meta_verified_conversion'};
  await db.batch([
    db.prepare(`UPDATE submissions SET lifecycle_stage='converted',status='converted',sng_sync_state='succeeded',sng_entity_id=?,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND email=? AND phone=? AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND kind='onboarding' AND sng_sync_state='succeeded' AND sng_synced=1) AND EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?)`).bind(signup.sng_entity_id||null,lead.id,lead.email,lead.phone,signup.id,'lead_workspace:org-opwp:'+lead.id,lead.payload),
    db.prepare(`UPDATE growth_leads SET stage='won',next_action=NULL,next_action_at=NULL,converted_at=COALESCE(converted_at,CURRENT_TIMESTAMP),version=version+1,updated_by='verified_signup',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp' AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND lifecycle_stage='converted')`).bind(lead.id,lead.id),
    db.prepare(`UPDATE lead_conversations SET status='resolved',automation_mode='paused',unread_count=0,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp' AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND lifecycle_stage='converted')`).bind(lead.id,lead.id),
    db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp' AND status IN ('queued','failed') AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND lifecycle_stage='converted')`).bind(lead.id,lead.id),
    db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='verified_signup',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp' AND status IN ('queued','blocked') AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND lifecycle_stage='converted')`).bind(lead.id,lead.id),
    db.prepare(`INSERT OR IGNORE INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email) SELECT ?,?,'org-opwp','system','Customer signup verified; sales outreach stopped',?,'verified_signup' WHERE EXISTS(SELECT 1 FROM submissions WHERE id=? AND lifecycle_stage='converted')`).bind(eventId,lead.id,JSON.stringify({onboardingId:signup.id,paymentVerified:false}),lead.id),
    db.prepare(`INSERT INTO lead_airtable_sync(submission_id,organization_id,status) SELECT ?,'org-opwp','queued' WHERE EXISTS(SELECT 1 FROM submissions WHERE id=? AND lifecycle_stage='converted') ON CONFLICT(submission_id) DO UPDATE SET status='queued',attempt_count=0,next_attempt_at=CURRENT_TIMESTAMP,revision=lead_airtable_sync.revision+1,updated_at=CURRENT_TIMESTAMP`).bind(lead.id,lead.id),
  ]);
  return {matched:true,leadId:lead.id};
}
