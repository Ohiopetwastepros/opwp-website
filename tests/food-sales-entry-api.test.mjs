import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import * as auth from '../lib/food-sales-auth.mjs';
import * as ledger from '../lib/food-sales-ledger.mjs';
import * as logic from '../lib/dog-food-operations.mjs';

const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const count=(f,table)=>f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n;
const origin='https://example.test';
async function staffApi(){
  const f=setup();
  f.sql.exec("DELETE FROM dog_food_stock_lots; UPDATE dog_food_sales_settings SET stock_basis='confirmed_count'");
  f.sql.exec(fs.readFileSync(new URL('../schema-proposals/0066_food_source_reconciliation.sql',import.meta.url),'utf8'));
  f.sql.prepare('UPDATE dog_food_launch_readiness SET created_at=?').run(logic.foodDate()+' 17:00:00');
  const env={DB:f.db,FOOD_SALES_NATIVE_ENABLED:'true',FOOD_SALES_RECORDING_ENABLED:'true',FOOD_SALES_USE_PREVIOUS_COUNTS:'true'};
  const api=vm.runInNewContext(source('lib/food-sales-api.js')+'\n({foodSalesContext,salesError,salesHeaders})',{
    getRuntimeEnv:()=>env,verifyFoodSalesRequest:auth.verifyFoodSalesRequest,verifyAdminRequest:async()=>({authorized:false}),
    checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>{throw Error('Unexpected rate limit');},FoodError:logic.FoodError,Response,URL,
  });
  const route=vm.runInNewContext(source('app/api/food-sales/route.js')+'\n({GET,POST})',{
    ...api,foodSalesService:f.sales,...ledger,...logic,readBoundedBytes:async r=>new Uint8Array(await r.arrayBuffer()),Response,URL,TextDecoder,JSON,
  });
  const signed=await auth.authenticateFoodSales(f.db,'seller@example.test','fixture-only',async()=>true);
  assert.equal(signed.authorized,true);
  assert.equal(f.sql.prepare("SELECT role FROM route_partner_members WHERE id='seller'").get().role,'viewer');
  const headers={cookie:auth.FOOD_SALES_COOKIE+'='+signed.token,origin,'Content-Type':'application/json'};
  const post=body=>route.POST(new Request(origin+'/api/food-sales/',{method:'POST',headers,body:JSON.stringify(body)}));
  const get=()=>route.GET(new Request(origin+'/api/food-sales/',{headers}));
  const draft={action:'save',commandId:crypto.randomUUID(),intakeVersion:3,customerId:'buyer',items:[{productId:'edf-22-12-pink-40',quantity:1}],
    billingProvider:'manual',includeTax:false,fulfillmentMethod:'pickup',fulfillmentStatus:'completed',handoffConfirmed:true,receivedBy:'Synthetic Buyer',
    paymentMethod:'cash',amountReceivedCents:6000,paymentReceivedConfirmed:true,paymentStatus:'paid'};
  async function priced(){
    const response=await post({...draft,action:'quote'});assert.equal(response.status,200);
    const {result}=await response.json();assert.equal(result.total,6000);assert.equal(result.tax,0);
    return {...draft,quoteHash:result.quoteHash};
  }
  return {...f,post,get,priced};
}

test('a viewer can quote and complete a manual sale with previous verified counts, then retry without duplicating it',async()=>{
  const f=await staffApi(),providerCalls=f.calls();
  const before=Object.fromEntries(['dog_food_customer_messages','dog_food_accounts','dog_food_sales_invitations'].map(table=>[table,count(f,table)]));
  assert.equal((await f.sales.inventory(f.db)).configured,false,'launch checks require current counts unless the staff flag permits previous counts');
  const initial=await f.get();assert.equal(initial.status,200);
  const data=await initial.json();assert.equal(data.office,false);assert.equal(data.recordingEnabled,true);assert.equal(data.stockBasis,'confirmed_count');assert.equal(data.inventoryConfigured,true);
  const body=await f.priced(),first=await f.post(body);assert.equal(first.status,200);
  const saved=(await first.json()).result;
  assert.equal(saved.totalCents,6000);assert.equal(saved.receivedCents,6000);assert.equal(saved.balanceCents,0);assert.equal(saved.fulfillmentStatus,'completed');
  const again=await f.post(body);assert.equal(again.status,200);assert.deepEqual((await again.json()).result,saved);
  assert.equal(count(f,'dog_food_orders'),1);assert.equal(count(f,'dog_food_payments'),1);assert.equal(count(f,'dog_food_sales_handoffs'),1);assert.equal(count(f,'dog_food_sales_commands'),1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM dog_food_ops_audit WHERE action='food_sales_save'").get().n,1);
  assert.equal(f.sql.prepare('SELECT tax_cents FROM dog_food_orders').get().tax_cents,0);
  assert.equal((await f.sales.inventory(f.db,{allowPreviousCounts:true})).products.find(p=>p.id===body.items[0].productId).available,7);
  assert.equal(f.calls(),providerCalls,'the entry and replay must not call an external provider');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM dog_food_transactional_outbox WHERE status<>'cancelled'").get().n,0,'staff-sale triggers leave no sendable email or SMS');
  for(const [table,n] of Object.entries(before))assert.equal(count(f,table),n,`${table} is unchanged`);
});

test('a viewer can quote an incomplete client but saving requires its name and phone, with a definitive rejection and no order',async()=>{
  for(const field of ['first_name','last_name','phone']){
    const f=await staffApi();f.sql.exec(`UPDATE dog_food_customers SET ${field}='' WHERE id='buyer'`);
    const body=await f.priced(),response=await f.post(body);assert.equal(response.status,409,field);
    const error=await response.json();assert.match(error.error,/customer name and phone/);assert.equal(error.definitive,true);assert.equal(error.uncertain,false);
    for(const table of ['dog_food_orders','dog_food_order_items','dog_food_payments','dog_food_sales_commands','dog_food_sales_count_allocations','dog_food_sales_handoffs'])assert.equal(count(f,table),0,`${field}: ${table}`);
    assert.equal(f.sql.prepare("SELECT command_token FROM dog_food_ops_state WHERE id='org-opwp'").get().command_token,null);
  }
});
