import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fixture} from './helpers/dog-food-fixture.mjs';
import * as profile from '../lib/dog-food-profile.mjs';
import * as checkout from '../lib/dog-food-checkout.mjs';
import * as cadence from '../lib/dog-food-cadence.mjs';
import * as food from '../lib/dog-food-account.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
import {readFoodPlanning} from '../lib/dog-food-sales-intelligence.mjs';
import {DENSITY_DAYS,densityDistance,densityAddressHash,localReliableGeocode} from '../lib/live-density.mjs';
import workflowSchema from '../data/dog-food-workflow-schema.json' with {type:'json'};
const source=name=>fs.readFileSync(new URL('../lib/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const now=new Date('2026-10-07T15:00:00Z');
const roster={status:'success',stale:false,capturedAt:now.toISOString(),clients:[
  {id:'private-id',name:'Private neighbor',address:'123 Main',city:'Toledo',zip:'43614',lat:41.6,lon:-83.6,serviceDays:['Tuesday'],technicians:[staffPrivate.primaryShort]},
  {id:'private-id-two',name:'Another neighbor',address:'100 Other',city:'Toledo',zip:'43614',lat:41.7,lon:-83.7,serviceDays:['Friday'],technicians:[staffPrivate.reliefShort]},
]};
function setup() {
  const f=fixture(undefined,{routes:true});let current=structuredClone(roster);
  const routing=runPrivateInNewContext(source('dog-food-routing.js')+'\n({foodRouteRecommendation,readFoodDeliveryChoices,locateFoodAddress})',{Date,Number,String,Map,crypto,TextEncoder,DENSITY_DAYS,densityDistance,densityAddressHash,localReliableGeocode,...cadence,readLiveDensity:async()=>current});
  const model={native:true,sync:{dirty:0,last_success_at:new Date().toISOString()},products:[{websiteId:'edf-22-12-pink-40',confirmed:true,onHand:8,reserved:0}]};
  const context={...logic,...food,...checkout,...cadence,...profile,...routing,...f.service,readFoodPlanning,crypto,TextEncoder,Date,Uint8Array,Map,URL,URLSearchParams,JSON,workflowSchema,getDb:()=>f.db,readFoodOperations:async()=>model,locateFoodAddress:async()=>null};
  const payments=runPrivateInNewContext(source('dog-food-payments.js')+'\n({activateDogFoodSubscriptionFromOrder,recordDogFoodPayment})',context);
  const fulfillment=runPrivateInNewContext(source('dog-food-fulfillment.js')+'\n({reserveFoodLots,checkFoodLotReconciliation,foodFulfillmentCommand,scheduleFoodOrders})',{...context,...payments,prepareFieldRelease:async()=>{throw Error('No driver release expected');}});
  const portal=runPrivateInNewContext(source('dog-food-portal.js')+'\n({readFoodPortal,requireFoodProfile,saveFoodProfile,createFoodPortalOrder})',{...context,...fulfillment});
  const workflow=runPrivateInNewContext(source('dog-food-workflow.js')+'\n({flushFoodProjections,flushFoodEmails})',{...context,sendTransactionalEmail:async()=>{throw Error('No emails authorized in this test');}});
  f.sql.exec(`INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES ('buyer','','','buyer@example.test','');
    INSERT INTO dog_food_accounts(id,email,customer_id,password_hash) VALUES ('account','buyer@example.test','buyer','hash');
    UPDATE dog_food_products SET retail_price_cents=5900,is_active=1,is_customer_visible=1 WHERE id='edf-22-12-pink-40';
    INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by) VALUES ('lot','edf-22-12-pink-40','TEST','2030-01-01',8,date('now'),'test');`);
  const account={id:'account',customer_id:'buyer',email:'buyer@example.test'};
  const savedProfile={firstName:'Test',lastName:'Buyer',phone:'4195550101',address:'123 Main',city:'Toledo',state:'OH',zip:'43614',placement:'Front door',fulfillmentMethod:'delivery'};
  const order=(extra={})=>portal.createFoodPortalOrder(f.db,account,{commandId:crypto.randomUUID(),plan:'on_demand',deliverySpeed:'route_day',fulfillmentMethod:'delivery',routeWeekday:2,items:[{productId:'edf-22-12-pink-40',quantity:2}],...extra});
  return {...f,...portal,...fulfillment,...payments,...workflow,...routing,account,savedProfile,order,model,setRoster:r=>{current=r;}};
}

async function profileForm(props) {
  const bundle=await build({entryPoints:['app/dog-food/account/DeliveryProfile.js'],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.js':'jsx'},jsxFactory:'h',banner:{js:'const h=(type,props,...children)=>({type,props:{...props,children}});'},plugins:[{name:'profile-form-test',setup(b){
    b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useState=value=>[value,()=>{}];',loader:'js'}));
    b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'css-fixture'}));
    b.onLoad({filter:/.*/,namespace:'css-fixture'},()=>({contents:'export default {};',loader:'js'}));
    b.onResolve({filter:/^@\/lib\/dog-food-profile\.mjs$/},()=>({path:fs.realpathSync('lib/dog-food-profile.mjs')}));
  }}]});
  const module={exports:{}};
  // Browser FormData reads live controls, independently of React's state.
  const BrowserFormData=class {constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}};
  runPrivateInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,FormData:BrowserFormData});
  return module.exports.default(props);
}
function controls(node) {
  if(!node||typeof node!=='object')return [];
  return [...(['input','select'].includes(node.type)?[node]:[]),...(node.props?.children||[]).flat(Infinity).flatMap(controls)];
}

test('autofilled visible profile values submit without change events and persist through the real profile save',async()=>{
  const f=setup();
  const stale={firstName:'',lastName:'',phone:'',address:'',city:'',state:'OH',zip:'',placement:'Front door',placementOther:'',fulfillmentMethod:'delivery'};
  let submitted;
  const form=await profileForm({profile:stale,required:true,email:f.account.email,busy:false,onSave:async value=>{submitted=value;await f.saveFoodProfile(f.db,f.account,{profile:value});}});
  const inputs=controls(form),names=inputs.map(input=>input.props.name);
  assert.equal(new Set(names).size,9);
  assert.ok(inputs.every(input=>!Object.hasOwn(input.props,'value')),'rerenders must not replace browser autofill with stale state');
  assert.equal(inputs.find(input=>input.props.name==='phone').props.autoComplete,'tel');
  assert.equal(inputs.find(input=>input.props.name==='address').props.autoComplete,'address-line1');
  const values=Object.fromEntries(inputs.map(input=>[input.props.name,f.savedProfile[input.props.name]]));
  let prevented=false;
  await form.props.onSubmit({preventDefault(){prevented=true;},currentTarget:{values}});
  assert.equal(prevented,true);assert.equal(submitted.phone,f.savedProfile.phone);
  const saved=await f.readFoodPortal(f.db,f.account);
  assert.equal(saved.profileRequired,false);assert.equal(saved.addresses[0].line1,f.savedProfile.address);assert.equal(saved.customer.first_name,f.savedProfile.firstName);
  assert.equal(stale.phone,'','saving must not depend on a React change event');
});

test('autofill submission preserves server validation and puts save errors in the profile form',async()=>{
  const f=setup(),error='Complete your name, phone and address.';
  const form=await profileForm({profile:{...f.savedProfile,placement:'Other',placementOther:'Side porch'},required:true,email:f.account.email,error,onSave:value=>f.saveFoodProfile(f.db,f.account,{profile:value})});
  const instructions=controls(form).find(input=>input.props.name==='placementOther');assert.equal(instructions.props.required,true);
  const values={...f.savedProfile,phone:'123',placement:'Other',placementOther:'Side porch'};
  await assert.rejects(form.props.onSubmit({preventDefault(){},currentTarget:{values}}),/Complete/);
  assert.equal((await f.readFoodPortal(f.db,f.account)).profileRequired,true);
  assert.ok(form.props.children.some(child=>child?.props?.role==='alert'&&child.props.children.includes(error)));
  assert.equal(values.placementOther,'Side porch');
});
test('new account is gated until a complete profile is saved, and subsequent sessions remember it',async()=>{
  const f=setup();assert.equal((await f.readFoodPortal(f.db,f.account)).profileRequired,true);
  await assert.rejects(f.requireFoodProfile(f.db,f.account),/Save your delivery profile/);
  await assert.rejects(f.order(),/Save your delivery profile/);
  await assert.rejects(f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,phone:'123'}}),/Complete/);
  await f.saveFoodProfile(f.db,f.account,{profile:f.savedProfile});
  const session=await f.readFoodPortal(f.db,{...f.account});assert.equal(session.profileRequired,false);assert.equal(session.customer.phone,'4195550101');assert.equal(session.addresses[0].line1,'123 Main');
  assert.ok(f.sql.prepare('SELECT profile_completed_at FROM dog_food_accounts').get().profile_completed_at);
  await f.saveFoodProfile(f.db,f.account,{profile:f.savedProfile});assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_addresses').get().n,1);
  const response=JSON.stringify(session.deliveryChoices);assert.ok(!response.includes('Private neighbor'));assert.ok(!response.includes('private-id'));assert.ok(!response.includes('123 Main'));
});
test('recommendations follow exact saved address or nearby current customers and reject stale evidence',()=>{
  const f=setup(),address={line1:'123 Main',city:'Toledo',state:'OH',postal_code:'43614'};
  assert.equal(f.foodRouteRecommendation(roster,address,now).days[0].day,'Tuesday');
  assert.equal(f.foodRouteRecommendation(roster,{...address,line1:'Unmatched',latitude:41.7,longitude:-83.7},now).days[0].day,'Friday');
  assert.equal(f.foodRouteRecommendation({...roster,stale:true},address,now).status,'unavailable');
  assert.equal(f.foodRouteRecommendation(roster,{...address,state:'MI'},now).status,'outside_route');
});
test('server rechecks current recommendations, changed address, and rejects forged primary technician dates',async()=>{
  const f=setup();await f.saveFoodProfile(f.db,f.account,{profile:f.savedProfile});
  await assert.rejects(f.order({routeWeekday:5}),/current OPWP routes/);
  await assert.rejects(f.order({routeWeekday:null,tonyDate:cadence.shiftFoodDays(cadence.easternFoodDate(),1)}),/Tony delivery dates/);
  f.setRoster({...roster,clients:roster.clients.map(c=>({...c,serviceDays:['Friday']}))});await assert.rejects(f.order(),/current OPWP routes/);
  f.setRoster({...roster,stale:true});await assert.rejects(f.order({routeWeekday:5}),/coverage cannot be confirmed/);
  f.setRoster({...roster,clients:roster.clients.map(c=>({...c,serviceDays:['Friday']}))});await f.order({routeWeekday:5});
  await f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,address:'999 Elsewhere',city:'Columbus',zip:'43215'}});
  await assert.rejects(f.order({routeWeekday:5}),/coverage cannot be confirmed/);
});
test('primary technician one-off dates allow non-scooping customers outside current routes and never offer relief technician dates as primary technician',async()=>{
  const f=setup(),today=cadence.easternFoodDate(),day=cadence.shiftFoodDays(today,1);
  await f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,address:'999 Extra',city:'Waterville',zip:'43566'}});
  f.sql.prepare(`INSERT INTO dog_food_delivery_capacity(id,service_date,technician_id,technician_name,postal_code,bag_limit,stop_limit,route_id,confirmed_by)
    VALUES ('extra',?,'tony','Tony','43566',4,2,'extra','owner'),('craig',?,'craig','Craig','43566',4,2,'craig','owner')`).run(day,cadence.shiftFoodDays(today,2));
  const choices=await f.readFoodDeliveryChoices(f.db,(await f.requireFoodProfile(f.db,f.account)));
  assert.deepEqual(Array.from(choices.tonyDates),[day]);assert.equal(choices.deliveryAvailable,true);
  const created=await f.order({routeWeekday:null,tonyDate:day});assert.equal(f.sql.prepare('SELECT requested_delivery_date FROM dog_food_orders WHERE id=?').get(created.orderId).requested_delivery_date,day);
  await assert.rejects(f.order({plan:'subscription',billingConsent:true,cadence:'fixed_day',monthDay:15,routeWeekday:null,tonyDate:day}),/Tony delivery dates/);
});
test('paid pickup schedules independently of ZIP and driver routes, requires actual handoff, consumes bags once and posts exact Airtable stock',async()=>{
  const f=setup(),today=cadence.easternFoodDate();
  await f.service.syncFoodOperations(f.env,{force:true});
  await f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,address:'999 Outside',city:'Columbus',zip:'43215',fulfillmentMethod:'pickup'}});
  const first=await f.order({fulfillmentMethod:'pickup',routeWeekday:null});
  const order=f.sql.prepare('SELECT * FROM dog_food_orders WHERE id=?').get(first.orderId);assert.equal(order.delivery_fee_cents,0);assert.equal(order.total_cents,12714);
  await assert.rejects(f.order({fulfillmentMethod:'pickup',routeWeekday:null,deliverySpeed:'next_day'}),/no delivery fee/);
  await assert.rejects(f.foodFulfillmentCommand(f.env,{action:'pickup_complete',orderId:order.id,confirm:true,receivedBy:'Test Buyer'},'owner'),/paid pickup/);
  f.sql.exec('UPDATE dog_food_workflow_settings SET scheduling_enabled=1,posting_enabled=1;');
  await f.recordDogFoodPayment({db:f.db,orderId:order.id,provider:'stripe',reference:'pi_fixture',actor:'test',amountCents:order.total_cents});
  await f.foodFulfillmentCommand(f.env,{action:'pickup_capacity',date:today,instructions:'Contact the office to arrange the pickup location.',bagLimit:8,stopLimit:3,confirm:true},'owner');
  assert.equal((await f.scheduleFoodOrders(f.env)).results[0].status,'pickup_preparing',JSON.stringify(f.sql.prepare('SELECT automation_review FROM dog_food_orders').all()));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_deliveries').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM route_partner_tasks').get().n,0);
  assert.equal(f.sql.prepare('SELECT usable_bags FROM dog_food_stock_lots').get().usable_bags,8);
  await assert.rejects(f.foodFulfillmentCommand(f.env,{action:'pickup_complete',orderId:order.id,receivedBy:'Test',confirm:false},'owner'),/actual bag handoff/);
  assert.equal((await f.readFoodPortal(f.db,f.account)).orders[0].pickup_status,'preparing');
  assert.equal((await f.readFoodPortal(f.db,f.account)).orders[0].pickup_date,null);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM dog_food_transactional_outbox WHERE template='pickup_ready'").get().n,0);
  await assert.rejects(f.foodFulfillmentCommand(f.env,{action:'pickup_complete',orderId:order.id,receivedBy:'Test Buyer',confirm:true},'owner'),/arranged/);
  await f.foodFulfillmentCommand(f.env,{action:'pickup_ready',orderId:order.id,confirm:true},'owner');
  assert.equal((await f.readFoodPortal(f.db,f.account)).orders[0].pickup_status,'ready');
  await f.foodFulfillmentCommand(f.env,{action:'pickup_arrange',orderId:order.id,date:today,instructions:'Agreed private test arrangement',confirm:true},'owner');
  await f.foodFulfillmentCommand(f.env,{action:'pickup_complete',orderId:order.id,receivedBy:'Test Buyer',confirm:true},'owner');
  assert.equal(f.sql.prepare('SELECT usable_bags FROM dog_food_stock_lots').get().usable_bags,6);assert.equal(f.sql.prepare('SELECT status FROM dog_food_orders WHERE id=?').get(order.id).status,'fulfilled');
  await assert.rejects(f.foodFulfillmentCommand(f.env,{action:'pickup_complete',orderId:order.id,receivedBy:'Test Buyer',confirm:true},'owner'),/paid pickup/);
  await f.flushFoodProjections(f.env,{force:true,limit:25});
  const projected=f.records['Website Workflow'].find(r=>r.fields[workflowSchema.fields['Stable ID']]==='customer:buyer');
  assert.equal(projected.fields[workflowSchema.fields['Delivery Preference']],'pickup');
  assert.equal(JSON.parse(projected.fields[workflowSchema.fields['Delivery Address']]).placement_preference,'Front door');
  const lines=f.records.Sales.filter(r=>r.fields[f.service.foodSchema.tables.Sales.fields['Website Order ID']]===order.id);assert.equal(lines.length,1);
  assert.equal(lines[0].fields[f.service.foodSchema.tables.Sales.fields['Fulfillment Status']],'Delivered');
  assert.ok(lines[0].fields[f.service.foodSchema.tables.Sales.fields['Stock Movement At (Website)']]);
  assert.equal((await f.readFoodPortal(f.db,f.account)).orders[0].pickup_status,'collected');
});
test('monthly pickup persists its method, holds renewal without pickup capacity, and charges the same cycle once when capacity is confirmed',async()=>{
  const f=setup(),today=cadence.easternFoodDate(),tomorrow=cadence.shiftFoodDays(today,1);let charges=0;
  await f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,city:'Columbus',zip:'43215',fulfillmentMethod:'pickup'}});
  f.sql.exec('UPDATE dog_food_workflow_settings SET scheduling_enabled=1;');
  const first=await f.order({fulfillmentMethod:'pickup',routeWeekday:null,plan:'subscription',cadence:'fixed_day',monthDay:Number(today.slice(8)),billingConsent:true});
  await f.recordDogFoodPayment({db:f.db,orderId:first.orderId,provider:'stripe',reference:'pi_initial',actor:'test',amountCents:12714,paymentMethodId:'pm_fixture',stripeCustomerId:'cus_fixture'});
  await f.foodFulfillmentCommand(f.env,{action:'pickup_capacity',date:today,instructions:'Contact the office for pickup by arrangement.',bagLimit:8,stopLimit:3,confirm:true},'owner');
  await f.scheduleFoodOrders(f.env);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_subscriptions').get().n,0);
  await f.foodFulfillmentCommand(f.env,{action:'pickup_ready',orderId:first.orderId,confirm:true},'owner');
  await f.foodFulfillmentCommand(f.env,{action:'pickup_arrange',orderId:first.orderId,date:today,instructions:'Agreed pickup time and instructions',confirm:true},'owner');
  const plan=f.sql.prepare('SELECT * FROM dog_food_subscriptions').get();assert.equal(plan.fulfillment_method,'pickup');assert.equal(plan.delivery_cadence,'fixed_day');
  await f.foodFulfillmentCommand(f.env,{action:'pickup_complete',orderId:first.orderId,receivedBy:'Test Buyer',confirm:true},'owner');
  f.model.products[0].onHand=6;
  f.sql.prepare('UPDATE dog_food_subscriptions SET next_delivery_date=?,next_charge_at=? WHERE id=?').run(tomorrow,today,plan.id);
  const renewal=runPrivateInNewContext(source('dog-food-renewals.js')+'\n({runScheduledDogFoodRenewals})',{...logic,...cadence,...f.service,...f,Date,crypto,console,readFoodOperations:async()=>f.model,stripeConfigured:()=>true,createStripePaymentIntent:async args=>{
    charges++;return {id:'pi_pickup_renewal',customer:'cus_fixture',currency:'usd',status:'succeeded',amount_received:args.amountCents,metadata:{order_id:args.orderId}};
  }});
  assert.equal((await renewal.runScheduledDogFoodRenewals(f.env)).results[0].status,'capacity_review');assert.equal(charges,0);
  await f.foodFulfillmentCommand(f.env,{action:'pickup_capacity',date:tomorrow,instructions:'Office confirms the pickup arrangement.',bagLimit:6,stopLimit:3,confirm:true},'owner');
  assert.equal((await renewal.runScheduledDogFoodRenewals(f.env)).results[0].status,'captured');
  await renewal.runScheduledDogFoodRenewals(f.env);assert.equal(charges,1);
  assert.equal((await f.scheduleFoodOrders(f.env)).results[0].status,'pickup_preparing',JSON.stringify(f.sql.prepare('SELECT automation_review FROM dog_food_orders').all()));
  const cycles=f.sql.prepare("SELECT * FROM dog_food_orders WHERE source='subscription_renewal'").all();assert.equal(cycles.length,1);assert.equal(cycles[0].fulfillment_method,'pickup');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_deliveries').get().n,0);
  // The renewal cycle advances only after its actual pickup arrangement is confirmed.
  await f.foodFulfillmentCommand(f.env,{action:'pickup_ready',orderId:cycles[0].id,confirm:true},'owner');
  await f.foodFulfillmentCommand(f.env,{action:'pickup_arrange',orderId:cycles[0].id,date:tomorrow,instructions:'Verified renewal pickup arrangement',confirm:true},'owner');
  assert.ok(f.sql.prepare('SELECT next_delivery_date FROM dog_food_subscriptions').get().next_delivery_date>tomorrow);
});
test('profile requirement also blocks direct checkout APIs before any Stripe request',async()=>{
  const f=setup();let calls=0;
  const apiSource=fs.readFileSync(new URL('../app/api/dog-food/account/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const api=runPrivateInNewContext(apiSource+'\n({POST})',{Response,URL,FoodAccountError:food.FoodAccountError,getDb:()=>f.db,foodAccountSession:async()=>f.account,requireFoodProfile:f.requireFoodProfile,protectJsonRequest:async()=>({body:{action:'checkout',orderId:'foreign'}}),stripeConfigured:()=>{calls++;return true;}});
  const r=await api.POST(new Request('https://example.test/api/dog-food/account/',{method:'POST',headers:{origin:'https://example.test'},body:'{}'}));
  assert.equal(r.status,409);assert.equal(calls,0);
});
test('declined pickup renewal records failed payment without delivery, handoff or stock consumption',async()=>{
  const f=setup(),today=cadence.easternFoodDate();
  await f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,fulfillmentMethod:'pickup'}});
  f.sql.prepare(`INSERT INTO dog_food_subscriptions(id,customer_id,address_id,status,payment_provider,payment_method_token,next_delivery_date,next_charge_at,fulfillment_method)
    VALUES ('pickup-plan','buyer',?,'active','stripe','pm_fixture',?,?,'pickup')`).run((await f.requireFoodProfile(f.db,f.account)).id,today,today);
  f.sql.exec("UPDATE dog_food_customers SET stripe_customer_id='cus_fixture'; UPDATE dog_food_workflow_settings SET scheduling_enabled=1; INSERT INTO dog_food_subscription_items(id,subscription_id,product_id,quantity,unit_price_cents) VALUES ('plan-item','pickup-plan','edf-22-12-pink-40',1,5900)");
  await f.foodFulfillmentCommand(f.env,{action:'pickup_capacity',date:today,instructions:'Office pickup by arrangement.',bagLimit:8,stopLimit:3,confirm:true},'owner');
  const renewal=runPrivateInNewContext(source('dog-food-renewals.js')+'\n({runScheduledDogFoodRenewals})',{...logic,...cadence,...f.service,...f,Date,crypto,console,readFoodOperations:async()=>f.model,stripeConfigured:()=>true,createStripePaymentIntent:async()=>({id:'pi_declined',status:'requires_payment_method',last_payment_error:{decline_code:'generic_decline'}})});
  assert.equal((await renewal.runScheduledDogFoodRenewals(f.env)).results[0].status,'payment_failed');
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_subscriptions').get().status,'past_due');
  assert.equal(f.sql.prepare('SELECT status FROM dog_food_payments').get().status,'failed');
  assert.equal(f.sql.prepare('SELECT usable_bags FROM dog_food_stock_lots').get().usable_bags,8);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_pickups').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM dog_food_deliveries').get().n,0);
});
test('outside-state pickup profile saves while unsupported delivery stays closed',async()=>{
  const f=setup();await f.saveFoodProfile(f.db,f.account,{profile:{...f.savedProfile,city:'Temperance',state:'MI',zip:'48182',fulfillmentMethod:'pickup'}});
  f.setRoster({...roster,clients:[{...roster.clients[0],city:'Temperance',zip:'48182'}]});
  const view=await f.readFoodPortal(f.db,f.account);assert.equal(view.profileRequired,false);assert.equal(view.preferredFulfillment,'pickup');assert.equal(view.deliveryChoices.deliveryAvailable,false);
  await assert.rejects(f.order(),/coverage cannot be confirmed/);
  const order=await f.order({fulfillmentMethod:'pickup',routeWeekday:null});assert.equal(f.sql.prepare('SELECT delivery_fee_cents FROM dog_food_orders WHERE id=?').get(order.orderId).delivery_fee_cents,0);
});
