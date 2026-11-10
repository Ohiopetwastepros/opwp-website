import {foodCustomerCommand} from '../lib/food-customer-hub.mjs';
import {customerBody} from './helpers/food-customer-input.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fixture} from './helpers/dog-food-fixture.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
import * as ledger from '../lib/food-sales-ledger.mjs';
import * as auth from '../lib/food-sales-auth.mjs';
import * as sng from '../lib/food-sales-sng.mjs';
import * as account from '../lib/dog-food-account.mjs';
import * as cadence from '../lib/dog-food-cadence.mjs';
import * as checkout from '../lib/dog-food-checkout.mjs';
import {foodProfileComplete,FOOD_STATES} from '../lib/dog-food-profile.mjs';
import {readFoodPlanning} from '../lib/dog-food-sales-intelligence.mjs';
const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const pink='edf-22-12-pink-40',blue='edf-26-14-blue-40';
const row=(id,fields)=>({id,fields});
import {setup} from './helpers/unified-food-sales-fixture.mjs';

const count=(f,table)=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n;
const payment=(amount,ref='receipt-1')=>({action:'receipt',commandId:crypto.randomUUID(),amountReceivedCents:amount,paymentMethod:'check',paymentReference:ref,paymentReceivedConfirmed:true});
const ingest=(f,id,type,data,verified=true)=>sng.ingestFoodSalesSng(f.db,{eventId:id,eventType:type,body:{type,data},verified});
const invoice=(total=63.57)=>({invoice_id:'invoice-1',client:'sng-client',total:String(total),items:[{description:'Dog Food Pink',quantity:'1.00',unit_amount:'59.00',amount:'59.00'}]});
const accepted=(extra={})=>({client:'sng-client',invoice_id:'invoice-1',reference_number:'sng-payment-1',amount:'63.57',...extra});

test('native staff sale reserves shared lots and leaves unpaid pickup independent of payment',async()=>{
  const f=setup(),o=await f.save();assert.equal(o.totalCents,6357);assert.equal(o.balanceCents,6357);
  const saved=await ledger.foodSalesOrder(f.db,o.orderId);assert.equal(saved.payment_status,'unpaid');assert.equal(saved.handoff_status,'pending');
  assert.equal(count(f,'dog_food_payments'),0);assert.equal(f.sql.prepare("SELECT quantity FROM dog_food_lot_allocations WHERE order_id=?").get(o.orderId).quantity,1);
  assert.equal((await f.service.readFoodOperations(f.db)).products.find(p=>p.websiteId===pink).available,7);
  assert.equal(count(f,'dog_food_sales_order_metadata'),1);assert.equal(f.sql.prepare('SELECT recorded_by FROM dog_food_sales_order_metadata').get().recorded_by,'seller');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM dog_food_transactional_outbox WHERE status<>'cancelled'").get().n,0);
});
test('multiple formulas, new shared customer, delivery, partial and later full receipts',async()=>{
  const f=setup(),created=await foodCustomerCommand(f.db,customerBody(),'seller'),o=await f.save({customerId:created.id,items:[{productId:pink,quantity:2},{productId:blue,quantity:1}],fulfillmentMethod:'delivery',deliveryAddress:{line1:'456 Test',city:'Toledo',state:'OH',postalCode:'43614'},amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true});
  assert.equal(o.totalCents,19071);assert.equal(o.balanceCents,18071);assert.equal(count(f,'dog_food_order_items'),2);
  assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).payment_status,'partial');
  await f.sales.command(f.db,{...payment(18071),orderId:o.orderId},'seller');
  assert.equal(count(f,'dog_food_payments'),2);assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).payment_status,'paid');
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_deliveries').get().status,'scheduled');
});
test('delivered unpaid order is fulfilled but never paid; payment later preserves handoff',async()=>{
  const f=setup(),o=await f.save({fulfillmentMethod:'delivery',fulfillmentStatus:'completed',handoffConfirmed:true,receivedBy:'Synthetic Buyer'});
  const order=await ledger.foodSalesOrder(f.db,o.orderId);assert.equal(order.status,'fulfilled');assert.equal(order.payment_status,'unpaid');assert.equal(order.balance_cents,6357);
  assert.equal(f.sql.prepare("SELECT usable_bags FROM dog_food_stock_lots WHERE id='pink-lot'").get().usable_bags,7);
  await f.sales.command(f.db,{...payment(6357),orderId:o.orderId},'seller');assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).status,'fulfilled');
});
test('pickup handoff consumes stock once; a replay returns original receipt and audit',async()=>{
  const f=setup(),o=await f.save(),body={action:'handoff',commandId:crypto.randomUUID(),orderId:o.orderId,handoffConfirmed:true,receivedBy:'Synthetic Buyer'};
  await f.sales.command(f.db,body,'seller');const audits=count(f,'dog_food_ops_audit');
  await f.sales.command(f.db,body,'seller');assert.equal(count(f,'dog_food_ops_audit'),audits);assert.equal(f.sql.prepare("SELECT usable_bags FROM dog_food_stock_lots WHERE id='pink-lot'").get().usable_bags,7);
  await assert.rejects(f.sales.command(f.db,{...body,commandId:crypto.randomUUID()},'seller'),/office review/);
});
test('lost save response, refreshed submission, stable canonical payload and conflicting ID',async()=>{
  const f=setup(),body=await f.payload({amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true});const saved=await f.sales.command(f.db,body,'seller');
  const retried=await f.sales.command(f.db,Object.fromEntries(Object.entries(body).reverse()),'seller');assert.deepEqual(retried,saved);assert.equal(count(f,'dog_food_orders'),1);assert.equal(count(f,'dog_food_payments'),1);
  await assert.rejects(f.sales.command(f.db,{...body,amountReceivedCents:2000},'seller'),/different content/);
  await assert.rejects(f.sales.command(f.db,body,'other'),/another account/);
});
test('concurrent last-bag orders across staff and portal admit only one commitment',async()=>{
  const f=setup({bags:1}),body=await f.payload();
  const online={commandId:crypto.randomUUID(),plan:'on_demand',fulfillmentMethod:'pickup',deliverySpeed:'route_day',items:[{productId:pink,quantity:1}]};
  const results=await Promise.allSettled([f.sales.command(f.db,body,'seller'),f.createFoodPortalOrder(f.db,{id:'account',customer_id:'buyer'},online)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(count(f,'dog_food_orders'),1);
  assert.equal(f.sql.prepare('SELECT SUM(quantity) q FROM dog_food_lot_allocations WHERE released_at IS NULL').get().q,1);
});
test('database allocation constraint rejects a stale reservation and rolls back orphan order',async()=>{
  const f=setup({bags:1});await f.save();
  assert.throws(()=>f.sql.exec(`BEGIN; INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type) VALUES('race','EDF-RACE','buyer','address','on_demand'); INSERT INTO dog_food_lot_allocations(order_id,lot_id,quantity) VALUES('race','pink-lot',1); COMMIT;`),/sellable/);
  f.sql.exec('ROLLBACK');assert.equal(count(f,'dog_food_orders'),1);
});
test('receipt amount confirmation, references, overpayments and duplicate references are enforced',async()=>{
  const f=setup();await assert.rejects(f.save({amountReceivedCents:1000,paymentMethod:'venmo',paymentReference:'v1'}),/actually received/);assert.equal(count(f,'dog_food_orders'),0);
  const a=await f.save(),b=await f.save();await f.sales.command(f.db,{...payment(1000),orderId:a.orderId},'seller');
  await assert.rejects(f.sales.command(f.db,{...payment(1000),orderId:b.orderId},'seller'),/UNIQUE/);
  await assert.rejects(f.sales.command(f.db,{...payment(6357,'x'),orderId:a.orderId},'seller'),/amount received/);
  await assert.rejects(f.sales.command(f.db,{...payment(1000,''),orderId:a.orderId},'seller'),/reference/);
});
test('Airtable outage cannot lose a native save, receipt or outbox identity',async()=>{
  const f=setup();f.fail();const calls=f.calls(),o=await f.save({amountReceivedCents:6357,paymentMethod:'venmo',paymentReference:'venmo-test',paymentReceivedConfirmed:true});
  assert.equal(f.calls(),calls);assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).balance_cents,0);
  assert.ok(f.sql.prepare("SELECT entity_key FROM dog_food_sync_outbox WHERE entity_key=?").get('order:'+o.orderId));
});
test('staff and online customer history share prices, customers, receipts and stock',async()=>{
  const f=setup();const a=await f.save({amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true});
  const b=await f.createFoodPortalOrder(f.db,{id:'account',customer_id:'buyer'},{commandId:crypto.randomUUID(),plan:'on_demand',fulfillmentMethod:'pickup',deliverySpeed:'route_day',items:[{productId:pink,quantity:1}]});
  assert.equal(b.totalCents,a.totalCents);const history=await f.readFoodPortal(f.db,{id:'account',customer_id:'buyer',email:'buyer@example.test'});
  assert.equal(history.orders.length,2);const staff=history.orders.find(o=>o.id===a.orderId);assert.equal(staff.amount_received_cents,1000);assert.equal(staff.balance_cents,5357);assert.equal(staff.paid_provider,null);
  const model=await f.service.readFoodOperations(f.db);assert.equal(model.products.find(p=>p.websiteId===pink).reserved,2);
});
test('server price changes reject an old quote; no customer totals or tax overrides are accepted',async()=>{
  const f=setup(),body=await f.payload();f.sql.exec('UPDATE dog_food_products SET retail_price_cents=6000');
  await assert.rejects(f.sales.command(f.db,body,'seller'),/Prices changed/);assert.equal(count(f,'dog_food_orders'),0);
  const o=await f.save({total:1,taxBasisPoints:0});assert.equal(o.totalCents,6465);
});
test('refund records actual money separately from a usable physical return',async()=>{
  const f=setup(),o=await f.save({fulfillmentStatus:'completed',handoffConfirmed:true,receivedBy:'Buyer',amountReceivedCents:6357,paymentMethod:'cash',paymentReceivedConfirmed:true});
  const p=f.sql.prepare('SELECT id FROM dog_food_payments').get().id;
  const refund={action:'refund',orderId:o.orderId,paymentId:p,amountCents:6357,reference:'refund-evidence',reason:'Actual refund received by customer',confirm:true,commandId:crypto.randomUUID()};
  await assert.rejects(f.sales.command(f.db,refund,'seller'),/not permitted/);await f.sales.command(f.db,refund,'owner',{office:true});
  assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).balance_cents,0);
  assert.equal((await f.service.readFoodOperations(f.db)).sales.find(s=>s.orderId===o.orderId).refundState,'refunded');
  await assert.rejects(f.sales.command(f.db,{...payment(1,'recharge'),orderId:o.orderId},'seller'),/amount received/);
  assert.equal(f.sql.prepare("SELECT usable_bags FROM dog_food_stock_lots WHERE id='pink-lot'").get().usable_bags,7);
  const returned={action:'return',orderId:o.orderId,lotId:'pink-lot',quantity:1,reference:'return-evidence',reason:'Sealed bag inspected',usable:true,confirm:true,commandId:crypto.randomUUID()};
  await f.sales.command(f.db,returned,'owner',{office:true});await f.sales.command(f.db,returned,'owner',{office:true});
  assert.equal(f.sql.prepare("SELECT usable_bags FROM dog_food_stock_lots WHERE id='pink-lot'").get().usable_bags,8);
  assert.equal((await f.service.readFoodOperations(f.db)).products.find(p=>p.websiteId===pink).onHand,8);
  await assert.rejects(f.sales.command(f.db,{...returned,commandId:crypto.randomUUID(),reference:'another'},'owner',{office:true}),/returned bags/);
});
test('settled records are immutable; correction requests retain original evidence',async()=>{
  const f=setup(),o=await f.save({amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true});
  assert.throws(()=>f.sql.exec('UPDATE dog_food_orders SET total_cents=1'),/locked/);assert.throws(()=>f.sql.exec('UPDATE dog_food_order_items SET quantity=10'),/historical/);
  assert.throws(()=>f.sql.exec('DELETE FROM dog_food_payments'),/cannot be deleted/);
  await f.sales.command(f.db,{action:'correction',commandId:crypto.randomUUID(),orderId:o.orderId,reason:'Review handoff details'},'seller');assert.equal(count(f,'dog_food_sales_review'),1);
  await assert.rejects(f.sales.command(f.db,{action:'receipt',commandId:crypto.randomUUID(),orderId:o.orderId},'other'),/requires the office/);
});
test('unexpired lots and quarantine rules protect both new sales and delayed handoffs',async()=>{
  const f=setup(),o=await f.save();f.sql.exec("UPDATE dog_food_stock_lots SET best_before='2000-01-01' WHERE id='pink-lot'");
  await assert.rejects(f.sales.command(f.db,{action:'handoff',commandId:crypto.randomUUID(),orderId:o.orderId,handoffConfirmed:true,receivedBy:'Buyer'},'seller'),/unexpired/);
  await assert.rejects(f.save(),/reconciliation|unexpired/);assert.equal(count(f,'dog_food_sales_handoffs'),0);
});
test('disabled pricing/rollout policy fails closed',async()=>{
  const f=setup();f.sql.exec('UPDATE dog_food_sales_settings SET enabled=0,pricing_policy=NULL');await assert.rejects(f.save(),/approval/);
});
test('individual staff password login, account lockout, session expiration and namespace isolation',async()=>{
  const f=setup();const login=()=>auth.authenticateFoodSales(f.db,'seller@example.test','123456',async()=>true);
  const signed=await login();assert.equal(signed.authorized,true);const headers=new Headers({cookie:auth.FOOD_SALES_COOKIE+'='+signed.token});
  assert.equal((await auth.verifyFoodSalesRequest(headers,f.db)).authorized,true);
  assert.equal((await auth.verifyFoodSalesRequest(new Headers({cookie:'opwp_office_session='+signed.token}),f.db)).authorized,false);
  f.sql.exec("UPDATE dog_food_sales_sessions SET last_seen_at=datetime('now','-31 minutes')");assert.equal((await auth.verifyFoodSalesRequest(headers,f.db)).authorized,false);
  const again=await login();const h2=new Headers({cookie:auth.FOOD_SALES_COOKIE+'='+again.token});await auth.revokeFoodSalesSession(h2,f.db);assert.equal((await auth.verifyFoodSalesRequest(h2,f.db)).authorized,false);
  for(let i=0;i<5;i++)await auth.authenticateFoodSales(f.db,'seller@example.test','000000',async()=>false);
  assert.equal((await login()).locked,true);
});
test('revoking a grant, resetting credentials or deactivating an account invalidates sessions',async()=>{
  for(const change of ["UPDATE dog_food_sales_grants SET enabled=0 WHERE member_id='seller'","UPDATE dog_food_sales_grants SET revision=revision+1 WHERE member_id='seller'","UPDATE route_partner_members SET status='inactive' WHERE id='seller'","UPDATE dog_food_sales_credentials SET password_version=password_version+1 WHERE member_id='seller'"]) {
    const f=setup(),signed=await auth.authenticateFoodSales(f.db,'seller@example.test','123456',async()=>true);f.sql.exec(change);
    assert.equal((await auth.verifyFoodSalesRequest(new Headers({cookie:auth.FOOD_SALES_COOKIE+'='+signed.token}),f.db)).authorized,false);
  }
});
test('direct food-sales API checks grants, cross-site writes, allowed actions and row ownership',async()=>{
  const f=setup(),env={DB:f.db,FOOD_SALES_NATIVE_ENABLED:'true'};
  const api=vm.runInNewContext(source('lib/food-sales-api.js')+'\n({foodSalesContext,salesError,salesHeaders})',{getRuntimeEnv:()=>env,verifyFoodSalesRequest:auth.verifyFoodSalesRequest,checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({error:'limited'},{status:429}),FoodError:logic.FoodError,Response,URL});
  const route=vm.runInNewContext(source('app/api/food-sales/route.js')+'\n({GET,POST})',{...api,foodSalesService:f.sales,...ledger,...logic,readBoundedBytes:async r=>new Uint8Array(await r.arrayBuffer()),Response,URL,TextDecoder,JSON});
  const unauthorized=await route.GET(new Request('https://example.test/api/food-sales/'));assert.equal(unauthorized.status,401);
  const signed=await auth.authenticateFoodSales(f.db,'seller@example.test','123456',async()=>true),headers={cookie:auth.FOOD_SALES_COOKIE+'='+signed.token,'Content-Type':'application/json',origin:'https://example.test'};
  assert.equal((await route.POST(new Request('https://example.test/api/food-sales/',{method:'POST',headers:{...headers,origin:'https://evil.test'},body:'{}'}))).status,403);
  for(const action of ['delete_native','purchasing','payroll','create_user','refund','return','sync','collection_notify'])assert.equal((await route.POST(new Request('https://example.test/api/food-sales/',{method:'POST',headers,body:JSON.stringify({action})}))).status,403);
  const paused=await route.POST(new Request('https://example.test/api/food-sales/',{method:'POST',headers,body:JSON.stringify({action:'save'})}));
  assert.equal(paused.status,503);assert.equal((await paused.json()).uncertain,false);assert.equal(count(f,'dog_food_orders'),0);
  const o=await f.save(),read=await route.GET(new Request('https://example.test/api/food-sales/?q=Buyer',{headers}));assert.equal(read.status,200);assert.equal((await read.json()).recent[0].id,o.orderId);
  f.sql.exec('UPDATE dog_food_sales_grants SET enabled=0');assert.equal((await route.GET(new Request('https://example.test/api/food-sales/',{headers}))).status,401);
});
test('verified SNG payments require exact invoice link; repeats and different event IDs do not duplicate receipts',async()=>{
  const f=setup(),o=await f.save();await ingest(f,'invoice-event','client:invoice_finalized',invoice());
  assert.equal((await ingest(f,'pay-event','client:client_payment_accepted',accepted())).reason,'invoice_requires_exact_office_order_link');
  await sng.linkFoodSalesInvoice(f.db,{eventId:'invoice-event',orderId:o.orderId,reason:'Verified native order and exact food lines against invoice',confirm:true},'owner');
  assert.equal(count(f,'dog_food_payments'),1);assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).balance_cents,0);
  await ingest(f,'pay-event','client:client_payment_accepted',accepted());await ingest(f,'pay-event-2','client:client_payment_accepted',accepted());assert.equal(count(f,'dog_food_payments'),1);assert.equal(count(f,'dog_food_lot_allocations'),1);
  await assert.rejects(ingest(f,'pay-event','client:client_payment_accepted',accepted({amount:'1.00'})),/content conflict/);
});
test('payment before invoice remains reviewable and settles only after verified invoice and office link',async()=>{
  const f=setup(),o=await f.save();assert.equal((await ingest(f,'pay-first','client:client_payment_accepted',accepted())).reason,'invoice_not_received_yet');
  await ingest(f,'invoice-later','client:invoice_finalized',invoice());assert.equal(count(f,'dog_food_payments'),0);
  await sng.linkFoodSalesInvoice(f.db,{eventId:'invoice-later',orderId:o.orderId,reason:'Exact reviewed source link',confirm:true},'owner');assert.equal(count(f,'dog_food_payments'),1);
});
test('manual payment later imported is linked as evidence, never a second receipt',async()=>{
  const f=setup(),o=await f.save({amountReceivedCents:6357,paymentMethod:'check',paymentReference:'sng-payment-1',paymentReceivedConfirmed:true});
  await ingest(f,'invoice','client:invoice_finalized',invoice());await sng.linkFoodSalesInvoice(f.db,{eventId:'invoice',orderId:o.orderId,reason:'Check reference verified on SNG',confirm:true},'owner');
  const result=await ingest(f,'payment','client:client_payment_accepted',accepted());assert.equal(result.linkedExistingReceipt,true);assert.equal(count(f,'dog_food_payments'),1);
});
test('mixed invoices, missing references, equal-value orders and ambiguous manual payments stay in review',async()=>{
  const f=setup();await f.save();await f.save();
  assert.equal((await ingest(f,'no-invoice','client:client_payment_accepted',accepted({invoice_id:undefined}))).reason,'payment_has_no_invoice_reference');
  const mixed=invoice();mixed.items.push({description:'Weekly scooping',amount:'25.00'});await ingest(f,'mixed','client:invoice_finalized',mixed);
  assert.equal((await ingest(f,'mixed-pay','client:client_payment_accepted',accepted())).reason,'mixed_or_unclassified_invoice');assert.equal(count(f,'dog_food_payments'),0);
  const g=setup(),o=await g.save({amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true});await ingest(g,'inv','client:invoice_finalized',invoice());await sng.linkFoodSalesInvoice(g.db,{eventId:'inv',orderId:o.orderId,reason:'Exact invoice reviewed',confirm:true},'owner');
  assert.equal((await ingest(g,'partial','client:client_payment_accepted',accepted({amount:'10.00'}))).reason,'manual_receipt_may_already_cover_this_payment');assert.equal(count(g,'dog_food_payments'),1);
});
test('unverified SNG evidence and invoices alone cannot create payments or recurring plans',async()=>{
  const f=setup();await f.save();await ingest(f,'unverified','client:client_payment_accepted',accepted(),false);assert.equal(count(f,'dog_food_sales_sng_events'),0);
  await ingest(f,'invoice-only','client:invoice_finalized',invoice());assert.equal(count(f,'dog_food_payments'),0);assert.equal(count(f,'dog_food_subscriptions'),0);
});
test('office links an ambiguous manual receipt to archived SNG evidence without another payment',async()=>{
  const f=setup(),o=await f.save({amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true});
  await ingest(f,'missing-invoice','client:client_payment_accepted',accepted({invoice_id:undefined,amount:'10.00'}));
  const paymentId=f.sql.prepare('SELECT id FROM dog_food_payments').get().id;
  const body={eventId:'missing-invoice',orderId:o.orderId,paymentId,reason:'Office checked the original cash deposit and SNG reference',confirm:true};
  await sng.linkFoodSalesExistingPayment(f.db,body,'owner');await sng.linkFoodSalesExistingPayment(f.db,body,'owner');
  assert.equal(count(f,'dog_food_payments'),1);assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).received_cents,1000);
  assert.equal(f.sql.prepare("SELECT status FROM dog_food_sales_review WHERE source_key='sng-event:missing-invoice'").get().status,'resolved');
});
test('conflicting later invoice versions cannot silently settle an order',async()=>{
  const f=setup(),o=await f.save();await ingest(f,'v1','client:invoice_finalized',invoice());
  await sng.linkFoodSalesInvoice(f.db,{eventId:'v1',orderId:o.orderId,reason:'Original exact food lines reviewed',confirm:true},'owner');
  await ingest(f,'v2','client:invoice_finalized',invoice());
  const changed=invoice();changed.items[0].description='Dog Food Blue instead';await ingest(f,'v3','client:invoice_finalized',changed);
  assert.equal((await ingest(f,'pay','client:client_payment_accepted',accepted())).reason,'conflicting_invoice_versions');assert.equal(count(f,'dog_food_payments'),0);
});
test('absolute session expiry, missing grants and organization isolation fail closed',async()=>{
  const f=setup(),signed=await auth.authenticateFoodSales(f.db,'seller@example.test','123456',async()=>true),h=new Headers({cookie:auth.FOOD_SALES_COOKIE+'='+signed.token});
  f.sql.exec("UPDATE dog_food_sales_sessions SET expires_at=datetime('now','-1 second')");assert.equal((await auth.verifyFoodSalesRequest(h,f.db)).authorized,false);
  f.sql.exec("DELETE FROM dog_food_sales_grants WHERE member_id='seller'");assert.equal((await auth.authenticateFoodSales(f.db,'seller@example.test','123456',async()=>true)).authorized,false);
  const legacy=vm.runInNewContext(source('lib/field-auth.js')+'\n({verifyFieldRequest,verifyOfficeRequest})',{getRuntimeEnv:()=>({}),dedicatedSigningSecret:()=>'synthetic-only',crypto,TextEncoder,Uint8Array,btoa,atob,Date});
  assert.equal((await legacy.verifyFieldRequest(h,f.db)).authorized,false);assert.equal((await legacy.verifyOfficeRequest(h,f.db)).authorized,false);
});
test('food API rate-limit protection fails closed before any record write',async()=>{
  const f=setup(),env={DB:f.db,FOOD_SALES_NATIVE_ENABLED:'true'};
  const api=vm.runInNewContext(source('lib/food-sales-api.js')+'\n({foodSalesContext})',{getRuntimeEnv:()=>env,verifyFoodSalesRequest:async()=>({authorized:true,member:{id:'seller'}}),checkRateLimit:async(request,options)=>{assert.equal(options.failClosed,true);assert.equal(options.identity,'seller');return {allowed:false};},rateLimitResponse:()=>Response.json({error:'limited'},{status:429}),FoodError:logic.FoodError,Response,URL});
  const result=await api.foodSalesContext(new Request('https://example.test/api/food-sales/',{method:'POST',headers:{origin:'https://example.test'}}),{write:true});
  assert.equal(result.response.status,429);assert.equal(count(f,'dog_food_orders'),0);
});
test('Airtable cannot overwrite a D1 customer after a staff sale; projection repairs retain exact identity',async()=>{
  const f=setup(),o=await f.save();
  const cFields=f.service.foodSchema.tables.Customers.fields;
  f.records.Customers.push({id:'recCCCCCCCCCCCCCC',fields:{[cFields['Website Customer ID']]:'buyer',[cFields['Customer Name']]:'Wrong Name',[cFields.Email]:'wrong@example.test',[cFields.Phone]:'000'}});
  await f.service.syncFoodOperations(f.env,{force:true});
  assert.equal(f.sql.prepare("SELECT email FROM dog_food_customers WHERE id='buyer'").get().email,'buyer@example.test');
  assert.equal((await ledger.foodSalesOrder(f.db,o.orderId)).customer_id,'buyer');
});
test('staff reporting projection can run while checkout stays disabled and recovers an Airtable timeout without duplicate lines',async()=>{
  const f=setup();f.env.FOOD_SALES_NATIVE_ENABLED='true';f.sql.exec('UPDATE dog_food_sales_settings SET projection_enabled=1');
  const o=await f.save({amountReceivedCents:1000,paymentMethod:'check',paymentReference:'projection-check',paymentReceivedConfirmed:true});
  const workflow=vm.runInNewContext(source('lib/dog-food-workflow.js')+'\n({flushFoodProjections})',{...logic,...f.service,workflowSchema:JSON.parse(fs.readFileSync(new URL('../data/dog-food-workflow-schema.json',import.meta.url),'utf8')),crypto,URLSearchParams,JSON,Date});
  f.loseWrite();await workflow.flushFoodProjections(f.env,{limit:25});
  f.sql.exec('UPDATE dog_food_sync_outbox SET next_attempt_at=CURRENT_TIMESTAMP');
  await workflow.flushFoodProjections(f.env,{limit:25});await workflow.flushFoodProjections(f.env,{limit:25});
  const fields=f.service.foodSchema.tables.Sales.fields;
  const rows=f.records.Sales.filter(r=>r.fields[fields['Website Order ID']]===o.orderId);assert.equal(rows.length,1,JSON.stringify(f.sql.prepare('SELECT entity_key,last_error FROM dog_food_sync_outbox').all()));assert.equal(rows[0].fields[fields['Payments Received']],10);
  assert.equal(f.sql.prepare('SELECT posting_enabled FROM dog_food_workflow_settings').get().posting_enabled,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_payments').get().n,1);
});
