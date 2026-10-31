import auditSeed from '../data/meta-ads-audit-2026-10-06.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { totals, importMetaDaily, importOutcomes, mergeDaily, historyForSnapshot, acquisitionMetrics } from '../lib/marketing-metrics.mjs';
import { marketingHandlers, readMarketingSnapshot, saveMarketingImport, MARKETING_KEY } from '../lib/marketing-store.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('./fixtures/meta-ads.json',import.meta.url)));
test('synthetic exports reconcile exactly across daily and lifetime views',()=>{
  for(const field of ['spend','leads','impressions','clicks']) assert.equal(totals(seed.daily)[field],totals(seed.ads)[field]);
  assert.equal(totals(seed.daily).spend,30);assert.equal(totals(seed.daily).leads,3);
  assert.equal(seed.reportingStart,'2026-01-01');
  const april=totals(seed.daily.filter(row=>row.date.startsWith('2026-04')));
  assert.equal(april.leads,2);assert.equal(april.spend,20);
  assert.equal(new Set(seed.daily.filter(row=>row.date.startsWith('2026-04')).map(row=>row.adId)).size,1);
});
const dailyHeader='Reporting starts,Reporting ends,Ad ID,Account ID,Campaign ID,Campaign name,Ad name,Amount spent (USD),Results,Result indicator,Impressions,Link clicks,Attribution setting';
const dailyLine=("2026-10-01,2026-10-01,123," + String(auditSeed.accountId) + ",456,Fall,Demo,20,2,actions:leadgen.other,1000,10,7-day click or 1-day view");
const dailyCsv=`${dailyHeader}\n${dailyLine}\n`;
test('imports reject foreign accounts, duplicate breakdown rows, mixed conversions and invalid values',()=>{
  assert.equal(importMetaDaily(dailyCsv,String(auditSeed.accountId)).rows.length,1);
  assert.throws(()=>importMetaDaily(dailyCsv.replace(("" + String(auditSeed.accountId) + ""),'999'),String(auditSeed.accountId)),/different ad account/);
  assert.throws(()=>importMetaDaily(dailyCsv+dailyLine,String(auditSeed.accountId)),/Duplicate/);
  assert.throws(()=>importMetaDaily(dailyCsv.replace('actions:leadgen.other','actions:purchase'),String(auditSeed.accountId)),/instant-form/);
  assert.throws(()=>importMetaDaily(dailyCsv.replace(',20,2,',',-20,2,'),String(auditSeed.accountId)),/nonnegative/);
  assert.throws(()=>importMetaDaily(dailyCsv.replace('2026-10-01,2026-10-01','2026-02-30,2026-02-30'),String(auditSeed.accountId)),/valid/);
  assert.throws(()=>importMetaDaily(dailyCsv.replace('7-day click or 1-day view','1-day click'),String(auditSeed.accountId)),/attribution/);
  assert.throws(()=>importMetaDaily(dailyCsv.replace('Campaign name','Placement'),String(auditSeed.accountId)),/Export Ads/);
});
test('overlapping refreshes replace rows and explicit zeros suppress the historical seed',()=>{
  const row=importMetaDaily(dailyCsv,String(auditSeed.accountId)).rows[0];
  assert.equal(totals(mergeDaily([row],[{...row,spend:25}])).spend,25);
  assert.equal(historyForSnapshot([row],{daily:[],zeroKeys:['123:2026-10-01']}).length,0);
});
const outcomeHeader='lead_id,ad_id,captured_at,qualified_at,signed_up_at,first_paid_at,customer_id,payment_verified,first_payment_amount,mrr';
test('CAC requires complete cohorts and verified payments; customer deduplication is consistent across filters',()=>{
  const outcomes=importOutcomes(`${outcomeHeader}\na,123,2026-10-01,2026-10-01,2026-10-02,2026-10-03,c1,true,100,100\nb,124,2026-10-02,,,2026-10-03,c1,true,100,100\nc,123,2026-10-01,,2026-10-02,,,false,,\n`);
  const rows=importMetaDaily(dailyCsv,String(auditSeed.accountId)).rows;
  assert.equal(acquisitionMetrics(rows,outcomes,{start:'2026-10-01',end:'2026-10-31'}).mediaCac,null);
  const metrics=acquisitionMetrics(rows,outcomes,{start:'2026-10-01',end:'2026-10-31',complete:true,additionalCost:5});
  assert.equal(metrics.paid,1);assert.equal(metrics.mediaCac,20);assert.equal(metrics.loadedCac,25);assert.equal(metrics.closeRate,.5);
  assert.equal(acquisitionMetrics([{...rows[0],adId:'124'}],outcomes,{start:'2026-10-01',end:'2026-10-31',complete:true}).paid,0);
  assert.throws(()=>importOutcomes(`${outcomeHeader}\nx,123,2026-10-01,,,,,true,,`),/require/);
  assert.throws(()=>importOutcomes(`${outcomeHeader}\nx,123,2026-10-01,,,,,false,,\nx,123,2026-10-01,,,,,false,,`),/Duplicate/);
});

function database(initial=null) {
  let payload=initial, statements=[];
  return {statements,get payload(){return payload;},prepare(sql){return {bind(...values){statements.push({sql,values});return {async first(){return payload ? {payload:JSON.stringify(payload)} : null;},async run(){
    if(sql.startsWith('INSERT') && payload) return {meta:{changes:0}};
    if(sql.startsWith('UPDATE') && payload?.revision!==values[3]) return {meta:{changes:0}};
    payload=JSON.parse(sql.startsWith('INSERT') ? values[1] : values[0]);return {meta:{changes:1}};
  }};}};}};
}
test('private storage is fixed to OPWP, parameterized and rejects stale writes',async()=>{
  const db=database();
  const result=await saveMarketingImport(db,{action:'meta',csv:dailyCsv,revision:''},'craig@example.com');
  assert.equal(result.status,200);assert.equal(db.payload.organizationId,'org-opwp');
  assert.ok(db.statements.every(statement=>statement.values.includes(MARKETING_KEY)));
  assert.equal((await saveMarketingImport(db,{action:'meta',csv:dailyCsv,revision:''},'craig@example.com')).status,409);
  await assert.rejects(()=>readMarketingSnapshot(database({organizationId:'other',daily:[],outcomes:[]})),/invalid/);
  const zero=dailyCsv.replace(',20,2,actions:leadgen.other,1000,10,',',0,0,actions:leadgen.other,0,0,');
  const cleared=await saveMarketingImport(db,{action:'meta',csv:zero,revision:db.payload.revision},'craig@example.com');
  assert.equal(cleared.status,200);assert.deepEqual(db.payload.zeroKeys,['123:2026-10-01']);assert.equal(db.payload.daily.length,0);
});

const request=(headers={},body='{}')=>new Request('https://ohiopetwastepros.com/api/admin/marketing/',{method:'POST',headers:{origin:'https://ohiopetwastepros.com','content-type':'application/json',...headers},body});
test('unauthenticated, office/field, expired and cross-site requests cannot read or mutate reporting data',async()=>{
  for(const principal of ['anonymous','office','field','expired','wrong-organization']) {
    let touched=false;
    const handlers=marketingHandlers({verifyAdminRequest:async()=>({authorized:false,principal}),getDb:()=>{touched=true;throw Error('must not reach');},checkRateLimit:async()=>{touched=true;},readBody:async()=>{touched=true;}});
    assert.equal((await handlers.GET(new Request('https://ohiopetwastepros.com/api/admin/marketing/'))).status,401);
    assert.equal((await handlers.POST(request())).status,401);assert.equal(touched,false);
  }
  let touched=false;
  const handlers=marketingHandlers({verifyAdminRequest:async()=>({authorized:true,email:'craig@example.com'}),getDb:()=>{touched=true;},checkRateLimit:async()=>{touched=true;return {allowed:false,unavailable:true};},readBody:async()=>{touched=true;}});
  assert.equal((await handlers.POST(request({origin:'https://attacker.example'}))).status,403);assert.equal(touched,false);
  assert.equal((await handlers.POST(request({'sec-fetch-site':'cross-site'}))).status,403);
  assert.equal((await handlers.POST(request({'content-type':'text/plain'}))).status,415);
  assert.equal((await handlers.POST(request())).status,503);
});
test('stream bounds and rate-limit gates are enforced before importing',async()=>{
  let read=false;
  const handlers=marketingHandlers({verifyAdminRequest:async()=>({authorized:true,email:'craig@example.com'}),getDb:()=>database(),checkRateLimit:async(_request,options)=>{assert.equal(options.failClosed,true);return {allowed:false};},readBody:async()=>{read=true;}});
  assert.equal((await handlers.POST(request())).status,429);assert.equal(read,false);
  await assert.rejects(()=>readBoundedProviderJson(request({},'x'.repeat(500)),100),RangeError);
});
