import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import * as store from '../lib/dog-food-website-store.mjs';
import {backupWebsiteFoodData} from '../lib/dog-food-backups.mjs';
import {requestWebsiteLegacyPlanChange,websiteLegacyPlans} from '../lib/dog-food-legacy-plans.mjs';
async function website(){const f=setup();f.sql.exec(fs.readFileSync(new URL('../schema-proposals/0064_independent_food_backend.sql',import.meta.url),'utf8'));const {snapshot}=await f.service.readFoodSnapshot(f.db),hash=await store.foodBusinessHash(snapshot);f.sql.exec('UPDATE dog_food_store_settings SET writes_paused=1');await store.importWebsiteFoodRecords(f.db,snapshot,{actor:'test-owner',sourceHash:hash,expectedSourceHash:hash,reconciliation:{verified:true},activate:true});f.env.AIRTABLE_API_KEY='';return f;}
const command=extra=>({commandId:crypto.randomUUID(),...extra});
test('import proof compares mixed-case source identifiers in the same canonical order',async()=>{
  const f=setup();f.sql.exec(fs.readFileSync(new URL('../schema-proposals/0064_independent_food_backend.sql',import.meta.url),'utf8'));
  const snapshot={tables:{Customers:['recZ','reca','recA'].map(id=>({id,fields:{'Customer Name':'Synthetic '+id}}))}},hash=await store.foodBusinessHash(snapshot);
  f.sql.exec('UPDATE dog_food_store_settings SET writes_paused=1');const r=await store.importWebsiteFoodRecords(f.db,snapshot,{actor:'owner',sourceHash:hash,expectedSourceHash:hash,reconciliation:{verified:true},activate:true});assert.equal(r.records,3);
});
test('website import retains every original record and stock balance and never calls Airtable',async()=>{
  const f=await website(),calls=f.calls();f.fail();const m=await f.service.readFoodOperations(f.db);assert.equal(m.sync.backend,'website');assert.equal(m.products.find(p=>p.websiteId==='edf-22-12-pink-40').available,8);
  assert.equal((await f.service.syncFoodOperations(f.env)).backend,'website');await assert.rejects(f.service.foodAirtable(f.env,'unused'),/retired/);assert.equal(f.calls(),calls);
  await assert.rejects(store.importWebsiteFoodRecords(f.db,{tables:{}},{actor:'test-owner',sourceHash:'x',expectedSourceHash:'x',reconciliation:{verified:true},activate:true}),/reviewed/);
});
test('stock count, waste and native sale share one independent stock ledger with unchanged prices',async()=>{
  const f=await website();f.sql.exec("UPDATE dog_food_sales_settings SET stock_basis='confirmed_count'");f.fail();await f.service.runFoodCommand(f.env,command({action:'stock_movement',productId:'recPink',type:'Waste',quantity:2,date:new Date().toISOString().slice(0,10),cost:'30',reason:'Damaged sealed bags removed'}),'owner');
  let m=await f.service.readFoodOperations(f.db);assert.equal(m.products.find(p=>p.id==='recPink').available,6);
  const order=await f.save();assert.equal(order.totalCents,6357);m=await f.service.readFoodOperations(f.db);assert.equal(m.products.find(p=>p.id==='recPink').available,5);assert.equal(m.products.find(p=>p.id==='recPink').reserved,1);
});
test('multi-line purchase receipt commits once and later partial receipts add only the actual delta',async()=>{
  const f=await website(),day=new Date().toISOString().slice(0,10),body=command({action:'save_purchase',number:'PO-TEST',supplier:'Example Supplier',date:day,freight:'10',paid:'0',lines:[{productId:'recPink',quantity:10,received:3,cost:'30',receivedDate:day},{productId:'recBlue',quantity:8,received:0,cost:'31',receivedDate:''}]});
  const po=await f.service.runFoodCommand(f.env,body,'owner');assert.deepEqual(await f.service.runFoodCommand(f.env,body,'owner'),po);
  let m=await f.service.readFoodOperations(f.db);assert.equal(m.pos[0].received,3);assert.equal(m.products.find(p=>p.id==='recPink').onHand,11);
  await f.service.runFoodCommand(f.env,{...body,id:po.id,commandId:crypto.randomUUID(),lines:[{...body.lines[0],received:5},body.lines[1]]},'owner');m=await f.service.readFoodOperations(f.db);assert.equal(m.pos[0].received,5);assert.equal(m.products.find(p=>p.id==='recPink').onHand,13);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_business_records WHERE table_name='Restock Log'").get().n,2);
});
test('lost transaction response replays the same completed command without a second waste event',async()=>{
  const f=await website(),original=f.db.batch;let lost=true;f.db.batch=async statements=>{const result=await original(statements);if(lost){lost=false;throw Error('Lost response after commit');}return result;};
  const b=command({action:'stock_movement',productId:'recPink',type:'Waste',quantity:1,date:new Date().toISOString().slice(0,10),cost:'30',reason:'Damaged bag'});const result=await f.service.runFoodCommand(f.env,b,'owner');assert.deepEqual(await f.service.runFoodCommand(f.env,b,'owner'),result);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_business_events').get().n,1);assert.equal((await f.service.readFoodOperations(f.db)).products.find(p=>p.id==='recPink').onHand,7);
});
test('purchase failure rolls back all record, stock and command changes',async()=>{
  const f=await website();f.sql.exec("CREATE TRIGGER reject_test_receipt BEFORE INSERT ON dog_food_business_records WHEN NEW.table_name='Restock Log' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;");const day=new Date().toISOString().slice(0,10);
  await assert.rejects(f.service.runFoodCommand(f.env,command({action:'save_purchase',number:'PO-FAIL',supplier:'Example',date:day,lines:[{productId:'recPink',quantity:5,received:2,cost:'30',receivedDate:day}]}),'owner'),/simulated/);
  for(const t of ['Purchase Orders','Purchase Order Lines','Restock Log'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_business_records WHERE table_name=?').get(t).n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_business_events').get().n,0);
});
test('supplier payments require actual evidence and record only the additional money',async()=>{
  const f=await website(),day=new Date().toISOString().slice(0,10),base={action:'save_purchase',number:'PO-PAY',supplier:'Example',date:day,paid:'100',reference:'supplier-ref-1',paymentDate:day,lines:[{productId:'recPink',quantity:10,received:0,cost:'30'}]};
  await assert.rejects(f.service.runFoodCommand(f.env,command(base),'owner'),/actually paid/);
  const first=await f.service.runFoodCommand(f.env,command({...base,supplierPaymentConfirmed:true}),'owner');
  const second=command({...base,id:first.id,paid:'150',reference:'supplier-ref-2',supplierPaymentConfirmed:true});await f.service.runFoodCommand(f.env,second,'owner');await f.service.runFoodCommand(f.env,second,'owner');
  const m=await f.service.readFoodOperations(f.db);assert.equal(m.pos[0].paidCents,15000);assert.deepEqual(m.pos[0].payments.map(p=>p.amountCents).sort((a,b)=>a-b),[5000,10000]);
  await assert.rejects(f.service.runFoodCommand(f.env,command({...base,id:first.id,paid:'50',supplierPaymentConfirmed:true}),'owner'),/cannot.*decrease|cannot.*reduc|cannot.*lower/i);
});
test('office plans and portal requests share exact customer identity without charges or duplicate enrollment',async()=>{
  const f=await website(),next=new Date().toISOString().slice(0,10),before=f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n;
  const plan=await f.service.runFoodCommand(f.env,command({action:'save_legacy_plan',customerId:'buyer',productId:'recPink',quantity:2,frequency:'Monthly',status:'Active',billingOwner:'manual',next,confirm:true}),'owner');
  assert.equal((await websiteLegacyPlans(f.db,'buyer')).length,1);assert.equal((await websiteLegacyPlans(f.db,'someone-else')).length,0);
  const b={commandId:crypto.randomUUID(),subscriptionId:'legacy:'+plan.id,requestType:'pause',details:'Please pause until next month.'};
  await requestWebsiteLegacyPlanChange(f.db,{customer_id:'buyer'},b);await requestWebsiteLegacyPlanChange(f.db,{customer_id:'buyer'},b);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_legacy_plan_requests').get().n,1);
  await assert.rejects(requestWebsiteLegacyPlanChange(f.db,{customer_id:'someone-else'},{...b,commandId:crypto.randomUUID()}),/not linked/);
  await f.service.runFoodCommand(f.env,command({action:'review_legacy_plan_request',id:b.commandId,status:'completed',officeNote:'Plan state reviewed and recorded separately.',confirm:true}),'owner');
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_legacy_plan_requests').get().status,'completed');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,before);
});
test('native sale receipts use the same payment ledger and replay without changing physical stock',async()=>{
  const f=await website();f.sql.exec("UPDATE dog_food_sales_settings SET stock_basis='confirmed_count'");f.fail();const order=await f.save(),sale=(await f.service.readFoodOperations(f.db)).sales.find(s=>s.orderId===order.orderId);assert.ok(sale);
  const b=command({action:'record_payment',saleId:sale.id,amount:'63.57',method:'Cash',date:new Date().toISOString().slice(0,10),reference:'office-native-receipt-1'});await f.service.runFoodCommand(f.env,b,'owner');await f.service.runFoodCommand(f.env,b,'owner');
  const m=await f.service.readFoodOperations(f.db);assert.equal(m.sales.find(s=>s.id===sale.id).balanceCents,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,1);const p=m.products.find(p=>p.id==='recPink');assert.equal(p.onHand,8);assert.equal(p.available,7);
});
test('private backups verify a read-back and exclude sessions, passwords and active tokens',async()=>{
  const f=await website(),objects=new Map();f.env.FIELD_PROOFS={put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{size:new TextEncoder().encode(objects.get(k)).length,text:async()=>objects.get(k)}:null};
  const saved=await backupWebsiteFoodData(f.env);assert.equal(saved.verified,true);assert.equal(objects.size,1);assert.equal((await backupWebsiteFoodData(f.env)).skipped,true);
  const payload=JSON.parse([...objects.values()][0]);assert.ok(payload.tables.dog_food_business_records);assert.ok(payload.tables.dog_food_orders);assert.ok(!payload.tables.dog_food_accounts);assert.ok(!JSON.stringify(payload).includes('synthetic-test-hash'));
  const clone=setup();clone.sql.exec(fs.readFileSync(new URL('../schema-proposals/0064_independent_food_backend.sql',import.meta.url),'utf8'));
  for(const name of ['dog_food_business_imports','dog_food_business_records'])for(const r of payload.tables[name]){const keys=Object.keys(r);clone.sql.prepare(`INSERT INTO ${name}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>r[k]));}
  assert.equal(clone.sql.prepare('SELECT COUNT(*) n FROM dog_food_business_records').get().n,f.sql.prepare('SELECT COUNT(*) n FROM dog_food_business_records').get().n);
  f.env.FIELD_PROOFS.get=async()=>({size:1,text:async()=>'{"wrong":true}'});await assert.rejects(backupWebsiteFoodData(f.env,{manual:true}),/verification failed/);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_backup_runs WHERE status='failed'").get().n,1);
});
