import { readBoundedProviderJson } from './bounded-body.mjs';
import { fieldQuota } from './field-quota.mjs';
import { DENSITY_SOURCE_KEY,DENSITY_REVIEWS_KEY,DENSITY_MAX_CLIENTS,DENSITY_REFRESH_MINUTES,densityAddress,densityAddressHash,normalizeDensityClients,closedWeekCapacity,densityChanges,buildDensityAnalysis } from './live-density.mjs';
const PRIVATE={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const fields=['Client Name','Address','City','ZIP','Type','Frequency','Service Day','Service Day 2','MRR ($)','Status','Assigned Tech','Assigned Tech 2','SNG Client ID','Est. Service Minutes'];
const LOCK_KEY=DENSITY_SOURCE_KEY+':lease';
const dateMs=value=>Date.parse(String(value||'').includes('T')?String(value):String(value)+'Z');
async function stored(db,key) {
  const row=await db.prepare('SELECT payload,status,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(key).first();
  if(!row)return null;
  if(typeof row.payload!=='string'||row.payload.length>2_000_000)throw Error('Invalid density storage.');
  return {...row,data:JSON.parse(row.payload)};
}
async function saveSource(db,source,status='success') {
  const payload=JSON.stringify(source);if(payload.length>2_000_000)throw Error('Density payload exceeds storage bound.');
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(DENSITY_SOURCE_KEY,payload,status,source.capturedAt).run();
}
export async function listDensityCustomers(env,{fetcher=(...args)=>fetch(...args),pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(!env?.AIRTABLE_API_KEY)throw Error('Density Airtable connection is unavailable.');
  const records=[];let offset=null,pages=0;const seen=new Set(),deadline=Date.now()+60000;
  do {
    if(++pages>20||seen.has(offset)&&offset||Date.now()>deadline)throw Error('Airtable roster pagination exceeds bound.');
    if(offset)seen.add(offset);
    const url=new URL('https://api.airtable.com/v0/appcAWPBQB8GmOrcT/tblhi8MGUOsWNmd37');
    url.searchParams.set('pageSize','100');url.searchParams.set('filterByFormula',"{Status}='Active'");
    for(const f of fields)url.searchParams.append('fields[]',f);
    if(offset)url.searchParams.set('offset',offset);
    // workerd supports manual/follow, not redirect:error. Fail on every non-2xx response.
    const response=await fetcher(url.toString(),{headers:{Authorization:'Bearer '+env.AIRTABLE_API_KEY,Accept:'application/json'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!response.ok){await response.body?.cancel();throw Error('Airtable customer refresh unavailable.');}
    const data=await readBoundedProviderJson(response,512_000);
    if(!Array.isArray(data.records)||data.records.length>100||data.records.some(r=>!r||typeof r.id!=='string'||!r.fields||typeof r.fields!=='object'))throw Error('Invalid Airtable customer page.');
    records.push(...data.records);if(records.length>DENSITY_MAX_CLIENTS)throw Error('Client roster exceeds supported bound.');
    if(data.offset!=null&&(typeof data.offset!=='string'||data.offset.length>512))throw Error('Invalid Airtable cursor.');
    offset=data.offset||null;if(offset)await pause(250);
  }while(offset);
  return {records,pages};
}
async function geocodesFor(db,records) {
  const hashes=await Promise.all(records.map(async r=>({id:r.id,hash:await densityAddressHash(densityAddress(r.fields))})));
  const byHash=new Map();
  for(let start=0;start<hashes.length;start+=80) {
    const chunk=[...new Set(hashes.slice(start,start+80).map(r=>r.hash))];if(!chunk.length)continue;
    const rows=await db.prepare(`SELECT address_hash,latitude,longitude,confidence,formatted_address,match_type FROM route_geocode_cache WHERE address_hash IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all();
    for(const r of rows.results||[])byHash.set(r.address_hash,r);
  }
  return {hashes,byHash,byRecord:new Map(hashes.map(r=>[r.id,byHash.get(r.hash)]))};
}
async function businessSource(db) {return await stored(db,'business_cockpit');}
async function rosterSource(db) {
  const row=await businessSource(db);if(!row?.data?.opwp||!Array.isArray(row.data.opwp.customers))throw Error('Airtable roster is not available.');
  const records=row.data.opwp.customers.filter(r=>r?.fields?.Status==='Active');
  const geo=await geocodesFor(db,records);
  return {schema:1,organizationId:'org-opwp',capturedAt:row.captured_at,status:row.status,sourceMode:'Existing Airtable snapshot',
    clients:normalizeDensityClients(records,geo.byRecord),capacity:{...closedWeekCapacity(row.data),capturedAt:row.captured_at},
    changes:{added:0,removed:0,changedAssignments:0,events:[]},automaticStarted:false};
}
function validateSource(source) {
  if(source?.schema!==1||source.organizationId!=='org-opwp'||!Array.isArray(source.clients)||source.clients.length>DENSITY_MAX_CLIENTS||!Number.isFinite(dateMs(source.capturedAt)))throw Error('Invalid density source.');
  if(source.clients.some(r=>!r||typeof r.id!=='string'||typeof r.name!=='string'||!Array.isArray(r.serviceDays)||!Array.isArray(r.technicians)||r.lat!=null&&(!Number.isFinite(r.lat)||!Number.isFinite(r.lon))))throw Error('Invalid density clients.');
  return source;
}
export async function readLiveDensity(db,{now=new Date()}={}) {
  if(!db)throw Error('Density database unavailable.');
  const row=await stored(db,DENSITY_SOURCE_KEY);
  const source=validateSource(row?.data||await rosterSource(db));
  const ageMinutes=Math.max(0,(now.getTime()-dateMs(source.capturedAt))/60000);
  return {...source,status:row?.status||source.status,ageMinutes:Math.round(ageMinutes),stale:ageMinutes>20||row?.status==='failed',refreshMinutes:DENSITY_REFRESH_MINUTES};
}
export async function refreshLiveDensity(env,{force=false,now=new Date(),fetcher=(...args)=>fetch(...args),pause,geocode,quota=fieldQuota}={}) {
  if(!env?.DB)throw Error('Density database unavailable.');
  const db=env.DB,previous=await readLiveDensity(db,{now}).catch(()=>null);
  if(!force&&previous?.automaticStarted&&previous.ageMinutes<DENSITY_REFRESH_MINUTES)return {source:previous,refreshed:false};
  const token=crypto.randomUUID(),at=now.toISOString(),until=new Date(now.getTime()+5*60000).toISOString();
  const lease=await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'running',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP WHERE airtable_cockpit_snapshots.captured_at<=?`)
    .bind(LOCK_KEY,token,until,at).run();
  if(!lease.meta?.changes)return {source:previous,refreshed:false,busy:true};
  let phase='quota';
  try {
    if(!await quota(db,'org-opwp','acquisition-density-provider-refresh',2,600))return {source:previous,refreshed:false,limited:true};
    phase='airtable';
    const {records,pages}=await listDensityCustomers(env,{fetcher,...(pause?{pause}:{})});
    phase='geocode-cache';const geo=await geocodesFor(db,records);
    let geocodeCalls=0;
    const geocodeAttempts=Object.fromEntries(Object.entries(previous?.geocodeAttempts||{}).filter(([,v])=>dateMs(v)>now.getTime()-86400000));
    const attemptedHashes=new Set();
    const unresolved=geo.hashes.filter(r=>!geo.byHash.has(r.hash)&&!geocodeAttempts[r.hash]&&!attemptedHashes.has(r.hash)&&(attemptedHashes.add(r.hash),true));
    phase='geocode';if(geocode&&env.GEOAPIFY_API_KEY)for(const item of unresolved.slice(0,5)) {
      const record=records.find(r=>r.id===item.id);if(!record?.fields?.Address)continue;
      if(!await quota(db,'org-opwp','acquisition-density-geocoding',100,86400))break;
      geocodeCalls++;geocodeAttempts[item.hash]=at;const result=await geocode(densityAddress(record.fields));
      if(!result?.ok||!Number.isFinite(result.data?.latitude)||!Number.isFinite(result.data?.longitude))continue;
      const g=result.data;
      await db.prepare(`INSERT INTO route_geocode_cache(address_hash,normalized_address,latitude,longitude,formatted_address,confidence,match_type,provider_place_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(address_hash) DO NOTHING`)
        .bind(item.hash,densityAddress(record.fields),g.latitude,g.longitude,String(g.formattedAddress||'').slice(0,512),g.confidence??null,String(g.matchType||'').slice(0,80),String(g.placeId||'').slice(0,512)).run();
      geo.byHash.set(item.hash,{latitude:g.latitude,longitude:g.longitude,confidence:g.confidence,formatted_address:g.formattedAddress,match_type:g.matchType});
    }
    phase='normalize';const clients=normalizeDensityClients(records,new Map(geo.hashes.map(r=>[r.id,geo.byHash.get(r.hash)])));
    const business=await businessSource(db).catch(()=>null);
    phase='capacity';
    const source={schema:1,organizationId:'org-opwp',capturedAt:at,lastAttemptAt:at,status:'success',sourceMode:'Live Airtable customers',
      automaticStarted:true,clients,capacity:{...closedWeekCapacity(business?.data,now),capturedAt:business?.captured_at||null},
      changes:densityChanges(previous,clients,now),providerPages:pages,geocodeCalls,geocodeAttempts};
    // Distinguish the content signature from the address normalizer's length bound.
    phase='signature';const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({clients,capacity:source.capacity})));
    source.revision=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    phase='save';await saveSource(db,source);
    return {source:await readLiveDensity(db,{now}),refreshed:true};
  } catch(error) {
    // Only fixed phase names and allowlisted categories; never provider bodies or client details.
    const category=/Illegal invocation/i.test(error?.message||'')?'illegal-invocation':/Invalid time value/.test(error?.message||'')?'invalid-date':/D1_|SQLITE|bind|parameter/i.test(error?.message||'')?'database':/Airtable customer refresh unavailable/.test(error?.message||'')?'provider-unavailable':/pagination|cursor|page|bound/i.test(error?.message||'')?'provider-data':/cache/i.test(error?.message||'')?'cache-option':/not implemented|not a function/i.test(error?.message||'')?'runtime-api':/URL|Request|string/.test(error?.message||'')?'request-input':'unexpected';
    console.error(JSON.stringify({event:'acquisition_density_refresh_error',phase,category}));
    if(previous){await saveSource(db,{...previous,lastAttemptAt:at,status:'failed',failureStage:phase,failureCategory:category},'failed');return {source:await readLiveDensity(db,{now}),refreshed:false,failed:true};}
    throw Error('Live Airtable density could not be refreshed.');
  } finally {await db.prepare('DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?').bind(LOCK_KEY,token).run();}
}
export async function readDensityReviews(db) {
  const row=await stored(db,DENSITY_REVIEWS_KEY);if(!row)return {revision:'',reviews:[]};
  const data=row.data;
  if(data?.organizationId!=='org-opwp'||typeof data.revision!=='string'||!Array.isArray(data.reviews)||data.reviews.length>200)throw Error('Invalid density reviews.');
  return {revision:data.revision,reviews:data.reviews};
}
export async function saveDensityReview(db,body,email) {
  if(!body||Object.keys(body).some(k=>!['operation','revision','sourceRevision','suggestionId','action','reason'].includes(k))||body.operation!=='review'||!['planned','dismissed'].includes(body.action)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000||typeof body.revision!=='string'||typeof body.sourceRevision!=='string'||typeof body.suggestionId!=='string'||body.suggestionId.length>100)return {status:400,error:'A review action and reason are required.'};
  const source=await readLiveDensity(db);if(source.stale||source.revision!==body.sourceRevision)return {status:409,error:'The source changed or is stale. Refresh and review the current evidence.'};
  const suggestion=buildDensityAnalysis(source).suggestions.find(r=>r.id===body.suggestionId);
  if(!suggestion)return {status:400,error:'This suggestion is no longer present in the current analysis.'};
  const prior=await readDensityReviews(db);if(prior.revision!==body.revision)return {status:409,error:'The review log changed. Reload before saving.'};
  if(prior.reviews.length>=200)return {status:409,error:'The review log reached its 200-entry limit. Existing history has been retained.'};
  const data={organizationId:'org-opwp',revision:crypto.randomUUID(),reviews:[...prior.reviews,{id:crypto.randomUUID(),suggestionId:suggestion.id,action:body.action,reason:body.reason.trim(),reviewer:email,at:new Date().toISOString(),sourceRevision:source.revision,sourceCapturedAt:source.capturedAt,title:suggestion.title,evidence:suggestion.reason}]};
  const payload=JSON.stringify(data);if(payload.length>400000)return {status:409,error:'The review log reached its storage limit.'};
  const result=prior.revision?await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=?,status='success',updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND json_extract(payload,'$.revision')=?`).bind(payload,DENSITY_REVIEWS_KEY,prior.revision).run():
    await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO NOTHING`).bind(DENSITY_REVIEWS_KEY,payload).run();
  return result.meta?.changes?{status:200,snapshot:{revision:data.revision,reviews:data.reviews}}:{status:409,error:'Another review was saved. Reload before saving.'};
}
export function densityHandlers({verifyAdminRequest,getDb,getEnv,checkRateLimit,geocode,readBody=readBoundedProviderJson}) {
  const json=(data,status=200)=>Response.json(data,{status,headers:PRIVATE});
  return {
    async GET(request) {
      const auth=await verifyAdminRequest(request.headers);if(!auth.authorized)return json({ok:false,error:'Your administrator session is required.'},401);
      if(new URL(request.url).search)return json({ok:false,error:'Unexpected query parameters.'},400);
      const rate=await checkRateLimit(request,{scope:'acquisition-density-read',limit:120,windowSeconds:60,failClosed:true});if(!rate.allowed)return json({ok:false,error:'Wait before refreshing this map.'},rate.unavailable?503:429);
      try {const db=getDb();return json({ok:true,source:await readLiveDensity(db),reviews:await readDensityReviews(db)});}catch{return json({ok:false,error:'Density data is temporarily unavailable.'},503);}
    },
    async POST(request) {
      const auth=await verifyAdminRequest(request.headers);if(!auth.authorized)return json({ok:false,error:'Your administrator session is required.'},401);
      if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({ok:false,error:'Cross-site requests are not allowed.'},403);
      if(new URL(request.url).search)return json({ok:false,error:'Unexpected query parameters.'},400);
      if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json({ok:false,error:'JSON is required.'},415);
      const rate=await checkRateLimit(request,{scope:'acquisition-density-write',limit:30,windowSeconds:3600,failClosed:true});if(!rate.allowed)return json({ok:false,error:'Wait before requesting another refresh or review.'},rate.unavailable?503:429);
      let body;try {body=await readBody(request,4096);}catch(e){return json({ok:false,error:'Invalid or oversized request.'},e instanceof RangeError?413:400);}
      try {
        if(body?.operation==='refresh'&&Object.keys(body).length===1) {
          const result=await refreshLiveDensity(getEnv(),{force:true,geocode});
          if(!result.source)return json({ok:false,error:'No density snapshot is available yet. Retry after the scheduled refresh.'},503);
          return json({ok:!result.failed,...result,reviews:await readDensityReviews(getDb())},result.failed?503:200);
        }
        const result=await saveDensityReview(getDb(),body,auth.email);return json({ok:result.status===200,...result},result.status);
      }catch{return json({ok:false,error:'The request could not be completed. Your previous data has been retained.'},503);}
    },
  };
}
