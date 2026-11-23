import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {customerBody} from './helpers/food-customer-input.mjs';
import * as auth from '../lib/food-sales-auth.mjs';
import * as staff from '../lib/food-sales-staff.mjs';
import * as ledger from '../lib/food-sales-ledger.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
import * as hub from '../lib/food-customer-hub.mjs';
import * as accountState from '../lib/food-customer-account.mjs';
const origin='https://example.test',password='Approved-sale!2026';
const body=(extra={})=>({action:'invite',commandId:crypto.randomUUID(),name:'Sample Salesperson',email:'salesperson@example.test',confirm:true,...extra});
const source=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const tokenOf=message=>/#setup=([a-f0-9]{64})/.exec(message.text)[1];
const count=(f,table)=>f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
async function staffCustomerApi(){
  const f=setup(),env={DB:f.db,FOOD_SALES_NATIVE_ENABLED:'true',FOOD_SALES_RECORDING_ENABLED:'true'};
  const api=vm.runInNewContext(source('lib/food-sales-api.js')+'\n({foodSalesContext,salesHeaders,salesError})',{
    getRuntimeEnv:()=>env,verifyFoodSalesRequest:auth.verifyFoodSalesRequest,verifyAdminRequest:async()=>({authorized:false}),
    checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>{throw Error('Unexpected rate limit');},...logic,Response,URL,
  });
  const common={...api,...ledger,...logic,...hub,...accountState,readBoundedBytes:async r=>new Uint8Array(await r.arrayBuffer()),Response,URL,TextDecoder};
  const customers=vm.runInNewContext(source('app/api/food-sales/customers/route.js')+'\n({GET,POST})',common);
  const sales=vm.runInNewContext(source('app/api/food-sales/route.js')+'\n({GET,POST})',{...common,foodSalesService:f.sales});
  const signed=await auth.authenticateFoodSales(f.db,'seller@example.test','fixture-only',async()=>true);
  assert.equal(signed.authorized,true);
  const headers={cookie:auth.FOOD_SALES_COOKIE+'='+signed.token,origin,'Content-Type':'application/json'};
  const post=(payload,extra={})=>customers.POST(new Request(origin+'/api/food-sales/customers/',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(payload)}));
  const get=id=>customers.GET(new Request(origin+'/api/food-sales/customers/?id='+encodeURIComponent(id),{headers}));
  return {...f,api,common,customers,sales,headers,post,get};
}

test('email invitation requires owner approval and a configured sender before changing credentials',async()=>{
  const f=setup(),before=f.sql.prepare('SELECT COUNT(*) n FROM route_partner_members').get().n;let sent=0;
  await assert.rejects(staff.inviteFoodSalesStaff(f.db,body({confirm:false}),'owner',origin,{email:true,sendEmail:async()=>{sent++;}}),/confirm/);
  await assert.rejects(staff.inviteFoodSalesStaff(f.db,body(),'owner',origin,{email:true}),/No account or password was changed/);
  const hash=f.sql.prepare("SELECT password_hash FROM dog_food_sales_credentials WHERE member_id='seller'").get().password_hash;
  await assert.rejects(staff.inviteFoodSalesStaff(f.db,body({email:'seller@example.test',replaceExistingPassword:true}),'owner',origin,{email:true}),/No account or password was changed/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_partner_members').get().n,before);assert.equal(sent,0);
  assert.equal(f.sql.prepare("SELECT password_hash FROM dog_food_sales_credentials WHERE member_id='seller'").get().password_hash,hash);
});

test('approved email has a one-use setup link; replay cannot send twice or expose the raw token',async()=>{
  const f=setup(),request=body(),messages=[];
  const options={email:true,sendEmail:async m=>{messages.push(m);return 'synthetic-accepted';}};
  const result=await staff.inviteFoodSalesStaff(f.db,request,'owner',origin,options);
  assert.equal(result.deliveryStatus,'accepted');assert.equal(result.setupUrl,undefined);assert.equal(messages.length,1);
  assert.equal(messages[0].to,request.email);assert.equal(messages[0].idempotencyKey,'food-staff-invitation:'+request.commandId);
  assert.match(messages[0].text,/add a new dog-food customer/i);
  assert.match(messages[0].text,/edit customer intake details before portal takeover/i);
  assert.doesNotMatch(messages[0].text,/Customer management[^.]*not permitted/i);
  const token=tokenOf(messages[0]);
  assert.equal((await auth.authenticateFoodSales(f.db,request.email,password)).authorized,false);
  const replay=await staff.inviteFoodSalesStaff(f.db,request,'owner',origin,options);assert.equal(replay.reused,true);assert.equal(messages.length,1);
  const stored=JSON.stringify({commands:f.sql.prepare('SELECT * FROM dog_food_sales_commands').all(),audit:f.sql.prepare('SELECT * FROM dog_food_ops_audit').all(),invitations:f.sql.prepare('SELECT * FROM dog_food_sales_invitations').all()});
  assert.equal(stored.includes(token),false);assert.equal(JSON.stringify(result).includes(token),false);
  await auth.activateFoodSalesPassword(f.db,{token,password,passwordConfirm:password});
  assert.equal((await auth.authenticateFoodSales(f.db,request.email,password)).authorized,true);
  await assert.rejects(auth.activateFoodSalesPassword(f.db,{token,password,passwordConfirm:password}),/expired/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_partner_field_credentials WHERE member_id=?').get(result.memberId).n,0);
});

test('uncertain provider acceptance is durable and requires an explicit replacement rather than automatic resend',async()=>{
  const f=setup(),request=body();let sent=0,oldToken;
  const options={email:true,sendEmail:async m=>{sent++;oldToken=tokenOf(m);throw Error('synthetic timeout');}};
  const result=await staff.inviteFoodSalesStaff(f.db,request,'owner',origin,options);assert.equal(result.deliveryStatus,'uncertain');
  assert.equal((await staff.inviteFoodSalesStaff(f.db,request,'owner',origin,options)).deliveryStatus,'uncertain');assert.equal(sent,1);
  assert.equal((await staff.readFoodSalesStaff(f.db)).find(m=>m.id===result.memberId).email_status,'uncertain');
  await staff.inviteFoodSalesStaff(f.db,body(),'owner',origin,{email:true,sendEmail:async()=> 'replacement'});
  await assert.rejects(auth.activateFoodSalesPassword(f.db,{token:oldToken,password,passwordConfirm:password}),/expired/);
});

test('master directory distinguishes setup, expiry, active and revoked; revocation invalidates links and sessions',async()=>{
  const f=setup();let message;
  const result=await staff.inviteFoodSalesStaff(f.db,body(),'owner',origin,{email:true,sendEmail:async m=>{message=m;return 'synthetic';}});
  const find=async()=> (await staff.readFoodSalesStaff(f.db)).find(m=>m.id===result.memberId);
  assert.equal((await find()).access_status,'invited');
  f.sql.prepare("UPDATE dog_food_sales_invitations SET expires_at=datetime('now','-1 minute') WHERE member_id=?").run(result.memberId);assert.equal((await find()).access_status,'expired');
  await staff.inviteFoodSalesStaff(f.db,body(),'owner',origin,{email:true,sendEmail:async m=>{message=m;return 'synthetic';}});
  await auth.activateFoodSalesPassword(f.db,{token:tokenOf(message),password,passwordConfirm:password});
  const login=await auth.authenticateFoodSales(f.db,body().email,password),headers=new Headers({cookie:auth.FOOD_SALES_COOKIE+'='+login.token});
  assert.equal((await find()).access_status,'active');assert.equal((await auth.verifyFoodSalesRequest(headers,f.db)).authorized,true);
  const order=await f.save(),total=f.sql.prepare('SELECT total_cents FROM dog_food_orders WHERE id=?').get(order.orderId).total_cents;
  await staff.revokeFoodSalesStaff(f.db,result.memberId,'owner');assert.equal((await find()).access_status,'revoked');assert.equal((await auth.verifyFoodSalesRequest(headers,f.db)).authorized,false);
  assert.equal(f.sql.prepare('SELECT total_cents FROM dog_food_orders WHERE id=?').get(order.orderId).total_cents,total);
  const fresh=await staff.inviteFoodSalesStaff(f.db,body({replaceExistingPassword:true}),'owner',origin,{email:true,sendEmail:async m=>{message=m;return 'synthetic';}});
  await staff.revokeFoodSalesStaff(f.db,fresh.memberId,'owner');await assert.rejects(auth.activateFoodSalesPassword(f.db,{token:tokenOf(message),password,passwordConfirm:password}),/expired/);
  assert.equal(JSON.stringify(await staff.readFoodSalesStaff(f.db)).includes('password_hash'),false);
});

test('staff HTTP boundary allows new sales and blocks changes to existing sales and inline customer creation',async()=>{
  const f=setup();let office=false,commandCalls=0;
  const context=async()=>({env:{DB:f.db,FOOD_SALES_RECORDING_ENABLED:'true'},auth:{office,canEditCustomerIntake:true,member:{id:'seller'}}});
  const common={...ledger,...logic,...hub,...accountState,foodSalesContext:context,salesHeaders:{},salesError:e=>Response.json({error:e.message,definitive:e.definitive===true},{status:e.status||500}),readBoundedBytes:async r=>new Uint8Array(await r.arrayBuffer()),Response,URL,TextDecoder};
  const route=vm.runInNewContext(source('app/api/food-sales/route.js')+'\n({GET,POST})',{...common,foodSalesService:{...f.sales,command:async(...args)=>{commandCalls++;return f.sales.command(...args);}}});
  const customers=vm.runInNewContext(source('app/api/food-sales/customers/route.js')+'\n({GET,POST})',common);
  const req=(payload,path='/api/food-sales/')=>new Request(origin+path,{method:'POST',headers:{origin},body:JSON.stringify(payload)});
  for(const action of ['receipt','handoff','correction','refund','return'])assert.equal((await route.POST(req({action,commandId:crypto.randomUUID()}))).status,403);
  const denied=await route.POST(req({action:'receipt',commandId:crypto.randomUUID()}));assert.equal((await denied.json()).definitive,true);
  assert.equal((await route.POST(req({...await f.payload(),newCustomer:{firstName:'Blocked'}}))).status,403);
  for(const action of ['invite_customer','set_customer_status','link_portal_account','delete_customer','delete','charge','refund','return','receipt','handoff','correction','inventory','staff_access','settings'])assert.equal((await customers.POST(req({action},'/api/food-sales/customers/'))).status,403,action);
  const profile=await customers.GET(new Request(origin+'/api/food-sales/customers/?id=buyer'));assert.equal(profile.status,200);assert.equal((await profile.json()).customer.canEditIntake,false);
  assert.equal(commandCalls,0);
  assert.equal((await route.POST(req({action:'quote',items:[{productId:'edf-22-12-pink-40',quantity:1}]}))).status,200);
  const save=await route.POST(req(await f.payload()));assert.equal(save.status,200);assert.equal(commandCalls,1);
  const order=(await save.json()).result;
  office=true;const receipt=await route.POST(req({action:'receipt',orderId:order.orderId,commandId:crypto.randomUUID(),amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true}));assert.equal(receipt.status,200);
});

test('a verified food-sales viewer can add and edit eligible customer intake without gaining office access or causing operational side effects',async()=>{
  const f=await staffCustomerApi();
  const context=await f.api.foodSalesContext(new Request(origin+'/api/food-sales/customers/',{headers:f.headers}));
  assert.equal(context.auth.canEditCustomerIntake,true);assert.notEqual(context.auth.office,true);
  assert.equal(f.sql.prepare("SELECT role FROM route_partner_members WHERE id='seller'").get().role,'viewer');
  const initial=await f.sales.GET(new Request(origin+'/api/food-sales/',{headers:f.headers}));assert.equal(initial.status,200);
  const data=await initial.json();assert.equal(data.office,false);assert.equal(data.canEditCustomerIntake,true);
  for(const action of ['invite_customer','set_customer_status','link_portal_account','delete_customer','delete','charge','refund','return','receipt','handoff','correction','inventory','staff_access','settings'])assert.equal((await f.post({action,commandId:crypto.randomUUID(),customerId:'buyer'})).status,403,action);
  for(const action of ['receipt','handoff','correction','charge','refund','return','delete'])assert.equal((await f.sales.POST(new Request(origin+'/api/food-sales/',{method:'POST',headers:f.headers,body:JSON.stringify({action,commandId:crypto.randomUUID()})}))).status,403,action);
  assert.equal((await f.sales.POST(new Request(origin+'/api/food-sales/',{method:'POST',headers:f.headers,body:JSON.stringify({...await f.payload(),newCustomer:{firstName:'Blocked'}})}))).status,403);
  const unchangedTables=['dog_food_accounts','dog_food_account_tokens','dog_food_customer_messages','dog_food_sales_invitations','dog_food_orders','dog_food_payments','dog_food_sales_credentials','dog_food_sales_grants'];
  const before=Object.fromEntries(unchangedTables.map(table=>[table,count(f,table)])),calls=f.calls();
  const body=customerBody(),created=await f.post(body);assert.equal(created.status,200);
  const saved=await created.json();assert.equal(saved.customer.canEditIntake,true);assert.equal(saved.customer.email,body.email);assert.deepEqual(saved.messages,[]);
  const profile=await f.get(saved.customer.id);assert.equal(profile.status,200);
  const customer=(await profile.json()).customer;assert.equal(customer.canEditIntake,true);
  const update={...body,action:'update_customer',customerId:customer.id,commandId:crypto.randomUUID(),revision:customer.revision,version:customer.version,firstName:'Updated',notes:'Synthetic revised intake'};
  const edited=await f.post(update);assert.equal(edited.status,200);
  const next=(await edited.json()).customer;assert.equal(next.first_name,'Updated');assert.equal(next.notes,'Synthetic revised intake');assert.equal(next.canEditIntake,true);
  assert.equal(count(f,'dog_food_customers'),2);assert.equal(count(f,'dog_food_customer_commands'),2);
  assert.equal(f.sql.prepare('SELECT updated_by FROM dog_food_customer_profiles WHERE customer_id=?').get(customer.id).updated_by,'seller');
  assert.equal(f.calls(),calls,'customer intake must not call an external provider');
  for(const [table,n] of Object.entries(before))assert.equal(count(f,table),n,table+' unchanged');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_transactional_outbox WHERE status<>'cancelled'").get().n,0);
  const forgedOffice=await f.post(customerBody({email:'blocked@example.test'}),{'X-Food-Office':'1'});assert.equal(forgedOffice.status,401);
});

test('staff intake reports portal takeover accurately and rejects edits while office customer updates remain authorized',async()=>{
  const f=await staffCustomerApi(),profile=await f.get('buyer');assert.equal(profile.status,200);
  const customer=(await profile.json()).customer;assert.equal(customer.canEditIntake,false);
  const body={action:'update_customer',customerId:customer.id,commandId:crypto.randomUUID(),revision:customer.revision||0,version:customer.version,firstName:'Office',lastName:'Buyer',phone:customer.phone,email:customer.email};
  const denied=await f.post(body);assert.equal(denied.status,409);assert.match((await denied.json()).error,/taken over their portal profile/);
  assert.equal(f.sql.prepare("SELECT first_name FROM dog_food_customers WHERE id='buyer'").get().first_name,'Synthetic');
  const owner=vm.runInNewContext(source('app/api/admin/dog-food/customers/route.js')+'\n({GET,POST})',{
    ...f.common,verifyAdminRequest:async()=>({authorized:true,email:'synthetic-owner'}),getRuntimeEnv:()=>({DB:f.db}),checkRateLimit:async()=>({allowed:true}),
  });
  const response=await owner.POST(new Request(origin+'/api/admin/dog-food/customers/',{method:'POST',headers:{origin},body:JSON.stringify(body)}));assert.equal(response.status,200);
  assert.equal((await response.json()).customer.first_name,'Office');
  const create=await owner.POST(new Request(origin+'/api/admin/dog-food/customers/',{method:'POST',headers:{origin},body:JSON.stringify(customerBody())}));assert.equal(create.status,200);
  assert.equal(count(f,'dog_food_customers'),2);assert.equal(count(f,'dog_food_customer_messages'),0);
});

test('dedicated staff customer routes reject unauthenticated, non-staff, revoked and cross-site requests before mutations',async()=>{
  const f=await staffCustomerApi(),request=(headers={},method='POST')=>new Request(origin+'/api/food-sales/customers/'+(method==='GET'?'?id=buyer':''),{method,headers:{origin,...headers},...(method==='POST'?{body:JSON.stringify(customerBody())}:{})});
  for(const headers of [{},{cookie:'opwp_food_session='+'a'.repeat(64)},{cookie:'opwp_field_session='+'b'.repeat(64)}]){
    assert.equal((await f.customers.POST(request(headers))).status,401);assert.equal((await f.customers.GET(request(headers,'GET'))).status,401);
  }
  for(const headers of [{...f.headers,origin:'https://evil.test'},{...f.headers,'sec-fetch-site':'cross-site'}])assert.equal((await f.customers.POST(request(headers))).status,403);
  f.sql.exec("UPDATE dog_food_sales_grants SET enabled=0 WHERE member_id='seller'");
  assert.equal((await f.customers.POST(request(f.headers))).status,401);assert.equal((await f.customers.GET(request(f.headers,'GET'))).status,401);
  assert.equal(count(f,'dog_food_customers'),1);assert.equal(count(f,'dog_food_customer_commands'),0);
});

test('customer intake capability does not authorize staff to use owner customer, inventory, reporting or staff administration APIs',async()=>{
  const f=await staffCustomerApi();
  for(const path of ['app/api/admin/dog-food/customers/route.js','app/api/admin/dog-food/operations/route.js','app/api/admin/dog-food/staff-access/route.js','app/api/admin/dog-food/sales-review/route.js','app/api/admin/dog-food/automation/route.js']){
    const route=vm.runInNewContext(source(path)+'\n({GET,POST})',{...f.common,verifyAdminRequest:async()=>({authorized:false})});
    const url=origin+'/'+path.replace(/^app\//,'').replace(/route\.js$/,'');
    assert.equal((await route.GET(new Request(url,{headers:f.headers}))).status,401,path+' GET');
    assert.equal((await route.POST(new Request(url,{method:'POST',headers:f.headers,body:JSON.stringify({action:'refund'})}))).status,401,path+' POST');
  }
  assert.equal(count(f,'dog_food_customers'),1);assert.equal(count(f,'dog_food_customer_commands'),0);
});
