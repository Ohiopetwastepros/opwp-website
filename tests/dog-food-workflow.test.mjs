import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import {foodProfileComplete,FOOD_STATES} from '../lib/dog-food-profile.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import workflowSchema from '../data/dog-food-workflow-schema.json' with {type:'json'};
import {fixture} from './helpers/dog-food-fixture.mjs';
import * as food from '../lib/dog-food-account.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
import {readFoodPlanning} from '../lib/dog-food-sales-intelligence.mjs';
import * as checkout from '../lib/dog-food-checkout.mjs';
import * as cadence from '../lib/dog-food-cadence.mjs';
const source=name=>fs.readFileSync(new URL('../lib/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
async function setup(routes=false,{sendEmail,charge}={}) {
  const f=fixture(undefined,{routes});
  if(!routes)f.sql.exec(`CREATE TABLE IF NOT EXISTS route_partner_plan_events(id TEXT,organization_id TEXT,event_type TEXT,actor_email TEXT,details TEXT);`);
  await f.service.syncFoodOperations(f.env,{force:true});
  const sends=[];
  const base={readFoodPlanning,foodProfileComplete,FOOD_STATES,locateFoodAddress:async()=>null,readFoodDeliveryChoices:async()=>({deliveryAvailable:true,days:[1,2,3,4,5].map(weekday=>({weekday})),tonyDates:[]}),...logic,...food,...checkout,...cadence,...f.service,crypto,Date,Map,URL,URLSearchParams,JSON,TextEncoder,Buffer,workflowSchema,getDb:()=>f.db};
  const payments=runPrivateInNewContext(source('dog-food-payments.js')+'\n({recordDogFoodPayment,activateDogFoodSubscriptionFromOrder})',base);
  const field=runPrivateInNewContext(source('field-operations.js')+'\n({prepareFieldRelease})',{...base,OPWP_ORGANIZATION_ID:'org-opwp',FieldError:logic.FoodError});
  const fulfillment=runPrivateInNewContext(source('dog-food-fulfillment.js')+'\n({reserveFoodLots,checkFoodLotReconciliation,scheduleFoodOrders,foodFulfillmentCommand})',{...base,...field,...payments});
  const portal=runPrivateInNewContext(source('dog-food-portal.js')+'\n({readFoodPortal,saveFoodProfile,createFoodPortalOrder,manageFoodSubscription})',{...base,...fulfillment});
  const workflow=runPrivateInNewContext(source('dog-food-workflow.js')+'\n({flushFoodProjections,flushFoodEmails,upsertFoodProjection})',{...base,sendTransactionalEmail:async(env,message)=>{sends.push(message);return sendEmail?sendEmail(message,sends.length):'email_'+sends.length;}});
  const renewals=runPrivateInNewContext(source('dog-food-renewals.js')+'\n({runScheduledDogFoodRenewals})',{...base,...fulfillment,...payments,console,stripeConfigured:()=>true,createStripePaymentIntent:charge||(()=>{throw new Error('No test charge configured');})});
  const events=runPrivateInNewContext(source('stripe-events.js')+'\n({processStripeEvent})',{...base,...payments,retrieveStripePaymentMethod:async()=>({id:'pm_test',customer:'cus_test',card:{brand:'visa',last4:'4242'}})});
  f.sql.exec("UPDATE dog_food_workflow_settings SET posting_enabled=1,email_enabled=1; UPDATE dog_food_products SET retail_price_cents=5900 WHERE id='edf-22-12-pink-40';");
  f.sql.prepare(`INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by) VALUES ('lot','edf-22-12-pink-40','TEST-LOT','2030-01-01',8,?,'test')`).run(logic.foodDate());
  // In-memory mailbox and synthetic test-only passphrase; no production credentials.
  let access;
  await food.beginFoodEmail(f.db,{email:'workflow@example.test',kind:'verify',origin:'https://example.test',send:async m=>{access=m;} });
  const temporary=/Temporary password: (\S+)/.exec(access.text)[1];
  const login=await food.loginFoodAccount(f.db,{email:'workflow@example.test',password:temporary});
  assert.equal(login.passwordChangeRequired,true);
  await assert.rejects(food.loginFoodAccount(f.db,{email:'workflow@example.test',password:temporary}));
  const active=await food.redeemFoodEmail(f.db,{token:login.setupToken,password:'Synthetic test-only passphrase!',passwordConfirm:'Synthetic test-only passphrase!'});
  const account=await food.foodAccountSession(f.db,new Headers({cookie:food.foodCookie(active.sessionToken).split(';')[0]}));
  await portal.saveFoodProfile(f.db,account,{profile:{firstName:'Test',lastName:'Buyer',phone:'4195550101',address:'123 Test','city':'Toledo',state:'OH',zip:'43614',placement:'Front door'}});
  f.sql.prepare("UPDATE dog_food_customers SET stripe_customer_id='cus_test' WHERE id=?").run(account.customer_id);
  const create=(plan='on_demand')=>portal.createFoodPortalOrder(f.db,account,{commandId:crypto.randomUUID(),plan,routeWeekday:2,deliverySpeed:'next_day',items:[{productId:'edf-22-12-pink-40',quantity:2}]});
  const event=(type,object,id=crypto.randomUUID())=>events.processStripeEvent({db:f.db,env:f.env,event:{id,type,data:{object}}});
  return {...f,...portal,...workflow,...payments,...events,...fulfillment,...renewals,account,sends,create,event};
}
const intent=(orderId,extra={})=>({id:'pi_test_'+orderId,status:'succeeded',currency:'usd',amount:13253,amount_received:13253,customer:'cus_test',payment_method:'pm_test',metadata:{order_id:orderId},...extra});
test('owner-confirmed full formula count records an exact cutoff and reconciles shared usable lot totals',async()=>{
  const f=fixture();await f.service.syncFoodOperations(f.env,{force:true});
  f.sql.prepare("INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by) VALUES ('count-lot','edf-22-12-pink-40','TEST','2030-01-01',8,?,'test')").run(logic.foodDate());
  const fulfillment=runPrivateInNewContext(source('dog-food-fulfillment.js')+'\n({foodFulfillmentCommand})',{...logic,...f.service,...cadence,crypto});
  await fulfillment.foodFulfillmentCommand(f.env,{action:'finalize_count',productId:'edf-22-12-pink-40',confirm:true},'test');
  const p=(await f.service.readFoodOperations(f.db)).products[0];assert.equal(p.onHand,8);assert.equal(p.confirmed,true);assert.ok(p.countedAt.endsWith('Z'));
  const map=f.service.foodSchema.tables['Inventory Adjustments'].fields;
  assert.equal(f.records['Inventory Adjustments'].at(-1).fields[map['Counted Quantity']],8);
  assert.equal(f.records['Inventory Adjustments'].at(-1).fields[map['Counted At (Website)']],p.countedAt);
});
test('signup activation → profile → order → exact Airtable identities → capture → proof → delivery → refund stays reconciled',async()=>{
  const f=await setup(),o=await f.create();
  assert.equal(o.totalCents,13253);
  assert.equal(f.sql.prepare('SELECT quantity FROM dog_food_lot_allocations WHERE order_id=?').get(o.orderId).quantity,2);
  await f.flushFoodProjections(f.env,{limit:25});
  assert.equal(f.sql.prepare('SELECT last_error FROM dog_food_sync_outbox WHERE last_error IS NOT NULL LIMIT 1').get()?.last_error,undefined);
  const saleMap=f.service.foodSchema.tables.Sales.fields;
  const sales=f.records.Sales.filter(r=>r.fields[saleMap['Website Order ID']]===o.orderId);
  assert.equal(sales.length,1);assert.equal(sales[0].fields[saleMap['Sale Total']],132.53);
  const snapshot=await f.service.readFoodSnapshot(f.db);
  const before=await f.service.readFoodOperations(f.db);assert.equal(before.products[0].onHand,8);assert.equal(before.products[0].reserved,2);
  await f.event('payment_intent.succeeded',intent(o.orderId),'evt_capture');
  assert.equal((await f.event('payment_intent.succeeded',intent(o.orderId),'evt_capture')).duplicate,true);
  assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM dog_food_payments WHERE status='captured'").get().count,1);
  assert.equal(f.sql.prepare('SELECT usable_bags FROM dog_food_stock_lots').get().usable_bags,8);
  const delivery=crypto.randomUUID();
  f.sql.prepare("INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type,status) SELECT ?,id,customer_id,address_id,'2026-10-08','on_demand','assigned' FROM dog_food_orders WHERE id=?").run(delivery,o.orderId);
  assert.throws(()=>f.sql.prepare("UPDATE dog_food_deliveries SET status='delivered' WHERE id=?").run(delivery),/proof/);
  f.sql.exec("INSERT INTO route_partner_route_plans(id,organization_id,service_date,source_provider,source_fingerprint,version,status) VALUES('test-plan','org-opwp','2026-10-08','test','synthetic',1,'draft'); INSERT INTO route_partner_locations(id,route_plan_id,organization_id,location_key,sequence,address) VALUES('test-location','test-plan','org-opwp','test',1,'123 Test, Toledo, OH, 43614');");
  f.sql.prepare("INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,dog_food_delivery_id,status) VALUES ('test-task','test-plan','test-location','org-opwp','dog_food','dog_food_automation',?,'in_progress')").run(delivery);
  f.sql.prepare("UPDATE dog_food_deliveries SET status='out_for_delivery' WHERE id=?").run(delivery);
  f.sql.exec("INSERT INTO route_partner_field_proofs(id,task_id,organization_id,object_key,content_type,byte_size,uploaded_by) VALUES ('test-proof','test-task','org-opwp','synthetic/test-proof.jpg','image/jpeg',128,'synthetic-technician')");
  f.sql.prepare("UPDATE dog_food_deliveries SET status='delivered',delivered_at=CURRENT_TIMESTAMP,proof_photo_url='/api/field/photo/test-proof/' WHERE id=?").run(delivery);
  f.sql.prepare("UPDATE dog_food_deliveries SET status='delivered' WHERE id=?").run(delivery);
  assert.equal(f.sql.prepare('SELECT usable_bags FROM dog_food_stock_lots').get().usable_bags,6);
  const after=await f.service.readFoodOperations(f.db);assert.equal(after.products[0].onHand,6);assert.equal(after.products[0].reserved,0);
  await f.flushFoodProjections(f.env,{limit:25});await f.service.syncFoodOperations(f.env,{force:true});
  assert.equal((await f.service.readFoodOperations(f.db)).products[0].onHand,6);
  await f.flushFoodEmails(f.env);await f.flushFoodEmails(f.env);
  assert.equal(f.sends.filter(m=>m.idempotencyKey.includes('paid:')).length,1);assert.equal(f.sends.filter(m=>m.idempotencyKey.includes('delivered:')).length,1);
  assert.equal(f.sends.filter(m=>m.idempotencyKey.includes('ordered:')||m.idempotencyKey.includes('on_way:')).length,0);
  assert.ok(f.sends.every(m=>m.to==='workflow@example.test'));
  await f.event('charge.refunded',{id:'ch_test',currency:'usd',customer:'cus_test',payment_intent:intent(o.orderId).id,amount_refunded:13253});
  assert.equal(f.sql.prepare('SELECT usable_bags FROM dog_food_stock_lots').get().usable_bags,6);
  assert.equal((await f.service.readFoodOperations(f.db)).products[0].onHand,6);
  assert.equal((await f.readFoodPortal(f.db,f.account)).orders[0].status,'refunded');
  const payload=JSON.stringify(f.records['Website Workflow']);
  for(const forbidden of ['password_hash','sessionToken','pm_test','setupToken','/api/field/photo/'])assert.ok(!payload.includes(forbidden));
});

test('partial refund posts exact net collections without creating a receivable or releasing stock',async()=>{
  const f=await setup(),o=await f.create();await f.event('payment_intent.succeeded',intent(o.orderId));
  await f.flushFoodProjections(f.env,{limit:25});
  await f.event('charge.refunded',{id:'ch_partial',currency:'usd',customer:'cus_test',payment_intent:intent(o.orderId).id,amount_refunded:1000},'evt_partial');
  await f.flushFoodProjections(f.env,{limit:25});
  const m=f.service.foodSchema.tables.Sales.fields,r=f.records.Sales.find(r=>r.fields[m['Website Order ID']]===o.orderId);
  assert.equal(r.fields[m['Payments Received']],122.53);assert.equal(r.fields[m['Website Order State']],'partial_refund');
  const model=await f.service.readFoodOperations(f.db),sale=model.sales.find(s=>s.orderId===o.orderId);
  assert.equal(sale.balanceCents,0);assert.equal(sale.collectedCents,12253);assert.equal(model.products[0].reserved,2);
  await f.event('charge.refunded',{id:'ch_partial',currency:'usd',customer:'cus_test',payment_intent:intent(o.orderId).id,amount_refunded:500});
  assert.equal(f.sql.prepare('SELECT refunded_amount_cents FROM dog_food_payments').get().refunded_amount_cents,1000);
});

test('uncertain email acceptance reuses identical provider request and then requires review',async()=>{
  const f=await setup(false,{sendEmail:()=>{throw new Error('response lost');}});await f.create();
  await f.flushFoodEmails(f.env);f.sql.exec("UPDATE dog_food_transactional_outbox SET next_attempt_at=CURRENT_TIMESTAMP");await f.flushFoodEmails(f.env);
  assert.equal(f.sends.length,2);assert.deepEqual(f.sends[0],f.sends[1]);
  f.sql.exec("UPDATE dog_food_transactional_outbox SET first_attempt_at=datetime('now','-24 hours'),next_attempt_at=CURRENT_TIMESTAMP");
  await f.flushFoodEmails(f.env);assert.equal(f.sends.length,2);assert.equal(f.sql.prepare('SELECT status FROM dog_food_transactional_outbox').get().status,'review');
});

async function duePlan(f) {
  const day=cadence.shiftFoodDays(logic.foodDate(),2),a=f.sql.prepare('SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1').get(f.account.customer_id);
  f.sql.prepare(`INSERT INTO dog_food_subscriptions(id,customer_id,address_id,status,next_charge_at,next_delivery_date,payment_method_token,payment_provider,billing_anchor_day,delivery_cadence) VALUES ('renewal-plan',?,?,'active',?,?,'pm_test','stripe',?,'fixed_day')`).run(f.account.customer_id,a.id,logic.foodDate(),day,Number(day.slice(8)));
  f.sql.exec(("INSERT INTO dog_food_subscription_items(id,subscription_id,product_id,quantity,unit_price_cents) VALUES ('renewal-item','renewal-plan','edf-22-12-pink-40',1,5900); UPDATE dog_food_workflow_settings SET scheduling_enabled=1; INSERT INTO route_partner_members(id,organization_id,email,display_name,role,external_employee_id) VALUES ('" + staffPrivate.primaryShortKey + "','org-opwp','tech@example.test','Tony Test','technician','employee-test')"));
  await f.foodFulfillmentCommand(f.env,{action:'capacity_slot',date:day,memberId:staffPrivate.primaryShortKey,zip:'43614',bagLimit:1,stopLimit:1,confirm:true},'test');return day;
}
test('renewal reserves lot and route capacity before a single charge and advances only after assignment',async()=>{
  let attempts=0,f;
  f=await setup(true,{charge:async request=>{attempts++;assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_capacity_allocations').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_lot_allocations').get().n,1);return intent(request.orderId,{id:'pi_renewal',amount:request.amountCents,amount_received:request.amountCents});}});
  const day=await duePlan(f);
  assert.equal((await f.runScheduledDogFoodRenewals(f.env)).results[0].status,'captured');
  assert.equal(f.sql.prepare('SELECT next_delivery_date FROM dog_food_subscriptions').get().next_delivery_date,day);
  assert.equal((await f.runScheduledDogFoodRenewals(f.env)).results[0].status,'already_paid');assert.equal(attempts,1);
  await f.scheduleFoodOrders(f.env);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_partner_tasks').get().n,1);
  assert.notEqual(f.sql.prepare('SELECT next_delivery_date FROM dog_food_subscriptions').get().next_delivery_date,day);
});
test('renewal timeout retains the same cycle; stale uncertainty and SNG plans never issue another charge',async()=>{
  let attempts=0;const f=await setup(true,{charge:async()=>{attempts++;throw new Error('timeout after provider acceptance');}});await duePlan(f);
  assert.equal((await f.runScheduledDogFoodRenewals(f.env)).results[0].status,'retry_required');
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_subscriptions').get().status,'active');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_payments WHERE status='failed'").get().n,0);
  f.sql.exec("UPDATE dog_food_orders SET renewal_attempted_at=datetime('now','-24 hours')");
  assert.equal((await f.runScheduledDogFoodRenewals(f.env)).results[0].status,'payment_review');assert.equal(attempts,1);
  f.sql.exec("UPDATE dog_food_customers SET sng_client_id='sng-linked'");assert.equal((await f.runScheduledDogFoodRenewals(f.env)).processed,0);assert.equal(attempts,1);
});

test('inactive customers never create a renewal order, reserve stock or issue a Stripe charge',async()=>{
  let attempts=0;const f=await setup(true,{charge:async()=>{attempts++;throw Error('Inactive customer must not charge');}});await duePlan(f);
  const before=f.sql.prepare('SELECT count(*) n FROM dog_food_orders').get().n;
  f.sql.exec("UPDATE dog_food_customers SET status='inactive'");
  assert.equal((await f.runScheduledDogFoodRenewals(f.env)).processed,0);assert.equal(attempts,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_orders').get().n,before);
});
test('lost Airtable write response retries the same stable ID and source revisions remain pending',async()=>{
  const f=await setup();await f.create();f.loseWrite();
  const failed=await f.flushFoodProjections(f.env,{limit:25});assert.ok(failed.results.some(r=>r.status==='failed'));
  f.sql.exec("UPDATE dog_food_sync_outbox SET next_attempt_at=CURRENT_TIMESTAMP,attempts=0");
  await f.flushFoodProjections(f.env,{limit:25});await f.flushFoodProjections(f.env,{limit:25});
  const key=workflowSchema.fields['Stable ID'],keys=f.records['Website Workflow'].map(r=>r.fields[key]);assert.equal(new Set(keys).size,keys.length);
  assert.equal(f.records.Customers.length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM dog_food_sync_outbox WHERE revision>synced_revision').get().count,0);
});
test('foreign failure/expiry events cannot release stock; genuine expiry releases only undelivered allocations',async()=>{
  const f=await setup(),o=await f.create();
  f.sql.prepare("UPDATE dog_food_orders SET stripe_checkout_session_id='cs_test' WHERE id=?").run(o.orderId);
  await assert.rejects(f.event('payment_intent.payment_failed',intent(o.orderId,{status:'requires_payment_method',customer:'cus_other'})));
  await f.event('payment_intent.payment_failed',intent(o.orderId,{status:'requires_payment_method',last_payment_error:{code:'card_declined'}}));
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_orders WHERE id=?').get(o.orderId).status,'payment_failed');
  await assert.rejects(f.event('checkout.session.expired',{id:'cs_test',status:'expired',customer:'cus_other',metadata:{order_id:o.orderId}}));
  await f.event('checkout.session.expired',{id:'cs_test',status:'expired',customer:'cus_test',metadata:{order_id:o.orderId}});
  assert.ok(f.sql.prepare('SELECT released_at FROM dog_food_lot_allocations WHERE order_id=?').get(o.orderId).released_at);
  assert.equal((await f.service.readFoodOperations(f.db)).products[0].reserved,0);
});
test('capacity assignment creates one technician task and monthly plan; no capacity or stock means review',async()=>{
  const f=await setup(true),today=logic.foodDate(),tomorrow=cadence.shiftFoodDays(today,1);
  f.sql.exec(("INSERT INTO route_partner_members(id,organization_id,email,display_name,role,external_employee_id) VALUES ('" + staffPrivate.primaryShortKey + "','org-opwp','tech@example.test','Tony Test','technician','employee-test'); UPDATE dog_food_workflow_settings SET scheduling_enabled=1"));
  const {orderId}=await f.create();await f.event('payment_intent.succeeded',intent(orderId));
  assert.equal((await f.scheduleFoodOrders(f.env)).results[0].status,'review');
  await f.foodFulfillmentCommand(f.env,{action:'capacity_slot',date:tomorrow,memberId:staffPrivate.primaryShortKey,zip:'43614',bagLimit:2,stopLimit:1,confirm:true},'test');
  const scheduled=await f.scheduleFoodOrders(f.env);assert.equal(scheduled.results[0].status,'assigned');
  assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM route_partner_tasks').get().count,1);
  assert.equal(f.sql.prepare('SELECT technician_id FROM dog_food_deliveries').get().technician_id,'employee-test');
  await f.scheduleFoodOrders(f.env);assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM route_partner_tasks').get().count,1);
  await assert.rejects(f.foodFulfillmentCommand(f.env,{action:'capacity_slot',date:tomorrow,memberId:staffPrivate.primaryShortKey,zip:'43614',bagLimit:1,stopLimit:1,confirm:true},'test'),/assigned work/);
  const monthly=await f.createFoodPortalOrder(f.db,f.account,{commandId:crypto.randomUUID(),plan:'subscription',routeWeekday:2,deliverySpeed:'route_day',cadence:'fixed_day',monthDay:Number(tomorrow.slice(8)),billingConsent:true,items:[{productId:'edf-22-12-pink-40',quantity:1}]});
  assert.equal(monthly.totalCents,6357);
  await f.event('payment_intent.succeeded',intent(monthly.orderId,{amount:6357,amount_received:6357}));
  await f.foodFulfillmentCommand(f.env,{action:'capacity_slot',date:tomorrow,memberId:staffPrivate.primaryShortKey,zip:'43614',bagLimit:3,stopLimit:2,confirm:true},'test');
  await f.scheduleFoodOrders(f.env);
  assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM dog_food_subscriptions WHERE payment_provider='stripe'").get().count,1);
  const s=f.sql.prepare('SELECT * FROM dog_food_subscriptions').get();
  assert.equal(s.next_delivery_date,cadence.nextFoodDelivery({...s,next_delivery_date:tomorrow}));
  await f.manageFoodSubscription(f.db,f.account,{action:'cancel',subscriptionId:s.id,confirm:true});
  await f.activateDogFoodSubscriptionFromOrder({db:f.db,orderId:monthly.orderId});
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_subscriptions').get().status,'cancelled');
});
