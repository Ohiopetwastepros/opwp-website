import { funnelDigest, funnelPhone, parseFunnelJson, funnelJobKey, FUNNEL_SETTINGS_KEY, nextFunnelSendAt } from './lead-funnel-policy.mjs';

const ORG = 'org-opwp';
export const LEAD_DEDUPE_HOURS = 24;
const normalizedSqlPhone = "substr(replace(replace(replace(replace(replace(replace(s.phone,'+',''),'(',''),')',''),'-',''),' ',''),'.',''),-10)";

// D1 batch is transactional. Resolve the canonical ID inside that transaction,
// before insertion, so simultaneous requests cannot both create a matching lead.
// Intake evidence is immutable and separate from the mutable canonical payload.
export async function captureFunnelLead(db, {source,body,funnelId='',eventId='',now=Date.now()}) {
  if (!['website','facebook'].includes(source)) throw new Error('Unsupported lead source.');
  const proposed = crypto.randomUUID(), phone = funnelPhone(body.phone), email = String(body.email || '').trim().toLowerCase();
  const evidenceKey = 'lead_intake:org-opwp:' + await funnelDigest(source + ':' + (eventId || crypto.randomUUID()));
  const at = new Date(now).toISOString();
  const match = `s.kind IN ('partial_quote','question') AND s.source IN ('website','facebook')
    AND s.status NOT IN ('deleted','converted','synced','cancelled') AND COALESCE(s.lifecycle_stage,'')!='converted'
    AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND (g.organization_id!='org-opwp' OR g.stage IN ('won','lost','not_qualified')))
    AND NOT EXISTS(SELECT 1 FROM lead_conversations c WHERE c.submission_id=s.id AND (c.organization_id!='org-opwp' OR c.status IN ('deleted','resolved')))
    AND ((?!='' AND s.funnel_id=?) OR (julianday(COALESCE(s.last_activity_at,s.created_at))>=julianday(?,'-24 hours')
      AND ((?!='' AND ${normalizedSqlPhone}=?) OR (?!='' AND lower(trim(s.email))=?))))`;
  const consent = source === 'website'
    ? {valid:body.follow_up_allowed === true && body.follow_up_consent === true && body.follow_up_consent_version === 'quote_service_sms_v1',version:body.follow_up_consent_version,capturedAt:body.follow_up_consent_at,phone,source}
    : {...body.sms_consent_evidence,phone,source};
  const incoming = {...body,phone:phone || body.phone || '',email,initial_sms_consent:consent};
  // Empty later answers must not erase known facts. Original forms remain in evidence.
  const nonempty = value => Object.fromEntries(Object.entries(value).filter(([,v]) => v !== '' && v !== null && v !== undefined).map(([k,v]) => [k,v && typeof v === 'object' && !Array.isArray(v) ? nonempty(v) : v]));
  const patch = nonempty(incoming);
  const results = await db.batch([
    db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
      VALUES (?,json_object('leadId',COALESCE((SELECT s.id FROM submissions s WHERE ${match} ORDER BY s.created_at,s.id LIMIT 1),?),
        'source',?,'receivedAt',?,'body',json(?)),'success',?) ON CONFLICT(snapshot_key) DO NOTHING`)
      .bind(evidenceKey,funnelId,funnelId,at,phone,phone.slice(-10),email,email,proposed,source,at,JSON.stringify(incoming),at),
    db.prepare(`INSERT INTO submissions(id,kind,source,status,name,email,phone,zip,payload,funnel_id,lifecycle_stage,sng_sync_state,last_activity_at)
      SELECT json_extract(payload,'$.leadId'),?,?,?,?,?,?,?,?,?,'quote_viewed','not_supported',? FROM airtable_cockpit_snapshots WHERE snapshot_key=?
      ON CONFLICT(id) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),submissions.name),email=COALESCE(NULLIF(excluded.email,''),submissions.email),
        phone=COALESCE(NULLIF(excluded.phone,''),submissions.phone),zip=COALESCE(NULLIF(excluded.zip,''),submissions.zip),
        payload=json_set(json_patch(submissions.payload,?),'$.sms_opt_out',CASE WHEN json_extract(submissions.payload,'$.sms_opt_out')=1 OR json_extract(excluded.payload,'$.sms_opt_out')=1 THEN json('true') ELSE json('false') END),
        last_activity_at=excluded.last_activity_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(source === 'website' ? 'partial_quote' : 'question',source,source === 'website' ? 'follow_up_pending' : 'new',body.name || null,email || null,phone || body.phone || null,body.zip || null,JSON.stringify(incoming),funnelId || null,at,evidenceKey,JSON.stringify(patch)),
    db.prepare(`INSERT OR IGNORE INTO lead_conversations(id,submission_id,organization_id,channel)
      SELECT 'funnel-'||json_extract(payload,'$.leadId'),json_extract(payload,'$.leadId'),'org-opwp',? FROM airtable_cockpit_snapshots WHERE snapshot_key=?`)
      .bind(source === 'facebook' ? 'facebook_lead' : 'website',evidenceKey),
    db.prepare(`INSERT OR IGNORE INTO growth_leads(submission_id,organization_id,stage,updated_by)
      SELECT json_extract(payload,'$.leadId'),'org-opwp','new','lead-intake' FROM airtable_cockpit_snapshots WHERE snapshot_key=?`).bind(evidenceKey),
    db.prepare(`SELECT json_extract(payload,'$.leadId') id FROM airtable_cockpit_snapshots WHERE snapshot_key=?`).bind(evidenceKey),
  ]);
  const id = results[4].results[0].id;
  return {configured:true,id,created:id === proposed,evidenceKey};
}

export async function getFunnelSettings(db) {
  const row = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(FUNNEL_SETTINGS_KEY).first();
  const saved = parseFunnelJson(row?.payload);
  return {...saved,initialTextMode:['auto','approval','off'].includes(saved.initialTextMode) ? saved.initialTextMode : 'approval'};
}

export async function queueFunnelInitialText(db, env, id, {now=Date.now()} = {}) {
  const row = await db.prepare('SELECT phone,payload FROM submissions WHERE id=?').bind(id).first();
  if (!row) throw new Error('Lead storage unavailable.');
  const body = parseFunnelJson(row.payload), consent = body.initial_sms_consent || {};
  const [settings,quiet] = await Promise.all([getFunnelSettings(db),db.prepare('SELECT * FROM lead_automation_settings WHERE organization_id=?').bind(ORG).first()]);
  const dueAt = nextFunnelSendAt(now, quiet || {});
  const job = {version:1,receivedAt:new Date(now).toISOString(),dueAt,consent,source:consent.source,initialTextMode:settings.initialTextMode,
    status:!consent.valid ? 'consent_required' : settings.initialTextMode === 'off' ? 'disabled' : settings.initialTextMode === 'approval' ? 'approval_required' : 'queued'};
  await db.batch([
    db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)
      ON CONFLICT(snapshot_key) DO NOTHING`).bind(funnelJobKey(id),JSON.stringify(job)),
    db.prepare(`INSERT OR IGNORE INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at)
      VALUES (?,?,?,?,'lead_funnel_v1',?,?)`).bind('funnel-'+id,id,row.phone,consent.disclosure || 'Requested quote and service follow-up. Reply STOP to opt out.',consent.capturedAt || new Date(now).toISOString(),dueAt || new Date(now).toISOString()),
    db.prepare(`INSERT OR IGNORE INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,next_attempt_at)
      SELECT ?,id,submission_id,'customer_sms',? FROM quote_follow_ups WHERE submission_id=?`).bind('quote-initial-sms-v1:'+id,dueAt || new Date(now).toISOString(),id),
  ]);
  // Keep fresh consent with its own source. A repeated form never resets approval,
  // retries, a sent outcome or an uncertain provider reservation.
  await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.consent',json(?),'$.source',?),updated_at=CURRENT_TIMESTAMP
    WHERE snapshot_key=?`).bind(JSON.stringify(consent),consent.source || '',funnelJobKey(id)).run();
  const delivery=await db.prepare(`SELECT id FROM quote_follow_up_deliveries WHERE submission_id=? AND channel='customer_sms'`).bind(id).first();
  if(delivery && delivery.id!=='quote-initial-sms-v1:'+id) {
    await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=json_set(payload,'$.status','legacy_delivery_review'),updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=?`).bind(funnelJobKey(id)).run();
    return {configured:true,status:'legacy_delivery_review',id:delivery.id,scheduledAt:dueAt};
  }
  return {configured:true,status:job.status,id:'quote-initial-sms-v1:'+id,scheduledAt:dueAt};
}
