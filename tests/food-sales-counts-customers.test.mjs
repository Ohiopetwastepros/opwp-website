import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {planFoodSalesCustomers,applyFoodSalesCustomerPlan,readFoodSalesCustomerDirectory} from '../lib/food-sales-customers.mjs';
import * as accounts from '../lib/dog-food-account.mjs';
const pink='edf-22-12-pink-40';
function counts(bags=4){const f=setup({bags});f.sql.exec("DELETE FROM dog_food_stock_lots; UPDATE dog_food_sales_settings SET stock_basis='confirmed_count'");return f;}

test('shared counts reserve unpaid sales and consume only on handoff, with stable retry and no manufactured lots',async()=>{
  const f=counts(),body=await f.payload({items:[{productId:pink,quantity:2}]});
  const result=await f.sales.command(f.db,body,'seller');
  let stock=(await f.service.readFoodOperations(f.db)).products.find(p=>p.websiteId===pink);
  assert.equal(stock.onHand,4);assert.equal(stock.reserved,2);assert.equal(stock.available,2);
  assert.deepEqual(await f.sales.command(f.db,body,'seller'),result);
  const handoff={action:'handoff',commandId:crypto.randomUUID(),orderId:result.orderId,handoffConfirmed:true,receivedBy:'Synthetic Buyer'};
  await f.sales.command(f.db,handoff,'seller');await f.sales.command(f.db,handoff,'seller');
  stock=(await f.service.readFoodOperations(f.db)).products.find(p=>p.websiteId===pink);
  assert.equal(stock.onHand,2);assert.equal(stock.reserved,0);assert.equal(stock.available,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_stock_lots').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_sales_count_allocations').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,0);
});
test('completed pickup and delivery use shared counts once, and overselling rolls back',async()=>{
  for(const method of ['pickup','delivery']){
    const f=counts(1),body=await f.payload({fulfillmentMethod:method,fulfillmentStatus:'completed',handoffConfirmed:true,receivedBy:'Synthetic Buyer',addressId:method==='delivery'?'address':undefined});
    const saved=await f.sales.command(f.db,body,'seller');await f.sales.command(f.db,body,'seller');
    const stock=(await f.service.readFoodOperations(f.db)).products.find(p=>p.websiteId===pink);assert.equal(stock.onHand,0);assert.equal(stock.reserved,0);
    await assert.rejects(f.save(),/inventory/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_orders').get().n,1);assert.ok(saved.orderId);
  }
});
test('concurrent last-bag requests admit one sale, and stock changes block a pending handoff',async()=>{
  const f=counts(1),one=await f.payload(),two=await f.payload();
  const results=await Promise.allSettled([f.sales.command(f.db,one,'seller'),f.sales.command(f.db,two,'other')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const order=results.find(r=>r.status==='fulfilled').value;
  const countField=f.service.foodSchema.tables['Inventory Adjustments'].fields['Counted Quantity'];
  f.records['Inventory Adjustments'][0].fields[countField]=0;await f.service.syncFoodOperations(f.env,{force:true});
  await assert.rejects(f.sales.command(f.db,{action:'handoff',commandId:crypto.randomUUID(),orderId:order.orderId,handoffConfirmed:true,receivedBy:'Buyer'},'seller',{office:true}),/reconciliation/);
});
test('count evidence cannot bypass lot requirements on other orders or be edited',async()=>{
  const f=counts(),saved=await f.save();
  assert.throws(()=>f.sql.prepare('UPDATE dog_food_sales_count_allocations SET quantity=2 WHERE order_id=?').run(saved.orderId),/immutable/);
  assert.throws(()=>f.sql.prepare("UPDATE dog_food_sales_order_metadata SET stock_basis='lots' WHERE order_id=?").run(saved.orderId),/immutable/);
  f.sql.exec("UPDATE dog_food_sales_settings SET stock_basis='lots'");
  await assert.rejects(f.save(),/lot counts/);
});
test('ambiguous shared product mappings cannot exclude a native sale from stock accounting',async()=>{
  const f=counts(),snapshot=JSON.parse(f.sql.prepare("SELECT payload FROM dog_food_ops_snapshots WHERE id='initial'").get().payload);
  snapshot.tables.Products.push({...snapshot.tables.Products[0],id:'duplicate-mapping'});
  f.sql.prepare("UPDATE dog_food_ops_snapshots SET payload=? WHERE id='initial'").run(JSON.stringify(snapshot));
  await assert.rejects(f.save(),/inventory/);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_orders').get().n,0);
});
test('directory import retains missing contact information, merges exact source names, and is replay-safe',async()=>{
  const f=setup(),existing=await readFoodSalesCustomerDirectory(f.db),before=f.sql.prepare('SELECT COUNT(*) n FROM dog_food_accounts').get().n;
  const snapshot={tables:{Customers:[{id:'contact-1',fields:{'Customer Name':'Known Buyer',Email:'known@example.test',Phone:'4195550123'}},{id:'contact-2',fields:{'Customer Name':'Name Only'}}],Sales:[{id:'sale-1',fields:{'Sold To':' Name   Only '}},{id:'sale-2',fields:{'Sold To':'Another Buyer'}}]}};
  const plan=await planFoodSalesCustomers(snapshot,existing);assert.equal(plan.creates.length,3);assert.equal(plan.links.length,4);assert.equal(plan.review.length,0);
  await applyFoodSalesCustomerPlan(f.db,plan,'owner');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_customers WHERE email=''").get().n,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_accounts').get().n,before);
  const links=f.sql.prepare('SELECT * FROM dog_food_sales_customer_sources').all();
  const replay=await planFoodSalesCustomers(snapshot,await readFoodSalesCustomerDirectory(f.db),links);assert.equal(replay.creates.length,0);assert.equal(replay.links.length,0);
  await assert.rejects(applyFoodSalesCustomerPlan(f.db,plan,'owner'),/changed/);
  assert.throws(()=>f.sql.prepare("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES('duplicate','Other','Buyer','known@example.test','')").run(),/UNIQUE/);
});
test('customer portal signup links the imported email only after email verification and leaves name-only contacts separate',async()=>{
  const f=setup(),plan=await planFoodSalesCustomers({tables:{Customers:[{id:'known',fields:{'Customer Name':'Known Buyer',Email:'known@example.test'}},{id:'unknown',fields:{'Customer Name':'Name Only'}}]}},await readFoodSalesCustomerDirectory(f.db));
  await applyFoodSalesCustomerPlan(f.db,plan,'owner');const id=f.sql.prepare("SELECT id FROM dog_food_customers WHERE email='known@example.test'").get().id;
  const before=f.sql.prepare('SELECT COUNT(*) n FROM dog_food_accounts').get().n;let message;
  await accounts.beginFoodEmail(f.db,{email:'known@example.test',kind:'verify',origin:'https://example.test',send:async m=>{message=m;}},1800000000);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_accounts').get().n,before);
  const temporary=message.text.match(/Temporary password: (\S+)/)[1],restricted=await accounts.loginFoodAccount(f.db,{email:'known@example.test',password:temporary},1800000001);
  await accounts.redeemFoodEmail(f.db,{token:restricted.setupToken,password:'A long account password!',passwordConfirm:'A long account password!'},1800000002);
  assert.equal(f.sql.prepare("SELECT customer_id FROM dog_food_accounts WHERE email='known@example.test'").get().customer_id,id);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id WHERE c.email=''").get().n,0);
});
test('name-only staff contacts can record sales without creating portal credentials',async()=>{
  const f=counts();await f.save({customerId:'',newCustomer:{firstName:'New',lastName:'Contact',email:'',phone:''}});
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_customers WHERE email='' AND first_name='New'").get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id WHERE c.first_name='New'").get().n,0);
});
