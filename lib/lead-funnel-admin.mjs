import {FUNNEL_SETTINGS_KEY,funnelJobKey,parseFunnelJson,funnelDigest,funnelTime,buildFunnelInitialText,sonaHandoffBrief,nextFunnelSendAt,funnelDetails} from './lead-funnel-policy.mjs';
import {getFunnelSettings} from './lead-funnel-intake.mjs';

export class FunnelError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const previewSql=`SELECT s.*,j.payload job_payload,d.status delivery_status,d.error_message,d.provider_message_id
    FROM submissions s JOIN airtable_cockpit_snapshots j ON j.snapshot_key='lead_funnel_job:org-opwp:'||s.id
    LEFT JOIN quote_follow_up_deliveries d ON d.id='quote-initial-sms-v1:'||s.id
    WHERE s.status!='deleted' AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND g.organization_id!='org-opwp')
      AND NOT EXISTS(SELECT 1 FROM lead_conversations c WHERE c.submission_id=s.id AND c.organization_id!='org-opwp')`;
async function previewFromRow(row,now) {
  const job=parseFunnelJson(row.job_payload),body=parseFunnelJson(row.payload),route={...(job.route || {})};
  if(route.day && (job.routeInputHash!==await funnelDigest(JSON.stringify(funnelDetails(body))) || !Number.isFinite(funnelTime(route.sourceSnapshotAt)) || funnelTime(route.sourceSnapshotAt)>now+60000 || now-funnelTime(route.sourceSnapshotAt)>15*60000))route.stale=true;
  const text=buildFunnelInitialText(body,route);
  return {id:row.id,name:row.name||row.phone||row.email,phone:row.phone,source:row.source,status:job.status,delivery:row.delivery_status,error:row.error_message,
    dueAt:job.dueAt,consent:job.consent?.valid===true,approvedAt:job.approvedAt||null,text,route,sonaBrief:sonaHandoffBrief(body,route),
    version:await funnelDigest(row.payload+'|'+row.phone+'|'+row.job_payload+'|'+text)};
}
export async function readFunnelPreview(db,id,{now=Date.now()}={}) {
  const row=await db.prepare(previewSql+' AND s.id=?').bind(id).first();
  if(!row)throw new FunnelError('Lead not found.',404);
  return previewFromRow(row,now);
}
export async function funnelOverview(db,env) {
  const settings=await getFunnelSettings(db);
  const rows=await db.prepare(previewSql+` AND s.status NOT IN ('converted','synced') ORDER BY s.created_at DESC LIMIT 100`).all();
  const now=Date.now(),leads=await Promise.all((rows.results||[]).map(row=>previewFromRow(row,now)));
  return {enabled:env.LEAD_FUNNEL_ENABLED==='true',sender:'+14192622371',settings,leads};
}
export async function saveFunnelMode(db,mode,actor) {
  if(!['auto','approval','off'].includes(mode))throw new FunnelError('Choose automatic sending, one-tap approval or off.');
  const settings={initialTextMode:mode,updatedBy:actor,updatedAt:new Date().toISOString()};
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP`).bind(FUNNEL_SETTINGS_KEY,JSON.stringify(settings)).run();
  return settings;
}
export async function approveFunnelInitialText(db,id,version,actor,{now=Date.now()}={}) {
  const preview=await readFunnelPreview(db,id,{now});
  if(version!==preview.version)throw new FunnelError('The lead or message changed. Review the latest text.',409);
  if(!preview.consent)throw new FunnelError('Verified SMS consent is required. Approval cannot supply consent.',409);
  if(preview.delivery!=='queued')throw new FunnelError('This text is already handled. Check its delivery status.',409);
  const row=await db.prepare(`SELECT s.payload,j.payload job_payload FROM submissions s JOIN airtable_cockpit_snapshots j ON j.snapshot_key='lead_funnel_job:org-opwp:'||s.id WHERE s.id=?`).bind(id).first();
  if((await readFunnelPreview(db,id,{now})).version!==version)throw new FunnelError('The lead changed. Review the latest text.',409);
  const job=parseFunnelJson(row.job_payload),settings=await getFunnelSettings(db);
  if(settings.initialTextMode==='off')throw new FunnelError('Initial texts are turned off.',409);
  const quiet=await db.prepare(`SELECT * FROM lead_automation_settings WHERE organization_id='org-opwp'`).first();
  const dueAt=nextFunnelSendAt(now,quiet||{});
  if(!dueAt)throw new FunnelError('Quiet hours leave no sending window. Review the settings.',409);
  const approved={...job,status:'queued',approvedAt:new Date(now).toISOString(),approvedBy:actor,approvedPayloadHash:await funnelDigest(row.payload),approvedMessageHash:await funnelDigest(preview.text),dueAt};
  const results=await db.batch([
    db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?
      AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND payload=?)`).bind(JSON.stringify(approved),funnelJobKey(id),row.job_payload,id,row.payload),
    db.prepare(`UPDATE quote_follow_up_deliveries SET next_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed') AND attempt_count<5
      AND EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?)`).bind(dueAt,'quote-initial-sms-v1:'+id,funnelJobKey(id),JSON.stringify(approved)),
  ]);
  if(!results[0].meta?.changes)throw new FunnelError('The lead changed. Reload before approving.',409);
  return {dueAt};
}
