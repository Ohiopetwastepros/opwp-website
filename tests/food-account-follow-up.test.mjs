import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {customerBody} from './helpers/food-customer-input.mjs';
import * as hub from '../lib/food-customer-hub.mjs';
import {FoodError} from '../lib/dog-food-operations.mjs';
import {foodStaffCustomerContactComplete,foodStaffCustomerComplete} from '../lib/food-customer-intake.mjs';

const source=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function sourceLinks(f){f.sql.exec(fs.readFileSync(new URL('../schema-proposals/0066_food_source_reconciliation.sql',import.meta.url),'utf8'));}
function contact(f,id,extra={}){
  const c={first_name:'Synthetic',last_name:id,email:'',phone:'',sng_client_id:null,stripe_customer_id:null,...extra};
  f.sql.prepare('INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,sng_client_id,stripe_customer_id) VALUES(?,?,?,?,?,?,?)').run(id,c.first_name,c.last_name,c.email,c.phone,c.sng_client_id,c.stripe_customer_id);
  return id;
}

test('manual contact readiness uses first and last name while existing external-billing intake still requires phone',()=>{
  const c={first_name:'First',last_name:'Last',phone:''},a={line1:'123 Test',city:'Toledo',state:'OH',postal_code:'43614',placement_preference:'Front door'};
  assert.equal(foodStaffCustomerContactComplete(c),true);
  assert.equal(foodStaffCustomerComplete(c,a,'pickup'),false);
  for(const key of ['first_name','last_name']){
    assert.equal(foodStaffCustomerContactComplete({...c,[key]:''}),false);
    assert.equal(foodStaffCustomerContactComplete({...c,[key]:'  '}),false);
  }
});

test('a complete stored contact and profile alone still need an account; portal and billing links clear the current flag',async()=>{
  const f=setup();sourceLinks(f);
  const created=await hub.foodCustomerCommand(f.db,customerBody(),'seller');
  const directory=(await hub.readFoodCustomerHub(f.db,{id:created.id})).customers[0];
  assert.equal(directory.establishedAccount,false);assert.equal(directory.needsAccountCreated,true);
  assert.ok(directory.revision);assert.ok(directory.addresses.length);assert.ok(directory.email);assert.ok(directory.phone);
  const staff=await hub.readStaffFoodCustomerIntake(f.db,created.id);assert.equal(staff.needsAccountCreated,true);assert.equal(staff.contactComplete,true);
  const types=[['sng',{sng_client_id:'sng-synthetic'}],['stripe',{stripe_customer_id:'cus_synthetic'}],['portal',{}],['source-sng',{}],['source-stripe',{}]];
  for(const [id,fields] of types){
    contact(f,id,fields);
    if(id==='portal')f.sql.prepare("INSERT INTO dog_food_accounts(id,email,customer_id,password_hash) VALUES('portal-only','portal@example.test',?,'fixture-hash')").run(id);
    if(id.startsWith('source-'))f.sql.prepare("INSERT INTO dog_food_source_customer_links(provider,external_id,customer_id,evidence,linked_by) VALUES(?,?,?,'{}','synthetic-owner')").run(id==='source-sng'?'sweep_and_go':'stripe','linked-'+id,id);
    const c=(await hub.readFoodCustomerHub(f.db,{id})).customers[0];
    assert.equal(c.establishedAccount,true,id);assert.equal(c.needsAccountCreated,false,id);
    assert.equal((await hub.readStaffFoodCustomerIntake(f.db,id)).needsAccountCreated,false,id);
  }
  f.sql.prepare("UPDATE dog_food_customers SET customer_type='route_partner',airtable_record_id='recSynthetic' WHERE id=?").run(created.id);
  f.sql.prepare("INSERT INTO dog_food_sales_customer_sources(source_table,source_record_id,customer_id,source_hash,imported_by) VALUES('Customers','recSynthetic',?,'fixture-hash','owner')").run(created.id);
  assert.equal((await hub.readFoodCustomerHub(f.db,{id:created.id})).customers[0].needsAccountCreated,true);
});

test('blank provider identities and unverified portal rows do not satisfy the established-account rule',async()=>{
  const f=setup();sourceLinks(f);contact(f,'blank',{sng_client_id:'   ',stripe_customer_id:''});
  f.sql.exec("INSERT INTO dog_food_accounts(id,email,customer_id,password_hash,verified_at) VALUES('blank-account','blank@example.test','blank','fixture-hash',''); INSERT INTO dog_food_source_customer_links(provider,external_id,customer_id,evidence,linked_by) VALUES('stripe','  ','blank','{}','owner')");
  const c=(await hub.readFoodCustomerHub(f.db,{id:'blank'})).customers[0];
  assert.equal(c.establishedAccount,false);assert.equal(c.needsAccountCreated,true);
});

test('office account filters run before pagination and combine with status and contact search',async()=>{
  const f=setup();sourceLinks(f);
  for(let n=0;n<105;n++)contact(f,'established-'+n,{last_name:'AAA'+String(n).padStart(3,'0'),sng_client_id:'sng-'+n});
  for(let n=0;n<102;n++)contact(f,'needed-'+n,{last_name:'ZZZ'+String(n).padStart(3,'0')});
  f.sql.exec("UPDATE dog_food_customers SET status='inactive' WHERE id='needed-101'");
  contact(f,'deleted',{last_name:'ZZZ999'});f.sql.exec("UPDATE dog_food_customers SET deleted_at=CURRENT_TIMESTAMP WHERE id='deleted'");
  const first=await hub.readFoodCustomerHub(f.db,{accountStatus:'needs_account'});
  assert.equal(first.customers.length,100);assert.equal(first.hasMore,true);assert.ok(first.customers.every(c=>c.needsAccountCreated));
  const second=await hub.readFoodCustomerHub(f.db,{accountStatus:'needs_account',offset:100});
  assert.equal(second.customers.length,2);assert.equal(second.hasMore,false);
  assert.deepEqual(second.customers.map(c=>c.id),['needed-100','needed-101']);
  const active=await hub.readFoodCustomerHub(f.db,{accountStatus:'needs_account',status:'active',q:'ZZZ10'});
  assert.deepEqual(active.customers.map(c=>c.id),['needed-100']);
  assert.equal((await hub.readFoodCustomerHub(f.db,{q:'ZZZ100',accountStatus:'established'})).customers.length,0);
  const established=await hub.readFoodCustomerHub(f.db,{accountStatus:'established'});
  assert.equal(established.customers.length,100);assert.ok(established.customers.every(c=>!c.needsAccountCreated&&c.establishedAccount));
  await assert.rejects(hub.readFoodCustomerHub(f.db,{accountStatus:"' OR 1=1 --"}),/account/i);
});

test('the protected office API exposes account follow-up flags and forwards the server-side filter',async()=>{
  const f=setup();contact(f,'needs-office');let providerCalls=0;
  const route=vm.runInNewContext(source('app/api/admin/dog-food/customers/route.js')+'\n({GET})',{
    ...hub,verifyAdminRequest:async()=>({authorized:true,email:'owner@example.test'}),getRuntimeEnv:()=>({DB:f.db}),
    checkRateLimit:async()=>({allowed:true}),salesHeaders:{},salesError:e=>Response.json({error:e.message},{status:e.status||500}),
    flushFoodCustomerMessages:()=>{providerCalls++;},readFoodOperations:async()=>{throw Error('A directory filter must not read provider operations');},FoodError,Response,URL,
  });
  const response=await route.GET(new Request('https://example.test/api/admin/dog-food/customers/?accountStatus=needs_account'));
  assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.customers.map(c=>c.id),['needs-office']);assert.equal(data.customers[0].needsAccountCreated,true);
  assert.equal(providerCalls,0);
});
