import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { BillingError } from '../lib/crm-billing.mjs';
import { PaymentsProviderError } from '../lib/payments-provider.mjs';
import { assertNoPaymentSecrets, crmBillingEnabled, verifyBillingUatRelayRequest } from '../lib/crm-billing-security.mjs';
import { readBoundedProviderJson } from '../lib/bounded-body.mjs';
import { localPreviewPaymentOrigin, fakeHostedTokenizerConfig } from '../lib/local-preview-payments.mjs';

const origin='https://example.test',actor='admin@example.test',relaySecret='fixture-relay-secret-32-characters-minimum';
class BillingStoreError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const files={main:'../app/api/admin/crm/billing/route.js',methods:'../app/api/admin/crm/billing/methods/route.js',relay:'../app/api/crm/billing/uat-relay/route.js'};
function fixture(kind='main',{authorized=true,enabled=true,env:overrides={},allowed=true,unavailable=false,failure=null,providerFailure=null}={}){
 const env={APP_ENV:'test',CRM_PAYMENTS_ENV:'uat',ROUTE_OS_BILLING_ENABLED:enabled?'true':'false',CRM_BILLING_UAT_RELAY_SECRET:relaySecret,...overrides},calls=[];
 const invoke=(name,value={})=>async(...args)=>{calls.push({name,args});if(failure)throw failure;return value;};
 const provider={hostedTokenizerConfig:({methodType})=>fakeHostedTokenizerConfig(localPreviewPaymentOrigin(env),methodType)||({provider:'cardpointe',environment:'uat',methodType,origin:'https://fts-uat.cardconnect.com',url:`https://fts-uat.cardconnect.com/itoke/ajax-tokenizer.html?tokenpropname=token`})};
 const context={Response,URL,RangeError,Date,crypto,TextEncoder,Uint8Array,BillingError,BillingStoreError,PaymentsProviderError,assertNoPaymentSecrets,crmBillingEnabled,verifyBillingUatRelayRequest,readBoundedProviderJson,localPreviewPaymentOrigin,
  verifyAdminRequest:async()=>({authorized,email:actor}),getRuntimeEnv:()=>env,getDb:()=>{calls.push({name:'db'});return {};},
  checkRateLimit:async(_request,options)=>{calls.push({name:'rate',options});return {allowed,unavailable};},rateLimitResponse:rate=>Response.json({ok:false,error:'Rate protection unavailable'},{status:rate.unavailable?503:429}),
  billingPaymentsProvider:()=>{calls.push({name:'provider'});if(providerFailure)throw providerFailure;return provider;},
  createFakeQboGateway:()=>{calls.push({name:'qbo_fixture'});return {fixtureOnly:true};},
  readBillingWorkspace:invoke('read',{invoices:[],methods:[],customers:[],settings:{},summary:{},syncIssues:[]}),
  generateMonthlyBillingDrafts:invoke('generate',{generated:[]}),createNewClientBillingInvoice:invoke('new_client',{invoice:{id:'invoice',revision:1,status:'draft'}}),saveBillingSettings:invoke('settings',{settings:{revision:2}}),
  runBillingCommand:invoke('command',{invoice:{id:'invoice',revision:5,status:'approved'},invoices:[{id:'invoice',revision:5,status:'approved'}]}),
  chargeBillingInvoice:invoke('charge',{invoice:{id:'invoice',revision:7,status:'paid'}}),reconcileBillingInvoice:invoke('reconcile',{invoice:{id:'invoice',revision:7,status:'paid'}}),
  scheduleBillingChargeNow:invoke('schedule_now',{invoice:{id:'invoice',revision:6,status:'approved'}}),refundBillingInvoice:invoke('refund',{invoice:{id:'invoice',status:'paid',refundedCents:100}}),
  reconcileBillingAdjustment:invoke('reconcile_adjustment',{invoice:{id:'invoice',status:'paid'}}),queueBillingAccounting:invoke('queue_accounting',{queued:true}),
  setDefaultBillingMethod:invoke('default',{method:{id:'method',isDefault:true}}),syncBillingQbo:invoke('sync',{jobs:[]}),createHostedBillingMethod:invoke('hosted',{method:{profileId:'18854390708079407191',profileAccountId:'1',last4:'4242'}}),recordBillingWebhookHint:invoke('hint',{accepted:true}),
 };
 const source=fs.readFileSync(new URL(files[kind],import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
 return {api:vm.runInNewContext(`${source}\n({${kind==='main'?'GET,POST':'POST'}})`,context),calls};
}
const get=query=>new Request(`${origin}/api/admin/crm/billing/${query||''}`);
const input=(extra={})=>({action:'approve',invoiceId:'invoice',expectedRevision:4,requestId:'7fb4ba3a-c682-4b63-a994-6d7f5d746e3d',reason:'Reviewed invoice',...extra});
function post(body,headers={origin,'content-type':'application/json'},path='/api/admin/crm/billing/'){return new Request(`${origin}${path}`,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});}
const writes=fixture=>fixture.calls.filter(call=>!['rate','db','provider','qbo_fixture'].includes(call.name));

test('billing admin endpoints deny unauthenticated and nonadmin sessions before reading any state',async()=>{
 for(const kind of ['main','methods']){
  const f=fixture(kind,{authorized:false});assert.equal((await f.api.POST(post(input()))).status,401);
  if(kind==='main')assert.equal((await f.api.GET(get())).status,401);
  assert.equal(f.calls.length,0);
 }
});
test('billing APIs remain closed outside explicitly enabled UAT and never touch proposed tables',async()=>{
 for(const env of [{ROUTE_OS_BILLING_ENABLED:'false'},{APP_ENV:'production'},{CRM_PAYMENTS_ENV:'production'},{}]){
  const f=fixture('main',{enabled:false,env}),response=await f.api.GET(get()),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.enabled,false);assert.deepEqual(body.invoices,[]);
  assert.equal((await f.api.POST(post(input()))).status,503);assert.equal(f.calls.length,0);
 }
 assert.equal((await fixture('methods',{enabled:false}).api.POST(post({token:'9412345678904242'}))).status,503);
});
test('billing workspace GET forwards filters, returns safe headers and initializes tokenizer config without charging',async()=>{
 const f=fixture('main',{env:{CARDPOINTE_UAT_BASE_URL:'https://fts-uat.cardconnect.com/cardconnect/rest/'}}),response=await f.api.GET(get('?period=2026-12-01&filter=below_book')),body=await response.json();
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 const read=f.calls.find(call=>call.name==='read');assert.equal(read.args[1].period,'2026-12-01');assert.equal(read.args[1].filter,'below_book');
 assert.equal(body.tokenizerConfigs.card.methodType,'card');assert.equal(body.tokenizerConfigs.ach.methodType,'ach');assert.equal(f.calls.filter(call=>call.name==='charge').length,0);
 const partial=fixture('main',{env:{CARDPOINTE_UAT_BASE_URL:'invalid'},providerFailure:new PaymentsProviderError('uat_configuration','UAT setup required')});
 assert.equal((await (await partial.api.GET(get())).json()).tokenizerConfigs,null);
});

test('the local fake billing workspace exposes only its loopback fake tokenizer and makes no charge', async () => {
 const localOrigin='http://localhost:8787',f=fixture('main',{env:{APP_ENV:'development',CRM_PAYMENTS_PROVIDER:'fake',LOCAL_PREVIEW_ENABLED:'true',LOCAL_PREVIEW_ORIGIN:localOrigin}});
 const response=await f.api.GET(new Request(`${localOrigin}/api/admin/crm/billing/`)),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.tokenizerConfigs.card.provider,'fake');assert.equal(body.tokenizerConfigs.ach.origin,localOrigin);assert.equal(f.calls.some(call=>call.name==='charge'),false);
 const outside=fixture('main',{env:{APP_ENV:'development',CRM_PAYMENTS_PROVIDER:'fake',LOCAL_PREVIEW_ENABLED:'true',LOCAL_PREVIEW_ORIGIN:localOrigin}});
 assert.equal((await (await outside.api.GET(get())).json()).tokenizerConfigs,null);
});
test('cross-site mutations and unavailable rate protection never reach billing services',async()=>{
 for(const kind of ['main','methods']){
  for(const headers of [{},{origin:'https://other.test'},{origin,'sec-fetch-site':'cross-site'}]){
   const f=fixture(kind);assert.equal((await f.api.POST(post(input(),headers))).status,403);assert.equal(f.calls.length,0);
  }
  for(const unavailable of [false,true]){
   const f=fixture(kind,{allowed:false,unavailable});assert.equal((await f.api.POST(post(input()))).status,unavailable?503:429);assert.equal(writes(f).length,0);
   assert.equal(f.calls.find(call=>call.name==='rate').options.failClosed,true);
  }
 }
});
test('billing input must be bounded JSON with a stable request ID and no sensitive nested metadata',async()=>{
 for(const [body,status] of [['{bad',400],['null',400],['[]',400],[JSON.stringify(input({notes:'x'.repeat(65536)})),413],[input({requestId:''}),400],[input({reason:''}),400],[input({nested:{routing_number:'123456789'}}),400],[input({token:'9412345678904242'}),400]]){
  const f=fixture();assert.equal((await f.api.POST(post(body))).status,status);assert.equal(writes(f).length,0);assert.equal(f.calls.some(call=>call.name==='provider'),false);
 }
});
test('draft generation, new-client invoices, settings, and normal approvals never instantiate a processor',async()=>{
 for(const [action,name] of [['generate_monthly','generate'],['create_new_client','new_client'],['save_settings','settings'],['approve','command'],['approve_batch','command'],['retry','command'],['edit','command'],['hold','command'],['void','command'],['credit','command'],['write_off','command'],['refresh','command']]){
  const f=fixture();assert.equal((await f.api.POST(post(input({action,actor:'forged@example.test'})))).status,200);
  const call=f.calls.find(call=>call.name===name);assert.ok(call);assert.equal(call.args[2].actor,actor);assert.ok(Number.isFinite(Date.parse(call.args[2].at)));
  assert.equal(f.calls.some(call=>call.name==='provider'||call.name==='charge'),false);
 }
});
test('approve/retry charge-now happens after durable approval, with updated revision and stable distinct command ID',async()=>{
 for(const action of ['approve','retry']){
  const f=fixture();const body=input({action,chargeNow:true});assert.equal((await f.api.POST(post(body))).status,200);
  assert.deepEqual(writes(f).map(call=>call.name),['command','charge']);
  const charge=f.calls.find(call=>call.name==='charge');assert.equal(charge.args[1],'invoice');assert.equal(charge.args[2].expectedRevision,5);assert.notEqual(charge.args[2].requestId,body.requestId);assert.match(charge.args[2].requestId,/^[a-f0-9-]{36}$/);
  await f.api.POST(post(body));const charges=f.calls.filter(call=>call.name==='charge');assert.equal(charges[0].args[2].requestId,charges[1].args[2].requestId);
 }
});
test('charge-now for an approved invoice records schedule separately before collection',async()=>{
 const f=fixture();assert.equal((await f.api.POST(post(input({action:'charge_now'})))).status,200);
 assert.deepEqual(writes(f).map(call=>call.name),['schedule_now','charge']);assert.equal(f.calls.find(call=>call.name==='charge').args[2].expectedRevision,6);
});
test('refund, reconciliation, defaults and fixture QBO use their separate server actions',async()=>{
 for(const [action,name] of [['refund','refund'],['void_payment','refund'],['reconcile','reconcile'],['reconcile_adjustment','reconcile_adjustment'],['queue_accounting','queue_accounting'],['default_method','default'],['link_method_default','default']]){
  const f=fixture();assert.equal((await f.api.POST(post(input({action})))).status,200);assert.ok(f.calls.some(call=>call.name===name));
  if(['default','queue_accounting'].includes(name))assert.equal(f.calls.some(call=>call.name==='provider'),false);
 }
 const disabled=fixture();assert.equal((await disabled.api.POST(post(input({action:'sync_retry',jobId:'job'})))).status,503);assert.equal(disabled.calls.some(call=>call.name==='qbo_fixture'||call.name==='sync'),false);
 const enabled=fixture('main',{env:{CRM_QBO_FIXTURES_ENABLED:'true'}});assert.equal((await enabled.api.POST(post(input({action:'sync_retry',jobId:'job'})))).status,200);
 const sync=enabled.calls.find(call=>call.name==='sync');assert.equal(sync.args[1].force,true);assert.equal(sync.args[3].gateway.fixtureOnly,true);assert.equal(enabled.calls.some(call=>call.name==='provider'),false);
});
test('hosted-method API forwards only ephemeral token and safe metadata to the profile operation',async()=>{
 const f=fixture('methods'),body={customerId:'customer',token:'9412345678904242',methodType:'card',billingZip:'43601',consent:true,isDefault:true};
 const response=await f.api.POST(post(body)),result=await response.text();assert.equal(response.status,200);assert.doesNotMatch(result,/9412345678904242|token/);
 const operation=f.calls.find(call=>call.name==='hosted');assert.equal(operation.args[1].token,body.token);assert.equal(operation.args[2].actor,actor);
 for(const invalid of [{...body,consent:false},{...body,token:'4111111111111111'},{...body,metadata:{cvv:'123'}},{...body,token:{nested:body.token}},{...body,notes:'x'.repeat(9000)}]){
  const bad=fixture('methods');assert.ok([400,413].includes((await bad.api.POST(post(invalid))).status));assert.equal(writes(bad).length,0);
 }
});
test('billing API errors retain actionable conflicts while hiding private internal details',async()=>{
 const conflict=fixture('main',{failure:new BillingStoreError('Refresh this invoice.',409)});assert.equal((await conflict.api.POST(post(input()))).status,409);
 for(const kind of ['main','methods']){
  const f=fixture(kind,{failure:new Error('SQLITE private@example.test 4111111111111111')}),body=kind==='main'?input():{customerId:'customer',token:'9412345678904242',methodType:'card',consent:true};
  const response=await f.api.POST(post(body));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/SQLITE|private@example|4111111111111111/);
 }
});
test('UAT relay rejects production, missing auth and unavailable rate protection before hint processing',async()=>{
 const hint={eventId:'event',invoiceId:'invoice',orderId:'order'},headers={authorization:`Bearer ${relaySecret}`};
 for(const env of [{APP_ENV:'production'},{CRM_PAYMENTS_ENV:'production'},{ROUTE_OS_BILLING_ENABLED:'false'}]){
  const f=fixture('relay',{env});assert.equal((await f.api.POST(post(hint,headers))).status,503);assert.equal(f.calls.length,0);
 }
 for(const auth of [undefined,'Bearer wrong','Basic wrong']){
  const f=fixture('relay');assert.equal((await f.api.POST(post(hint,auth?{authorization:auth}:{}))).status,401);assert.equal(f.calls.length,0);
 }
 const limited=fixture('relay',{allowed:false,unavailable:true});assert.equal((await limited.api.POST(post(hint,headers))).status,503);assert.equal(writes(limited).length,0);assert.equal(limited.calls.find(call=>call.name==='rate').options.failClosed,true);
});
test('UAT relay accepts identifiers only and cannot mark Paid using a supplied status or amount',async()=>{
 const hint={eventId:'event',invoiceId:'invoice',transactionId:'123456789012',orderId:'order'},headers={authorization:`Bearer ${relaySecret}`};
 for(const bad of [{...hint,status:'paid'},{...hint,amountCents:1},{...hint,raw:{account:'secret'}},{...hint,eventId:''},{eventId:'event',invoiceId:'invoice'}]){
  const f=fixture('relay');assert.equal((await f.api.POST(post(bad,headers))).status,400);assert.equal(writes(f).length,0);assert.equal(f.calls.some(call=>call.name==='provider'),false);
 }
 const f=fixture('relay'),response=await f.api.POST(post(hint,headers));assert.equal(response.status,202);assert.deepEqual(await response.json(),{ok:true,accepted:true});
 const call=f.calls.find(item=>item.name==='hint');assert.deepEqual(Object.keys(call.args[1]),['eventId','invoiceId','transactionId','orderId']);assert.equal(call.args[2].actor,'system:billing-uat-relay');assert.equal(f.calls.some(item=>item.name==='charge'),false);
});
