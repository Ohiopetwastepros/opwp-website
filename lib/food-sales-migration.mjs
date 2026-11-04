import {salesHash} from './food-sales-ledger.mjs';

// This module only proposes records. It has no DB, provider or apply capability.
// IDs in reviewed mappings must come from source exports, never name/amount matching.
export async function foodSalesMigrationDryRun(input) {
  if(input?.schemaVersion!==1||!input.asOf)throw Error('A versioned, dated export is required.');
  const exceptions=[],maps=[],imports=[],duplicates=[];
  const required={native:['customers','products','orders','items','payments','lots','subscriptions','movements'],airtable:['customers','products','sales','receipts','subscriptions','stock'],sng:['customers','invoices','payments','plans']};
  for(const [source,names] of Object.entries(required))for(const name of names) {
    if(!Array.isArray(input[source]?.[name]))throw Error(`Missing export: ${source}.${name}`);
    if(input[source][name].length>20000)throw Error(`Export exceeds reviewed bound: ${source}.${name}`);
    const seen=new Set();for(const row of input[source][name]){if(!row?.id||seen.has(row.id))exceptions.push({kind:'duplicate_source_id',source,table:name,id:row?.id});seen.add(row?.id);}
  }
  for(const [name,rows] of Object.entries(input.coverage||{}))if(rows!==true)exceptions.push({kind:'incomplete_source_coverage',source:name});
  for(const source of Object.keys(required))if(input.coverage?.[source]!==true)exceptions.push({kind:'unverified_source_coverage',source});
  const native=input.native,airtable=input.airtable,sng=input.sng,reviewed=input.reviewedMappings||{};
  function resolve(kind,source,row) {
    const target=kind==='customer'?native.customers:native.products;
    const direct=row.nativeId||null,explicit=(reviewed[kind+'s']||[]).filter(m=>m.source===source&&m.sourceId===row.id);
    const candidates=new Set([direct,...explicit.map(m=>m.nativeId)].filter(Boolean));
    if(candidates.size!==1){exceptions.push({kind:`${kind}_mapping_required`,source,id:row.id,candidates:[...candidates]});return null;}
    const id=[...candidates][0],found=target.find(t=>t.id===id);
    if(!found){exceptions.push({kind:'missing_native_identity',source,id:row.id,nativeId:id});return null;}
    if(kind==='product'&&(String(found.formula)!==String(row.formula)||found.weightLb!==row.weightLb)){exceptions.push({kind:'formula_or_weight_conflict',source,id:row.id,nativeId:id});return null;}
    maps.push({kind,source,sourceId:row.id,nativeId:id,evidence:direct?'source_native_id':explicit[0]?.evidence||'reviewed_mapping'});return id;
  }
  const customerMap=new Map(),productMap=new Map();
  for(const [source,rows] of [['airtable',airtable.customers],['sng',sng.customers]])for(const row of rows)customerMap.set(source+':'+row.id,resolve('customer',source,row));
  for(const row of airtable.products)productMap.set(row.id,resolve('product','airtable',row));
  const nativePayments=new Map(native.payments.map(p=>[p.id,p]));
  const orderTotals=new Map(native.orders.map(o=>[o.id,{totalCents:o.totalCents,receivedCents:native.payments.filter(p=>p.orderId===o.id).reduce((n,p)=>n+p.amountCents-(p.refundedCents||0),0)}]));
  const validMoney=value=>Number.isSafeInteger(value)&&value>=0;
  for(const o of native.orders)if(!validMoney(o.totalCents))exceptions.push({kind:'invalid_historical_amount',source:'native',id:o.id});
  for(const p of native.payments)if(!validMoney(p.amountCents)||!validMoney(p.refundedCents||0)||p.refundedCents>p.amountCents||!orderTotals.has(p.orderId))exceptions.push({kind:'invalid_historical_receipt',source:'native',id:p.id});
  const grouped=new Map();
  for(const sale of airtable.sales) {
    if(!validMoney(sale.totalCents)||!validMoney(sale.openingReceivedCents||0)||!sale.date||!Number.isSafeInteger(sale.quantity)||sale.quantity<=0){exceptions.push({kind:'invalid_historical_sale',source:'airtable',id:sale.id});continue;}
    const receipts=airtable.receipts.filter(r=>r.saleId===sale.id);
    if(sale.paymentEvidenceMissing){exceptions.push({kind:'historical_paid_label_without_receipt_amount',source:'airtable',id:sale.id});continue;}
    if(sale.nativeLineId) {
      const item=native.items.find(i=>i.id===sale.nativeLineId),o=item&&native.orders.find(o=>o.id===item.orderId);
      if(!item||!o||sale.nativeOrderId&&sale.nativeOrderId!==o.id){exceptions.push({kind:'broken_native_line_link',id:sale.id});continue;}
      if(item.quantity!==sale.quantity||productMap.get(sale.productId)!==item.productId)exceptions.push({kind:'projected_line_conflict',id:sale.id,nativeId:item.id});
      duplicates.push({source:'airtable',sourceId:sale.id,nativeOrderId:o.id,nativeLineId:item.id,action:'retain_projection_only'});
      maps.push({kind:'order_line',source:'airtable',sourceId:sale.id,nativeId:item.id,evidence:'exact_website_line_id'});
      if(receipts.length)exceptions.push({kind:'receipt_on_native_projection',id:sale.id,receiptIds:receipts.map(r=>r.id)});
      continue;
    }
    if(sale.nativeOrderId){exceptions.push({kind:'order_reference_without_line_identity',source:'airtable',id:sale.id,nativeOrderId:sale.nativeOrderId});continue;}
    const customerId=customerMap.get('airtable:'+sale.customerId),productId=productMap.get(sale.productId);
    const received=(sale.openingReceivedCents||0)+receipts.reduce((n,r)=>n+r.amountCents,0);
    if(receipts.some(r=>!validMoney(r.amountCents)||!r.date)||received>sale.totalCents){exceptions.push({kind:'historical_balance_conflict',id:sale.id,receivedCents:received,totalCents:sale.totalCents});continue;}
    if(!customerId||!productId){exceptions.push({kind:'historical_sale_identity_unmapped',source:'airtable',id:sale.id,customerId:sale.customerId||null,productId:sale.productId||null});continue;}
    const id='historical:airtable:'+sale.id;
    imports.push({kind:'historical_order',migrationKey:id,customerId,productId,original:sale,receipts,receivedCents:received,balanceCents:sale.totalCents-received,
      stockEffect:0,lotAllocations:[],fulfillmentHistoryOnly:true,billingAction:'none',requiredSourceTombstone:{source:'airtable',id:sale.id,nativeId:id}});
    grouped.set(id,{totalCents:sale.totalCents,receivedCents:received});
  }
  for(const p of sng.payments) {
    const mapping=(reviewed.payments||[]).filter(m=>m.source==='sng'&&m.sourceId===p.id);
    if(mapping.length===1&&nativePayments.has(mapping[0].nativeId)) {
      const existing=nativePayments.get(mapping[0].nativeId),order=native.orders.find(o=>o.id===existing.orderId);
      if(!p.verified||p.amountCents!==existing.amountCents||customerMap.get('sng:'+p.customerId)!==order?.customerId)exceptions.push({kind:'payment_mapping_conflict',id:p.id});
      else duplicates.push({source:'sng',sourceId:p.id,nativePaymentId:existing.id,action:'attach_source_evidence_only'});
    } else exceptions.push({kind:p.verified?'sng_payment_requires_exact_link':'sng_payment_unverified',id:p.id,invoiceId:p.invoiceId||null,stockEffect:0});
  }
  for(const invoice of sng.invoices)if(!invoice.lines?.length||invoice.lines.some(l=>l.businessLine!=='food'))exceptions.push({kind:'mixed_or_unclassified_invoice',id:invoice.id});
  const inventory=airtable.stock.map(stock=>{
    const productId=productMap.get(stock.productId),lots=native.lots.filter(l=>l.productId===productId),usable=lots.reduce((n,l)=>n+l.usableBags,0),reserved=lots.reduce((n,l)=>n+(l.reservedBags||0),0);
    const result={sourceId:stock.id,productId,sourceOnHand:stock.onHand,lotUsableBags:usable,reservedBags:reserved,proposedHistoricalStockDelta:0,matched:productId!=null&&stock.onHand===usable,lots};
    if(!result.matched)exceptions.push({kind:'stock_lot_reconciliation',id:stock.id,productId,sourceOnHand:stock.onHand,lotUsableBags:usable});return result;
  });
  const plans=[...native.subscriptions.map(p=>({source:'native',original:p,action:'preserve_billing'})),...airtable.subscriptions.map(p=>({source:'airtable',original:p,action:'review_exact_overlap'})),...sng.plans.map(p=>({source:'sng',original:p,action:'preserve_sng_billing'}))];
  for(const p of airtable.subscriptions)exceptions.push({kind:'recurring_plan_overlap_review',id:p.id});
  function totals(rows){return {orders:rows.length,salesCents:rows.reduce((n,o)=>n+o.totalCents,0),receivedCents:rows.reduce((n,o)=>n+o.receivedCents,0),balanceCents:rows.reduce((n,o)=>n+Math.max(0,o.totalCents-o.receivedCents),0)};}
  return {mode:'dry-run-only',dataClass:input.dataClass||'private-export',asOf:input.asOf,inputHash:await salesHash(input),
    sourceCounts:Object.fromEntries(Object.keys(required).map(s=>[s,Object.fromEntries(required[s].map(t=>[t,input[s][t].length]))])),
    before:totals([...orderTotals.values()]),proposedAfter:totals([...orderTotals.values(),...grouped.values()]),maps,duplicates,imports,exceptions,inventory,plans,
    productionReady:false,applySupported:false,proposedStockDelta:0,requiredBeforeApply:['Verify complete source exports and deployed schema','Resolve every exception and approve exact mapping evidence','Snapshot D1, Airtable and source sync cursors','Disable legacy new-sale writers and establish durable source tombstones','Separately approve reviewed migration and rollback rehearsal'],
    rollback:{strategy:'Disable new writers and workers first; retain all source evidence and commands. Restore the pre-migration snapshot only before new live transactions. After new transactions, use reviewed compensating records, never destructive replay.',historicalInventory:'No current stock decrements or lot reservations are proposed for imported history.'}};
}
