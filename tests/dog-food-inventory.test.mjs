import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {operationModel,FoodError,foodDate,date,integer,text,cents} from '../lib/dog-food-operations.mjs';
import {foodInventoryDashboard,saveInventoryCost,inventoryCostInput,readInventoryCosts,applyInventoryCostReviews} from '../lib/dog-food-inventory.mjs';
import {emptyFoodPlanning,validateFoodPlanning} from '../lib/dog-food-sales-intelligence.mjs';
import {fixture} from './helpers/dog-food-fixture.mjs';
const now=new Date('2026-10-13T16:00:00Z'),row=(id,fields)=>({id,fields});
const product={id:'pink',websiteId:'edf-22-12-pink-40',name:'Pink',color:'Pink',formula:'22-12',weight:40,active:true,onHand:20,reserved:2,available:18};
const sale=(id,quantity,stockDate,extra={})=>({id,productId:'pink',name:'Buyer',quantity,stockDate,date:stockDate,inventoryEligible:true,fulfillment:'Delivered',totalCents:quantity*6000,...extra});
const model=()=>({products:[{...product}],sales:[],pos:[],movements:[],counts:[{id:'checkpoint',productId:'pink',date:'2026-10-12',quantity:20}],issues:[],native:{orders:[]}});
const policy=()=>({...emptyFoodPlanning(),supplierLeadDays:5,safetyDays:5,reviewDays:10,minimumOrderBags:5,orderMultipleBags:2,historyConfirmedFrom:'2026-01-01',historyConfirmedThrough:'2026-10-13',mixedPalletMinimumBags:40,mixedPalletMultipleBags:10});
test('checkpoint cost with unknown actual date has no stock, payment, revenue or duplicate cash effect',async()=>{
  const f=fixture(),m=model(),body={commandId:crypto.randomUUID(),confirm:true,category:'personal_family',productId:'pink',quantity:3,cost:'40',checkpointId:'checkpoint',sourceReference:'distinct-family-use',note:'Already in checkpoint'};
  const stockBefore=f.sql.prepare('SELECT COUNT(*) n FROM dog_food_orders').get().n;
  const out=await saveInventoryCost(f.db,body,'owner',m),c=f.sql.prepare('SELECT * FROM dog_food_cost_annotations WHERE id=?').get(out.id);
  assert.equal(c.actual_date,null);assert.ok(c.created_at);assert.equal(c.unit_cost_cents*c.quantity,12000);
  const v=foodInventoryDashboard(m,{now,costs:[c]});assert.equal(v.costTotals[0].knownCents,12000);assert.equal(v.replenishment[0].onHand,20);assert.equal(m.sales.length,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_orders').get().n,stockBefore);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_payments').get().n,0);
  await assert.rejects(saveInventoryCost(f.db,{...body,commandId:crypto.randomUUID()},'owner',m),/already has/);
  assert.throws(()=>f.sql.prepare('UPDATE dog_food_cost_annotations SET quantity=7 WHERE id=?').run(c.id),/immutable/);
  for(const invalid of [{checkpointId:'foreign'}, {actualDate:'2026-10-13'}, {movementId:'other'}, {category:'spoilage'}, {cost:true}, {quantity:-3}])assert.throws(()=>inventoryCostInput({...body,...invalid},m,'2026-10-13'),FoodError);
});
test('original synthetic sale remains intact and pending personal classification is excluded from customer demand and confirmed costs',()=>{
  const f=fixture(),m=model();m.products[0].id='rec00000000000002';m.sales=[sale('rec00000000000008',2,'2026-03-15',{productId:'rec00000000000002'})];m.movements=[{id:'rec00000000000008',productId:'rec00000000000002',type:'Sale',quantity:-2}];
  const costs=f.sql.prepare('SELECT * FROM dog_food_cost_annotations').all(),v=foodInventoryDashboard(m,{now,costs});
  assert.equal(m.sales[0].totalCents,12000);assert.equal(v.records.length,0);assert.equal(v.costTotals[0].knownCents,0);assert.equal(v.costRows.find(c=>c.movement_id).totalCents,8000);assert.ok(v.issues.some(i=>i.message.includes('separate review')));
});

test('audited owner confirmation resolves exactly the pending entry while preserving original evidence, stock and sales',async()=>{
  const f=fixture(),raw=f.sql.prepare("SELECT * FROM dog_food_cost_annotations WHERE id='fixture-value-007'").get();
  const details={organizationId:'org-opwp',decision:'confirmed',basis:raw,reference:'fixture-owner-confirmation',note:'Owner confirms two Pink bags are personal use, distinct from the three additional bags.'};
  f.sql.prepare(("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES (?,'" + staffPrivate.reliefShort + "','inventory_cost_confirmed',?,?)")).run('confirmation',raw.id,JSON.stringify(details));
  const costs=await readInventoryCosts(f.db),resolved=costs.find(c=>c.id===raw.id);
  assert.equal(resolved.review_status,'confirmed');assert.equal(resolved.original_review_status,'needs_review');assert.equal(resolved.reviewed_by,staffPrivate.reliefShort);assert.match(resolved.note,/distinct from the three/);
  assert.deepEqual(f.sql.prepare('SELECT * FROM dog_food_cost_annotations WHERE id=?').get(raw.id),raw,'The stored annotation remains immutable');
  const m=model();m.products[0].id=raw.product_id;m.counts=[{id:'rec00000000000003',productId:raw.product_id,date:'2026-10-12',quantity:20}];m.sales=[sale(raw.movement_id,2,'2026-03-15',{productId:raw.product_id})];m.movements=[{id:raw.movement_id,productId:raw.product_id,type:'Sale',quantity:-2,date:'2026-03-15'}];
  const before=structuredClone(m),v=foodInventoryDashboard(m,{now,costs});
  assert.deepEqual(m,before);assert.equal(v.costTotals[0].bags,5);assert.equal(v.costTotals[0].knownCents,20000);assert.equal(v.salesReport.total.recordedSalesCents,0);assert.equal(v.records.length,0);assert.equal(v.replenishment[0].onHand,20);assert.equal(v.costRows.length,2);
  assert.throws(()=>f.sql.prepare('UPDATE dog_food_cost_annotations SET review_status=? WHERE id=?').run('confirmed',raw.id),/immutable/);
});

test('cost confirmations fail closed on wrong organization, target or evidence and malformed audit details',()=>{
  const f=fixture(),raw=f.sql.prepare("SELECT * FROM dog_food_cost_annotations WHERE id='fixture-value-007'").get(),d={organizationId:'org-opwp',decision:'confirmed',basis:raw,reference:'owner-confirmation',note:'Confirmed distinct use'},review={action:'inventory_cost_confirmed',entity_id:raw.id,details:JSON.stringify(d),actor:staffPrivate.reliefShort,created_at:'2026-10-14 12:00:00'};
  for(const invalid of [{...review,action:'other'},{...review,entity_id:'foreign'},{...review,actor:''},{...review,details:'invalid'},...[
    {...d,organizationId:'foreign'},{...d,decision:'pending'},{...d,note:''},{...d,basis:{...raw,quantity:3}},{...d,basis:{...raw,unit_cost_cents:0}},{...d,basis:{...raw,movement_id:'foreign'}},{...d,basis:{...raw,actual_date:'2026-03-16'}},{...d,basis:{...raw,category:'expiration'}}
  ].map(details=>({...review,details:JSON.stringify(details)}))])assert.equal(applyInventoryCostReviews([raw],[invalid])[0].review_status,'needs_review');
});
test('demand excludes partial quotes, drafts, personal use and duplicate sources; fulfilled refunds keep physical demand',()=>{
  const m=model();m.sales=[sale('explicit',3,'2026-10-02'),sale('legacy',2,'2026-09-30',{fulfillmentAssumed:true}),sale('test',99,'2026-10-02',{name:'Test customer'}),sale('draft',99,'2026-10-02',{inventoryEligible:false}),sale('quote',4,'2026-10-02',{source:'Quote'}),sale('refund',1,'2026-10-03',{cancelled:true}),sale('one',4,'2026-10-05',{lineId:'line',orderId:'order'}),sale('duplicate',4,'2026-10-05',{orderId:'order'})];
  const v=foodInventoryDashboard(m,{now});assert.equal(v.usage.at(-1).formulas[0].bags,8);assert.equal(v.usage.at(-2).formulas[0].assumedBags,2);assert.equal(v.records.length,4);assert.equal(v.replenishment[0].dailyDemand,null);assert.equal(v.replenishment[0].suggestedBags,null);assert.ok(v.issues.some(i=>i.kind==='duplicate'));
});
test('supported daily demand requires complete history and stockout-free window; MTD compares equal periods',()=>{
  const m=model();m.sales=[sale('old',60,'2026-09-02'),sale('recent',30,'2026-10-02'),sale('previous-late',20,'2026-09-20')];
  const v=foodInventoryDashboard(m,{now,policy:policy()});assert.equal(v.replenishment[0].dailyDemand,1.22);assert.equal(v.comparisons[0].current,30);assert.equal(v.comparisons[0].previousSamePeriod,60);assert.equal(v.comparisons[0].through,'2026-09-13');
  const missing=structuredClone(m);missing.sales.push(sale('missing',0,'2026-09-02'));assert.equal(foodInventoryDashboard(missing,{now,policy:policy()}).replenishment[0].dailyDemand,null);
  assert.equal(foodInventoryDashboard(m,{now,policy:{...policy(),stockoutPeriods:[{productId:'pink',start:'2026-09-01',end:'2026-09-02'}]}}).replenishment[0].dailyDemand,null);
});
test('reorder accounts for reservations and timely partial receipts once, then uses independent minimum and multiple',()=>{
  const m=model();m.sales=[sale('historical',90,'2026-09-01'),sale('committed',2,'2026-10-16',{inventoryEligible:false,fulfillment:'Awaiting Delivery'})];
  m.products[0].onHand=4;m.products[0].available=2;
  m.pos=[{id:'po',number:'PO',status:'Partially Received',expected:'2026-10-20',lines:[{id:'line',productId:'pink',ordered:10,received:6}]},{id:'late',number:'Late',status:'Ordered',expected:'2026-11-20',lines:[{productId:'pink',ordered:50,received:0}]},{id:'overdue',number:'Overdue',status:'Ordered',expected:'2026-10-01',lines:[{productId:'pink',ordered:50,received:0}]}];
  const r=foodInventoryDashboard(m,{now,policy:policy()}).replenishment[0];assert.equal(r.calculation.baselineBags,13);assert.equal(r.calculation.requiredBags,18);assert.equal(r.available,2);assert.equal(r.incomingTimely,4);assert.equal(r.calculation.rawShortage,12);assert.equal(r.suggestedBags,12);assert.equal(r.onHand,4);
  m.products[0].onHand=20;m.products[0].available=18;assert.equal(foodInventoryDashboard(m,{now,policy:policy()}).replenishment[0].suggestedBags,0);
});
test('subscription cycles clamp calendar months and generated orders replace their forecast commitments',()=>{
  const m=model();m.sales=[sale('history',90,'2026-09-01')];m.native.orders=[{id:'generated',subscription_id:'plan',scheduled_date:'2026-10-20',status:'paid'}];
  const args={now,policy:policy(),plans:[{id:'plan',status:'active',next_delivery_date:'2026-10-20'}],planItems:[{subscription_id:'plan',product_id:product.websiteId,quantity:8,is_active:1}]};
  let v=foodInventoryDashboard(m,args);assert.deepEqual(v.forecast[0].periods.map(p=>p.bags),[8,16,24]);assert.equal(v.forecast[0].periods[0].ungeneratedBags,0);assert.equal(v.replenishment[0].calculation.ungeneratedRecurringBags,0);
  m.native.orders[0].status='cancelled';v=foodInventoryDashboard(m,args);assert.equal(v.forecast[0].periods[0].bags,0);
  const feb=foodInventoryDashboard(model(),{now:new Date('2026-01-31T17:00:00Z'),plans:[{id:'plan',status:'active',next_delivery_date:'2026-01-31'}],planItems:args.planItems});assert.deepEqual(feb.forecast[0].periods[2].cycles.map(c=>c.date),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
});
test('expired, quarantined and assumed lots are excluded; covered sellable checkpoint is not reduced twice; FEFO flags expiry risk',()=>{
  const m=model();m.sales=[sale('history',90,'2026-09-01')];
  const lots=[{id:'expired',product_id:product.websiteId,lot_number:'E',best_before:'2026-10-01',usable_bags:3},{id:'quarantine',product_id:product.websiteId,lot_number:'Q',best_before:'2027-01-01',usable_bags:2,quarantined:1},{id:'early',product_id:product.websiteId,lot_number:'A',best_before:'2026-10-15',usable_bags:10},{id:'late',product_id:product.websiteId,lot_number:'B',best_before:'2027-03-08',usable_bags:5}];
  let r=foodInventoryDashboard(m,{now,policy:policy(),lots}).replenishment[0];assert.equal(r.onHand,15);assert.equal(r.available,13);assert.equal(r.lots.find(l=>l.id==='early').atRisk,5);assert.equal(r.lots[0].id,'expired');
  assert.equal(r.projectedShortageDate,'2026-10-21','FEFO projection removes unconsumed expired bags rather than assuming they can sell later');
  assert.equal(r.reorderDate,'2026-10-13','Reorder date cannot follow an expiry-driven shortage');
  assert.equal(r.calculation.projectedExpiryWasteBags,5);assert.equal(r.suggestedBags,12,'20 required minus 13 available plus 5 projected expiry bags = 12');
  m.products[0].onHand=15;r=foodInventoryDashboard(m,{now,policy:policy(),lots}).replenishment[0];assert.equal(r.onHand,15,'Checkpoint already excluded blocked bags');
  m.products[0].onHand=19;assert.equal(foodInventoryDashboard(m,{now,policy:policy(),lots}).replenishment[0].onHand,null,'Unreconciled lots cannot establish sellable stock');
});
test('only exact signed deduction may be categorized; personal, damage and expiration never merge',()=>{
  const m=model();m.movements=[{id:'damage',productId:'pink',date:'2026-10-01',quantity:-4,type:'Waste'}];const b={confirm:true,category:'animal_damage',productId:'pink',quantity:4,actualDate:'2026-10-01',movementId:'damage',cost:'40',sourceReference:'raccoon-verified',note:'Exact verified count'};
  assert.equal(inventoryCostInput(b,m).quantity,4);assert.throws(()=>inventoryCostInput({...b,quantity:3},m));assert.throws(()=>inventoryCostInput({...b,actualDate:''},m));
  const costs=[{id:'damage-cost',product_id:'pink',category:'animal_damage',quantity:4,unit_cost_cents:4000,actual_date:'2026-10-01',movement_id:'damage',review_status:'confirmed'}],v=foodInventoryDashboard(m,{now,costs});assert.equal(v.costTotals[1].knownCents,16000);assert.equal(v.costTotals[0].knownCents,0);assert.equal(v.costTotals[2].knownCents,0);assert.equal(v.uncategorized.length,0);
});
test('unknown supplier inputs do not become zero; mixed-pallet surplus needs formula review',()=>{
  assert.equal(emptyFoodPlanning().supplierLeadDays,null);
  for(const p of [{reviewDays:-1},{orderMultipleBags:0},{freightCents:true},{historyConfirmedFrom:'2026-02-30',historyConfirmedThrough:'2026-03-01'},{stockoutPeriods:[{productId:'pink',start:'2026-10-10',end:'2026-10-01'}]}])assert.throws(()=>validateFoodPlanning(p));
  const m=model();m.products[0].onHand=0;m.products[0].reserved=0;m.sales=[sale('history',90,'2026-09-01')];const v=foodInventoryDashboard(m,{now,policy:policy()});assert.equal(v.mixed.proposedBags,20);assert.equal(v.mixed.targetBags,40);assert.equal(v.mixed.unallocatedBags,20);assert.equal(v.mixed.ready,false);
});
test('owner acquisition cost uses Dealer Price and missing costs remain unknown; history before checkpoint is never deducted again',()=>{
  const snapshot={tables:{Products:[row('pink',{'Product Name':'Pink (Pink)','Formula Code':'22-12','Bag Weight':40,'Dealer Price':40,'DC Cost':30,'Active Status':true})],Sales:[row('old',{Product:['pink'],'Sold To':'Buyer','Bag Quantity':10,'Sale Date':'2026-03-15','Sale Total':600})],'Inventory Adjustments':[row('checkpoint',{Product:['pink'],'Movement Type':'Stock Count','Movement Date':'2026-10-12','Counted Quantity':20})]}};
  let m=operationModel(snapshot);assert.equal(m.products[0].costCents,4000);assert.equal(m.products[0].stockValueCents,80000);assert.equal(m.products[0].onHand,20);assert.equal(m.sales[0].fulfillmentAssumed,true);
  delete snapshot.tables.Products[0].fields['Dealer Price'];m=operationModel(snapshot);assert.equal(m.products[0].costCents,null);assert.equal(m.products[0].stockValueCents,null);
});
test('database allocations reject quarantine, assumed dates and overbooking at transaction time',()=>{
  const f=fixture();f.sql.exec("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES('buyer','Test','Buyer','a@example.test','4195550100'); INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code) VALUES('address','buyer','123 Example','Toledo','OH','43614'); INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,subtotal_cents,tax_cents,total_cents) VALUES('o','one','buyer','address','on_demand','paid',5900,0,5900),('o2','two','buyer','address','on_demand','paid',5900,0,5900);");
  f.sql.prepare('INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by) VALUES (?,?,?,?,?,?,?)').run('lot',product.websiteId,'A','2027-03-08',2,foodDate(),'owner');
  f.sql.exec("INSERT INTO dog_food_lot_allocations(order_id,lot_id,quantity) VALUES('o','lot',2)");
  assert.throws(()=>f.sql.exec("INSERT INTO dog_food_lot_allocations(order_id,lot_id,quantity) VALUES('o2','lot',1)"),/Insufficient/);
  assert.throws(()=>f.sql.exec("UPDATE dog_food_stock_lots SET quarantined=1 WHERE id='lot'"),/allocated/);
  f.sql.exec("UPDATE dog_food_lot_allocations SET released_at=CURRENT_TIMESTAMP; UPDATE dog_food_stock_lots SET quarantined=1 WHERE id='lot'");assert.throws(()=>f.sql.exec("INSERT INTO dog_food_lot_allocations(order_id,lot_id,quantity) VALUES('o2','lot',1)"),/sellable/);
});
test('refund alone never increases stock; actual sellable return increases stock only once',()=>{
  const snapshot={tables:{Products:[row('pink',{'Product Name':'Pink (Pink)','Formula Code':'22-12','Bag Weight':40,'Dealer Price':40,'Active Status':true})],Sales:[row('refund',{Product:['pink'],'Sold To':'Buyer','Bag Quantity':2,'Sale Date':'2026-10-13','Sale Total':120,'Website Order State':'refunded','Fulfillment Status':'Delivered'})],'Inventory Adjustments':[row('count',{Product:['pink'],'Movement Type':'Stock Count','Movement Date':'2026-10-12','Counted Quantity':20})]}};
  assert.equal(operationModel(snapshot).products[0].onHand,18);snapshot.tables['Inventory Adjustments'].push(row('return',{Product:['pink'],'Movement Type':'Return','Movement Date':'2026-10-13','Quantity Change':2}));assert.equal(operationModel(snapshot).products[0].onHand,20);assert.equal(operationModel(snapshot).products[0].onHand,20);
});
test('supported gross profit requires cost and tax-exclusive evidence; partial refunds never imply full revenue',()=>{
  const m=model();m.sales=[sale('reliable',2,'2026-10-01',{acquisitionCostCents:4000,revenueCents:11800}),sale('partial-refund',1,'2026-10-02',{refundState:'partial_refund'}),sale('assumed',1,'2026-10-03',{fulfillmentAssumed:true})];
  let v=foodInventoryDashboard(m,{now});assert.equal(v.financial[0].revenueCents,11800);assert.equal(v.financial[0].acquisitionCents,8000);assert.equal(v.financial[0].grossProfitCents,3800);assert.equal(v.records.length,3,'Physical fulfilled refunds remain in demand');
  m.sales[0].acquisitionCostCents=null;v=foodInventoryDashboard(m,{now});assert.equal(v.financial[0].grossProfitCents,null);assert.equal(v.financial[0].acquisitionCents,null);
});
test('cost commands replay once through the existing actor and payload guard; plan settings and customer launch gates stay unchanged',async()=>{
  const f=fixture(),m=model(),b={action:'cost_annotation',commandId:crypto.randomUUID(),confirm:true,category:'personal_family',productId:'pink',quantity:1,cost:'40',checkpointId:'checkpoint',sourceReference:'owner-event',note:'Already counted'};
  const execute=()=>saveInventoryCost(f.db,b,'owner',m),a=await f.service.runFoodCommand(f.env,b,'owner',execute),replay=await f.service.runFoodCommand(f.env,b,'owner',execute);assert.equal(a.id,replay.id);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_cost_annotations WHERE source_reference='owner-event'").get().n,1);
  await assert.rejects(f.service.runFoodCommand(f.env,b,'different-actor',execute),/identity conflict/);
  await assert.rejects(f.service.runFoodCommand(f.env,{...b,quantity:2},'owner',execute),/identity conflict/);
  assert.equal(f.sql.prepare('SELECT scheduling_enabled FROM dog_food_workflow_settings').get().scheduling_enabled,0);assert.equal(f.sql.prepare('SELECT email_enabled FROM dog_food_workflow_settings').get().email_enabled,0);
});
test('migration rollback preserves existing orders, stock counts and audit history',()=>{
  const f=fixture();f.sql.exec("CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0056_dog_food_inventory_costs.sql')");
  const before=f.sql.prepare('SELECT payload FROM dog_food_ops_snapshots').get().payload;
  f.sql.exec(fs.readFileSync(new URL('./fixtures/dog-food-inventory-rollback.sql',import.meta.url),'utf8'));
  assert.equal(f.sql.prepare('SELECT payload FROM dog_food_ops_snapshots').get().payload,before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_orders').get().n,0);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_ops_audit WHERE action='cost_evidence'").get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n,0);
});
