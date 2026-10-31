import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUSINESS_ACQUISITION_KEY,normalizeOpportunity,readBusinessAcquisition,saveBusinessOpportunity,businessAcquisitionHandlers } from '../lib/business-acquisition.mjs';
import { DENSITY_ASSUMPTIONS,densityEconomics } from '../lib/acquisition-density.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { ADMIN_NAVIGATION,adminGroupFor } from '../app/admin/admin-navigation.mjs';
const opportunity={id:'20000000-0000-4000-a000-000000000001',name:'Example business',area:'Perrysburg',stage:'Research',askingPrice:null,customers:null,mrr:null,source:'',nextStep:'Review route overlap',nextActionAt:'2026-10-12',notes:'Unverified seller figures'};
function database(initial=null) {
  let payload=initial;const statements=[];
  return {statements,get payload(){return payload;},prepare(sql){return {bind(...values){statements.push({sql,values});return {async first(){return payload?{payload:JSON.stringify(payload)}:null;},async run(){if(sql.startsWith('INSERT') && payload || sql.startsWith('UPDATE') && payload?.revision!==values[3])return {meta:{changes:0}};payload=JSON.parse(sql.startsWith('INSERT')?values[1]:values[0]);return {meta:{changes:1}};}};}};}};
}
const request=(headers={},body='{}')=>new Request('https://ohiopetwastepros.com/api/admin/acquisition/businesses/',{method:'POST',headers:{origin:'https://ohiopetwastepros.com','content-type':'application/json',...headers},body});
test('business opportunities preserve unknown figures and reject invalid or injected fields',()=>{
  assert.equal(normalizeOpportunity(opportunity).mrr,null);
  for(const patch of [{organizationId:'other'},{id:'../other'},{stage:'Delete all'},{name:''},{askingPrice:-1},{customers:2.5},{mrr:Infinity},{notes:'x'.repeat(6001)},{nextActionAt:'2026-02-30'}])assert.throws(()=>normalizeOpportunity({...opportunity,...patch}));
});
test('business storage is OPWP-scoped, parameterized and prevents concurrent overwrites',async()=>{
  const db=database();const first=await saveBusinessOpportunity(db,{revision:'',opportunity},'owner@example.com');
  assert.equal(first.status,200);assert.equal(db.payload.organizationId,'org-opwp');assert.equal(db.payload.opportunities.length,1);
  assert.ok(db.statements.every(s=>s.values.includes(BUSINESS_ACQUISITION_KEY)));
  assert.equal((await saveBusinessOpportunity(db,{revision:'',opportunity:{...opportunity,name:'stale edit'}},'owner@example.com')).status,409);
  const next=await saveBusinessOpportunity(db,{revision:first.snapshot.revision,opportunity:{...opportunity,stage:'Passed'}},'owner@example.com');
  assert.equal(next.status,200);assert.equal(next.snapshot.opportunities.length,1);assert.equal(next.snapshot.opportunities[0].stage,'Passed');
  await assert.rejects(()=>readBusinessAcquisition(database({organizationId:'other',revision:'a',opportunities:[]})),/Invalid/);
  assert.equal((await saveBusinessOpportunity(db,{revision:next.snapshot.revision,opportunity,organizationId:'other'},'owner@example.com')).status,400);
});
test('anonymous, office, field, expired and foreign-principal requests never access acquisition storage',async()=>{
  for(const principal of ['anonymous','office','field','expired','foreign-organization']) {
    let touched=false;const forbidden=()=>{touched=true;throw Error('Forbidden storage call');};
    const h=businessAcquisitionHandlers({verifyAdminRequest:async()=>({authorized:false,principal}),getDb:forbidden,checkRateLimit:forbidden,readBody:forbidden});
    assert.equal((await h.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/businesses/'))).status,401);
    assert.equal((await h.POST(request())).status,401);assert.equal(touched,false);
  }
});
test('cross-site, missing origin, wrong content and rate-limit failures reject business writes before body reads',async()=>{
  let read=false;const h=businessAcquisitionHandlers({verifyAdminRequest:async()=>({authorized:true,email:'owner@example.com'}),getDb:()=>database(),checkRateLimit:async(_,options)=>{assert.equal(options.failClosed,true);return {allowed:false};},readBody:async()=>{read=true;}});
  assert.equal((await h.POST(request({origin:'https://attacker.example'}))).status,403);
  assert.equal((await h.POST(request({origin:''}))).status,403);
  assert.equal((await h.POST(request({'sec-fetch-site':'cross-site'}))).status,403);
  assert.equal((await h.POST(request({'content-type':'text/plain'}))).status,415);
  assert.equal((await h.POST(request())).status,429);assert.equal(read,false);
});
test('business handlers enforce body bounds, private errors and persistence',async()=>{
  const db=database();const h=businessAcquisitionHandlers({verifyAdminRequest:async()=>({authorized:true,email:'owner@example.com'}),getDb:()=>db,checkRateLimit:async()=>({allowed:true}),readBody:readBoundedProviderJson});
  assert.equal((await h.POST(request({},'x'.repeat(33000)))).status,413);
  assert.equal((await h.POST(request({},JSON.stringify({revision:'',opportunity})))).status,200);
  const get=await h.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/businesses/'));
  assert.equal(get.headers.get('cache-control'),'private, no-store');assert.equal((await get.json()).snapshot.opportunities[0].name,'Example business');
  const broken=businessAcquisitionHandlers({verifyAdminRequest:async()=>({authorized:true,email:'owner@example.com'}),getDb:()=>{throw Error('private SQL credential');},checkRateLimit:async()=>({allowed:true}),readBody:readBoundedProviderJson});
  const response=await broken.GET(new Request('https://ohiopetwastepros.com/api/admin/acquisition/businesses/'));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('credential'));
});
test('density calculator remains consistent for equal travel inputs and bounded for invalid values',()=>{
  const base=densityEconomics(DENSITY_ASSUMPTIONS);assert.ok(Math.abs(base.dense-68.8)<.001);assert.ok(base.advantage>0);
  const equal=densityEconomics({...DENSITY_ASSUMPTIONS,dense:15,denseMiles:5});assert.equal(equal.dense,equal.sparse);assert.equal(equal.advantage,0);
  assert.ok(Object.values(densityEconomics({...DENSITY_ASSUMPTIONS,dense:Infinity,mrr:NaN})).every(v=>v===null || Number.isFinite(v)));
});
test('workspace uses one Growth destination, guards server props and ships only aggregate map geometry',()=>{
  assert.equal(adminGroupFor('acquisition').id,'customers');
  assert.equal(ADMIN_NAVIGATION.flatMap(g=>g.items).filter(i=>i.href==='/admin/acquisition/').length,1);
  const page=fs.readFileSync(new URL('../app/admin/acquisition/page.js',import.meta.url),'utf8');assert.ok(page.indexOf('if(!auth.authorized)')<page.indexOf('readMarketingSnapshot(getDb())'));
  const raw=fs.readFileSync(new URL('./fixtures/route-density.json',import.meta.url),'utf8'),data=JSON.parse(raw);
  assert.equal(data.scope.activeRecords,12);assert.equal(data.scope.trustedGeocodes,10);assert.ok(data.clusters.every(r=>r.customers>=4));
  assert.ok(!/rec[A-Za-z0-9]{14}|address_hash|formatted_address|customer_id/.test(raw));
  const tags=new Set(['svg','defs','clipPath','rect','g','path','ellipse','circle','text']);
  function check(node){if(typeof node==='string')return;assert.ok(tags.has(node.tag));assert.ok(Object.keys(node.attrs).every(k=>!/^on|^href|^style|^dangerously/i.test(k)));node.children.forEach(check);}
  check(data.map);
});
