const sum=(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0);
const whole=n=>Number.isSafeInteger(n)&&n>0;
const validDay=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const notCustomer=s=>/^(test|demo|sample)(\b|[-_ ])/i.test(s.name||'')||/^(draft|quote|test|transfer|personal|family)$/i.test(s.source||'');
export const personalUseLabel='Non-sale: Personal / family use';
export function foodSalesCsv(rows) {
  const fields=['id','name','date','productName','quantity','totalCents','supportedCashCents','collectedCents','balanceCents','unitReferenceCents','referenceCostCents','referenceMarginCents','exactGrossProfitCents','recordedPaymentStatus','paymentMethod','fulfillment','fulfillmentAssumed','sourceLabel','recordCategory','included','exclusion','costBasis','responsible','customerType','distributionCenter','createdAt','notes'];
  const escape=value=>'"'+String(value??'').replace(/^\s*[=+@\t\r-]/,"' $&").replaceAll('"','""')+'"';
  return [fields.map(k=>k.replace(/Cents$/,'USD')).join(','),...rows.map(r=>fields.map(k=>escape(k.endsWith('Cents')&&r[k]!=null?(r[k]/100).toFixed(2):r[k])).join(','))].join('\r\n');
}

// All dollars originate in the operating snapshot. Dealer Price is an explicit
// reference basis, not an assertion that every historical lot cost that amount.
export function foodSalesProfitLoss(model,{costs=[],today}={}) {
  const products=model.products||[],annotations=new Map(costs.filter(c=>c.movement_id).map(c=>[c.movement_id,c])),seen=new Set();
  const rows=[...(model.sales||[]),...(model.salesPlaceholders||[])].sort((a,b)=>Number(Boolean(b.lineId))-Number(Boolean(a.lineId))).map(s=>{
    const product=products.find(p=>p.id===s.productId),annotation=annotations.get(s.id),key=s.orderId?`order:${s.orderId}:${s.productId}`:s.lineId?`line:${s.lineId}`:s.sngJobId?`job:${s.sngJobId}:${s.productId}`:null;
    const duplicate=Boolean(key&&seen.has(key));if(key)seen.add(key);
    const personal=annotation?.category==='personal_family'||/^(personal|family)$/i.test(s.source||''),recordCategory=personal?personalUseLabel:'Customer sale / other source';
    const exclusion=!s.id?'Missing source record identifier':s.sourcePlaceholder?'Incomplete source record / partial quote':annotation?(annotation.review_status!=='confirmed'?'Classification review pending':personal?personalUseLabel:'Non-sale adjustment'):duplicate?'Duplicate projection':notCustomer(s)?personal?personalUseLabel:'Test / quote / transfer':s.cancelled||s.refundState?'Cancelled / refund review':!validDay(s.date)||s.date>today?'Missing / future sale date':!Number.isSafeInteger(s.totalCents)||!(s.totalCents>0)?'Unpriced / complimentary review':null;
    const included=!exclusion,quantity=whole(s.quantity)?s.quantity:null,unitReference=Number.isSafeInteger(product?.dealerCents)&&product.dealerCents>=0?product.dealerCents:null,
      referenceCost=quantity!=null&&unitReference!=null?quantity*unitReference:null,
      exactCost=quantity!=null&&s.acquisitionCostCents!=null?Math.round(quantity*s.acquisitionCostCents):null,
      recordedCash=s.verifiedCollectedCents??0,cashConflict=(s.warnings||[]).some(w=>/Duplicate payment|Payments exceed/.test(w));
    return {...s,date:s.date||'',quantity,recordCategory,unitReferenceCents:unitReference,referenceCostCents:referenceCost,exactCostCents:exactCost,included,exclusion,
      recordedCashCents:recordedCash,cashConflict,supportedCashCents:cashConflict?null:recordedCash,
      referenceMarginCents:included&&referenceCost!=null?s.totalCents-referenceCost:null,
      exactGrossProfitCents:included&&!s.fulfillmentAssumed&&s.inventoryEligible&&exactCost!=null&&s.revenueCents!=null?s.revenueCents-exactCost:null,
      costBasis:exactCost!=null?'Consumed lot acquisition cost':referenceCost!=null?'Airtable Dealer Price reference':'Quantity or Dealer Price missing',
      sourceLabel:s.lineId?'Native website ledger / Airtable projection':'Airtable direct sale',
      review:[...(s.warnings||[]),...(s.reportingWarnings||[]),...(exclusion?[exclusion]:[])]};
  }).sort((a,b)=>b.date.localeCompare(a.date)||String(a.id||'').localeCompare(String(b.id||'')));
  const summarize=selected=>{
    const included=selected.filter(r=>r.included),costed=included.filter(r=>r.referenceCostCents!=null),unpriced=included.filter(r=>r.referenceCostCents==null),exact=included.filter(r=>r.exactGrossProfitCents!=null);
    return {recordCount:selected.length,includedCount:included.length,excludedCount:selected.length-included.length,
      recordedSalesCents:sum(included,r=>r.totalCents),knownBags:sum(included,r=>r.quantity||0),missingQuantityRecords:included.filter(r=>r.quantity==null).length,
      documentedReceiptsCents:sum(included.filter(r=>!r.cashConflict),r=>r.supportedCashCents),cashReviewRecords:included.filter(r=>r.cashConflict).length,
      sourceReportedPaidCents:sum(included,r=>r.collectedCents||0),sourceOutstandingCents:sum(included,r=>r.balanceCents||0),
      dealerBasisCostCents:sum(costed,r=>r.referenceCostCents),costedSalesCents:sum(costed,r=>r.totalCents),dealerBasisMarginCents:sum(costed,r=>r.referenceMarginCents),
      missingCostSalesCents:sum(unpriced,r=>r.totalCents),missingCostRecords:unpriced.length,
      verifiedGrossProfitCents:included.length&&exact.length===included.length?sum(exact,r=>r.exactGrossProfitCents):null,
      records:included.map(r=>r.id),costedRecords:costed.map(r=>r.id),missingCostIds:unpriced.map(r=>r.id)};
  };
  const months=[...new Set(rows.filter(r=>validDay(r.date)&&r.date<=today).map(r=>r.date.slice(0,7)))].sort();
  const monthly=months.map(month=>({month,...summarize(rows.filter(r=>r.date.slice(0,7)===month))}));
  const formulas=products.filter(p=>p.active||rows.some(r=>r.productId===p.id)).map(p=>({productId:p.id,name:p.name,color:p.color,formula:p.formula,weight:p.weight,unitReferenceCents:p.dealerCents??null,...summarize(rows.filter(r=>r.productId===p.id))}));
  const businessCosts=costs.filter(c=>c.category!=='personal_family'&&c.review_status==='confirmed'&&(c.checkpoint_id?(model.counts||[]).some(r=>r.id===c.checkpoint_id&&r.productId===c.product_id):(model.movements||[]).some(r=>r.id===c.movement_id&&r.productId===c.product_id))).map(c=>({...c,totalCents:c.unit_cost_cents==null?null:c.quantity*c.unit_cost_cents}));
  const personalUse=costs.filter(c=>c.category==='personal_family').map(c=>({...c,
    productName:products.find(p=>p.id===c.product_id)?.name||c.product_id,
    linked:c.checkpoint_id?(model.counts||[]).some(r=>r.id===c.checkpoint_id&&r.productId===c.product_id):[...(model.movements||[]),...(model.sales||[])].some(r=>r.id===c.movement_id&&r.productId===c.product_id),
    totalCents:c.unit_cost_cents==null?null:c.quantity*c.unit_cost_cents}));
  return {rows,monthly,formulas,total:summarize(rows),businessCosts,personalUse,
    knownBusinessCostCents:sum(businessCosts,c=>c.totalCents||0),undatedBusinessCostCents:sum(businessCosts.filter(c=>!c.actual_date),c=>c.totalCents||0),
    netProfitCents:null,
    limitations:['Recorded sales amounts are source values, including billed but unpaid sales. Legacy Paid labels are source-reported payment state, not verified cash.',
      'Dealer-basis margin uses each sale’s bag quantity × current Airtable Dealer Price. It is an operating estimate, not verified historical COGS; later purchase costs, tax, merchant fees and overhead may be missing.',
      'Missing quantities or costs stay in recorded sales but outside the costed margin subtotal. Compare those unmatched sales separately; they are never assigned zero cost.',
      'Personal/family use stays outside customer revenue and business spoilage. Unknown damage, expiration and undated expenses prevent a complete net profit/loss. No accounting entry is posted.']};
}

export function monthlyFoodStockSignals(products,usage,replenishment,today) {
  const prior=usage.filter(m=>m.month<today.slice(0,7)).slice(-3);
  return products.filter(p=>p.active).map(p=>{
    const months=prior.map(m=>{const f=m.formulas.find(f=>f.productId===p.id);return {month:m.month,bags:f?.bags??0,complete:Boolean(f?.complete),records:f?.records||[]};});
    const latest=months.at(-1),average=months.length?sum(months,m=>m.bags)/months.length:null,peak=months.length?Math.max(...months.map(m=>m.bags)):null,
      r=replenishment.find(r=>r.productId===p.id),available=r?.available??null,benchmark=average==null?null:Math.ceil(Math.max(average,latest?.bags||0));
    return {productId:p.id,name:p.name,color:p.color,formula:p.formula,weight:p.weight,months,previousMonthBags:latest?.bags??null,
      averageThreeMonths:average==null?null:Math.round(average*10)/10,peakThreeMonths:peak,benchmarkBags:benchmark,available,
      benchmarkGapBags:available==null||benchmark==null?null:Math.max(0,benchmark-available),complete:months.length===3&&months.every(m=>m.complete),
      observedMonthsCovered:available==null||!average?null:Math.round(available/average*10)/10,records:months.flatMap(m=>m.records)};
  });
}
