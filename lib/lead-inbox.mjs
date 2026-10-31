// Shared display and input policy. Customer consent and payment never come from this form.
export const LEAD_MILESTONES = [['new','New'],['contacted','In conversation'],['quoted','Quote sent'],['signup','Signup in progress']];
export const INTAKE_TEXT = { firstName:80,lastName:80,phone:30,email:254,address:200,city:80,state:2,zip:5,dogs:2,frequency:40,lastCleaned:30,yardSize:20,dogNames:200,dogSafety:200,dogDoor:80,gateLocation:200,gateCode:80,wasteLocation:200,notificationType:80,notes:2000,serviceDay:40,startDate:10,sender:80 };
export const CALL_RESULTS = [['handled','Handled'],['no_answer','No answer'],['discussed','Spoke with customer'],['needs_quote','Needs a quote'],['quote_sent','Quote sent'],['ready_to_start','Ready to start']];
export const CLOSED_REASONS = [['price','Price / budget'],['timing','Not ready'],['outside_service_area','Outside service area'],['chose_competitor','Chose another provider'],['service_fit','Service not a fit'],['no_response','No response'],['opted_out','Opted out'],['wrong_number','Wrong number'],['duplicate','Duplicate'],['spam','Spam / vendor'],['other','Other']];
export function leadTime(value) { if(!value)return 0; const s=String(value); const n=Date.parse(s.replace(' ','T')+(/Z$|[+-]\d\d:?\d\d$/.test(s)?'':'Z')); return Number.isFinite(n)?n:0; }
export function formatLeadPhone(value) {
  const original=String(value||'').trim();
  let digits=original.replace(/\D/g,'');
  if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);
  return digits.length===10?`(${digits.slice(0,3)})-${digits.slice(3,6)}-${digits.slice(6)}`:original;
}
export function leadContactName(lead) {
  const intake=lead.workspace?.intake||{};
  const candidates=[lead.contactName,[intake.firstName,intake.lastName].filter(Boolean).join(' '),lead.name];
  return candidates.find(value=>typeof value==='string'&&value.trim()&&value!=='Name pending'&&value!==lead.email&&!(lead.phone&&/^[+\d\s().-]+$/.test(value)&&formatLeadPhone(value)===formatLeadPhone(lead.phone)))?.trim()||'';
}
export function leadName(lead) { return leadContactName(lead)||formatLeadPhone(lead.phone)||lead.email||'Contact details needed'; }
export function leadMilestone(lead) { return lead.stage==='won'||lead.meta?.signedUpAt?'customer':['lost','not_qualified'].includes(lead.stage)?'closed':lead.workspace?.milestone==='signup'?'signup':lead.stage==='qualified'?'contacted':lead.stage||'new'; }
export function inboxState(lead,now=Date.now()) {
  if(lead.meta?.signedUpAt)return {view:'closed',rank:9,reason:lead.meta.paidAt?'Customer · payment verified':'Customer · payment verification separate'};
  if(['won','lost','not_qualified'].includes(lead.stage)){
    const closedAt=leadTime(lead.lostAt||lead.notQualifiedAt);
    if(lead.stage!=='won'&&!['opted_out','wrong_number','duplicate','spam'].includes(lead.outcomeReason)&&Number(lead.conversation?.unreadCount)>0&&leadTime(lead.conversation?.lastInboundAt)>0&&leadTime(lead.conversation?.lastInboundAt)>=closedAt)return {view:'attention',rank:0,reason:'New reply · review closed inquiry'};
    return {view:'closed',rank:9,reason:lead.stage==='won'?(lead.workspace?.manualWon?'Converted · manually set up':'Customer'):lead.outcomeReason?.replaceAll('_',' ')||'Closed'};
  }
  if(lead.manualDelivery?.status==='unknown'||(lead.manualDelivery?.status==='sending'&&now-leadTime(lead.manualDelivery.startedAt)>120000))return {view:'attention',rank:0,reason:'Check unconfirmed text in Quo'};
  if(Number(lead.conversation?.unreadCount)>0)return {view:'attention',rank:0,reason:'Customer replied'};
  const unresolved=[...(lead.meta?.jobs||[]),...(lead.followUps||[])].filter(j=>['failed','unknown'].includes(j.status));
  const deliveryIssue=(lead.deliveries||[]).some(j=>j.status==='failed');
  if(unresolved.length||deliveryIssue)return {view:'attention',rank:1,reason:'Check message delivery'};
  if(lead.meta?.state?.ready_for_route_audit&&!lead.meta?.routeAuditedAt)return {view:'attention',rank:1,reason:'Review service day'};
  const due=leadTime(lead.nextActionAt);
  // A reply always wins over an old reminder; future reminders intentionally snooze new leads.
  if(due&&due<=now)return {view:'attention',rank:2,reason:lead.nextAction||'Follow up'};
  if(due>now)return {view:'waiting',rank:5,reason:lead.nextAction||'Follow up later'};
  if(!lead.workspace?.handledAt&&!lead.conversation?.lastOutboundAt)return {view:'attention',rank:3,reason:'Make first contact'};
  if(leadMilestone(lead)==='signup')return {view:'attention',rank:2,reason:'Complete signup handoff'};
  return {view:'attention',rank:4,reason:'Set the next step'};
}
export function sortInbox(leads) { return [...leads].sort((a,b)=>leadTime(b.createdAt)-leadTime(a.createdAt)||b.id.localeCompare(a.id)); }
export function validateIntake(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Enter valid customer details.');
  if(Object.keys(value).some(k=>!Object.hasOwn(INTAKE_TEXT,k)&&!['areas','addons','startDatePending'].includes(k)))throw new Error('These customer details contain unsupported fields.');
  const result={};
  for(const [key,max] of Object.entries(INTAKE_TEXT)){const v=value[key]??'';if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw new Error('Check the length and format of '+key+'.');result[key]=v.trim();}
  if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new Error('Enter a valid email address.');
  if(result.phone&&!/^\+?[- ().\d]{10,30}$/.test(result.phone))throw new Error('Enter a valid phone number.');
  if(result.zip&&!/^\d{5}$/.test(result.zip))throw new Error('Enter a five-digit ZIP.');
  if(result.state&&!/^[A-Z]{2}$/.test(result.state))throw new Error('Use a two-letter state.');
  if(result.dogs&&!/^[1-9]\d?$/.test(result.dogs))throw new Error('Enter the exact dog count.');
  if(result.startDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(result.startDate)||new Date(result.startDate+'T12:00:00Z').toISOString().slice(0,10)!==result.startDate))throw new Error('Choose a valid start date.');
  for(const key of ['areas','addons']){const a=value[key]??[];if(!Array.isArray(a)||a.length>12||a.some(v=>typeof v!=='string'||v.length>80))throw new Error('Choose valid '+key+'.');result[key]=[...new Set(a)];}
  result.startDatePending=value.startDatePending===true;
  return result;
}
export function prefillIntake(lead,source={}) {
  const q=source.quote_context||{},meta=lead.meta?.state?.details||{};
  const name=(lead.contactName||lead.name||'').replace(/^Name pending$/,'').trim().split(/\s+/);
  const frequencies={weekly:'once_a_week','Weekly':'once_a_week','Twice A Week':'twice_a_week','Twice weekly':'twice_a_week',biweekly:'every_other_week','Biweekly':'every_other_week',monthly:'once_a_month','Monthly':'once_a_month','One Time':'one_time'};
  const frequency=String(q.frequency||source.clean_up_frequency||meta.clean_up_frequency||lead.quote?.frequency||'');
  return {firstName:name.shift()||'',lastName:name.join(' '),phone:lead.phone||'',email:lead.email||'',zip:lead.zip||'',state:'OH',address:source.home_address||source.address||meta.address||'',city:source.city||'',dogs:String(q.dogs||source.number_of_dogs||meta.number_of_dogs||lead.quote?.dogs||''),frequency:frequencies[frequency]||frequency,lastCleaned:q.last_cleaned||source.last_time_yard_was_thoroughly_cleaned||'',yardSize:q.yard_size||source.yard_size_tier||lead.quote?.yard||'',...lead.workspace?.intake};
}
export function duplicateCandidates(leads,lead) { const phone=v=>String(v||'').replace(/\D/g,'').slice(-10),email=v=>String(v||'').trim().toLowerCase();return leads.filter(l=>l.id!==lead.id&&((phone(lead.phone).length===10&&phone(l.phone)===phone(lead.phone))||(email(lead.email)&&email(l.email)===email(lead.email)))); }
