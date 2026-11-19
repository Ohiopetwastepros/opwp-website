import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
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

test('staff HTTP boundary allows new sales and blocks customer mutations and changes to existing sales',async()=>{
  const f=setup();let office=false,commandCalls=0;
  const context=async()=>({env:{DB:f.db,FOOD_SALES_RECORDING_ENABLED:'true'},auth:{office,member:{id:'seller'}}});
  const common={...ledger,...logic,...hub,...accountState,foodSalesContext:context,salesHeaders:{},salesError:e=>Response.json({error:e.message,definitive:e.definitive===true},{status:e.status||500}),readBoundedBytes:async r=>new Uint8Array(await r.arrayBuffer()),Response,URL,TextDecoder};
  const route=vm.runInNewContext(source('app/api/food-sales/route.js')+'\n({GET,POST})',{...common,foodSalesService:{...f.sales,command:async(...args)=>{commandCalls++;return f.sales.command(...args);}}});
  const customers=vm.runInNewContext(source('app/api/food-sales/customers/route.js')+'\n({GET,POST})',common);
  const req=(payload,path='/api/food-sales/')=>new Request(origin+path,{method:'POST',headers:{origin},body:JSON.stringify(payload)});
  for(const action of ['receipt','handoff','correction','refund','return'])assert.equal((await route.POST(req({action,commandId:crypto.randomUUID()}))).status,403);
  const denied=await route.POST(req({action:'receipt',commandId:crypto.randomUUID()}));assert.equal((await denied.json()).definitive,true);
  assert.equal((await route.POST(req({...await f.payload(),newCustomer:{firstName:'Blocked'}}))).status,403);
  for(const action of ['create_customer','update_customer','invite_customer','set_customer_status'])assert.equal((await customers.POST(req({action},'/api/food-sales/customers/'))).status,403);
  const profile=await customers.GET(new Request(origin+'/api/food-sales/customers/?id=buyer'));assert.equal(profile.status,200);assert.equal((await profile.json()).customer.canEditIntake,false);
  assert.equal(commandCalls,0);
  assert.equal((await route.POST(req({action:'quote',items:[{productId:'edf-22-12-pink-40',quantity:1}]}))).status,200);
  const save=await route.POST(req(await f.payload()));assert.equal(save.status,200);assert.equal(commandCalls,1);
  const order=(await save.json()).result;
  office=true;const receipt=await route.POST(req({action:'receipt',orderId:order.orderId,commandId:crypto.randomUUID(),amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true}));assert.equal(receipt.status,200);
});
