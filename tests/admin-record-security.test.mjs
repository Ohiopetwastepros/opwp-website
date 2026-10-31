import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readBoundedBytes} from '../lib/bounded-body.mjs';
import {RecordError} from '../lib/admin-record-policy.mjs';
import {matchGoogleReviews} from '../lib/google-review-matching.mjs';

const root=new URL('../',import.meta.url);
const guardSource=fs.readFileSync(new URL('lib/public-api-security.js',root),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const readBoundedJson=runPrivateInNewContext(guardSource+'\nreadBoundedJson',{Response,TextDecoder,readBoundedBytes});
function runtime(path,{authorized=true,limited=false,unavailable=false}={}){
  let writes=0,reads=0;
  const source=fs.readFileSync(new URL(path,root),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const api=runPrivateInNewContext(source+'\n({GET,POST})',{Response,URL,console,RecordError,readBoundedJson,verifyAdminRequest:async()=>({authorized,email:'owner'}),getRuntimeEnv:()=>unavailable?{}:{DB:{},AIRTABLE_API_KEY:'test'},checkRateLimit:async()=>({allowed:!limited}),rateLimitResponse:()=>new Response(null,{status:429}),recordCatalog:async()=>{reads++;return[];},listBusinessRecords:async()=>{reads++;return{};},readBusinessRecord:async()=>{reads++;return{};},recordHistory:async()=>[],saveBusinessRecord:async()=>{writes++;return{};},reviewResolutionData:async()=>{reads++;return{};},resolveGoogleReview:async()=>{writes++;return{};}});
  return {api,writes:()=>writes,reads:()=>reads};
}
for(const path of ['app/api/admin/records/route.js','app/api/admin/google-reviews/resolve/route.js']){
  test(path+' rejects unauthenticated, cross-site, unavailable, limited and unbounded writes before provider access',async()=>{
    const request=(origin='https://example.com',body='{}')=>new Request('https://example.com/api/admin/test/',{method:'POST',headers:{...(origin?{origin}:{}),'Content-Type':'application/json'},body});
    for(const [settings,req,status] of [[{authorized:false},request(),401],[{},request('https://evil.test'),403],[{},request(null),403],[{unavailable:true},request(),503],[{limited:true},request(),429],[{},request(undefined,JSON.stringify({value:'x'.repeat(70000)})),413],[{},request(undefined,'[]'),400]]){
      const r=runtime(path,settings);assert.equal((await r.api.POST(req)).status,status);assert.equal(r.writes(),0);assert.equal(r.reads(),0);
    }
    const r=runtime(path,{authorized:false});assert.equal((await r.api.GET(new Request('https://example.com'))).status,401);assert.equal(r.reads(),0);
  });
  test(path+' permits owner-only same-origin saves and sends private uncached responses',async()=>{const r=runtime(path);const response=await r.api.POST(new Request('https://example.com/api/admin/test/',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'}));assert.equal(response.status,200);assert.equal(r.writes(),1);assert.match(response.headers.get('cache-control'),/no-store/);});
}
test('explicit review IDs resolve duplicate names, ignored decisions stay excluded and stale customer IDs do not guess a replacement',()=>{
  const records=[{id:'one',fields:{'Client Name':'First','Google Review Aliases':'Shared'}},{id:'two',fields:{'Client Name':'Second','Google Review Aliases':'Shared'}}];
  const review={reviewId:'real-review',reviewer:{displayName:'Shared'},comment:'Evidence'};
  assert.equal(matchGoogleReviews(records,[review]).ambiguous.length,1);
  const chosen=matchGoogleReviews(records,[review],{'real-review':{action:'assign',recordId:'two'}});
  assert.equal(chosen.matches[0].record.id,'two');assert.equal(chosen.ambiguous.length,0);
  const ignored=matchGoogleReviews(records,[review],{'real-review':{action:'ignore',reason:'No customer relationship'}});assert.equal(ignored.matches.length,0);assert.equal(ignored.ignored.length,1);
  const missing=matchGoogleReviews(records,[review],{'real-review':{action:'assign',recordId:'gone'}});assert.equal(missing.matches.length,0);assert.equal(missing.unmatched.length,1);
});
