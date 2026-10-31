import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';
const source=readFileSync(new URL('../app/api/admin/bank-reconciliation/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function api({authorized=true,allowed=true}={}) {
  let actions=0;
  const work=async()=>{actions++;return {};};
  const handlers=runPrivateInNewContext(`${source}\n({GET,POST})`,{Response,Request,URL,RangeError,Object,Array,verifyAdminRequest:async()=>({authorized,email:'owner'}),checkRateLimit:async()=>({allowed}),rateLimitResponse:()=>Response.json({},{status:429}),readBoundedProviderJson,getRuntimeEnv:()=>({}),startBankLink:work,finishBankLink:work,bankBookAccounts:work,mapBankBookAccount:work,reviewBankSettlement:work,runFinancialReconciliation:work,getReconciliationStatus:work});
  return {...handlers,actions:()=>actions};
}
function req({origin='https://site.test',body={action:'check'},type='application/json'}={}) {return new Request('https://site.test/api/admin/bank-reconciliation/',{method:'POST',headers:{origin,'content-type':type},body:JSON.stringify(body)});}
test('unauthenticated/expired/office/field roles fail before financial access',async()=>{
  for(const method of ['GET','POST']){const a=api({authorized:false});assert.equal((await a[method](req())).status,401);assert.equal(a.actions(),0);}
});
test('cross-site, missing origin, rate limits, body bounds and unknown actions fail closed',async()=>{
  for(const [settings,request,status] of [[{},req({origin:'https://evil.test'}),403],[{},req({origin:''}),403],[{allowed:false},req(),429],[{},req({type:'text/plain'}),415],[{},req({body:{action:'check',junk:'x'.repeat(3000)}}),413],[{},req({body:{action:'transfer'}}),400],[{},req({body:{action:'check',organizationId:'other'}}),400]]) {
    const a=api(settings);assert.equal((await a.POST(request)).status,status);assert.equal(a.actions(),0);
  }
});
test('authorized same-origin check is private and executes exactly once',async()=>{
  const a=api();const response=await a.POST(req());assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(a.actions(),1);
});
