import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readBoundedBytes} from '../lib/bounded-body.mjs';
import {FoodError} from '../lib/dog-food-operations.mjs';
import {FoodAccountError} from '../lib/dog-food-account.mjs';
import {fixture} from './helpers/dog-food-fixture.mjs';
const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
test('sales planning and shared reviews require an admin, same origin, bounded body and audited command execution',async()=>{
  let authorized=false,allowed=true,calls=0;
  const api=runPrivateInNewContext(source('app/api/admin/dog-food/operations/route.js')+'\n({GET,POST})',{
    Response,URL,TextDecoder,JSON,RangeError,SyntaxError,crypto,readBoundedBytes,FoodError,console:{error:()=>{}},
    verifyAdminRequest:async()=>({authorized,email:'office'}),getRuntimeEnv:()=>({DB:{}}),
    checkRateLimit:async()=>({allowed}),rateLimitResponse:()=>Response.json({ok:false},{status:429}),
    runFoodCommand:async(env,body,actor,execute)=>{assert.equal(actor,'office');calls++;return execute(env);},
    saveInventoryCost:async()=>({message:'Cost evidence saved'}),saveFoodPlanning:async()=>({message:'Planning saved'}),foodCustomerReview:async()=>({message:'Review saved'}),readFoodOperations:async()=>({}),
  });
  const request=(origin,body)=>new Request('https://example.test/api/admin/dog-food/operations/',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body});
  assert.equal((await api.GET(new Request('https://example.test/api/admin/dog-food/operations/'))).status,401);
  assert.equal((await api.POST(request('https://example.test','{"action":"planning_settings"}'))).status,401);
  authorized=true;
  for(const origin of [null,'https://evil.test'])assert.equal((await api.POST(request(origin,'{"action":"customer_review"}'))).status,403);
  assert.equal((await api.POST(request('https://example.test','x'.repeat(16385)))).status,413);
  assert.equal(calls,0);
  allowed=false;assert.equal((await api.POST(request('https://example.test','{"action":"planning_settings"}'))).status,429);assert.equal(calls,0);
  allowed=true;
  for(const action of ['cost_annotation','planning_settings','customer_review'])assert.equal((await api.POST(request('https://example.test',JSON.stringify({action})))).status,200);
  assert.equal(calls,3);
});
test('email recovery preserves the original request and blocks retry after the safe provider window',async()=>{
  const f=fixture();f.sql.exec("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,customer_type) VALUES ('retry-customer','Test','Buyer','retry@example.test','4195550101','on_demand'); INSERT INTO dog_food_transactional_outbox(event_key,customer_id,template,status,recipient,subject,text_body,attempts,first_attempt_at) VALUES ('paid:retry-order','retry-customer','paid','failed','retry@example.test','Original subject','Original text',5,CURRENT_TIMESTAMP)");
  const api=runPrivateInNewContext(source('app/api/admin/dog-food/automation/route.js')+'\n({POST})',{
    Response,URL,TextDecoder,JSON,RangeError,SyntaxError,crypto,readBoundedBytes,FoodError,
    verifyAdminRequest:async()=>({authorized:true,email:'owner'}),getRuntimeEnv:()=>f.env,checkRateLimit:async()=>({allowed:true}),
    runFoodCommand:async(env,body,actor,execute)=>execute(env),readFoodWorkflow:async()=>({}),
  });
  const req=()=>new Request('https://example.test/api/admin/dog-food/automation/',{method:'POST',headers:{Origin:'https://example.test'},body:JSON.stringify({action:'retry_email',key:'paid:retry-order'})});
  assert.equal((await api.POST(req())).status,200);
  const row=f.sql.prepare('SELECT * FROM dog_food_transactional_outbox').get();assert.equal(row.attempts,0);assert.equal(row.subject,'Original subject');assert.equal(row.text_body,'Original text');
  f.sql.exec("UPDATE dog_food_transactional_outbox SET first_attempt_at=datetime('now','-24 hours'),attempts=5");
  assert.equal((await api.POST(req())).status,409);assert.equal(f.sql.prepare('SELECT attempts FROM dog_food_transactional_outbox').get().attempts,5);
});
test('public checkout stays gated and production never accepts a test key or sandbox override',async()=>{
  let enabled=0,checkouts=0,env={STRIPE_SECRET_KEY:'sk_live_testfixture'};
  const db={prepare:q=>({first:async()=>({posting_enabled:enabled,scheduling_enabled:enabled}),bind:()=>({first:async()=>q.includes('dog_food_payments')?null:{id:'owned-order',status:'pending_payment'}})})};
  const api=runPrivateInNewContext(source('app/api/dog-food/account/route.js')+'\n({POST})',{
    Response,URL,FoodAccountError,requireFoodProfile:async()=>({}),getDb:()=>db,getRuntimeEnv:()=>env,foodAccountSession:async()=>({customer_id:'owner'}),stripeConfigured:()=>true,
    protectJsonRequest:async()=>({body:{action:'checkout',orderId:'owned-order'}}),applicationConfig:()=>({siteOrigin:'https://example.test'}),
    createDogFoodCheckout:async()=>{checkouts++;return {checkoutUrl:'https://checkout.stripe.com/test'};},
  });
  const req=host=>new Request(`https://${host}/api/dog-food/account/`,{method:'POST',headers:{Origin:`https://${host}`},body:'{}'});
  assert.equal((await api.POST(req('www.ohiopetwastepros.com'))).status,503);assert.equal(checkouts,0);
  enabled=1;env={STRIPE_SECRET_KEY:'sk_test_fixture',DOG_FOOD_TEST_CHECKOUT:'true'};
  assert.equal((await api.POST(req('www.ohiopetwastepros.com'))).status,503);assert.equal(checkouts,0);
  assert.equal((await api.POST(req('sandbox.example.test'))).status,200);assert.equal(checkouts,1);
  env={STRIPE_SECRET_KEY:'sk_test_fixture'};assert.equal((await api.POST(req('sandbox.example.test'))).status,503);assert.equal(checkouts,1);
  env={STRIPE_SECRET_KEY:'sk_live_fixture'};assert.equal((await api.POST(req('www.ohiopetwastepros.com'))).status,200);assert.equal(checkouts,2);
});
test('workflow controls reject non-admin sessions, cross-site writes and streamed oversized bodies',async()=>{
  let admin=false,calls=0;
  const api=runPrivateInNewContext(source('app/api/admin/dog-food/automation/route.js')+'\n({GET,POST})',{
    Response,URL,TextDecoder,JSON,RangeError,SyntaxError,crypto,readBoundedBytes,FoodError,
    verifyAdminRequest:async()=>({authorized:admin,email:'owner'}),getRuntimeEnv:()=>({DB:{}}),
    checkRateLimit:async()=>({allowed:true}),readFoodWorkflow:async()=>{calls++;return {};},runFoodWebsiteWorkflow:async()=>{calls++;return {};},
  });
  const request=(origin,body)=>new Request('https://example.test/api/admin/dog-food/automation/',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body});
  assert.equal((await api.POST(request('https://example.test','{"action":"run"}'))).status,401);
  admin=true;
  assert.equal((await api.POST(request(null,'{}'))).status,403);
  assert.equal((await api.POST(request('https://evil.test','{}'))).status,403);
  assert.equal((await api.POST(request('https://example.test','x'.repeat(8200)))).status,413);
  assert.equal(calls,0);
});
test('customer proof reads enforce customer ownership and private image responses',async()=>{
  const id=crypto.randomUUID(),binds=[];let signed=false,owned=false;
  const db={prepare:sql=>{assert.match(sql,/o\.customer_id=\?/);assert.match(sql,/organization_id='org-opwp'/);return {bind:(...v)=>{binds.push(v);return {first:async()=>owned?{object_key:'private/proof',storage_provider:'r2',content_type:'image/jpeg'}:null};}};}};
  const api=runPrivateInNewContext(source('app/api/dog-food/proof/[orderId]/route.js')+'\n({GET})',{
    Response,checkRateLimit:async()=>({allowed:true}),getDb:()=>db,foodAccountSession:async()=>signed?{customer_id:'signed-in-customer'}:null,
    getRuntimeEnv:()=>({FIELD_PROOFS:{get:async key=>{assert.equal(key,'private/proof');return {body:new Uint8Array([1,2,3])};}}}),
  });
  const request=new Request('https://example.test/api/dog-food/proof/'+id+'/'),params=Promise.resolve({orderId:id});
  assert.equal((await api.GET(request,{params})).status,401);assert.equal(binds.length,0);
  signed=true;assert.equal((await api.GET(request,{params})).status,404);assert.deepEqual(binds[0],[id,'signed-in-customer']);
  owned=true;const response=await api.GET(request,{params});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
});
