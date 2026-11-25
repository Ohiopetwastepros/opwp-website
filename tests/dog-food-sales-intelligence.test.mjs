import * as websiteStore from '../lib/dog-food-website-store.mjs';
import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fixture} from './helpers/dog-food-fixture.mjs';
import {foodSalesIntelligence,emptyFoodPlanning,validateFoodPlanning,saveFoodPlanning,readFoodPlanning} from '../lib/dog-food-sales-intelligence.mjs';
import {FoodError,foodDate} from '../lib/dog-food-operations.mjs';
const now=new Date('2026-10-08T15:00:00Z');
const product={id:'pink',websiteId:'edf-22-12-pink-40',active:true,color:'Pink',formula:'22-12',weight:40,reorderPoint:20,onHand:22,reserved:2,available:20};
const model=()=>({products:[{...product}],sales:[],pos:[],native:{orders:[]}});
const source=name=>fs.readFileSync(new URL('../lib/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
test('monthly physical bag usage follows completion date, retains delivered refunds, excludes unfulfilled orders',()=>{
  const m=model();m.sales=[{productId:'pink',quantity:3,stockDate:'2026-10-01',date:'2026-09-20',inventoryEligible:true,cancelled:false,totalCents:19000},
    {productId:'pink',quantity:2,stockDate:'2026-09-30',date:'2026-10-01',inventoryEligible:true,cancelled:true,totalCents:12000},
    {productId:'pink',quantity:9,stockDate:'2026-10-02',inventoryEligible:false,cancelled:false,date:'2026-10-02',totalCents:57000}];
  const v=foodSalesIntelligence(m,{now});assert.equal(v.usage.find(r=>r.month==='2026-10').formulas[0].bags,3);assert.equal(v.usage.find(r=>r.month==='2026-09').formulas[0].bags,2);
  assert.equal(v.summary.fulfilledMonthBags,3);assert.equal(v.summary.billedMonthCents,57000);
  m.products.push({...product,id:'retired-pink',active:false,weight:20});
  m.sales.push({productId:'retired-pink',quantity:4,stockDate:'2026-10-02',date:'2026-09-20',inventoryEligible:true,cancelled:false,totalCents:10000});
  const retained=foodSalesIntelligence(m,{now});
  assert.equal(retained.usage.find(r=>r.month==='2026-10').formulas.find(f=>f.weight===20).bags,4,'Retiring a formula does not erase its physical usage');
  assert.equal(retained.usage.find(r=>r.month==='2026-10').formulas.reduce((n,f)=>n+f.bags,0),retained.summary.fulfilledMonthBags);
  assert.equal(retained.replenishment.length,1,'Reorder planning only includes active formulas');
});
test('approved 20/30 stock alerts work without inventing counts, lead times or purchase quantities',()=>{
  const m=model();m.products.push({...product,id:'green',color:'Green',reorderPoint:30,onHand:null,available:null});
  const v=foodSalesIntelligence(m,{now});assert.equal(v.replenishment[0].reorderAlert,true);assert.equal(v.replenishment[0].threshold,20);assert.equal(v.replenishment[0].suggestedBags,null);
  assert.equal(v.replenishment[1].reorderAlert,false);assert.equal(v.replenishment[1].stockState,'count_needed');assert.equal(v.summary.reorderAlerts,1);
  const policy={...emptyFoodPlanning(),supplierLeadDays:3,safetyDays:7,minimumOrderBags:5};m.products[0].available=0;
  m.pos=[{number:'late',expected:'2026-10-20',status:'Ordered',lines:[{productId:'pink',ordered:50,received:0}]},{number:'early',expected:'2026-10-10',status:'Partially Received',lines:[{productId:'pink',ordered:10,received:5}]}];
  const r=foodSalesIntelligence(m,{now,policy}).replenishment[0];assert.equal(r.incomingBags,55);assert.equal(r.incomingTimely,5);assert.equal(r.suggestedBags,15);
  assert.equal(r.onHand,22,'Ordered-but-unreceived bags do not become usable inventory');
});
test('actual dated route adds two service minutes once; new stops and stale roster cannot claim a full route time',()=>{
  const m=model();m.native.orders=[{id:'one',status:'scheduled',scheduled_date:'2026-10-09',fulfillment_method:'delivery',technician_id:staffPrivate.primaryShortKey,technician_name:staffPrivate.primaryShort,line1:'123 Main',city:'Toledo',state:'OH',postal_code:'43614',itemDetails:[{quantity:2}]}];
  const args={now,routeSource:{status:'success',stale:false,clients:[]},routePlans:[{id:'route',service_date:'2026-10-09',technician_external_id:staffPrivate.primaryShortKey,source_provider:'sng',locations:[{address:'123 Main, Toledo, OH, 43614',estimated_service_minutes:22,food_service_minutes:2,estimated_drive_minutes:10,non_food_tasks:1}]}]};
  let row=foodSalesIntelligence(m,args).routeLoads[0];assert.equal(row.existingStops,1);assert.equal(row.baseServiceMinutes,20);assert.equal(row.foodServiceMinutes,2);assert.equal(row.fullRouteMinutes,32);
  m.native.orders[0].line1='999 Other';row=foodSalesIntelligence(m,args).routeLoads[0];assert.equal(row.foodOnlyStops,1);assert.equal(row.fullRouteMinutes,null);
  args.routeSource.stale=true;row=foodSalesIntelligence(m,args).routeLoads[0];assert.equal(row.unmatchedStops,1);assert.equal(row.fullRouteMinutes,null);
});
test('route app food task timing is evidence, not the combined scoop duration',()=>{
  const v=foodSalesIntelligence(model(),{now,taskTimes:[{status:'completed',started_at:'2026-10-08 10:00:00',completed_at:'2026-10-08 10:01:30'},{status:'completed',started_at:'2026-10-08 11:00:00',completed_at:'2026-10-08 11:03:00'},{status:'failed',started_at:'2026-10-08 12:00:00',completed_at:'2026-10-08 13:00:00'}]});
  assert.equal(v.summary.observedFoodStops,2);assert.equal(v.summary.observedFoodStopMinutes,2.3);assert.equal(v.summary.overAllowanceFoodStops,1);
});
test('planning configuration is bounded, private to OPWP, and does not silently activate workflows',async()=>{
  for(const input of [{supplierLeadDays:-1},{safetyDays:Infinity},{foodStopMinutes:true},{minimumOrderByColor:{Purple:20}},{routeMode:'anything'},{token:'secret'}])assert.throws(()=>validateFoodPlanning(input),FoodError);
  const f=fixture();await saveFoodPlanning(f.db,{confirm:true,policy:{...emptyFoodPlanning(),supplierLeadDays:0,minimumOrderByColor:{Pink:20,Blue:20,Red:20,Green:30}}},'owner@example.test');
  const p=await readFoodPlanning(f.db);assert.equal(p.foodStopMinutes,2);assert.equal(p.minimumOrderByColor.Green,30);
  assert.equal(f.sql.prepare('SELECT scheduling_enabled FROM dog_food_workflow_settings').get().scheduling_enabled,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_orders').get().n,0);
});
function customer(f){
  f.sql.exec("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES('buyer','Real','Buyer','buyer@example.test','4195550100'); INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,placement_preference,is_primary) VALUES('address','buyer','123 Main','Toledo','OH','43614','Front door',1); INSERT INTO dog_food_accounts(id,email,customer_id,password_hash) VALUES('account','buyer@example.test','buyer','synthetic-not-a-production-credential'); UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP WHERE id='account';");
}
test('shared profile review is durable, unchanged saves stay reviewed, changes reopen review and stale approvals fail',async()=>{
  const f=fixture();customer(f);let review=f.sql.prepare('SELECT * FROM dog_food_customer_reviews').get();assert.equal(review.revision,1);
  const fn=runPrivateInNewContext(source('dog-food-customer-review.js')+'\n({foodCustomerReview})',{...websiteStore,FoodError,text:v=>String(v||''),readLiveDensity:async()=>({status:'success',stale:false,clients:[]})}).foodCustomerReview;
  await fn(f.env,{confirm:true,revision:1,relationship:'food_only',customerId:'buyer'},'office');
  f.sql.exec("UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP WHERE id='account'");assert.equal(f.sql.prepare('SELECT status FROM dog_food_customer_reviews').get().status,'reviewed');
  f.sql.exec("UPDATE dog_food_customers SET phone='4195550199' WHERE id='buyer'; UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP WHERE id='account'");
  review=f.sql.prepare('SELECT * FROM dog_food_customer_reviews').get();assert.equal(review.status,'pending');assert.equal(review.revision,2);assert.equal(JSON.parse(review.profile_json).phone,'4195550199');
  await assert.rejects(fn(f.env,{confirm:true,revision:1,relationship:'food_only',customerId:'buyer'},'office'),/profile changed/);
  await assert.rejects(fn(f.env,{confirm:true,revision:2,relationship:'linked',customerId:'buyer',opwpRecordId:'rec12345678901234'},'office'),/Refresh the active/);
  assert.equal(f.sql.prepare('SELECT sng_client_id FROM dog_food_customers').get().sng_client_id,null,'Review does not change SNG billing identity');
});
test('shared identity review reads the fixed OPWP source, rejects mismatch and preserves native billing identity',async()=>{
  const f=fixture();customer(f);const id='rec12345678901234';let name='Different Customer';
  const fn=runPrivateInNewContext(source('dog-food-customer-review.js')+'\n({foodCustomerReview})',{
    ...websiteStore,FoodError,text:v=>String(v||''),readLiveDensity:async()=>({status:'success',stale:false,clients:[{id}]}),
    foodAirtable:async(env,path)=>{assert.equal(env.DOG_FOOD_AIRTABLE_TOKEN,undefined);assert.equal(env.AIRTABLE_API_KEY,'synthetic-opwp-token');assert.equal(path,`appcAWPBQB8GmOrcT/tblhi8MGUOsWNmd37/${id}`);return {id,fields:{Status:'Active','Client Name':name,Address:'123 Main',City:'Toledo',ZIP:'43614'}};},
  }).foodCustomerReview;
  const env={...f.env,AIRTABLE_API_KEY:'synthetic-opwp-token',DOG_FOOD_AIRTABLE_TOKEN:'synthetic-food-only-token'},body={customerId:'buyer',revision:1,confirm:true,relationship:'linked',opwpRecordId:id};
  await assert.rejects(fn(env,body,'office'),/identity\/address differs/);
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_customer_reviews').get().status,'pending');
  name='Real Buyer';await fn(env,body,'office');
  const review=f.sql.prepare('SELECT * FROM dog_food_customer_reviews').get();assert.equal(review.opwp_record_id,id);assert.equal(review.status,'reviewed');
  assert.equal(f.sql.prepare('SELECT sng_client_id FROM dog_food_customers').get().sng_client_id,null);
  const row={id:'buyer',first_name:'Real',last_name:'Buyer',email:'buyer@example.test',phone:'4195550100',line1:'123 Main',city:'Toledo',state:'OH',postal_code:'43614',placement_preference:'Front door',profile_completed_at:'2026-10-08 10:00:00'};
  const routeSource={status:'success',stale:false,clients:[{id,address:'123 Main',city:'Toledo',zip:'43614',serviceDays:['Thursday']}]};
  assert.equal(foodSalesIntelligence(model(),{now,accounts:[row],customerReviews:[review],routeSource}).profiles[0].crmState,'linked_active');
  routeSource.stale=true;assert.equal(foodSalesIntelligence(model(),{now,accounts:[row],customerReviews:[review],routeSource}).profiles[0].crmState,'address_match_review');
});
test('food tasks join the real dated route and shared stop, preserve scoop work, use two minutes and reject released routes',async()=>{
  const f=fixture(undefined,{routes:true});customer(f);const day=foodDate();
  f.sql.prepare("INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,subtotal_cents,tax_cents,total_cents) VALUES('order','EDF-TEST','buyer','address','on_demand','paid',5900,457,6357)").run();
  f.sql.prepare("INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type,status) VALUES('delivery','order','buyer','address',?,'scoop_route','assigned')").run(day);
  f.sql.prepare(("INSERT INTO route_partner_route_plans(id,organization_id,service_date,technician_external_id,technician_name,source_provider,source_route_id,source_fingerprint,version,status,location_count) VALUES('route','org-opwp',?,'" + staffPrivate.primaryShortKey + "','" + staffPrivate.primaryShort + "','sng','real-route','test',1,'draft',1)")).run(day);
  f.sql.exec("INSERT INTO route_partner_locations(id,route_plan_id,organization_id,location_key,sequence,address,estimated_service_minutes) VALUES('stop','route','org-opwp','source-stop',1,'123 Main, Toledo, OH, 43614',10); INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,status,estimated_minutes) VALUES('scoop','route','stop','org-opwp','scoop','sng','scheduled',10);");
  const fn=runPrivateInNewContext(source('dog-food-fulfillment.js')+'\n({createFoodFieldTask})',{FoodError,readFoodPlanning}).createFoodFieldTask;
  const o={id:'order',address_id:'address',customer_id:'buyer'},slot={route_id:'route',service_date:day,technician_id:staffPrivate.primaryShortKey,technician_name:staffPrivate.primaryShort};
  await fn(f.db,o,slot,'delivery');await fn(f.db,o,slot,'delivery');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_partner_locations').get().n,1);assert.equal(f.sql.prepare("SELECT location_id,estimated_minutes FROM route_partner_tasks WHERE task_type='dog_food'").get().estimated_minutes,2);
  assert.equal(f.sql.prepare("SELECT estimated_service_minutes FROM route_partner_locations WHERE id='stop'").get().estimated_service_minutes,12);
  assert.equal(f.sql.prepare("SELECT status FROM route_partner_tasks WHERE id='scoop'").get().status,'scheduled');
  f.sql.exec("INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,subtotal_cents,tax_cents,total_cents) VALUES('order-two','EDF-TWO','buyer','address','on_demand','paid',5900,457,6357)");
  f.sql.prepare("INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type,status) VALUES('delivery-two','order-two','buyer','address',?,'scoop_route','assigned')").run(day);
  await fn(f.db,{...o,id:'order-two'},slot,'delivery-two');
  assert.equal(f.sql.prepare("SELECT SUM(estimated_minutes) n FROM route_partner_tasks WHERE task_type='dog_food'").get().n,2,'Two orders at one physical stop share the allowance');
  f.sql.exec("UPDATE route_partner_tasks SET status='cancelled' WHERE id='food-task:delivery'");
  assert.equal(f.sql.prepare("SELECT estimated_minutes FROM route_partner_tasks WHERE id='food-task:delivery-two'").get().estimated_minutes,2,'Cancellation transfers the one-stop allowance to the remaining order');
  assert.equal(f.sql.prepare("SELECT estimated_service_minutes FROM route_partner_locations WHERE id='stop'").get().estimated_service_minutes,12,'Remaining food work retains its allowance');
  f.sql.exec("UPDATE route_partner_tasks SET status='cancelled' WHERE task_type='dog_food'");assert.equal(f.sql.prepare("SELECT estimated_service_minutes FROM route_partner_locations WHERE id='stop'").get().estimated_service_minutes,10);
  assert.equal(f.sql.prepare("SELECT arrival_status FROM route_partner_locations WHERE id='stop'").get().arrival_status,'pending');
  f.sql.exec("INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,is_primary) VALUES('other-address','buyer','999 Other','Toledo','OH','43614',0); INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,subtotal_cents,tax_cents,total_cents) VALUES('order-other','EDF-OTHER','buyer','other-address','on_demand','paid',5900,457,6357)");
  f.sql.prepare("INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type,status) VALUES('delivery-other','order-other','buyer','other-address',?,'scoop_route','assigned')").run(day);
  await fn(f.db,{...o,id:'order-other',address_id:'other-address'},slot,'delivery-other');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM route_partner_locations').get().n,2,'Food-only stop joins the actual dated route');
  assert.equal(f.sql.prepare("SELECT estimated_service_minutes FROM route_partner_locations WHERE address LIKE '999 Other%'").get().estimated_service_minutes,2);
  await assert.rejects(fn(f.db,o,{...slot,technician_id:'someone-else'},'delivery'),/technician|does not match/);
  f.sql.exec("UPDATE route_partner_route_plans SET status='finalized' WHERE id='route'");await assert.rejects(fn(f.db,o,slot,'delivery'),/already released/);
});
