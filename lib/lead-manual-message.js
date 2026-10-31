import {getLeadRecord,sendLeadMessage} from './lead-assistant';
import {readInboxRow,inboxVersion,leadDigest,quoteMessage,intakeQuote,saveInboxChange,LeadInboxError} from './lead-inbox-store';
const key=id=>'lead_manual_send:org-opwp:'+id;
const parse=s=>{try{return JSON.parse(s||'{}');}catch{return {};}};
export async function sendInboxText(db,env,id,body,actor,{sender=sendLeadMessage}={}){
  if(typeof body.message!=='string'||!body.message.trim()||body.message.length>1000||! /^[0-9a-f-]{36}$/.test(body.commandId||''))throw new LeadInboxError('Write a message up to 1,000 characters and use a valid send identifier.');
  const row=await readInboxRow(db,id);if(!row)throw new LeadInboxError('Lead not found.',404);
  const previous=parse((await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(key(id)).first())?.payload);
  if(previous.commandId===body.commandId){if(previous.messageHash!==await leadDigest(body.message.trim()))throw new LeadInboxError('This send identifier belongs to a different message.',409);if(previous.status==='accepted')return {accepted:true,replayed:true};throw new LeadInboxError('This send already has a recorded attempt. Check its delivery details before starting a new message.',409);}
  if(['sending','unknown'].includes(previous.status))throw new LeadInboxError('An earlier text has an unconfirmed outcome. Check Quo and resolve its delivery record first.',409);
  if(body.version!==await inboxVersion(row))throw new LeadInboxError('This lead changed. Reload and review the latest reply before sending.',409);
  if(['won','lost','not_qualified'].includes(row.office_stage)||row.lifecycle_stage==='converted')throw new LeadInboxError('This sales inquiry is closed.');
  const ws=parse(row.workspace_payload);
  if(body.kind==='quote'){
    const recalculated=ws.intake?intakeQuote(ws.intake):{custom:true};
    if(recalculated.custom||body.message.trim()!==quoteMessage(row,{...ws,quote:recalculated}))throw new LeadInboxError('The quote draft changed. Prepare a fresh quote before sending it as a quote.');
  }
  const state={commandId:body.commandId,status:'sending',actor,startedAt:new Date().toISOString(),messageHash:await leadDigest(body.message.trim())};
  const reservation=await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at)
    VALUES (?,?,'success',CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP WHERE payload=?`)
    .bind(key(id),JSON.stringify(state),previous.commandId?JSON.stringify(previous):'').run();
  if(reservation.meta?.changes!==1)throw new LeadInboxError('Another message is being prepared. Reload the lead.',409);
  async function update(status,extra={}){Object.assign(state,{status,...extra});await db.prepare('UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND json_extract(payload,\'$.commandId\')=?').bind(JSON.stringify(state),key(id),body.commandId).run();}
  try{
    const current=await readInboxRow(db,id);
    if(body.version!==await inboxVersion(current)){await update('cancelled');throw new LeadInboxError('The lead changed while preparing this text. Reload before sending.',409);}
    const lead=await getLeadRecord(db,id);if(!lead)throw new LeadInboxError('Lead not found.',404);
    const message=await sender(db,env,lead,body.message.trim(),actor);
    await update('accepted',{providerId:message.provider_message_id,acceptedAt:new Date().toISOString()});
    const after=await readInboxRow(db,id);
    // Do not consume a reply that arrived during the provider request.
    if(after.last_inbound_at===row.last_inbound_at&&Number(after.unread_count||0)===0){
      try{await saveInboxChange(db,id,{action:'activity',result:body.kind==='quote'?'quote_sent':'discussed',version:await inboxVersion(after)},actor);}catch{/* Text acceptance is durable; next-action correction remains available. */}
    }
    return {accepted:true,message};
  }catch(e){
    if(state.status==='sending'){
      const known=e instanceof LeadInboxError||['This lead was deleted.','SMS consent or an inbound customer message is required before sending from YardOps.','This phone number is suppressed from YardOps messaging.','Quo messaging is not configured.'].includes(e.message);
      await update(known?'rejected':'unknown',{checkedAt:new Date().toISOString()});
    }
    if(e instanceof LeadInboxError)throw e;
    throw new LeadInboxError(state.status==='unknown'?'The text outcome is unconfirmed. Check Quo before resolving this attempt or sending again.':'Texting is blocked. Check consent, the phone number and messaging configuration.',state.status==='unknown'?502:409);
  }
}
export async function resolveManualDelivery(db,id,body,actor){
  if(!['sent','not_sent'].includes(body.result)||typeof body.note!=='string'||!body.note.trim()||body.note.length>500)throw new LeadInboxError('Record what you verified in Quo and whether the text was sent.');
  if(!await readInboxRow(db,id))throw new LeadInboxError('Lead not found.',404);
  const row=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(key(id)).first(),state=parse(row?.payload);
  if(!['unknown','sending'].includes(state.status))throw new LeadInboxError('There is no unconfirmed send to resolve.');
  if(state.status==='sending'&&Date.now()-Date.parse(state.startedAt)<2*60000)throw new LeadInboxError('A text is still being sent. Wait for its outcome before resolving it.');
  const resolved={...state,status:body.result==='sent'?'verified_sent':'verified_not_sent',resolvedBy:actor,resolvedAt:new Date().toISOString()};
  const result=await db.batch([
    db.prepare('UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?').bind(JSON.stringify(resolved),key(id),row.payload),
    db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email) SELECT ?,?,'org-opwp','system','Manual text delivery checked in Quo',?,? WHERE EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?)`).bind(crypto.randomUUID(),id,JSON.stringify({result:body.result,note:body.note,commandId:state.commandId}),actor,key(id),JSON.stringify(resolved)),
  ]);
  if(result[0].meta?.changes!==1)throw new LeadInboxError('This send changed. Reload before resolving it.',409);
}
