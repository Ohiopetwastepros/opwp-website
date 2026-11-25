import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {foodSalesMigrationDryRun} from '../lib/food-sales-migration.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/food-sales-migration.json',import.meta.url),'utf8'));
test('repeatable historical dry run preserves amounts, dates, references and stock; collapses only exact source links',async()=>{
  const input=fixture(),before=JSON.stringify(input),a=await foodSalesMigrationDryRun(input),b=await foodSalesMigrationDryRun(input);
  assert.deepEqual(a,b);assert.equal(JSON.stringify(input),before);assert.equal(a.duplicates.length,2);
  assert.deepEqual(a.before,{orders:1,salesCents:6357,receivedCents:3000,balanceCents:3357});
  assert.deepEqual(a.proposedAfter,{orders:2,salesCents:18357,receivedCents:9000,balanceCents:9357});
  assert.equal(a.imports[0].original.date,'2026-09-01');assert.equal(a.imports[0].receipts[0].reference,'check-102');
  assert.equal(a.proposedStockDelta,0);assert.equal(a.imports[0].stockEffect,0);assert.equal(a.inventory[0].matched,true);
  assert.equal(a.plans.find(p=>p.source==='sng').action,'preserve_sng_billing');assert.equal(a.applySupported,false);
  assert.deepEqual(a.exceptions.map(e=>e.kind).sort(),['mixed_or_unclassified_invoice','recurring_plan_overlap_review','sng_payment_requires_exact_link'].sort());
});
test('missing exports, unknown customer links, product mismatch and stale stock cannot pass review',async()=>{
  const missing=fixture();delete missing.native.lots;await assert.rejects(foodSalesMigrationDryRun(missing),/Missing export/);
  const input=fixture();input.airtable.customers[0].nativeId=null;input.airtable.products[0].weightLb=20;input.airtable.stock[0].onHand=99;
  const result=await foodSalesMigrationDryRun(input);assert.equal(result.imports.length,0);assert.equal(result.productionReady,false);
  assert.ok(result.exceptions.some(e=>e.kind==='customer_mapping_required'));assert.ok(result.exceptions.some(e=>e.kind==='formula_or_weight_conflict'));assert.ok(result.exceptions.some(e=>e.kind==='stock_lot_reconciliation'));
});
test('unmapped legacy sales, paid labels without amounts and order links without line IDs remain explicit exceptions',async()=>{
  const input=fixture(),legacy=input.airtable.sales[1];
  input.airtable.sales.push({...legacy,id:'missing-customer',customerId:'not-linked'});
  input.airtable.sales.push({...legacy,id:'paid-label-only',paymentEvidenceMissing:true});
  input.airtable.sales.push({...legacy,id:'order-without-line',nativeOrderId:'order-1'});
  const result=await foodSalesMigrationDryRun(input);
  assert.equal(result.imports.length,1);
  for(const kind of ['historical_sale_identity_unmapped','historical_paid_label_without_receipt_amount','order_reference_without_line_identity'])assert.ok(result.exceptions.some(e=>e.kind===kind));
});
