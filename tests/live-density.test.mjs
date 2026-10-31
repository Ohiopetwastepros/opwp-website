import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {densityAddress,densityAddressHash,normalizeDensityClients,buildDensityAnalysis,closedWeekCapacity,DENSITY_SOURCE_KEY,DENSITY_REVIEWS_KEY} from '../lib/live-density.mjs';
import {listDensityCustomers,readLiveDensity,refreshLiveDensity,densityHandlers,readDensityReviews,saveDensityReview} from '../lib/live-density-store.mjs';
const now=new Date(),capturedAt=now.toISOString();
const record=(id,n,patch={})=>({id,createdTime:'2026-01-01T12:00:00Z',fields:{Status:'Active','Client Name':'Fixture '+id,Address:`${n} Fixture Lane`,City:'Perrysburg',ZIP:'43551',Frequency:'Weekly','Service Day':'Monday','Assigned Tech':staffPrivate.reliefShort,'Est. Service Minutes':8,'MRR ($)':100,...patch}});
const records=[record('one',1),record('two',2),record('three',3),record('four',4,{'Service Day':'Friday','Assigned Tech':staffPrivate.primaryShort}),record('five',5,{'Service Day':'Friday','Assigned Tech':staffPrivate.primaryShort})];
const g=(offset=0)=>({latitude:41.535+offset,longitude:-83.665,confidence:1,match_type:'full_match',formatted_address:'Fixture Lane, Perrysburg, OH 43551, United States of America'});
const geos=new Map(records.map((r,i)=>[r.id,g(i*.0003)]));
const source=(clients=normalizeDensityClients(records,geos))=>({schema:1,organizationId:'org-opwp',capturedAt,clients,revision:'fixture-revision',capacity:{staff:[{name:staffPrivate.primaryShort,hours:47,reviewOvertime:true},{name:staffPrivate.reliefShort,hours:5}]},changes:{events:[]},automaticStarted:true});
function database(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE api_rate_limits(scope TEXT,client_key TEXT,window_start INTEGER,request_count INTEGER,expires_at TEXT,PRIMARY KEY(scope,client_key,window_start));
    CREATE TABLE route_geocode_cache(address_hash TEXT PRIMARY KEY,normalized_address TEXT,latitude REAL,longitude REAL,formatted_address TEXT,confidence REAL,match_type TEXT,provider_place_id TEXT,updated_at TEXT);`);
  const db={prepare(query){
    const statement=sql.prepare(query);
    return {bind(...args){return {
      async first(){return statement.get(...args)||null;},
      async all(){return {results:statement.all(...args)};},
      async run(){return {meta:{changes:Number(statement.run(...args).changes)}};},
    };}};
  }};
  return {db,sql,put(key,data,status='success',date=capturedAt){sql.prepare('INSERT OR REPLACE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,?,?)').run(key,JSON.stringify(data),status,date);}};
}
const response=rows=>Response.json({records:rows});
const fakeQuota=async()=>true;
async function seedGeos(f,rows=records){for(const [i,r]of rows.entries()){const geo=g(i*.0003);f.sql.prepare('INSERT INTO route_geocode_cache VALUES (?,?,?,?,?,?,?,?,?)').run(await densityAddressHash(densityAddress(r.fields)),densityAddress(r.fields),geo.latitude,geo.longitude,geo.formatted_address,1,'full_match','fixture',capturedAt);}}
test('density uses verified local locations, corrects ZIPs and preserves unknown figures',()=>{
  const rows=[...records,record('missing',8,{'MRR ($)':null,'Est. Service Minutes':null}),record('paused',9,{Status:'Paused'}),record('low',10)];
  const map=new Map([...geos,['low',{...g(),confidence:.25}],['missing',{...g(),latitude:null}]]);
  const clients=normalizeDensityClients(rows,map);assert.equal(clients.length,7);assert.equal(clients.find(r=>r.id==='missing').mrr,null);assert.equal(clients.find(r=>r.id==='missing').lat,null);assert.equal(clients.find(r=>r.id==='low').lat,null);
  assert.equal(densityAddress({Address:'1 Main',City:'Lambertville',ZIP:'48144'}),'1 Main, Lambertville, MI, 48144');
  assert.throws(()=>normalizeDensityClients([records[0],records[0]],map),/Duplicate/);
  assert.equal(normalizeDensityClients([record('zip',1,{ZIP:'99999'})],new Map([['zip',g()]]))[0].zip,'43551');
});
test('pockets recompute after new and removed clients, have unique coverage and stable centers',()=>{
  const original=buildDensityAnalysis(source());assert.equal(original.pockets[0].customers,5);assert.equal(original.scope.coveredClients,5);
  const newClient={...original.clients[0],id:'new',name:'New fixture'};
  const grown=buildDensityAnalysis(source([...original.clients,newClient]));assert.equal(grown.pockets[0].customers,6);assert.equal(grown.pockets[0].id,original.pockets[0].id);
  const removed=buildDensityAnalysis(source(original.clients.slice(0,3)));assert.equal(removed.pockets[0].customers,3);
  const sparse=buildDensityAnalysis(source(original.clients.slice(0,2)));assert.equal(sparse.pockets.length,0);
  assert.equal(grown.pockets.reduce((n,p)=>n+p.newCoverage,0),grown.scope.coveredClients);
  assert.ok(original.suggestions.some(r=>r.kind==='Part-time route book'));assert.ok(original.suggestions.filter(r=>r.kind==='Local acquisition').every(r=>r.capacityStatus==='Capacity review first'));
});
test('day and technician filters keep twice-weekly technician assignments paired',()=>{
  const pair=normalizeDensityClients([record('pair',1,{Frequency:'Twice Weekly','Service Day':'Monday','Service Day 2':'Thursday','Assigned Tech':staffPrivate.reliefShort,'Assigned Tech 2':staffPrivate.primaryShort})],new Map([['pair',g()]]));
  assert.equal(buildDensityAnalysis(source(pair),{day:'Thursday',technician:staffPrivate.reliefShort}).clients.length,0);
  const thursday=buildDensityAnalysis(source(pair),{day:'Thursday',technician:staffPrivate.primaryShort});assert.equal(thursday.clients.length,1);
  assert.equal(thursday.dayLoads.find(r=>r.day==='Thursday').weeklyVisits,1);assert.equal(thursday.clients[0].weeklyWeight,1);
  assert.equal(thursday.dayLoads.reduce((n,d)=>n+d.weeklyVisits,0),1);
  assert.deepEqual(thursday.clients[0].serviceDays,['Thursday']);
  assert.equal(buildDensityAnalysis(source(pair),{technician:staffPrivate.reliefShort}).dayLoads.find(r=>r.day==='Thursday').customers,0);
  assert.equal(buildDensityAnalysis(source(pair)).dayLoads.reduce((n,d)=>n+d.weeklyVisits,0),2);
  const secondary=normalizeDensityClients([record('secondary',1,{'Service Day':null,'Service Day 2':'Thursday','Assigned Tech':staffPrivate.reliefShort,'Assigned Tech 2':staffPrivate.primaryShort})]);
  assert.deepEqual(secondary[0].technicians,[staffPrivate.primaryShort]);
});
test('closed-week capacity separates missing paid time from zero and enforces owner thresholds',()=>{
  const data={opwp:{time:[{fields:{Date:'2025-02-03','Tech Name':staffPrivate.primaryName,'Minutes Clocked':46*60,'Miles Driven':320}},{fields:{Date:'2025-02-04','Tech Name':staffPrivate.reliefShort,'Minutes Clocked':null}}]}};
  const capacity=closedWeekCapacity(data,new Date('2025-02-11T12:00:00Z'));assert.equal(capacity.from,'2025-02-03');assert.equal(capacity.through,'2025-02-09');assert.equal(capacity.staff[0].hours,46);assert.equal(capacity.staff[0].reviewOvertime,true);assert.equal(capacity.staff[1].hours,null);assert.equal(capacity.staff[1].missingTimeRows,1);
});
test('customer-only refresh is paginated, bounded and never accepts partial or repeated pages',async()=>{
  let calls=0;const result=await listDensityCustomers({AIRTABLE_API_KEY:'fixture-secret'},{pause:async()=>{},fetcher:async input=>{assert.equal(typeof input,'string');const url=new URL(input);calls++;assert.ok(url.hostname==='api.airtable.com');assert.equal(url.searchParams.get('filterByFormula'),"{Status}='Active'");return calls===1?Response.json({records:[records[0]],offset:'next'}):response(records.slice(1));}});assert.equal(result.records.length,5);assert.equal(result.pages,2);
  await assert.rejects(listDensityCustomers({AIRTABLE_API_KEY:'fixture'},{pause:async()=>{},fetcher:async()=>Response.json({records:[],offset:'repeat'})}),/pagination/);
  await assert.rejects(listDensityCustomers({AIRTABLE_API_KEY:'fixture'},{fetcher:async()=>new Response('x'.repeat(513000))}),RangeError);
  await assert.rejects(listDensityCustomers({AIRTABLE_API_KEY:'fixture'},{fetcher:async(_,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://attacker.test'}});}}),/unavailable/);
});
test('SQLite refresh detects additions and cancellation while failures retain the last good map',async()=>{
  const f=database();await seedGeos(f);f.put('business_cockpit',{opwp:{customers:records,time:[]}});
  const env={DB:f.db,AIRTABLE_API_KEY:'fixture'};
  const first=await refreshLiveDensity(env,{force:true,now,quota:fakeQuota,fetcher:async()=>response(records),pause:async()=>{}});assert.equal(first.source.clients.length,5);assert.equal(first.source.changes.added,0);
  const nextTime=new Date(now.getTime()+60000),nextRows=[...records.slice(1),record('six',6)];
  const second=await refreshLiveDensity(env,{force:true,now:nextTime,quota:fakeQuota,fetcher:async()=>response(nextRows),pause:async()=>{}});assert.equal(second.source.changes.added,1);assert.equal(second.source.changes.removed,1);assert.notEqual(first.source.revision,second.source.revision);
  const failed=await refreshLiveDensity(env,{force:true,now:new Date(nextTime.getTime()+60000),quota:fakeQuota,fetcher:async()=>new Response('provider secret',{status:500})});assert.equal(failed.failed,true);assert.equal(failed.source.clients.length,5);assert.equal(failed.source.capturedAt,second.source.capturedAt);assert.equal(failed.source.stale,true);assert.equal(JSON.stringify(failed).includes('provider secret'),false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(DENSITY_SOURCE_KEY+':lease').n,0);f.sql.close();
});
test('an atomic lease prevents two simultaneous provider refreshes',async()=>{
  const f=database();await seedGeos(f);f.put('business_cockpit',{opwp:{customers:records,time:[]}});
  let resolve,start;const entered=new Promise(r=>start=r),held=new Promise(r=>resolve=r),env={DB:f.db,AIRTABLE_API_KEY:'fixture'};
  const first=refreshLiveDensity(env,{force:true,now,quota:fakeQuota,fetcher:async()=>{start();await held;return response(records);}});await entered;
  const second=await refreshLiveDensity(env,{force:true,now,quota:fakeQuota,fetcher:async()=>{throw Error('must not call');}});assert.equal(second.busy,true);resolve();await first;f.sql.close();
});
test('reviews preserve evidence, reject stale source, scope storage and prevent lost updates',async()=>{
  const f=database();f.put(DENSITY_SOURCE_KEY,source());const suggestion=buildDensityAnalysis(source()).suggestions.find(s=>s.pocketId);
  const body={operation:'review',revision:'',sourceRevision:'fixture-revision',suggestionId:suggestion.id,action:'planned',reason:'Confirm Monday hours and road fit.'};
  const saved=await saveDensityReview(f.db,body,'fixture-owner');assert.equal(saved.status,200);assert.equal(saved.snapshot.reviews[0].evidence,suggestion.reason);
  assert.equal((await saveDensityReview(f.db,body,'other')).status,409);
  assert.equal((await saveDensityReview(f.db,{...body,revision:saved.snapshot.revision,sourceRevision:'old'},'owner')).status,409);
  assert.equal((await saveDensityReview(f.db,{...body,organizationId:'other'},'owner')).status,400);
  assert.equal((await saveDensityReview(f.db,{...body,revision:saved.snapshot.revision,suggestionId:'foreign'},'owner')).status,400);
  assert.equal((await readDensityReviews(f.db)).reviews.length,1);assert.equal(f.sql.prepare('SELECT snapshot_key FROM airtable_cockpit_snapshots WHERE snapshot_key=?').get(DENSITY_REVIEWS_KEY).snapshot_key,DENSITY_REVIEWS_KEY);f.sql.close();
});
const request=(patch={},body={operation:'refresh'})=>new Request('https://ohiopetwastepros.com/api/admin/acquisition/density/',{method:'POST',headers:{origin:'https://ohiopetwastepros.com','content-type':'application/json',...patch},body:typeof body==='string'?body:JSON.stringify(body)});
test('anonymous, expired, office, field and foreign principals cannot read clients or call providers',async()=>{
  for(const principal of ['anonymous','expired','office','field','foreign']) {
    let touched=false;const forbidden=()=>{touched=true;throw Error('forbidden');};
    const h=densityHandlers({verifyAdminRequest:async()=>({authorized:false,principal}),getDb:forbidden,getEnv:forbidden,checkRateLimit:forbidden,geocode:forbidden});
    assert.equal((await h.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/density/'))).status,401);assert.equal((await h.POST(request())).status,401);assert.equal(touched,false);
  }
});
test('density API rejects hostile origins, bounded bodies, query keys and unavailable abuse protection',async()=>{
  const f=database();f.put(DENSITY_SOURCE_KEY,source());let allowed=true;
  const h=densityHandlers({verifyAdminRequest:async()=>({authorized:true,email:'fixture-owner'}),getDb:()=>f.db,getEnv:()=>({DB:f.db}),checkRateLimit:async(_,options)=>{assert.equal(options.failClosed,true);return {allowed,unavailable:!allowed};}});
  for(const headers of [{origin:''},{origin:'https://attacker.test'},{'sec-fetch-site':'cross-site'}])assert.equal((await h.POST(request(headers))).status,403);
  assert.equal((await h.POST(request({'content-type':'text/plain'}))).status,415);assert.equal((await h.POST(request({},'x'.repeat(5000)))).status,413);
  assert.equal((await h.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/density/?organizationId=other'))).status,400);
  assert.equal((await h.POST(request({},{operation:'refresh',organizationId:'other'}))).status,400);
  const result=await h.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/density/'));assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal((await result.json()).source.clients.length,5);
  allowed=false;assert.equal((await h.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/density/'))).status,503);f.sql.close();
});
test('private map loads local library code and uses text nodes for untrusted client details',()=>{
  const map=fs.readFileSync(new URL('../app/admin/acquisition/LocalDensityMap.js',import.meta.url),'utf8');
  assert.ok(map.includes("import('leaflet')"));assert.ok(map.includes('textContent'));assert.ok(!map.includes('innerHTML'));assert.ok(!map.includes('dangerouslySetInnerHTML'));
  const page=fs.readFileSync(new URL('../app/admin/acquisition/page.js',import.meta.url),'utf8');assert.ok(page.indexOf('if(!auth.authorized)')<page.indexOf('readLiveDensity(getDb())'));assert.ok(!page.includes('route-density-audit-2026-10-06.json'));
});
