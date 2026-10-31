import { PRICING, YARD_TIERS, isInArea, haulAwayPrice } from '@/app/free-quote/pricing';
import { normalizePhone } from './lead-assistant.mjs';
import { validateIntake, prefillIntake, CLOSED_REASONS, CALL_RESULTS } from './lead-inbox.mjs';
import { normalizeGrowthSubmissionId } from './growth-desk.mjs';

const ORG='org-opwp';
const key=id=>`lead_workspace:${ORG}:${id}`;
const kinds="'partial_quote','question','waitlist','onboarding'";
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
export class LeadInboxError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export async function leadDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
export async function readInboxRow(db,id){
  return db.prepare(`SELECT s.*,g.stage office_stage,g.version office_version,g.priority,g.owner_email,g.next_action,g.next_action_at,g.outcome_reason,
    c.id conversation_id,c.status conversation_status,c.last_inbound_at,c.last_outbound_at,c.unread_count,c.updated_at conversation_updated_at,
    w.payload workspace_payload
    FROM submissions s LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
    LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=?
    LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key=?
    WHERE s.id=? AND s.kind IN (${kinds}) AND s.status!='deleted' AND COALESCE(c.status,'')!='deleted'
    AND COALESCE(g.outcome_reason,'')!='not_a_lead'
    AND NOT EXISTS(SELECT 1 FROM growth_leads x WHERE x.submission_id=s.id AND x.organization_id!=?)
    AND NOT EXISTS(SELECT 1 FROM lead_conversations x WHERE x.submission_id=s.id AND x.organization_id!=?) LIMIT 1`)
    .bind(ORG,ORG,key(id),id,ORG,ORG).first();
}
export const inboxVersion=row=>leadDigest(JSON.stringify(row));
export function intakeQuote(intake){
  const dogs=Number(intake.dogs),frequency=PRICING.frequencies.find(f=>f.id===intake.frequency),yard=YARD_TIERS.find(y=>y.id===intake.yardSize);
  const history=PRICING.lastCleanedOptions.find(h=>h.id===intake.lastCleaned);
  if(!Number.isInteger(dogs)||dogs<1||dogs>5||!frequency||dogs>frequency.maxDogs||!yard||yard.id==='unsure'||yard.upcharge===null||!history||!isInArea(intake.zip))return {custom:true,reason:'Confirm dog count, frequency, ZIP, yard size and last thorough cleanup before quoting.'};
  const range=(intake.frequency==='one_time'?PRICING.oneTimeCleanup:PRICING.initialCleanup)[intake.lastCleaned]?.[dogs];
  const base=PRICING.monthly[intake.frequency]?.[dogs];
  if(!range||(intake.frequency!=='one_time'&&base==null))return {custom:true,reason:'This combination needs a custom quote.'};
  const addons=(intake.addons||[]).map(id=>PRICING.addons.find(a=>a.id===id));
  if(addons.some(a=>!a)||addons.some(a=>a.charge==='product'))return {custom:true,reason:'Review selected add-ons before quoting. Dog food is ordered separately.'};
  if(intake.frequency==='one_time'&&addons.some(a=>a.charge==='monthly'))return {custom:true,reason:'Review recurring add-ons separately for a one-time cleanup.'};
  const extra=addons.filter(a=>a.charge==='monthly').reduce((n,a)=>n+(a.id==='haul_away'?haulAwayPrice(dogs):a.price),0);
  return {custom:false,monthly:intake.frequency==='one_time'?null:base+yard.upcharge+extra,cleanupRange:range,dogs:String(dogs),frequency:intake.frequency,yard:intake.yardSize,lastCleaned:intake.lastCleaned,addons:addons.map(a=>({id:a.id,name:a.name,amount:a.id==='haul_away'?haulAwayPrice(dogs):a.price,charge:a.charge})),basis:'Website pricing chart',calculatedAt:new Date().toISOString()};
}
export function quoteMessage(row,workspace){
  const q=workspace.quote,i=workspace.intake;
  if(!q||q.custom)throw new LeadInboxError('Complete the quote details first. Custom cases need your review.');
  const dollars=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n);
  const history=PRICING.lastCleanedOptions.find(h=>h.id===i.lastCleaned)?.label;
  const name=i.firstName||row.name?.split(' ')[0]||'there';
  const plan=PRICING.frequencies.find(f=>f.id===i.frequency)?.name||i.frequency;
  const range=q.cleanupRange.map(dollars).join('–');
  const extras=q.addons?.filter(a=>a.charge!=='monthly').map(a=>`${a.name}: ${dollars(a.amount)}${a.charge==='per_treatment'?' per treatment':''}`).join('; ');
  return `Hi ${name}, this is Craig with Ohio Pet Waste Pros. For ${i.dogs} dog${i.dogs==='1'?'':'s'}, ${plan.toLowerCase()} and ${YARD_TIERS.find(y=>y.id===i.yardSize)?.label.toLowerCase()}, ${q.monthly===null?`the one-time cleanup estimate is ${range}`:`service is ${dollars(q.monthly)}/month, plus an initial cleanup estimate of ${range}`}. This uses ${history?.toLowerCase()} since the last thorough cleanup; the cleanup amount is confirmed after seeing the yard.${extras?' Additional items: '+extras+'.':''} Would you like to get started?`;
}
export async function enrichInbox(db,leads){
  // Small batches stay below D1's parameter bound and avoid one query per lead.
  const out=[];
  for(let start=0;start<leads.length;start+=60){const group=leads.slice(start,start+60);const result=await db.prepare(`SELECT s.*,g.stage office_stage,g.version office_version,g.priority,g.owner_email,g.next_action,g.next_action_at,g.outcome_reason,c.id conversation_id,c.status conversation_status,c.last_inbound_at,c.last_outbound_at,c.unread_count,c.updated_at conversation_updated_at,w.payload workspace_payload FROM submissions s LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=? LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=? LEFT JOIN airtable_cockpit_snapshots w ON w.snapshot_key=('lead_workspace:org-opwp:'||s.id) WHERE s.id IN (${group.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM growth_leads x WHERE x.submission_id=s.id AND x.organization_id!=?) AND NOT EXISTS(SELECT 1 FROM lead_conversations x WHERE x.submission_id=s.id AND x.organization_id!=?)`).bind(ORG,ORG,...group.map(l=>l.id),ORG,ORG).all();
    const manual=await db.prepare(`SELECT snapshot_key,payload FROM airtable_cockpit_snapshots WHERE snapshot_key IN (${group.map(()=>'?').join(',')})`).bind(...group.map(l=>'lead_manual_send:org-opwp:'+l.id)).all();
    for(const lead of group){const row=result.results?.find(r=>r.id===lead.id);if(!row)continue;const workspace=parse(row.workspace_payload);const contactName=row.name||'';const intake=prefillIntake({...lead,contactName,workspace},parse(row.payload));const send=parse(manual.results?.find(r=>r.snapshot_key==='lead_manual_send:org-opwp:'+lead.id)?.payload);out.push({...lead,contactName,name:contactName||lead.phone||lead.email||'Contact details needed',workspace:{...workspace,intake},recordVersion:await inboxVersion(row),quote:workspace.quote?{...lead.quote,...workspace.quote,monthly:workspace.quote.custom?null:workspace.quote.monthly}:lead.quote,payment:{verified:Boolean(lead.meta?.paidAt)},manualDelivery:send.status?{status:send.status,startedAt:send.startedAt,providerId:send.providerId||null}:null});}
  }
  return out;
}
function requireText(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw new LeadInboxError(label);return value.trim();}
function nextDate(value){if(typeof value!=='string'||!value.endsWith('Z')||!Number.isFinite(Date.parse(value))||Date.parse(value)<Date.now()-60000||Date.parse(value)>Date.now()+366*86400000)throw new LeadInboxError('Choose a future reminder within the next year.');return value;}
function isConverted(row){return row.lifecycle_stage==='converted'||(row.kind==='onboarding'&&row.sng_sync_state==='succeeded');}

export async function saveInboxChange(db,id,body,actor,context={}){
  const row=await readInboxRow(db,id);if(!row)throw new LeadInboxError('Lead not found.',404);
  const activeSend=await db.prepare(`SELECT 1 busy FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND json_extract(payload,'$.status')='sending' LIMIT 1`).bind('lead_manual_send:org-opwp:'+id).first();
  if(activeSend)throw new LeadInboxError('A text is being sent. Wait for its delivery outcome before editing this lead.',409);
  if(body.version!==await inboxVersion(row))throw new LeadInboxError('This lead changed. Your draft is kept. Reload the latest lead before saving again.',409);
  const ws=parse(row.workspace_payload),now=new Date().toISOString();
  const prior=JSON.parse(JSON.stringify(ws));
  let intake,phoneChanged=false,pause=false,suppress=false,cancel=false,summary='',stage=isConverted(row)?'won':row.office_stage||'new',reason=row.outcome_reason||'',nextAction=row.next_action||'',nextAt=row.next_action_at||'';
  if(body.action==='save_intake'){
    if(isConverted(row))throw new LeadInboxError('This is an existing customer. Use the internal customer record controls to correct source-owned details.',409);
    try{intake=validateIntake(body.intake);}catch(e){throw new LeadInboxError(e.message);}
    if(intake.phone&&!normalizePhone(intake.phone))throw new LeadInboxError('Enter a valid phone number.');
    if(!intake.phone&&!intake.email)throw new LeadInboxError('Keep a phone number or email so this lead can be contacted.');
    phoneChanged=normalizePhone(intake.phone)!==normalizePhone(row.phone);
    ws.intake=intake;ws.quote=intakeQuote(intake);ws.quoteSentAt=null;ws.milestone=stage==='new'?'new':'contacted';ws.handoffKey=crypto.randomUUID();
    if(['quoted','qualified'].includes(stage))stage='contacted';
    cancel=true;pause=true;summary='Customer and quote details saved';
    nextAction=ws.quote.custom?'Review custom quote':'Review and send quote';nextAt=now;
  }else if(body.action==='remind'){
    if(['won','lost','not_qualified'].includes(stage))throw new LeadInboxError('Reopen this lead before adding a reminder.');
    nextAt=nextDate(body.dueAt);nextAction=requireText(body.nextAction,240,'Describe the next step (up to 240 characters).');
    ws.handledAt=now;ws.handledInboundAt=row.last_inbound_at||'';summary='Reminder saved for you';
    cancel=true;pause=true;
  }else if(body.action==='activity'){
    if(!CALL_RESULTS.some(([v])=>v===body.result))throw new LeadInboxError('Choose a call outcome.');
    if(['won','lost','not_qualified'].includes(stage))throw new LeadInboxError('Reopen this lead before recording a sales follow-up.');
    ws.handledAt=now;ws.handledInboundAt=row.last_inbound_at||'';ws.lastResult=body.result;
    if(body.result==='quote_sent'){if(!ws.quote)throw new LeadInboxError('Save the quote details before marking a quote sent.');if(ws.quote.custom&&!(typeof body.note==='string'&&body.note.trim()))throw new LeadInboxError('Record the human-reviewed custom quote in the office note before marking it sent.');stage='quoted';ws.quoteSentAt=now;ws.milestone='quoted';}
    if(['discussed','needs_quote'].includes(body.result)){if(stage==='new')stage='contacted';}
    if(body.result==='ready_to_start'){ws.milestone='signup';if(stage==='new')stage='contacted';}
    const messages={handled:'Follow up with customer',no_answer:'Try calling again',discussed:'Follow up on conversation',needs_quote:'Prepare quote',quote_sent:'Follow up on quote',ready_to_start:'Confirm service day and continue signup'};
    nextAction=messages[body.result];nextAt=body.dueAt?nextDate(body.dueAt):new Date(Date.now()+(['needs_quote','ready_to_start'].includes(body.result)?0:body.result==='quote_sent'?3*86400000:86400000)).toISOString();
    summary=CALL_RESULTS.find(([v])=>v===body.result)[1];
    // Taking over a thread prevents old automation from racing a human's next step.
    cancel=true;pause=true;
  }else if(body.action==='close'){
    if(isConverted(row))throw new LeadInboxError('A verified customer stays a customer.',409);
    reason=requireText(body.reason,60,'Choose a closing reason.');if(!CLOSED_REASONS.some(([r])=>r===reason))throw new LeadInboxError('Choose a closing reason.');
    stage=['no_response','opted_out','wrong_number'].includes(reason)?'not_qualified':'lost';nextAction='';nextAt='';cancel=true;pause=true;suppress=['opted_out','wrong_number'].includes(reason);ws.handledAt=now;ws.handledInboundAt=row.last_inbound_at||'';ws.handoffKey=crypto.randomUUID();summary='Lead closed: '+CLOSED_REASONS.find(([r])=>r===reason)[1];
    if(reason==='duplicate'){const other=await readInboxRow(db,body.duplicateOf);if(!other||other.id===id)throw new LeadInboxError('Choose the original lead.');const samePhone=normalizePhone(other.phone)&&normalizePhone(other.phone)===normalizePhone(row.phone),sameEmail=other.email&&row.email&&other.email.toLowerCase()===row.email.toLowerCase();if(!samePhone&&!sameEmail)throw new LeadInboxError('The original lead must share a phone number or email.');ws.duplicateOf=other.id;}
  }else if(body.action==='mark_won'){
    if(isConverted(row)||row.office_stage==='won')throw new LeadInboxError('This lead is already a client.',409);
    if(body.manuallySetUp!==true)throw new LeadInboxError('Confirm that this client has already been set up.');
    stage='won';reason='';nextAction='';nextAt='';cancel=true;pause=true;
    ws.manualWon={at:now,by:actor};ws.milestone='customer';ws.handledAt=now;ws.handledInboundAt=row.last_inbound_at||'';ws.handoffKey=crypto.randomUUID();delete ws.duplicateOf;
    summary='Lead converted by owner; client was set up manually. Payment verification unchanged.';
  }else if(body.action==='reopen'){
    if(isConverted(row))throw new LeadInboxError('This record is already a customer.');
    stage='contacted';reason='';nextAction='Review reopened inquiry';nextAt=now;ws.milestone='contacted';delete ws.duplicateOf;delete ws.manualWon;summary='Lead reopened; messaging permissions unchanged';
  }else if(body.action==='note'){
    summary=requireText(body.note,2000,'Write a note (up to 2,000 characters).');
  }else if(body.action==='approve_day'){
    if(!context.routeAudit||context.routeAudit.actor!==actor||context.routeAudit.handoffKey!==ws.handoffKey)throw new LeadInboxError('Verify the saved address, service day and staffing first.');
    ws.routeAudit=context.routeAudit;summary='Service day reviewed by owner';
  }else if(body.action==='handoff'){
    if(['won','lost','not_qualified'].includes(stage))throw new LeadInboxError('This lead is closed.');
    if(!ws.quote||ws.quote.custom)throw new LeadInboxError('Save standard quote details before creating a signup link.');
    if(!ws.routeAudit||ws.routeAudit.handoffKey!==ws.handoffKey)throw new LeadInboxError('Review the service day and staffing before preparing signup.');
    // A link never promises a route day or accepts terms/payment for the customer.
    ws.milestone='signup';ws.handoffKey||=crypto.randomUUID();ws.handoffPreparedAt=now;nextAction='Check signup completion';nextAt=new Date(Date.now()+86400000).toISOString();summary='Secure signup handoff prepared';
  }else throw new LeadInboxError('Unsupported lead action.');
  if(typeof body.note==='string'&&body.note.length>2000)throw new LeadInboxError('Keep notes under 2,000 characters.');
  if(body.action!=='note'&&typeof body.note==='string'&&body.note.trim())summary+='\n'+body.note.trim();
  ws.revision=Number(ws.revision||0)+1;ws.updatedAt=now;ws.command=crypto.randomUUID();
  const serialized=JSON.stringify(ws),guard=`EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?)`;
  const args=[key(id),serialized];
  // First statement claims this exact source + office + conversation + workspace version.
  // Every later statement is guarded by the unique command payload in the same D1 transaction.
  const statements=[db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at)
    SELECT ?,?,'success',?,CURRENT_TIMESTAMP FROM submissions s WHERE s.id=? AND s.status=? AND COALESCE(s.updated_at,'')=? AND s.payload=?
    AND COALESCE(s.name,'')=? AND COALESCE(s.phone,'')=? AND COALESCE(s.email,'')=? AND COALESCE(s.zip,'')=?
    AND COALESCE((SELECT version FROM growth_leads WHERE submission_id=s.id AND organization_id=?),0)=?
    AND COALESCE((SELECT updated_at FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),'')=?
    AND COALESCE((SELECT unread_count FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),0)=?
    AND COALESCE((SELECT last_inbound_at FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),'')=?
    AND COALESCE((SELECT last_outbound_at FROM lead_conversations WHERE submission_id=s.id AND organization_id=?),'')=?
    AND NOT EXISTS(SELECT 1 FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND json_extract(payload,'$.status')='sending')
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP WHERE airtable_cockpit_snapshots.payload=?`)
    .bind(key(id),serialized,now,id,row.status,row.updated_at||'',row.payload,row.name||'',row.phone||'',row.email||'',row.zip||'',ORG,Number(row.office_version||0),ORG,row.conversation_updated_at||'',ORG,Number(row.unread_count||0),ORG,row.last_inbound_at||'',ORG,row.last_outbound_at||'','lead_manual_send:org-opwp:'+id,row.workspace_payload||'')];
  statements.push(db.prepare(`INSERT INTO growth_leads(submission_id,organization_id,stage,priority,owner_email,next_action,next_action_at,outcome_reason,updated_by,converted_at)
    SELECT ?,?,?,?, ?,?,?,?,?,CASE WHEN ?='won' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE ${guard} ON CONFLICT(submission_id) DO UPDATE SET stage=excluded.stage,owner_email=COALESCE(growth_leads.owner_email,excluded.owner_email),next_action=excluded.next_action,next_action_at=excluded.next_action_at,outcome_reason=excluded.outcome_reason,version=growth_leads.version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,converted_at=CASE WHEN excluded.stage='won' THEN COALESCE(growth_leads.converted_at,CURRENT_TIMESTAMP) ELSE NULL END, lost_at=CASE WHEN excluded.stage='lost' THEN COALESCE(growth_leads.lost_at,CURRENT_TIMESTAMP) ELSE NULL END,not_qualified_at=CASE WHEN excluded.stage='not_qualified' THEN COALESCE(growth_leads.not_qualified_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE growth_leads.organization_id=?`)
    .bind(id,ORG,stage,row.priority||'normal',actor,nextAction||null,nextAt||null,reason||null,actor,stage,...args,ORG));
  statements.push(db.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id,channel) SELECT ?,?,?,'manual' WHERE ${guard} ON CONFLICT(submission_id) DO NOTHING`).bind(crypto.randomUUID(),id,ORG,...args));
  if(intake){
    const original=parse(row.payload);if(phoneChanged){original.follow_up_consent=false;original.follow_up_consent_at=null;original.sms_consent_evidence={valid:false,reason:'Phone corrected by owner; new permission required'};}
    statements.push(db.prepare(`UPDATE submissions SET name=?,phone=?,email=?,zip=?,payload=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${guard}`).bind([intake.firstName,intake.lastName].filter(Boolean).join(' '),intake.phone,intake.email,intake.zip,JSON.stringify(original),id,...args));
  }
  if(ws.handledAt===now||phoneChanged)statements.push(db.prepare(`UPDATE lead_conversations SET unread_count=0,${phoneChanged?"last_inbound_at=NULL,last_outbound_at=NULL,external_thread_id=NULL,":""}status=?,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(['won','lost','not_qualified'].includes(stage)?'resolved':'waiting',id,ORG,...args));
  if(pause)statements.push(db.prepare(`UPDATE lead_conversations SET automation_mode='paused',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args));
  if(cancel){
    statements.push(db.prepare(`UPDATE lead_follow_up_jobs SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','failed') AND ${guard}`).bind(id,ORG,...args));
    statements.push(db.prepare(`UPDATE meta_sms_jobs SET status='cancelled',block_reason='owner_updated_lead',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND status IN ('queued','blocked') AND ${guard}`).bind(id,ORG,...args));
    statements.push(db.prepare(`UPDATE quote_follow_up_deliveries SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP WHERE submission_id=? AND status IN ('queued','failed') AND ${guard}`).bind(id,...args));
    if(intake)statements.push(db.prepare(`UPDATE meta_lead_intakes SET route_guidance=NULL,route_audited_at=NULL,route_audited_by=NULL,response_state='{}',review_reason='Owner corrected details; manual review required',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=? AND ${guard}`).bind(id,ORG,...args));
  }
  if(suppress&&normalizePhone(row.phone))statements.push(db.prepare(`INSERT INTO lead_suppressions(organization_id,phone_hash,reason,source,created_by) SELECT ?,?,?,'admin_lead_inbox',? WHERE ${guard} ON CONFLICT(organization_id,phone_hash) DO NOTHING`).bind(ORG,await leadDigest(normalizePhone(row.phone)),reason,actor,...args));
  statements.push(db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,details,actor_email) SELECT ?,?,?,'${body.action==='note'?'note':'state_changed'}',?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),id,ORG,summary,JSON.stringify({action:body.action,note:body.action==='note'?undefined:body.note||'',phoneChanged,before:{stage:row.office_stage||'new',nextAction:row.next_action||'',workspaceRevision:prior.revision||0,...(intake?{contact:{name:row.name,phone:row.phone,email:row.email,zip:row.zip}}:{})},after:{stage,nextAction,workspaceRevision:ws.revision}}),actor,...args));
  statements.push(db.prepare(`INSERT INTO lead_airtable_sync(submission_id,organization_id,status,next_attempt_at) SELECT ?,?,'queued',CURRENT_TIMESTAMP WHERE ${guard} ON CONFLICT(submission_id) DO UPDATE SET status='queued',attempt_count=0,error_message=NULL,next_attempt_at=CURRENT_TIMESTAMP,revision=lead_airtable_sync.revision+1,updated_at=CURRENT_TIMESTAMP WHERE lead_airtable_sync.organization_id=?`).bind(id,ORG,...args,ORG));
  const result=await db.batch(statements);
  if(result[0].meta?.changes!==1)throw new LeadInboxError('This lead changed during your save. Reload the latest lead; your draft is kept.',409);
  return {summary,workspace:ws};
}

export async function createInboxLead(db,body,actor){
  let intake;try{intake=validateIntake(body.intake);}catch(e){throw new LeadInboxError(e.message);}
  if(!intake.phone&&!intake.email)throw new LeadInboxError('Enter a phone number or email.');
  if(intake.phone&&!normalizePhone(intake.phone))throw new LeadInboxError('Enter a valid phone number.');
  if(!normalizeGrowthSubmissionId(body.commandId))throw new LeadInboxError('A valid creation identifier is required.');
  const id=body.commandId;
  const prior=await readInboxRow(db,id);if(prior){if(parse(prior.payload).created_by!==actor)throw new LeadInboxError('This creation identifier is already in use.',409);return {id,replayed:true};}
  const phone=normalizePhone(intake.phone),email=intake.email.toLowerCase();
  const candidates=await db.prepare(`SELECT s.id,s.name,s.phone,s.email FROM submissions s LEFT JOIN lead_conversations c ON c.submission_id=s.id AND c.organization_id=? WHERE s.status!='deleted' AND s.kind IN (${kinds}) AND COALESCE(c.status,'')!='deleted' AND ((?<>'' AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(s.phone,'+',''),' ',''),'-',''),'(',''),')','') IN (?,?)) OR (?<>'' AND lower(s.email)=?)) LIMIT 6`).bind(ORG,phone,phone.replace('+',''),phone.replace('+1',''),email,email).all();
  if(candidates.results?.length)throw new LeadInboxError('A lead with that phone or email already exists. Search for it before adding another.',409);
  const workspace={intake,quote:intakeQuote(intake),revision:1,milestone:'new',updatedAt:new Date().toISOString(),handoffKey:crypto.randomUUID()};
  await db.batch([
    db.prepare(`INSERT INTO submissions(id,kind,source,name,phone,email,zip,payload,funnel_id,last_activity_at) VALUES (?,'question','manual',?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(id,[intake.firstName,intake.lastName].filter(Boolean).join(' '),intake.phone,intake.email,intake.zip,JSON.stringify({source:'manual',created_by:actor,follow_up_consent:false}),crypto.randomUUID()),
    db.prepare(`INSERT INTO growth_leads(submission_id,organization_id,owner_email,next_action,next_action_at,updated_by) VALUES (?,?,?,'Make first contact',CURRENT_TIMESTAMP,?)`).bind(id,ORG,actor,actor),
    db.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id,channel,automation_mode) VALUES (?,?,?,'manual','paused')`).bind(crypto.randomUUID(),id,ORG),
    db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',CURRENT_TIMESTAMP)`).bind(key(id),JSON.stringify(workspace)),
    db.prepare(`INSERT INTO lead_airtable_sync(submission_id,organization_id,status) VALUES (?,?,'queued')`).bind(id,ORG),
    db.prepare(`INSERT INTO growth_lead_events(id,submission_id,organization_id,event_type,summary,actor_email) VALUES (?,?,?,'state_changed','Lead added in the admin workspace',?)`).bind(crypto.randomUUID(),id,ORG,actor),
  ]);
  return {id};
}
