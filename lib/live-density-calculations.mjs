// Pure, bounded analysis. Neighborhood circles are screening areas, not road routes.
export const DENSITY_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
export const DENSITY_COLORS = {Monday:'#2563a6',Tuesday:'#22856a',Wednesday:'#8060a9',Thursday:'#12798d',Friday:'#d37b17',Unassigned:'#657785'};
export const DENSITY_SOURCE_KEY = 'acquisition:density-source:org-opwp:v1';
export const DENSITY_REVIEWS_KEY = 'acquisition:density-reviews:org-opwp:v1';
export const DENSITY_MAX_CLIENTS = 2000;
export const DENSITY_REFRESH_MINUTES = 10;
const weights = {Weekly:1,Biweekly:.5,Monthly:12/52,'Twice Weekly':1};
const text = (v,max=160) => String(v ?? '').trim().slice(0,max);
const figure = v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v)>=0 ? Math.min(Number(v),1000000) : null;
const round = (n,p=2) => Math.round(n*10**p)/10**p;
export function densityAddress(fields) {return [fields.Address,fields.City,String(fields.ZIP||'').startsWith('48')?'MI':'OH',fields.ZIP].filter(Boolean).join(', ').replace(/\s+/g,' ');}
export async function densityAddressHash(address) {
  const normalized=text(address,1000).toLowerCase().replace(/[^a-z0-9]/g,'');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function localReliableGeocode(g) {
  return Boolean(g && g.latitude!=null && g.longitude!=null && Number.isFinite(Number(g.latitude)) && Number.isFinite(Number(g.longitude)) &&
    Number(g.latitude)>=41 && Number(g.latitude)<=42.3 && Number(g.longitude)>=-84.6 && Number(g.longitude)<=-82.7 &&
    Number(g.confidence)>=.75 && g.match_type==='full_match');
}
export function normalizeDensityClients(records, geocodes=new Map()) {
  if(!Array.isArray(records) || records.length>DENSITY_MAX_CLIENTS) throw Error('Client roster exceeds the supported bound.');
  if(new Set(records.map(r=>r?.id)).size!==records.length)throw Error('Duplicate roster record identifiers.');
  const providerIds=new Map();
  for(const r of records) if(r?.fields?.Status==='Active' && r.fields['SNG Client ID']) {
    const id=text(r.fields['SNG Client ID']);providerIds.set(id,(providerIds.get(id)||0)+1);
  }
  return records.filter(r=>r?.fields?.Status==='Active').map(r=>{
    const f=r.fields,g=geocodes.get(r.id),reliable=localReliableGeocode(g);
    const visits=[{day:f['Service Day'],technician:f['Assigned Tech']},{day:f['Service Day 2'],technician:f['Assigned Tech 2']||f['Assigned Tech']}]
      .filter((v,i,a)=>DENSITY_DAYS.includes(v.day)&&a.findIndex(other=>other.day===v.day)===i);
    const serviceDays=visits.map(v=>v.day);
    const cityMatch=text(g?.formatted_address,512).match(/,\s*([^,]+),\s*(?:Ohio|Michigan|OH|MI)\b/i);
    const postcode=text(g?.formatted_address,512).match(/\b(\d{5})(?:-\d{4})?\b/);
    const duplicateProvider=Boolean(f['SNG Client ID'] && providerIds.get(text(f['SNG Client ID']))>1);
    const issue=!f.Address?'Missing street address':!g?'Awaiting geocode':!reliable?'Location needs verification':null;
    return {id:text(r.id,80),name:text(f['Client Name'])||'Unnamed client',address:text(f.Address,256),city:reliable&&cityMatch?cityMatch[1]:text(f.City),
      zip:reliable&&postcode?postcode[1]:text(f.ZIP,10),sourceZip:text(f.ZIP,10),type:text(f.Type)||'Unknown',
      lat:reliable?Number(g.latitude):null,lon:reliable?Number(g.longitude):null,issue,
      serviceDays,technicians:visits.map(v=>text(v.technician)||'Unassigned'),
      frequency:text(f.Frequency)||'Unknown',weeklyWeight:weights[f.Frequency]??null,mrr:figure(f['MRR ($)']),serviceMinutes:figure(f['Est. Service Minutes']),
      createdAt:text(r.createdTime,40),duplicateProvider};
  }).sort((a,b)=>a.id.localeCompare(b.id));
}
export function densityDistance(a,b) {
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  return 3958.7613*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2)));
}
function tally(rows,key) {const out=Object.create(null);for(const r of rows) {const k=key(r);out[k]=(out[k]||0)+1;}return out;}
const largest = counts => Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||'Unassigned';
function summary(rows,ownerShort) {
  const primaryDays=tally(rows,r=>r.serviceDays[0]||'Unassigned'),technicians=tally(rows,r=>r.technicians[0]||'Unassigned');
  return {customers:rows.length,primaryDays,technicians,mainDay:largest(primaryDays),
    weeklyVisits:round(rows.reduce((n,r)=>n+(r.weeklyWeight??0)*r.serviceDays.length,0)),unknownCadence:rows.filter(r=>r.weeklyWeight==null).length,
    mrr:round(rows.reduce((n,r)=>n+(r.mrr??0),0)),missingMrr:rows.filter(r=>r.mrr==null).length,
    serviceEstimateCoverage:rows.filter(r=>r.serviceMinutes!=null&&r.serviceMinutes>0).length,
    modeledServiceHours:round(rows.reduce((n,r)=>n+(r.serviceMinutes??0)*(r.weeklyWeight??0)*r.serviceDays.length/60,0)),
    craigMonday:rows.filter(r=>r.serviceDays.some((d,i)=>d==='Monday'&&new RegExp('^'+ownerShort+'\\b','i').test(r.technicians[i]))).length};
}
export function calculateClosedWeekCapacity(data, now, staffPolicy) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const monday=new Date(today+'T12:00:00Z');monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7)-7);
  const sunday=new Date(monday);sunday.setUTCDate(sunday.getUTCDate()+6);
  const from=monday.toISOString().slice(0,10),through=sunday.toISOString().slice(0,10);
  const logs=(Array.isArray(data?.opwp?.time)?data.opwp.time:[]).filter(r=>r?.fields?.Date>=from&&r.fields.Date<=through);
  const staff=[staffPolicy.primaryShort,staffPolicy.reliefShort].map(name=>{
    const rows=logs.filter(r=>new RegExp('^'+name+'\\b','i').test(text(r.fields['Tech Name'])));
    const timeRows=rows.filter(r=>figure(r.fields['Minutes Clocked'])!=null),mileRows=rows.filter(r=>figure(r.fields['Miles Driven'])!=null);
    const hours=timeRows.length?round(timeRows.reduce((n,r)=>n+figure(r.fields['Minutes Clocked']),0)/60):null;
    return {name,hours,miles:mileRows.length?round(mileRows.reduce((n,r)=>n+figure(r.fields['Miles Driven']),0)):null,records:rows.length,missingTimeRows:rows.length-timeRows.length,
      days:new Set(rows.map(r=>r.fields.Date)).size,reviewOvertime:name===staffPolicy.primaryShort&&hours!=null&&hours>45,
      belowFullTimeFloor:name===staffPolicy.primaryShort&&hours!=null&&hours<40};
  });
  return {from,through,staff,source:'Recorded paid time; not spare route capacity',coverageKnown:logs.length>0};
}
export function densityChanges(previous, clients, now=new Date()) {
  const prior=previous?.clients;if(!Array.isArray(prior))return {added:0,removed:0,changedAssignments:0,events:[]};
  const old=new Map(prior.map(r=>[r.id,r])),current=new Map(clients.map(r=>[r.id,r]));
  const added=clients.filter(r=>!old.has(r.id)).length,removed=prior.filter(r=>!current.has(r.id)).length;
  const changedAssignments=clients.filter(r=>old.has(r.id)&&JSON.stringify([r.serviceDays,r.technicians])!==JSON.stringify([old.get(r.id).serviceDays,old.get(r.id).technicians])).length;
  const events=(previous.changes?.events||[]).filter(r=>Date.parse(r.at)>now.getTime()-14*86400000).slice(-99);
  if(added||removed||changedAssignments)events.push({at:now.toISOString(),added,removed,changedAssignments});
  return {added,removed,changedAssignments,events};
}
export function buildDensityAnalysis(source,filters={}) {
  const primaryShort=source?.capacity?.staff?.[0]?.name,ownerShort=source?.capacity?.staff?.[1]?.name;
  if(source?.organizationId!=='org-opwp' || !Array.isArray(source.clients) || source.clients.length>DENSITY_MAX_CLIENTS)throw Error('Invalid density source.');
  const matches = r => {
    const day=filters.day&&filters.day!=='All'?filters.day:null,tech=filters.technician&&filters.technician!=='All'?filters.technician:null;
    return day&&tech?r.serviceDays.some((d,i)=>d===day&&r.technicians[i]===tech):(!day||r.serviceDays.includes(day))&&(!tech||r.technicians.includes(tech));
  };
  // Scope visits as well as clients: a Craig Monday client can have a Tony Friday visit.
  const clients=source.clients.filter(matches).map(r=>{
    const visits=r.serviceDays.map((day,i)=>({day,technician:r.technicians[i]})).filter(v=>
      (!filters.day||filters.day==='All'||v.day===filters.day)&&(!filters.technician||filters.technician==='All'||v.technician===filters.technician));
    return {...r,serviceDays:visits.map(v=>v.day),technicians:visits.map(v=>v.technician)};
  }),points=clients.filter(r=>r.lat!=null&&r.lon!=null);
  const nearby=(center,radius)=>points.filter(r=>Math.abs(r.lat-center.lat)<radius/68 && Math.abs(r.lon-center.lon)<radius/49 && densityDistance(center,r)<=radius);
  const centers=new Map();for(const p of points){const lat=round(Math.round(p.lat/.005)*.005,3),lon=round(Math.round(p.lon/.005)*.005,3);centers.set(lat+','+lon,{lat,lon});}
  const candidates=[...centers.values()].map(center=>({...center,rows:nearby(center,1)})).filter(c=>c.rows.length>=3);
  const remaining=new Set(points.map(p=>p.id)),pockets=[];
  while(pockets.length<20){
    const ranked=candidates.filter(c=>!pockets.some(p=>densityDistance(p,c)<.65)).map(c=>({...c,unique:c.rows.filter(r=>remaining.has(r.id)).length})).filter(c=>c.unique>=3)
      .sort((a,b)=>b.unique-a.unique||b.rows.length-a.rows.length||a.lat-b.lat||a.lon-b.lon);
    const best=ranked[0];if(!best)break;
    const stats=summary(best.rows,ownerShort),city=largest(tally(best.rows,r=>r.city||'Local area'));
    const id=`P-${Math.round(best.lat*1000)}-${Math.round(-best.lon*1000)}`;
    const reference=[...best.rows].sort((a,b)=>densityDistance(best,a)-densityDistance(best,b)||a.id.localeCompare(b.id))[0];
    const street=text(reference.address.replace(/^\d+[A-Za-z-]*\s+/,''),80)||'Local pocket';
    pockets.push({id,lat:best.lat,lon:best.lon,displayName:city+' · near '+street,radiusMiles:1,twoMiles:nearby(best,2).length,
      newCoverage:best.unique,overlap:best.rows.length-best.unique,memberIds:best.rows.map(r=>r.id),...stats});
    best.rows.forEach(r=>remaining.delete(r.id));
  }
  const dayLoads=DENSITY_DAYS.map(day=>{
    const rows=clients.filter(r=>r.serviceDays.includes(day));
    return {day,customers:rows.length,weeklyVisits:round(rows.reduce((n,r)=>n+(r.weeklyWeight??0),0)),
      modeledServiceHours:round(rows.reduce((n,r)=>n+(r.serviceMinutes??0)*(r.weeklyWeight??0)/60,0)),
      serviceEstimateCoverage:rows.filter(r=>r.serviceMinutes>0).length};
  });
  const tony=source.capacity?.staff?.find(s=>s.name===primaryShort),suggestions=[];
  const prioritized=pockets.map(p=>({...p,score:round(p.customers*(((p.primaryDays[p.mainDay]||0)/p.customers)+.5)+p.craigMonday*2)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  for(const p of prioritized.slice(0,5)) {
    suggestions.push({id:'infill:'+p.id,pocketId:p.id,kind:'Local acquisition',title:'Build around '+p.displayName,
      reason:`${p.customers} verified locations within one mile; ${p.primaryDays[p.mainDay]||0} on ${p.mainDay}${p.craigMonday?`; ${p.craigMonday} Craig Monday anchors`:''}.`,
      nextStep:`Test neighborhood creative and qualify each service address for ${p.mainDay}. Check bridge/road insertion and confirmed hours before adding stops.`,
      capacityStatus:tony?.reviewOvertime?'Capacity review first':'Confirm staffing capacity',score:p.score});
    const movable=p.memberIds.map(id=>points.find(r=>r.id===id)).filter(r=>r.serviceDays.length===1&&r.serviceDays[0]!==p.mainDay);
    if(movable.length>=2&&(p.primaryDays[p.mainDay]||0)>=3)suggestions.push({id:'day-review:'+p.id,pocketId:p.id,kind:'Day consolidation',title:'Review the split in '+p.displayName,
      reason:`${movable.length} single-day clients share this pocket with ${p.primaryDays[p.mainDay]} ${p.mainDay} clients.`,
      nextStep:`Compare current road time and customer day restrictions with a ${p.mainDay} grouping. Balance nearby day workloads; keep fixed twice-weekly pairs and Tony's full-time work.`,
      capacityStatus:'Review proposal; no assignment change',score:p.score-.5});
    if(p.craigMonday>=2)suggestions.push({id:'part-time:'+p.id,pocketId:p.id,kind:'Part-time route book',title:'Grow Craig’s existing Monday pocket',
      reason:`${p.craigMonday} confirmed Craig Monday anchors in ${p.displayName}.`,nextStep:'Use nearby new clients to build a coherent book a future part-time hire can inherit. Confirm additional Craig hours and protect Tony’s 40-hour floor.',
      capacityStatus:'Monday confirmed; other availability unknown',score:p.score+1});
  }
  const reviewCount=clients.filter(r=>r.issue).length,assignmentIssues=clients.filter(r=>!r.serviceDays.length||r.technicians.includes('Unassigned')||r.duplicateProvider).length;
  if(reviewCount||assignmentIssues)suggestions.unshift({id:'data-review',kind:'Data quality',title:'Verify locations and assignments',reason:`${reviewCount} locations need review; ${assignmentIssues} clients have assignment or provider-identifier issues.`,nextStep:'Resolve the source records before treating these clients as reliable targeting or route anchors.',capacityStatus:'Evidence gap',score:0});
  const isolated=points.filter(p=>points.length>1&&!points.some(other=>other.id!==p.id&&densityDistance(p,other)<=2));
  if(isolated.length)suggestions.push({id:'isolated-review',kind:'Travel review',title:'Review isolated stops before expanding outward',reason:`${isolated.length} mapped clients have no other mapped client within two miles.`,nextStep:'Compare actual travel and margin. Look for adjacent demand before adding distant stops; do not move clients into unrelated territories to fill a lighter day.',capacityStatus:'Road-time review needed',score:0});
  const zips=Object.entries(tally(points,r=>r.zip||'Unknown')).map(([key])=>({key,...summary(points.filter(r=>(r.zip||'Unknown')===key),ownerShort)})).sort((a,b)=>b.customers-a.customers||a.key.localeCompare(b.key));
  return {...source,clients,pockets,suggestions,dayLoads,zips,scope:{activeRecords:source.clients.length,filteredRecords:clients.length,trustedGeocodes:points.length,
    needsGeocodeReview:reviewCount,coveredClients:points.length-remaining.size,isolatedClients:isolated.length,assignmentIssues},
    filterOptions:{days:DENSITY_DAYS,technicians:[...new Set(source.clients.flatMap(r=>r.technicians))].sort()},analysisVersion:1};
}
