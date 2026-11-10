import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fixture } from './helpers/dog-food-fixture.mjs';
import { nextFoodDelivery, shiftFoodDays } from '../lib/dog-food-cadence.mjs';
const source = file => fs.readFileSync(new URL('../lib/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function billingFixture() {
  const f=fixture();
  f.sql.exec(`CREATE TABLE IF NOT EXISTS route_partner_plan_events(id TEXT,organization_id TEXT,event_type TEXT,actor_email TEXT,details TEXT);
    INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,stripe_customer_id) VALUES ('buyer','Buyer','One','buyer@example.com','4195550180','cus_buyer');
    INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,is_primary) VALUES ('address','buyer','123 Main','Toledo','OH','43614',1);
    INSERT INTO dog_food_accounts(id,email,customer_id,password_hash) VALUES ('account','buyer@example.com','buyer','hash');
    INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,total_cents,portal_account_id,billing_consent_at,requested_month_day)
      VALUES ('first','EDF-FIRST','buyer','address','subscription','paid',6357,'account',CURRENT_TIMESTAMP,31);
    INSERT INTO dog_food_order_items(id,order_id,product_id,quantity,unit_price_cents,line_total_cents,substitution_policy)
      VALUES ('item','first','edf-22-12-pink-40',1,5900,5900,'none');`);
  const context={crypto,TextEncoder,Date,Number,String,Uint8Array,getDb:()=>f.db,nextFoodDelivery,shiftFoodDays};
  f.payments=runPrivateInNewContext(source('dog-food-payments.js')+'\n({activateDogFoodSubscriptionFromOrder,recordDogFoodPayment})',context);
  f.method={id:'pm_buyer',customer:'cus_buyer',card:{brand:'visa',last4:'4242'}};
  f.events=runPrivateInNewContext(source('stripe-events.js')+'\n({processStripeEvent})',{...context,...f.payments,retrieveStripePaymentMethod:async()=>f.method});
  f.paid=()=>f.sql.exec("INSERT INTO dog_food_payments(id,order_id,provider,idempotency_key,amount_cents,status) VALUES ('paid','first','stripe','first-paid',6357,'captured')");
  f.scheduled=()=>f.sql.exec("INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type,status) VALUES ('delivery','first','buyer','address','2027-01-31','scoop_route','scheduled')");
  return f;
}
test('monthly enrollment requires explicit consent, captured payment and a confirmed delivery',async()=>{
  const f=billingFixture(), activate=()=>f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_buyer'});
  assert.equal((await activate()).reason,'delivery_date_required');f.scheduled();
  assert.equal((await activate()).reason,'captured_payment_required');f.paid();
  f.sql.exec("UPDATE dog_food_orders SET billing_consent_at=NULL");
  assert.equal((await activate()).reason,'billing_consent_required');
  f.sql.exec("UPDATE dog_food_orders SET billing_consent_at=CURRENT_TIMESTAMP");
  const result=await activate();assert.equal(result.nextDelivery,'2027-02-28');
  assert.equal(f.sql.prepare('SELECT billing_anchor_day FROM dog_food_subscriptions').get().billing_anchor_day,31);
  assert.equal((await activate()).reason,'existing_plan_preserved');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_subscriptions').get().n,1);
});

test('late payment or fulfillment cannot enroll an inactive customer into automatic billing',async()=>{
  const f=billingFixture();f.scheduled();f.paid();f.sql.exec("UPDATE dog_food_customers SET status='inactive'");
  const result=await f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_buyer'});
  assert.equal(result.reason,'inactive_customer_review_required');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_subscriptions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,1);
});
test('payment replays cannot resume a cancelled plan or advance the same monthly cycle twice',async()=>{
  const f=billingFixture();f.scheduled();f.paid();
  const {subscriptionId}=await f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_buyer'});
  f.sql.prepare("UPDATE dog_food_orders SET billing_cycle_key='2027-02-28' WHERE id='first'").run();
  await f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_buyer'});
  assert.equal(f.sql.prepare('SELECT next_delivery_date FROM dog_food_subscriptions').get().next_delivery_date,'2027-03-31');
  await f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_buyer'});
  assert.equal(f.sql.prepare('SELECT next_delivery_date FROM dog_food_subscriptions').get().next_delivery_date,'2027-03-31');
  f.sql.prepare("UPDATE dog_food_subscriptions SET status='cancelled',next_delivery_date='2027-02-28' WHERE id=?").run(subscriptionId);
  await f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_buyer'});
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_subscriptions').get().status,'cancelled');
});
test('Stripe captures enforce the order amount, currency, customer and saved-card ownership',async()=>{
  const f=billingFixture();
  const intent={id:'pi_one',status:'succeeded',currency:'usd',amount_received:6357,customer:'cus_buyer',payment_method:'pm_buyer',metadata:{order_id:'first'}};
  const send=object=>f.events.processStripeEvent({db:f.db,env:{},event:{id:crypto.randomUUID(),type:'payment_intent.succeeded',data:{object}}});
  for(const changed of [{amount_received:1},{currency:'eur'},{customer:'cus_other'},{status:'processing'}])await assert.rejects(send({...intent,...changed}));
  f.method.customer='cus_other';await assert.rejects(send(intent));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_payments').get().n,0);
  f.method.customer='cus_buyer';await send(intent);await send(intent);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM dog_food_payments WHERE status='captured'").get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_inventory_movements').get().n,0);
});
test('Stripe card updates reject foreign customers and keep cancelled plans unchanged',async()=>{
  const f=billingFixture();f.scheduled();f.paid();
  await f.payments.activateDogFoodSubscriptionFromOrder({orderId:'first',paymentMethodId:'pm_old'});
  const send=customer=>f.events.processStripeEvent({db:f.db,env:{},event:{id:crypto.randomUUID(),type:'setup_intent.succeeded',data:{object:{id:'seti_one',status:'succeeded',customer,payment_method:'pm_buyer',metadata:{dog_food_customer_id:'buyer'}}}}});
  await assert.rejects(send('cus_other'));
  assert.equal(f.sql.prepare('SELECT payment_method_token FROM dog_food_subscriptions').get().payment_method_token,'pm_old');
  f.sql.exec("UPDATE dog_food_subscriptions SET status='paused'");await send('cus_buyer');
  assert.equal(f.sql.prepare('SELECT payment_method_token FROM dog_food_subscriptions').get().payment_method_token,'pm_buyer');
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_subscriptions').get().status,'paused');
});
