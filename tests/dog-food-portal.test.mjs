import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import {foodProfileComplete,FOOD_STATES} from '../lib/dog-food-profile.mjs';
import {foodCheckoutTotals,foodDeliveryPreference,FOOD_DELIVERY_OPTIONS,FOOD_TAX_BASIS_POINTS,foodSameDayOpen} from '../lib/dog-food-checkout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fixture } from './helpers/dog-food-fixture.mjs';
import { FoodAccountError, foodTokenHash } from '../lib/dog-food-account.mjs';
import { nextFoodDelivery, shiftFoodDays, easternFoodDate } from '../lib/dog-food-cadence.mjs';
import {readBoundedProviderJson} from '../lib/bounded-body.mjs';
const source=fs.readFileSync(new URL('../lib/dog-food-portal.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function portalFixture(stock=10) {
  const f=fixture();
  f.sql.exec(`INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES ('buyer','Buyer','One','buyer@example.com','4195550180'),('other','Other','Two','other@example.com','4195550186');
    INSERT INTO dog_food_accounts(id,email,customer_id,password_hash) VALUES ('account','buyer@example.com','buyer','hash');
    INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,is_primary) VALUES ('address','buyer','123 Main','Toledo','OH','43614',1),('other-address','other','321 Main','Toledo','OH','43614',1);
    UPDATE dog_food_products SET retail_price_cents=5900,is_customer_visible=1,is_active=1 WHERE id='edf-22-12-pink-40';`);
  f.sql.exec("UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP; UPDATE dog_food_addresses SET placement_preference='Front door';");
  const model={sync:{dirty:0,last_success_at:new Date().toISOString()},products:[{websiteId:'edf-22-12-pink-40',confirmed:true,onHand:stock,reserved:0}]};
  f.sql.prepare("INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by) VALUES ('lot','edf-22-12-pink-40','TEST','2030-01-01',?,date('now'),'test')").run(stock);
  const fulfillment=runPrivateInNewContext(fs.readFileSync(new URL('../lib/dog-food-fulfillment.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\n({reserveFoodLots,checkFoodLotReconciliation})',{FoodError:FoodAccountError,Date,foodDate:()=>easternFoodDate()});
  f.api=runPrivateInNewContext(source+'\n({readFoodPortal,saveFoodProfile,createFoodPortalOrder,manageFoodSubscription})',{...fulfillment,foodProfileComplete,FOOD_STATES,locateFoodAddress:async()=>null,readFoodDeliveryChoices:async()=>({deliveryAvailable:true,days:[{day:'Tuesday',weekday:2}],tonyDates:[]}),crypto,Map,Date,Number,String,Object,Array,JSON,foodCheckoutTotals,foodDeliveryPreference,FOOD_DELIVERY_OPTIONS,FOOD_TAX_BASIS_POINTS,foodSameDayOpen,FoodAccountError,foodTokenHash,nextFoodDelivery,shiftFoodDays,easternFoodDate,readFoodOperations:async()=>model});
  f.account={id:'account',customer_id:'buyer',email:'buyer@example.com'};
  return f;
}
const body=()=>({commandId:crypto.randomUUID(),plan:'on_demand',routeWeekday:2,deliverySpeed:'route_day',cadence:'service_week',serviceWeek:4,items:[{productId:'edf-22-12-pink-40',quantity:2}],totalCents:1,customerId:'other',addressId:'other-address'});
test('server-owned customer, address, prices and stock are enforced; retry returns one order',async()=>{
  const f=portalFixture(),b=body(),first=await f.api.createFoodPortalOrder(f.db,f.account,b),again=await f.api.createFoodPortalOrder(f.db,f.account,b);
  assert.equal(first.orderId,again.orderId);assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_orders').get().n,1);
  const order=f.sql.prepare('SELECT * FROM dog_food_orders').get();assert.equal(order.customer_id,'buyer');assert.equal(order.address_id,'address');assert.equal(order.total_cents,12714);assert.equal(order.status,'pending_payment');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_deliveries').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_inventory_movements').get().n,0);
  await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...b,items:[{productId:b.items[0].productId,quantity:3}]}),/reference/);
  await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...body(),items:[{productId:'inactive-product',quantity:1}]}),/unavailable/);
});
test('shared order lock and fresh database reservations stop competing orders and oversell',async()=>{
  const f=portalFixture(3);await f.api.createFoodPortalOrder(f.db,f.account,body());await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,body()),/quantity/);
  f.sql.exec("UPDATE dog_food_ops_state SET command_until=datetime('now','+1 minute')");await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,body()),/in progress/);
});

test('one-time expedited checkout stores server fees and delivery tax, ignores claimed amounts, and binds delivery speed to retries',async()=>{
  const f=portalFixture(),b={...body(),deliverySpeed:'next_day',deliveryFeeCents:0,taxCents:0,totalCents:1,cadence:'fixed_day',monthDay:99};
  await f.api.createFoodPortalOrder(f.db,f.account,b);
  const order=f.sql.prepare('SELECT * FROM dog_food_orders').get();
  assert.equal(order.requested_delivery_speed,'next_day');assert.equal(order.delivery_fee_cents,500);
  assert.equal(order.tax_rate_basis_points,775);assert.equal(order.tax_cents,953);assert.equal(order.total_cents,13253);
  assert.equal(order.delivery_cadence,'route_day');assert.equal(order.requested_month_day,null);assert.equal(order.requested_service_week,null);
  assert.match(order.notes,/Next-day requested for/);assert.ok(!order.notes.includes('calendar day'));
  await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...b,deliverySpeed:'route_day'}),/reference/);
  await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...body(),deliverySpeed:'free_express'}),/valid delivery/);
  await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...body(),plan:'subscription',deliverySpeed:'next_day',billingConsent:true}),/Monthly plans/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_orders').get().n,1);
});

test('Stripe checkout receives the persisted food, expedited fee and delivery-inclusive tax; no live provider requests',async()=>{
  const f=portalFixture();f.sql.exec("UPDATE dog_food_customers SET stripe_customer_id='cus_buyer' WHERE id='buyer'");
  const {orderId}=await f.api.createFoodPortalOrder(f.db,f.account,{...body(),deliverySpeed:'next_day',deliveryFeeCents:0,totalCents:1});
  const stripeSource=fs.readFileSync(new URL('../lib/stripe.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  let checkoutForm;
  const stripe=runPrivateInNewContext(stripeSource+'\n({createDogFoodCheckout})',{URL,URLSearchParams,Response,readBoundedProviderJson,getRuntimeEnv:()=>({}),outboundFetch:async(url,options)=>{
    assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
    checkoutForm=options.body;
    return Response.json({id:'cs_test_delivery',url:'https://checkout.stripe.com/c/pay/cs_test_delivery',expires_at:Math.floor(Date.now()/1000)+1800});
  }});
  await stripe.createDogFoodCheckout({db:f.db,orderId,origin:'https://example.test',env:{STRIPE_SECRET_KEY:'sk_test_fixture'}});
  const lines=[0,1,2].map(i=>({amount:Number(checkoutForm.get(`line_items[${i}][price_data][unit_amount]`)),quantity:Number(checkoutForm.get(`line_items[${i}][quantity]`))}));
  assert.deepEqual(lines,[{amount:5900,quantity:2},{amount:500,quantity:1},{amount:953,quantity:1}]);
  assert.equal(lines.reduce((n,i)=>n+i.amount*i.quantity,0),13253);
  assert.match(checkoutForm.get('line_items[1][price_data][product_data][name]'),/Next-day/);
  assert.equal(checkoutForm.get('payment_intent_data[setup_future_usage]'),null);
});
test('profile edits never mutate historical addresses or another customer',async()=>{
  const f=portalFixture();const p={firstName:'New',lastName:'Name',phone:"4195550183",address:'555 New','city':'Toledo',state:'OH',zip:'43614',placement:'Front door'};
  await f.api.saveFoodProfile(f.db,f.account,{profile:p,customerId:'other'});assert.equal(f.sql.prepare("SELECT line1 FROM dog_food_addresses WHERE id='address'").get().line1,'123 Main');assert.equal(f.sql.prepare("SELECT first_name FROM dog_food_customers WHERE id='other'").get().first_name,'Other');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM dog_food_addresses WHERE customer_id='buyer' AND is_primary=1").get().n,1);
});
test('monthly enrollment needs explicit consent and never creates parallel existing SNG or native plans',async()=>{
  const f=portalFixture();await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...body(),plan:'subscription'}),/Authorize/);
  f.sql.exec("UPDATE dog_food_customers SET sng_client_id='rcl_existing' WHERE id='buyer'");await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...body(),plan:'subscription',billingConsent:true}),/migrate/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_orders').get().n,0);
  f.sql.exec("UPDATE dog_food_customers SET sng_client_id=NULL WHERE id='buyer'");await f.api.createFoodPortalOrder(f.db,f.account,{...body(),plan:'subscription',billingConsent:true});await assert.rejects(f.api.createFoodPortalOrder(f.db,f.account,{...body(),plan:'subscription',billingConsent:true}),/monthly food plan/);
});
test('portal responses exclude other customers and card tokens',async()=>{
  const f=portalFixture();await f.api.createFoodPortalOrder(f.db,f.account,body());const mine=await f.api.readFoodPortal(f.db,f.account);assert.equal(mine.orders.length,1);assert.ok(!JSON.stringify(mine).includes('other@example.com'));assert.equal(mine.customer.stripe_payment_method_id,undefined);
  const publicData=await f.api.readFoodPortal(f.db,null);assert.equal(publicData.customer,undefined);assert.equal(publicData.orders,undefined);
});
test('plan changes require ownership, confirmation and billing lease clearance; cancel leaves paid orders untouched',async()=>{
  const f=portalFixture(),id=crypto.randomUUID();f.sql.prepare("INSERT INTO dog_food_subscriptions(id,customer_id,address_id,payment_provider,status,next_delivery_date,next_charge_at) VALUES (?,'buyer','address','stripe','active','2027-01-15','2027-01-13')").run(id);
  await assert.rejects(f.api.manageFoodSubscription(f.db,f.account,{subscriptionId:id,action:'pause'}),/Confirm/);
  await assert.rejects(f.api.manageFoodSubscription(f.db,{...f.account,customer_id:'other'},{subscriptionId:id,action:'pause',confirm:true}),/office/);
  f.sql.exec("UPDATE dog_food_subscriptions SET billing_lease_until=datetime('now','+1 minute')");await assert.rejects(f.api.manageFoodSubscription(f.db,f.account,{subscriptionId:id,action:'pause',confirm:true}),/in progress/);
  f.sql.exec('UPDATE dog_food_subscriptions SET billing_lease_until=NULL');await f.api.manageFoodSubscription(f.db,f.account,{subscriptionId:id,action:'skip',confirm:true});assert.equal(f.sql.prepare('SELECT next_delivery_date FROM dog_food_subscriptions').get().next_delivery_date,'2027-02-15');
  await f.api.manageFoodSubscription(f.db,f.account,{subscriptionId:id,action:'cancel',confirm:true});assert.equal(f.sql.prepare('SELECT status FROM dog_food_subscriptions').get().status,'cancelled');
});
test('customer APIs reject missing/cross-site origins and non-customer sessions before payment or profile writes',async()=>{
  const src=fs.readFileSync(new URL('../app/api/dog-food/account/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');let calls=0;
  const POST=runPrivateInNewContext(src+'\nPOST',{Response,URL,FoodAccountError,getDb:()=>({}),foodAccountSession:async()=>null,protectJsonRequest:async()=>({body:{action:'order'}}),stripeConfigured:()=>{calls++;return true;}});
  const url='https://www.ohiopetwastepros.com/api/dog-food/account/';for(const headers of [{},{origin:'https://evil.test'},{origin:'https://www.ohiopetwastepros.com','sec-fetch-site':'cross-site'}])assert.equal((await POST(new Request(url,{method:'POST',headers}))).status,403);
  for(const cookie of ['', '__Host-opwp-food=expired','opwp_office_session=valid-other-role'])assert.equal((await POST(new Request(url,{method:'POST',headers:{origin:new URL(url).origin,cookie}}))).status,401);assert.equal(calls,0);
});
