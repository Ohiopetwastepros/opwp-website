const ORG='org-opwp';
export class LeadTrashError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
export const trashVersion=row=>hash(JSON.stringify(row));
export async function listLeadTrash(db,{limit=100,offset=0,query=''}={}) {
  const pattern='%'+String(query).trim().slice(0,120).replace(/[\\%_]/g,v=>'\\'+v)+'%';
  const result=await db.prepare(`SELECT s.id,s.name,s.phone,s.email,s.zip,t.deleted_at,t.purge_after,t.command_id
    FROM lead_inbox_trash t JOIN submissions s ON s.id=t.submission_id
    WHERE t.organization_id=? AND s.status='trashed' AND datetime(t.purge_after)>CURRENT_TIMESTAMP
    AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND g.organization_id!=?)
    AND NOT EXISTS(SELECT 1 FROM lead_conversations c WHERE c.submission_id=s.id AND c.organization_id!=?)
    AND (COALESCE(s.name,'') LIKE ? ESCAPE '\\' OR COALESCE(s.phone,'') LIKE ? ESCAPE '\\' OR COALESCE(s.email,'') LIKE ? ESCAPE '\\' OR COALESCE(s.zip,'') LIKE ? ESCAPE '\\')
    ORDER BY t.deleted_at DESC,s.id DESC LIMIT ? OFFSET ?`).bind(ORG,ORG,ORG,pattern,pattern,pattern,pattern,Math.min(100,Math.max(1,Number(limit)||100)),Math.max(0,Number(offset)||0)).all();
  return {leads:await Promise.all((result.results||[]).map(async row=>({...row,name:row.name||row.phone||row.email||'Contact details needed',trashedAt:row.deleted_at,purgeAfter:row.purge_after,recordVersion:await trashVersion(row)})))};
}
export async function trashLead(db,row,body,actor) {
  if(body.action!=='delete'||body.confirmed!==true)throw new LeadTrashError('Confirm Delete before moving this lead to Trash.');
  if(!row||row.status==='trashed'||row.status==='deleted')throw new LeadTrashError('Lead not found.',404);
  const id=row.id,command=crypto.randomUUID();
  const guard=`EXISTS(SELECT 1 FROM lead_inbox_trash WHERE submission_id=? AND command_id=?)`;
  const args=[id,command];
  // The insert claims the observed source, office, conversation and workspace version.
  // Every mutation is guarded by this command in the same D1 transaction.
  const result=await db.batch([
    db.prepare(`INSERT INTO lead_inbox_trash(submission_id,organization_id,prior_status,deleted_by,command_id)
      SELECT s.id,?,s.status,?,? FROM submissions s WHERE s.id=? AND s.status=? AND COALESCE(s.updated_at,'')=? AND s.payload=?
      AND COALESCE(s.name,'')=? AND COALESCE(s.phone,'')=? AND COALESCE(s.email,'')=? AND COALESCE(s.zip,'')=?
      AND COALESCE((SELECT version FROM growth_leads WHERE submission_id=s.id AND organization_id=?),0)=?
      AND COALESCE((SELECT updated_at FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),'')=?
      AND COALESCE((SELECT unread_count FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),0)=?
      AND COALESCE((SELECT last_inbound_at FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),'')=?
      AND COALESCE((SELECT last_outbound_at FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),'')=?
      AND COALESCE((SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?),'')=?
      AND NOT EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND json_extract(payload,'$.status')='sending')
      ON CONFLICT(submission_id) DO NOTHING`).bind(ORG,actor,command,id,row.status,row.updated_at||'',row.payload,row.name||'',row.phone||'',row.email||'',row.zip||'',ORG,Number(row.office_version||0),ORG,row.conversation_updated_at||'',ORG,Number(row.unread_count||0),ORG,row.last_inbound_at||'',ORG,row.last_outbound_at||'','lead_workspace:org-opwp:'+id,row.workspace_payload||'','lead_manual_send:org-opwp:'+id),
    db.prepare(`UPDATE submissions SET status='trashed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${guard}`).bind(id,...args),
    db.prepare(`UPDATE lead_conversations SET automation_mode='paused',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args),
    db.prepare(`UPDATE quote_follow_ups SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed','sending') AND ${guard}`).bind(id,...args),
    db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed','sending') AND ${guard}`).bind(id,...args),
    db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','failed','sending') AND ${guard}`).bind(id,ORG,...args),
    db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='lead_trashed',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','blocked','sending','failed') AND ${guard}`).bind(id,ORG,...args),
    db.prepare(`UPDATE submission_notifications SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed','sending') AND ${guard}`).bind(id,...args),
    db.prepare(`UPDATE review_request_deliveries SET status='skipped',reason='lead_trashed',skipped_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','failed','sending') AND ${guard}
      AND (request_id IN (SELECT r.id FROM review_requests r WHERE json_extract(CASE WHEN json_valid(r.payload) THEN r.payload ELSE '{}' END,'$.submissionId')=? OR json_extract(CASE WHEN json_valid(r.payload) THEN r.payload ELSE '{}' END,'$.submission_id')=? OR (?<>'' AND r.customer_id=?))
        OR (channel='email' AND ?<>'' AND lower(trim(recipient))=lower(trim(?)))
        OR (channel='sms' AND ?<>'' AND substr(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(recipient,'+',''),' ',''),'-',''),'(',''),')',''),-10)=?))`).bind(...args,id,id,row.sng_entity_id||'',row.sng_entity_id||'',row.email||'',row.email||'',row.phone||'',String(row.phone||'').replace(/\D/g,'').slice(-10)),
    db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email) SELECT ?,?,?,'state_changed','Lead moved to Trash; pending outreach cancelled',?,? WHERE ${guard}`).bind(crypto.randomUUID(),id,ORG,JSON.stringify({action:'delete',retentionDays:30}),actor,...args),
  ]);
  if(result[0].meta?.changes!==1)throw new LeadTrashError('This lead changed. Reload it before deleting.',409);
  return {summary:'Lead moved to Trash for 30 days. Pending outreach was cancelled.',trashed:true};
}
export async function restoreLead(db,id,body,actor) {
  if(body.action!=='restore')throw new LeadTrashError('An explicit Restore action is required.');
  // Direct lookup also supports restoring older entries beyond the first page.
  const row=await db.prepare(`SELECT s.id,s.name,s.phone,s.email,s.zip,t.deleted_at,t.purge_after,t.command_id FROM lead_inbox_trash t JOIN submissions s ON s.id=t.submission_id
    WHERE t.submission_id=? AND t.organization_id=? AND s.status='trashed' AND datetime(t.purge_after)>CURRENT_TIMESTAMP
    AND NOT EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=s.id AND g.organization_id!=?)
    AND NOT EXISTS(SELECT 1 FROM lead_conversations c WHERE c.submission_id=s.id AND c.organization_id!=?)`).bind(id,ORG,ORG,ORG).first();
  if(!row)throw new LeadTrashError('This lead is no longer in Trash.',404);
  if(body.version!==await trashVersion(row))throw new LeadTrashError('Trash changed. Refresh it before restoring this lead.',409);
  const restoreCommand=crypto.randomUUID();
  const result=await db.batch([
    db.prepare(`UPDATE lead_inbox_trash SET restore_command_id=? WHERE submission_id=? AND command_id=? AND restore_command_id IS NULL AND datetime(purge_after)>CURRENT_TIMESTAMP`).bind(restoreCommand,id,row.command_id),
    db.prepare(`UPDATE submissions SET status=(SELECT prior_status FROM lead_inbox_trash WHERE submission_id=? AND command_id=?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='trashed' AND EXISTS(SELECT 1 FROM lead_inbox_trash WHERE submission_id=? AND command_id=? AND datetime(purge_after)>CURRENT_TIMESTAMP)`).bind(id,row.command_id,id,id,row.command_id),
    db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email) SELECT ?,?,?,'state_changed','Lead restored from Trash; cancelled outreach stays cancelled','{"action":"restore"}',? WHERE EXISTS(SELECT 1 FROM submissions s JOIN lead_inbox_trash t ON t.submission_id=s.id WHERE s.id=? AND s.status=t.prior_status AND t.command_id=?)`).bind(crypto.randomUUID(),id,ORG,actor,id,row.command_id),
    db.prepare(`DELETE FROM lead_inbox_trash WHERE submission_id=? AND command_id=? AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND status=lead_inbox_trash.prior_status)`).bind(id,row.command_id,id),
  ]);
  if(result[0].meta?.changes!==1||result[1].meta?.changes!==1)throw new LeadTrashError('This lead changed while restoring it. Refresh Trash.',409);
  return {summary:'Lead restored. Cancelled outreach stays cancelled.',restored:true};
}
export async function purgeLeadTrash(env,{limit=100}={}) {
  const db=env?.DB;if(!db)return {configured:false,purged:0};
  const due=await db.prepare(`SELECT t.submission_id,t.command_id,s.email,s.phone,s.sng_entity_id FROM lead_inbox_trash t JOIN submissions s ON s.id=t.submission_id WHERE t.organization_id=? AND datetime(t.purge_after)<=CURRENT_TIMESTAMP ORDER BY t.purge_after LIMIT ?`).bind(ORG,Math.min(500,Math.max(1,Number(limit)||100))).all();
  let purged=0;
  for(const row of due.results||[]){
    const id=row.submission_id,args=[id,row.command_id],guard=`EXISTS(SELECT 1 FROM lead_inbox_trash WHERE submission_id=? AND command_id=? AND datetime(purge_after)<=CURRENT_TIMESTAMP)`;
    const results=await db.batch([
      // Keep a non-contactable tombstone and already-sent delivery history, as with existing inbox history.
      db.prepare(`UPDATE submissions SET status='deleted',name=NULL,email=NULL,phone=NULL,zip=NULL,payload='{"deleted":true,"trashPurged":true}',sng_response=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='trashed' AND ${guard}`).bind(id,...args),
      db.prepare(`DELETE FROM airtable_cockpit_snapshots WHERE (snapshot_key IN (?,?) OR (snapshot_key LIKE 'lead_prefill:%' AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.leadId')=?)) AND ${guard}`).bind('lead_workspace:org-opwp:'+id,'lead_manual_send:org-opwp:'+id,id,...args),
      db.prepare(`UPDATE lead_conversations SET status='deleted',automation_mode='paused',unread_count=0,deleted_at=CURRENT_TIMESTAMP,deletion_reason='Trash expired after 30 days',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE meta_lead_intakes SET response_state='{}',route_guidance=NULL,phone_hash=NULL,review_reason='trash_expired' WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE meta_reply_decisions SET response_body='',state_json='{}',prior_state_json='{}' WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE meta_sms_jobs SET message_body='Expired Trash lead',error_message=NULL WHERE submission_id=? AND organization_id=? AND status NOT IN ('sent','delivered','unknown') AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE lead_follow_up_jobs SET message_body='Expired Trash lead',error_message=NULL WHERE submission_id=? AND organization_id=? AND status NOT IN ('sent') AND provider_message_id IS NULL AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE quote_follow_ups SET recipient='',error_message=NULL WHERE submission_id=? AND status!='sent' AND provider_message_id IS NULL AND ${guard}`).bind(id,...args),
      db.prepare(`UPDATE quote_follow_up_deliveries SET error_message=NULL WHERE submission_id=? AND status!='sent' AND provider_message_id IS NULL AND ${guard}`).bind(id,...args),
      db.prepare(`UPDATE submission_notifications SET recipient=('purged:'||id),subject='Expired Trash lead',text_body='Expired Trash lead',html_body='Expired Trash lead',error_message=NULL WHERE submission_id=? AND status!='sent' AND provider_message_id IS NULL AND ${guard}`).bind(id,...args),
      db.prepare(`DELETE FROM lead_messages WHERE conversation_id IN (SELECT id FROM lead_conversations WHERE submission_id=? AND organization_id=?) AND NOT (direction='outbound' AND delivery_status IN ('sent','delivered')) AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE review_request_deliveries SET recipient='',email_hash=NULL,reason='lead_trash_expired' WHERE status='skipped' AND reason='lead_trashed' AND ${guard}
        AND ((channel='email' AND ?<>'' AND lower(trim(recipient))=lower(trim(?))) OR (channel='sms' AND ?<>'' AND substr(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(recipient,'+',''),' ',''),'-',''),'(',''),')',''),-10)=?)
          OR request_id IN (SELECT r.id FROM review_requests r WHERE json_extract(CASE WHEN json_valid(r.payload) THEN r.payload ELSE '{}' END,'$.submissionId')=? OR json_extract(CASE WHEN json_valid(r.payload) THEN r.payload ELSE '{}' END,'$.submission_id')=? OR (?<>'' AND r.customer_id=?)))`).bind(...args,row.email||'',row.email||'',row.phone||'',String(row.phone||'').replace(/\D/g,'').slice(-10),id,id,row.sng_entity_id||'',row.sng_entity_id||''),
      db.prepare(`UPDATE review_requests SET customer_name='',payload='{}' WHERE id IN (SELECT request_id FROM review_request_deliveries WHERE reason='lead_trash_expired') AND NOT EXISTS(SELECT 1 FROM review_request_deliveries d WHERE d.request_id=review_requests.id AND (d.status='sent' OR d.provider_message_id IS NOT NULL)) AND ${guard}`).bind(...args),
      db.prepare(`UPDATE growth_leads SET next_action=NULL,next_action_at=NULL,outcome_note=NULL WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`UPDATE growth_lead_events SET summary='Expired Trash lead activity',details=NULL WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args),
      db.prepare(`DELETE FROM lead_inbox_trash WHERE submission_id=? AND command_id=? AND datetime(purge_after)<=CURRENT_TIMESTAMP`).bind(...args),
    ]);
    purged+=Number(results[0].meta?.changes||0);
  }
  return {configured:true,purged};
}
