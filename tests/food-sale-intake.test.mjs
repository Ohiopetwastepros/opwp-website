import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {customerBody} from './helpers/food-customer-input.mjs';
import {foodCustomerCommand,readStaffFoodCustomerIntake} from '../lib/food-customer-hub.mjs';
import {foodDate} from '../lib/dog-food-operations.mjs';
const office={office:true},staff={staffIntake:true};
test('expanded receipt schema copies old rows exactly and retains immutable payment and capture guards',()=>{
  const f=setup({intakeSchema:false});f.sql.exec(`INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,total_cents) VALUES('old','EDF-OLD','buyer','address','on_demand','pending_payment',6357);
    INSERT INTO dog_food_payments(id,order_id,provider,provider_transaction_id,idempotency_key,amount_cents,status) VALUES('receipt','old','staff_cash','cash-old','cash-old',1000,'captured');
    INSERT INTO dog_food_sales_payment_evidence(payment_id,actor,method,reference,received_at,evidence) VALUES('receipt','seller','cash','cash-old','2026-01-01','{}');`);
  const before=f.sql.prepare('SELECT * FROM dog_food_sales_payment_evidence').get();f.sql.exec(fs.readFileSync(new URL('../schema-proposals/0063_food_sale_intake.sql',import.meta.url),'utf8'));
  assert.deepEqual(f.sql.prepare('SELECT * FROM dog_food_sales_payment_evidence').get(),before);assert.throws(()=>f.sql.exec("UPDATE dog_food_payments SET amount_cents=1 WHERE id='receipt'"),/immutable/);assert.throws(()=>f.sql.exec("DELETE FROM dog_food_payments WHERE id='receipt'"),/cannot be deleted/);
  assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('manual intake saves date, customer type, notes and validated payment status without changing catalog pricing or stock timing',async()=>{
  const f=setup(),c=await foodCustomerCommand(f.db,customerBody(),'seller'),saleDate='2026-01-02';
  const body=await f.payload({customerId:c.id,intakeVersion:2,saleDate,saleCustomerType:'dealer',saleNotes:'Deliver by the side door',paymentStatus:'partial',amountReceivedCents:1000,paymentMethod:'zelle',paymentReference:'zelle-test',paymentReceivedConfirmed:true});
  const result=await f.sales.command(f.db,body,'seller');assert.deepEqual(await f.sales.command(f.db,body,'seller'),result);
  const m=f.sql.prepare('SELECT * FROM dog_food_sales_order_metadata WHERE order_id=?').get(result.orderId);assert.equal(m.sale_date,saleDate);assert.equal(m.customer_type,'dealer');assert.equal(m.sale_notes,'Deliver by the side door');assert.equal(m.payment_status_entered,'partial');assert.equal(result.totalCents,6357);
  assert.equal(m.payment_method_entered,'zelle');
  const model=await f.service.readFoodOperations(f.db);assert.equal(model.sales.find(s=>s.orderId===result.orderId).date,saleDate);assert.equal(model.products.find(p=>p.websiteId==='edf-22-12-pink-40').reserved,1);
  await assert.rejects(f.save({...body,commandId:crypto.randomUUID(),paymentStatus:'paid'}),/must match/);
  await assert.rejects(f.save({...body,commandId:crypto.randomUUID(),saleDate:'2099-01-01'}),/future/);
});
test('unpaid sales retain the selected payment method without inventing a receipt',async()=>{
  const f=setup(),o=await f.save({paymentMethod:'card',paymentStatus:'unpaid'});assert.equal(f.sql.prepare('SELECT payment_method_entered FROM dog_food_sales_order_metadata WHERE order_id=?').get(o.orderId).payment_method_entered,'card');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,0);
});
test('manual digital and card receipts can be partial, never charge a provider, and retain distinct methods and unique references',async()=>{
  const f=setup(),o=await f.save();
  for(const [n,method] of ['venmo','zelle','paypal','card','card'].entries())await f.sales.command(f.db,{action:'receipt',commandId:crypto.randomUUID(),orderId:o.orderId,amountReceivedCents:1000,paymentMethod:method,paymentReference:'processor-'+n,paymentReceivedConfirmed:true},'seller');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,5);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_sales_payment_evidence WHERE method='card'").get().n,2);
  await assert.rejects(f.sales.command(f.db,{action:'receipt',commandId:crypto.randomUUID(),orderId:o.orderId,amountReceivedCents:100,paymentMethod:'card',paymentReference:'4111 1111 1111 1111',paymentReceivedConfirmed:true},'seller'),/never the card number/);
  const other=await f.save();await assert.rejects(f.sales.command(f.db,{action:'receipt',commandId:crypto.randomUUID(),orderId:other.orderId,amountReceivedCents:100,paymentMethod:'card',paymentReference:'processor-3',paymentReceivedConfirmed:true},'seller'));
});
test('staff can complete existing intake until portal takeover; stale edits cannot replace customer-owned details',async()=>{
  const f=setup(),created=await foodCustomerCommand(f.db,customerBody(),'seller');let c=await readStaffFoodCustomerIntake(f.db,created.id);assert.equal(c.canEditIntake,true);assert.equal(c.intakeComplete,true);assert.equal(c.orders,undefined);
  const update=customerBody({action:'update_customer',customerId:c.id,revision:c.revision,version:c.version,address:'789 Updated Street'});
  await foodCustomerCommand(f.db,update,'seller',staff);c=await readStaffFoodCustomerIntake(f.db,c.id);assert.equal(c.addresses[0].line1,'789 Updated Street');
  f.sql.prepare("INSERT INTO dog_food_accounts(id,email,customer_id,password_hash,profile_completed_at) VALUES('new-portal',?,?,'private-hash',CURRENT_TIMESTAMP)").run(c.email,c.id);
  await assert.rejects(foodCustomerCommand(f.db,{...update,commandId:crypto.randomUUID(),revision:c.revision,version:c.version},'seller',staff),/taken over/);
  assert.equal((await readStaffFoodCustomerIntake(f.db,c.id)).canEditIntake,false);
  await foodCustomerCommand(f.db,{...update,commandId:crypto.randomUUID(),revision:c.revision,version:c.version,address:'Office correction'},'owner',office);
});
test('portal preferences prefill from staff intake and customer changes update the same profile without changing office notes or SMS permission',async()=>{
  const f=setup(),c=await foodCustomerCommand(f.db,customerBody(),'seller');f.sql.prepare("INSERT INTO dog_food_accounts(id,email,customer_id,password_hash,profile_completed_at) VALUES('new-portal',?,?,'private-hash',CURRENT_TIMESTAMP)").run('new@example.test',c.id);
  const account={id:'new-portal',customer_id:c.id,email:'new@example.test'},before=f.sql.prepare('SELECT * FROM dog_food_customer_profiles WHERE customer_id=?').get(c.id);
  const sale=await f.save({customerId:c.id,saleDate:'2026-01-02'});
  const portal=await f.readFoodPortal(f.db,account);assert.equal(portal.foodPreferences.dog_count,2);
  assert.equal(portal.orders.find(o=>o.id===sale.orderId).placed_at.slice(0,10),'2026-01-02');
  await f.saveFoodProfile(f.db,account,{profile:{firstName:'New',lastName:'Buyer',phone:'4195550199',address:'456 Example Street',city:'Toledo',state:'OH',zip:'43614',placement:'Front door',placementOther:'',fulfillmentMethod:'pickup',dogCount:'3',frequency:'biweekly'}});
  const after=f.sql.prepare('SELECT * FROM dog_food_customer_profiles WHERE customer_id=?').get(c.id);assert.equal(after.dog_count,3);assert.equal(after.service_frequency,'biweekly');assert.equal(after.notes,before.notes);assert.equal(after.sms_consent_at,before.sms_consent_at);assert.equal(after.revision,before.revision+1);
  assert.equal((await readStaffFoodCustomerIntake(f.db,c.id)).preferred_fulfillment,'pickup');assert.equal(foodDate().length,10);
});
