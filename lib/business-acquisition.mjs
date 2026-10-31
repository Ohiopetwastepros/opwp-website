export const BUSINESS_ACQUISITION_KEY = 'acquisition:org-opwp:business-v1';
export const OPPORTUNITY_STAGES = ['Research', 'Contact planned', 'In conversation', 'Due diligence', 'Offer review', 'On hold', 'Passed', 'Closed'];
const FIELDS = ['id','name','area','stage','askingPrice','customers','mrr','source','nextStep','nextActionAt','notes'];
const empty = () => ({organizationId:'org-opwp', revision:'', opportunities:[], updatedAt:null});
function text(value, max, required=false) {
  if(typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) throw Error('Invalid opportunity fields.');
  return value.trim();
}
function number(value,max,integer=false) {
  if(value === null) return null;
  if(typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) throw Error('Invalid opportunity figures.');
  return value;
}
export function normalizeOpportunity(input) {
  if(!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!FIELDS.includes(k))) throw Error('Invalid opportunity fields.');
  const id=text(input.id,36);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw Error('Invalid opportunity identifier.');
  if(!OPPORTUNITY_STAGES.includes(input.stage)) throw Error('Invalid opportunity stage.');
  const date=text(input.nextActionAt,10);
  if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw Error('Invalid next-action date.');
  return {id,name:text(input.name,160,true),area:text(input.area,240),stage:input.stage,
    askingPrice:number(input.askingPrice,100000000),customers:number(input.customers,100000, true),mrr:number(input.mrr,10000000),
    source:text(input.source,500),nextStep:text(input.nextStep,500),nextActionAt:date,notes:text(input.notes,6000)};
}
export async function readBusinessAcquisition(db) {
  if(!db) throw Error('Private opportunity storage unavailable.');
  const row=await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(BUSINESS_ACQUISITION_KEY).first();
  if(!row) return empty();
  const snapshot=JSON.parse(row.payload);
  if(snapshot.organizationId!=='org-opwp' || typeof snapshot.revision!=='string' || snapshot.revision.length>100 || !Array.isArray(snapshot.opportunities) || snapshot.opportunities.length>200) throw Error('Invalid private opportunity storage.');
  const opportunities=snapshot.opportunities.map(normalizeOpportunity);
  if(new Set(opportunities.map(r=>r.id)).size!==opportunities.length) throw Error('Invalid private opportunity storage.');
  return {organizationId:'org-opwp',revision:snapshot.revision,opportunities,updatedAt:snapshot.updatedAt || null};
}
export async function saveBusinessOpportunity(db,body,actor) {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['revision','opportunity'].includes(k)) || typeof body.revision!=='string' || body.revision.length>100) return {status:400,error:'Invalid opportunity request.'};
  let opportunity;
  try {opportunity=normalizeOpportunity(body.opportunity);} catch(error) {return {status:400,error:error.message};}
  const current=await readBusinessAcquisition(db);
  if(body.revision!==current.revision) return {status:409,error:'Another session updated the workspace. Refresh before saving.'};
  const exists=current.opportunities.some(r=>r.id===opportunity.id);
  if(!exists && current.opportunities.length>=200) return {status:400,error:'The workspace supports up to 200 opportunities.'};
  const opportunities=exists ? current.opportunities.map(r=>r.id===opportunity.id ? opportunity : r) : [opportunity,...current.opportunities];
  const next={organizationId:'org-opwp',revision:crypto.randomUUID(),opportunities,updatedAt:new Date().toISOString(),updatedBy:String(actor).slice(0,254)};
  const payload=JSON.stringify(next);
  if(new TextEncoder().encode(payload).length>2*1024*1024) return {status:413,error:'Opportunity workspace is too large.'};
  const result=current.revision
    ? await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,status='success',captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND json_extract(payload,'$.revision')=?").bind(payload,next.updatedAt,BUSINESS_ACQUISITION_KEY,current.revision).run()
    : await db.prepare("INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)").bind(BUSINESS_ACQUISITION_KEY,payload,next.updatedAt).run();
  return Number(result.meta?.changes || 0)===1 ? {status:200,snapshot:next} : {status:409,error:'Another session updated the workspace. Refresh before saving.'};
}
export function businessAcquisitionHandlers({verifyAdminRequest,getDb,checkRateLimit,readBody}) {
  const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  return {
    async GET(request) {
      const auth=await verifyAdminRequest(request.headers);
      if(!auth.authorized) return response({error:'Unauthorized'},401);
      try {return response({snapshot:await readBusinessAcquisition(getDb())});} catch {return response({error:'Private opportunity storage is unavailable.'},503);}
    },
    async POST(request) {
      const auth=await verifyAdminRequest(request.headers);
      if(!auth.authorized) return response({error:'Unauthorized'},401);
      if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') return response({error:'Cross-site request blocked.'},403);
      if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return response({error:'JSON required.'},415);
      const actorRequest=new Request(request.url,{headers:{'cf-connecting-ip':'actor','user-agent':'acquisition-workspace'}});
      const limit=await checkRateLimit(actorRequest,{scope:`acquisition_save:${auth.email}`,limit:60,windowSeconds:3600,failClosed:true});
      if(!limit.allowed) return response({error:limit.unavailable ? 'Service protection unavailable.' : 'Save limit reached. Try again later.'},limit.unavailable ? 503 : 429);
      try {const result=await saveBusinessOpportunity(getDb(),await readBody(request,32768),auth.email);return response(result.snapshot ? {snapshot:result.snapshot} : {error:result.error},result.status);}
      catch(error) {return response({error:error instanceof RangeError ? 'Request too large.' : 'Private opportunity storage is unavailable.'},error instanceof RangeError ? 413 : 503);}
    },
  };
}
