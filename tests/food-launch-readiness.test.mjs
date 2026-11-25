import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {fixture} from './helpers/dog-food-fixture.mjs';import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {applyFoodOpeningVerification,readFoodLaunchGate,readFoodLaunchReadiness} from '../lib/food-launch-readiness.mjs';
import {FoodError,operationModel,foodDate} from '../lib/dog-food-operations.mjs';import {readBoundedBytes} from '../lib/bounded-body.mjs';
import release from '../lib/deployment-release.json' with {type:'json'};
const sqlFile=n=>fs.readFileSync(new URL('../schema-proposals/'+n,import.meta.url),'utf8');
test('optional intake migration retains original preferences and consent timestamps without inferring consent for a current phone',()=>{
  const f=fixture(undefined,{optionalIntake:false});f.sql.exec("INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES('legacy','Example','Person','legacy@example.test','4195550123');INSERT INTO dog_food_customer_profiles(customer_id,dog_count,service_frequency,preferred_fulfillment,notes,sms_consent_at,created_by,updated_by) VALUES('legacy',3,'monthly','pickup','Retain this note','2026-10-01 12:00:00','office','office');");
  const before=f.sql.prepare('SELECT * FROM dog_food_customer_profiles').get();f.sql.exec(sqlFile('0065_food_customer_optional_intake.sql'));const after=f.sql.prepare('SELECT * FROM dog_food_customer_profiles').get();for(const k of Object.keys(before))assert.equal(after[k],before[k]);assert.equal(after.sms_consent_phone,null);
  const history=f.sql.prepare('SELECT * FROM dog_food_customer_consent_events').get();assert.equal(history.consent_at,before.sms_consent_at);assert.equal(history.status,'migrated');assert.throws(()=>f.sql.exec('DELETE FROM dog_food_customer_consent_events'),/retained/);
  f.sql.exec("UPDATE dog_food_customer_profiles SET dog_count=NULL,service_frequency=NULL,sms_consent_at=NULL");assert.equal(f.sql.prepare('SELECT dog_count FROM dog_food_customer_profiles').get().dog_count,null);
});
test('old checkpoints remain provisional and a fixed launch date does not drift with a later settings update',()=>{
  const model={products:[{id:'pink',active:true,confirmed:true,countDate:'2026-10-01',onHand:20,available:18,reserved:2}],metrics:{stockBags:20},issues:[]};applyFoodOpeningVerification(model,{created_at:'2026-11-13 15:00:00',updated_at:'2026-11-20 12:00:00'});assert.equal(model.products[0].onHand,null);assert.equal(model.products[0].provisionalOnHand,20);assert.equal(model.products[0].reserved,2);assert.equal(model.inventoryOpening.requiredFromDate,'2026-11-13');
});
test('public ordering remains held for missing proof, test credentials, stale release proof, or missing physical stock',async()=>{
  const f=setup();f.sql.exec(sqlFile('0064_independent_food_backend.sql'));f.sql.exec(sqlFile('0066_food_source_reconciliation.sql'));
  const live={STRIPE_SECRET_KEY:'sk_live_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',RESEND_API_KEY:'synthetic',EMAIL_SENDING_ENABLED:'true'};
  assert.equal((await readFoodLaunchGate(f.db,live)).orderingAvailable,false);
  f.sql.prepare("UPDATE dog_food_launch_readiness SET public_ordering_enabled=1,inventory_opening_verified_at=CURRENT_TIMESTAMP,sources_reviewed_at=CURRENT_TIMESTAMP,checkout_test_verified_at=CURRENT_TIMESTAMP,saved_card_test_verified_at=CURRENT_TIMESTAMP,email_verified_at=CURRENT_TIMESTAMP,approved_by='synthetic-owner',approved_at=CURRENT_TIMESTAMP,security_reviewed_source_hash=?").run(release.sourceHash||'not-a-release');
  f.sql.exec('UPDATE dog_food_workflow_settings SET posting_enabled=1,scheduling_enabled=1,email_enabled=1');
  assert.equal((await readFoodLaunchGate(f.db,{...live,STRIPE_SECRET_KEY:'sk_test_synthetic'})).orderingAvailable,false);
  f.sql.exec("UPDATE dog_food_launch_readiness SET security_reviewed_source_hash='stale'");assert.equal((await readFoodLaunchGate(f.db,live)).orderingAvailable,false);
  const m=await f.service.readFoodOperations(f.db);assert.equal((await readFoodLaunchReadiness(f.db,live,m)).orderingAvailable,false);assert.equal(m.products.find(p=>p.active).onHand,null);
});
test('native legacy sources remain in the unified view, with actual captured provider taking precedence over an entered method',()=>{
  const snapshot={tables:{Products:[{id:'pink',fields:{'Product Name':'Pink','Formula Code':'22-12','Bag Weight':40,'Active Status':true,'Website Product ID':'pink'}}]}};
  const o={id:'legacy',source:'website',first_name:'Example',last_name:'Person',created_at:foodDate()+' 12:00:00',total_cents:5900,tax_rate_basis_points:0,sale_payment_method:'cash',itemDetails:[{id:'item-legacy',product_id:'pink',quantity:1,unit_price_cents:5900,line_total_cents:5900}]};
  const m=operationModel(snapshot,{orders:[o],payments:[{order_id:o.id,status:'captured',provider:'stripe',amount_cents:5900}]});assert.equal(m.sales.length,1);assert.equal(m.sales[0].paymentMethod,'Stripe');assert.equal(m.sales[0].lineId,'item-legacy');
});
test('source review and launch-readiness routes require owner access and reject cross-site or oversized mutations',async()=>{
  const src=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');let authorized=false,calls=0;
  const ctx={Response,URL,FoodError,readBoundedBytes,TextDecoder,verifyAdminRequest:async()=>({authorized,email:'owner@example.test'}),getRuntimeEnv:()=>({DB:{}}),checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({}, {status:429}),salesHeaders:{'Cache-Control':'private, no-store'},salesError:e=>Response.json({error:e.message},{status:e instanceof FoodError?e.status:e instanceof RangeError?413:400}),readFoodOperations:async()=>{calls++;return {};},readFoodLaunchReadiness:async()=>({orderingAvailable:false}),reviewFoodSourceLine:async()=>{calls++;return {};}};
  const source=vm.runInNewContext(src('app/api/admin/dog-food/reconciliation/route.js')+'\n({GET,POST})',{...ctx}),ready=vm.runInNewContext(src('app/api/admin/dog-food/readiness/route.js')+'\n({GET})',{...ctx});
  const request=(origin='https://example.test',body='{}')=>new Request('https://example.test/api/admin/dog-food/reconciliation/',{method:'POST',headers:{origin},body});assert.equal((await source.POST(request())).status,401);assert.equal((await ready.GET(new Request('https://example.test/'))).status,401);authorized=true;
  assert.equal((await source.POST(request('https://other.test'))).status,403);assert.equal((await source.POST(request('https://example.test','x'.repeat(17000)))).status,413);assert.equal(calls,0);assert.equal((await ready.GET(new Request('https://example.test/'))).status,200);
});
