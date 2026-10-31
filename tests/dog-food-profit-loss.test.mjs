import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {foodSalesProfitLoss,monthlyFoodStockSignals,foodSalesCsv} from '../lib/dog-food-profit-loss.mjs';
import {operationModel} from '../lib/dog-food-operations.mjs';
import {ADMIN_NAVIGATION,adminGroupFor} from '../app/admin/admin-navigation.mjs';
const product={id:'pink',name:'Pink',color:'Pink',formula:'22-12',weight:40,active:true,dealerCents:4000};
const sale=(id,qty=2,extra={})=>({id,name:'Buyer',date:'2026-09-04',productId:'pink',quantity:qty,totalCents:12000,collectedCents:12000,verifiedCollectedCents:0,balanceCents:0,fulfillmentAssumed:true,receipts:[],warnings:[],...extra});
const model=()=>({products:[product],sales:[],counts:[],movements:[]});
test('recorded sales and source Paid amounts remain separate from payment evidence; Dealer Price supplies labeled margin',()=>{
  const m=model();m.sales=[sale('one'),sale('two',1,{totalCents:6000,collectedCents:2000,verifiedCollectedCents:2000,balanceCents:4000})];
  const r=foodSalesProfitLoss(m,{today:'2026-10-13'});assert.equal(r.total.recordedSalesCents,18000);assert.equal(r.total.sourceReportedPaidCents,14000);assert.equal(r.total.documentedReceiptsCents,2000);assert.equal(r.total.dealerBasisCostCents,12000);assert.equal(r.total.dealerBasisMarginCents,6000);assert.equal(r.total.verifiedGrossProfitCents,null);assert.equal(r.netProfitCents,null);
  assert.match(r.rows[0].costBasis,/Dealer Price reference/);
});
test('missing quantity stays in actual sales but never becomes zero-cost profit; missing and zero unit costs differ',()=>{
  const m=model();m.sales=[sale('known'),sale('missing',0,{totalCents:6000})];let r=foodSalesProfitLoss(m,{today:'2026-10-13'});
  assert.equal(r.total.recordedSalesCents,18000);assert.equal(r.total.costedSalesCents,12000);assert.equal(r.total.dealerBasisMarginCents,4000);assert.equal(r.total.missingCostSalesCents,6000);assert.equal(r.total.missingQuantityRecords,1);
  m.products=[{...product,dealerCents:null}];r=foodSalesProfitLoss(m,{today:'2026-10-13'});assert.equal(r.total.missingCostSalesCents,18000);assert.equal(r.total.dealerBasisMarginCents,0);
  m.products=[{...product,dealerCents:0}];assert.equal(foodSalesProfitLoss(m,{today:'2026-10-13'}).rows.find(r=>r.id==='known').referenceCostCents,0);
  m.products=[{...product,dealerCents:-4}];assert.equal(foodSalesProfitLoss(m,{today:'2026-10-13'}).total.missingCostSalesCents,18000);
});
test('personal use, test/quote, duplicates, cancellations and partial refunds stay inspectable without inflating customer P&L',()=>{
  const m=model();m.sales=[sale('customer'),sale('personal'),sale('test',2,{source:'Test'}),sale('quote',2,{source:'Quote'}),sale('cancelled',2,{cancelled:true}),sale('refund',2,{refundState:'partial_refund'}),sale('native',2,{orderId:'order',lineId:'line'}),sale('projection',2,{orderId:'order'}),sale('undated',2,{date:''})];
  const r=foodSalesProfitLoss(m,{today:'2026-10-13',costs:[{movement_id:'personal'}]});assert.equal(r.rows.length,9);assert.equal(r.total.includedCount,2);assert.equal(r.total.recordedSalesCents,24000);assert.equal(r.total.excludedCount,7);assert.equal(r.monthly[0].recordedSalesCents,24000);assert.equal(r.rows.find(r=>r.id==='personal').totalCents,12000);
});
test('monthly totals reconcile to customer source rows; documented cash conflicts are held',()=>{
  const m=model();m.sales=[sale('sep'),sale('oct',1,{date:'2026-10-03',totalCents:6000,verifiedCollectedCents:6000,warnings:['Duplicate payment reference']}),sale('future',2,{date:'2027-01-01'})];
  const r=foodSalesProfitLoss(m,{today:'2026-10-13'});assert.equal(r.monthly.reduce((n,m)=>n+m.recordedSalesCents,0),r.total.recordedSalesCents);assert.equal(r.total.cashReviewRecords,1);assert.equal(r.total.documentedReceiptsCents,0);assert.equal(r.rows.find(r=>r.id==='oct').supportedCashCents,null);
});

test('non-sale personal use preserves source evidence without creating sales, cash or business losses',()=>{
  const m=model();m.sales=[sale('customer'),sale('owner')];m.counts=[{id:'count',productId:'pink',quantity:20}];
  const before=structuredClone(m),costs=[
    {id:'family',product_id:'pink',category:'personal_family',quantity:3,unit_cost_cents:4000,actual_date:null,checkpoint_id:'count',review_status:'confirmed'},
    {id:'owner-review',product_id:'pink',category:'personal_family',quantity:2,unit_cost_cents:4000,actual_date:'2026-09-04',movement_id:'owner',review_status:'needs_review'},
    {id:'missing',product_id:'pink',category:'personal_family',quantity:1,unit_cost_cents:null,checkpoint_id:'missing-count',review_status:'confirmed'}
  ];
  const r=foodSalesProfitLoss(m,{today:'2026-10-14',costs});
  assert.deepEqual(m,before,'Reporting never changes physical stock or original sales');
  assert.equal(r.total.recordedSalesCents,12000);assert.equal(r.total.sourceReportedPaidCents,12000);assert.equal(r.total.dealerBasisMarginCents,4000);
  assert.equal(r.businessCosts.length,0);assert.equal(r.knownBusinessCostCents,0);assert.equal(r.personalUse.length,3);
  assert.equal(r.personalUse.find(c=>c.id==='family').totalCents,12000);assert.equal(r.personalUse.find(c=>c.id==='family').actual_date,null);
  assert.equal(r.personalUse.find(c=>c.id==='owner-review').linked,true);assert.equal(r.personalUse.find(c=>c.id==='owner-review').review_status,'needs_review');
  assert.equal(r.personalUse.find(c=>c.id==='missing').totalCents,null);assert.equal(r.personalUse.find(c=>c.id==='missing').linked,false);
  assert.equal(r.rows.find(s=>s.id==='owner').totalCents,12000);assert.equal(r.rows.find(s=>s.id==='owner').exclusion,'Classification review pending');
  assert.equal(r.rows.find(s=>s.id==='owner').recordCategory,'Non-sale: Personal / family use');
  assert.match(foodSalesCsv(r.rows),/recordCategory/);assert.match(foodSalesCsv(r.rows),/Non-sale: Personal \/ family use/);
});

test('confirmed personal classifications and explicit personal sources are non-sales',()=>{
  const m=model();m.sales=[sale('owner'),sale('family',1,{source:'Family'}),sale('customer')];
  const r=foodSalesProfitLoss(m,{today:'2026-10-14',costs:[{movement_id:'owner',category:'personal_family',review_status:'confirmed'}]});
  for(const id of ['owner','family']){const row=r.rows.find(s=>s.id===id);assert.equal(row.included,false);assert.equal(row.exclusion,'Non-sale: Personal / family use');assert.equal(row.referenceMarginCents,null);}
  assert.equal(r.total.includedCount,1);assert.equal(r.total.recordedSalesCents,12000);
});
test('exact gross profit requires tax-exclusive revenue and actual consumed-lot cost on every sale',()=>{
  const m=model();m.sales=[sale('exact',2,{inventoryEligible:true,fulfillmentAssumed:false,acquisitionCostCents:4200,revenueCents:11800})];let r=foodSalesProfitLoss(m,{today:'2026-10-13'});assert.equal(r.total.verifiedGrossProfitCents,3400);assert.equal(r.rows[0].exactCostCents,8400);assert.equal(r.rows[0].referenceCostCents,8000,'Dealer basis and actual lot cost stay separate');
  m.sales.push(sale('legacy'));r=foodSalesProfitLoss(m,{today:'2026-10-13'});assert.equal(r.total.verifiedGrossProfitCents,null);
});
test('source partial placeholders are retained in full sales detail while operational calculations stay unchanged',()=>{
  const m=operationModel({tables:{Products:[],Sales:[{id:'blank',fields:{Notes:'Partial form'}},{id:'dated-empty',fields:{'Sale Date':'2026-10-01',Notes:'Incomplete quote'}}]}});
  assert.equal(m.sales.length,0);assert.equal(m.salesPlaceholders.length,2);
  const r=foodSalesProfitLoss(m,{today:'2026-10-13'});assert.equal(r.rows.length,2);assert.equal(r.total.recordedSalesCents,0);assert.equal(r.total.excludedCount,2);assert.equal(r.rows.find(r=>r.id==='blank').notes,'Partial form');
});
test('stock benchmarks compare previous full calendar months, exclude MTD and preserve incomplete-history labels',()=>{
  const usage=[['2026-07',3],['2026-08',6],['2026-09',9],['2026-10',99]].map(([month,bags])=>({month,formulas:[{productId:'pink',bags,complete:false,records:[month]}]}));
  const r=monthlyFoodStockSignals([product],usage,[{productId:'pink',available:7}],'2026-10-13')[0];assert.equal(r.averageThreeMonths,6);assert.equal(r.previousMonthBags,9);assert.equal(r.peakThreeMonths,9);assert.equal(r.benchmarkBags,9);assert.equal(r.benchmarkGapBags,2);assert.equal(r.complete,false);assert.equal(r.records.length,3);
  assert.equal(monthlyFoodStockSignals([product],usage,[{productId:'pink',available:null}],'2026-10-13')[0].benchmarkGapBags,null);
});
test('website navigation routes to protected dog-food pages; server auth precedes all inventory and financial reads',()=>{
  const group=ADMIN_NAVIGATION.find(g=>g.id==='dog-food');assert.ok(group.items.some(i=>i.href==='/admin/dog-food/inventory/'));assert.ok(group.items.some(i=>i.href==='/admin/dog-food/profit-loss/'));assert.equal(adminGroupFor('food-profit').id,'dog-food');
  const server=fs.readFileSync(new URL('../app/admin/dog-food/DogFoodWorkspacePage.js',import.meta.url),'utf8');assert.ok(server.indexOf('if(!auth.authorized)redirect')<server.indexOf('const data=await readFoodOperations'));assert.match(server,/verifyAdminRequest\(await headers\(\)\)/);
  for(const path of ['inventory','profit-loss']){const source=fs.readFileSync(new URL(`../app/admin/dog-food/${path}/page.js`,import.meta.url),'utf8');assert.match(source,/DogFoodWorkspacePage/);assert.match(source,/index:false/);}
});
test('sales CSV uses dollar units, preserves missing costs and blocks spreadsheet formulas including leading whitespace',()=>{
  const text=foodSalesCsv([{id:'one',name:'   =HYPERLINK("https://invalid.test")',quantity:2,totalCents:12000,referenceCostCents:null,notes:'Line one\nLine two, "quoted"'}]);
  assert.match(text,/totalUSD/);assert.doesNotMatch(text.split('\r\n')[0],/totalCents/);assert.match(text,/"120\.00"/);assert.match(text,/"'    =HYPERLINK/);assert.match(text,/Line two, ""quoted""/);
});
