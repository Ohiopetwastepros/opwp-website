import reconciliationIssues from './dog-food-reconciliation.json' with {type:'json'};
import {FoodError,foodDate,date,integer,cents,text} from './dog-food-operations.mjs';
import {foodSalesProfitLoss,monthlyFoodStockSignals} from './dog-food-profit-loss.mjs';

export const shiftInventoryDay=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const sum=(a,fn)=>a.reduce((n,r)=>n+fn(r),0);
const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
const round=n=>Math.round(n*100)/100;
const missing=v=>v===null||v===undefined||v==='';
const validDate=v=>{try{return Boolean(date(v));}catch{return false;}};
const closed=o=>o.deleted_at||['cancelled','refunded','draft'].includes(o.status);
const nonCustomer=s=>/^(test|demo|sample)(\b|[-_ ])/i.test(s.name||'')||/^(draft|quote|test|transfer|personal|family)$/i.test(s.source||'');
const monthCycle=(anchor,n)=>{
  const d=new Date(anchor+'T12:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
};
export const inventoryCategories=['personal_family','animal_damage','expiration','other'];
export function inventoryCostInput(body,model,today=foodDate()) {
  if(body.confirm!==true||!inventoryCategories.includes(body.category))throw new FoodError('Confirm a supported cost category.');
  const product=model.products.find(p=>p.id===body.productId);if(!product)throw new FoodError('Choose an exact product.');
  const quantity=integer(body.quantity,'quantity',1,100000),actualDate=body.actualDate?date(body.actualDate):null;
  if(actualDate&&actualDate>today)throw new FoodError('Actual use or disposal cannot be in the future.');
  const checkpointId=text(body.checkpointId,100)||null,movementId=text(body.movementId,100)||null;
  if(Boolean(checkpointId)===Boolean(movementId))throw new FoodError('Link exactly one physical checkpoint or existing movement.');
  if(checkpointId){const checkpoint=model.counts.find(c=>c.id===checkpointId&&c.productId===product.id);
    if(!checkpoint||actualDate&&actualDate>checkpoint.date)throw new FoodError('The checkpoint must already include this usage.');
  } else {
    const movement=model.movements.find(m=>m.id===movementId&&m.productId===product.id&&m.quantity<0&&m.type!=='Sale');
    if(!movement||quantity!==-movement.quantity||actualDate!==movement.date)throw new FoodError('Match the existing non-sale deduction quantity and actual date.');
  }
  const reference=text(body.sourceReference,300),note=text(body.note,4000);
  if(!reference||!note)throw new FoodError('Source reference and factual note are required.');
  return {productId:product.id,category:body.category,quantity,unitCostCents:missing(body.cost)?null:cents(body.cost,'acquisition cost per bag'),actualDate,checkpointId,movementId,reference,note};
}
export async function saveInventoryCost(db,body,actor,model) {
  const v=inventoryCostInput(body,model),prior=await db.prepare("SELECT id FROM dog_food_cost_annotations WHERE organization_id='org-opwp' AND (source_reference=? OR movement_id=?)").bind(v.reference,v.movementId).first();
  if(prior)throw new FoodError('This source or movement already has a cost annotation. Review its existing record.',409);
  const id='cost:'+body.commandId;
  await db.prepare(`INSERT INTO dog_food_cost_annotations(id,product_id,category,quantity,unit_cost_cents,actual_date,checkpoint_id,movement_id,source_reference,note,actor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,v.productId,v.category,v.quantity,v.unitCostCents,v.actualDate,v.checkpointId,v.movementId,v.reference,v.note,actor).run();
  return {id,message:'Cost evidence saved. Linked stock history is unchanged; no revenue, payment or accounting entry was created.'};
}
// Preserve original evidence; a matching, separately audited owner decision
// resolves a pending classification without editing the annotation or stock.
export function applyInventoryCostReviews(costs,reviews) {
  const fields=['id','organization_id','product_id','category','quantity','unit_cost_cents','actual_date','checkpoint_id','movement_id','source_reference'];
  return costs.map(c=>{
    if(c.organization_id!=='org-opwp'||c.review_status!=='needs_review')return c;
    for(const review of reviews){
      let d;try{d=JSON.parse(review.details);}catch{continue;}
      if(review.action!=='inventory_cost_confirmed'||review.entity_id!==c.id||!review.actor||!review.created_at||d?.organizationId!=='org-opwp'||d.decision!=='confirmed'||typeof d.note!=='string'||!d.note.trim()||d.note.length>4000||typeof d.reference!=='string'||!d.reference||d.reference.length>300||!d.basis||!fields.every(k=>(d.basis[k]??null)===(c[k]??null)))continue;
      return {...c,review_status:'confirmed',original_review_status:c.review_status,reviewed_at:review.created_at,reviewed_by:review.actor,review_reference:d.reference,
        note:`${c.note}\nClassification confirmed by ${review.actor} on ${review.created_at}: ${d.note}`};
    }
    return c;
  });
}
export async function readInventoryCosts(db) {
  const [r,reviews]=await Promise.all([
    db.prepare("SELECT * FROM dog_food_cost_annotations WHERE organization_id='org-opwp' ORDER BY created_at DESC,id LIMIT 5001").all(),
    db.prepare("SELECT id,action,entity_id,details,actor,created_at FROM dog_food_ops_audit WHERE action='inventory_cost_confirmed' ORDER BY created_at DESC,id DESC LIMIT 5001").all()
  ]);
  if(r.results.length>5000||reviews.results.length>5000)throw new FoodError('Cost history exceeds its reviewed bound.',503);
  return applyInventoryCostReviews(r.results,reviews.results);
}

// Reporting never writes inventory. A physical checkpoint owns all earlier usage;
// an annotation only categorizes its cost and keeps entry/use dates separate.
export function foodInventoryDashboard(model,{now=new Date(),policy={},lots=[],costs=[],plans=[],planItems=[],sync={}}={}) {
  const today=foodDate(now),since=shiftInventoryDay(today,-89),month=today.slice(0,7),products=model.products||[],orders=model.native?.orders||[];
  const issues=(model.issues||[]).filter(i=>!i.message.includes('Legacy blank fulfillment')&&!i.message.includes('Paid label alone')).map(i=>({...i,severity:'review'})),excluded=new Set(costs.filter(c=>c.movement_id).map(c=>c.movement_id)),seen=new Set();
  const fulfilled=[];
  for(const s of [...(model.sales||[])].sort((a,b)=>Number(Boolean(b.lineId))-Number(Boolean(a.lineId)))) {
    if(excluded.has(s.id)||nonCustomer(s)||!s.inventoryEligible||!positive(s.quantity)||!validDate(s.stockDate)||s.stockDate>today)continue;
    if(s.fulfillmentAssumed&&!(s.totalCents>0)){issues.push({id:s.id,kind:'sale',message:'Unpriced legacy row is not verified fulfilled demand; review quote/complimentary status.'});continue;}
    const key=s.orderId?'order:'+s.orderId+':'+s.productId:s.lineId?'line:'+s.lineId:s.sngJobId?'job:'+s.sngJobId+':'+s.productId:null;
    if(key&&seen.has(key)){issues.push({id:s.id,kind:'duplicate',message:'Duplicate fulfillment source excluded from demand; reconcile stock history.'});continue;}
    if(key)seen.add(key);
    fulfilled.push(s);
  }
  for(const m of model.movements||[])if(m.type==='Source handoff'&&m.date<=today&&!excluded.has(m.id))fulfilled.push({id:m.id,productId:m.productId,stockDate:m.date,quantity:-m.quantity,inventoryEligible:true,fulfillmentAssumed:false,totalCents:0,physicalOnly:true,acquisitionCostCents:null});
  const unknown=(model.sales||[]).filter(s=>s.fulfillment==='Unknown'||s.fulfillment==='Fulfillment unknown');
  if(unknown.length)issues.push({kind:'coverage',message:`${unknown.length} sales have unknown physical fulfillment and are excluded from delivered-bag demand.`,recordIds:unknown.map(s=>s.id)});
  const legacy=fulfilled.filter(s=>s.fulfillmentAssumed);
  if(legacy.length)issues.push({kind:'coverage',message:`${legacy.length} historical fulfilled rows assume delivery from a blank field; completion dates use sale dates.`,recordIds:legacy.map(s=>s.id)});
  const unverifiedCash=(model.sales||[]).filter(s=>s.reportingWarnings?.some(w=>w.includes('Paid label alone')));
  if(unverifiedCash.length)issues.push({kind:'cash',message:`${unverifiedCash.length} Paid labels lack recorded cash evidence. Original sales remain unchanged; review receipts before treating them as cash collected.`,recordIds:unverifiedCash.map(s=>s.id)});
  const months=Array.from({length:12},(_,i)=>monthCycle(month+'-01',i-11).slice(0,7));
  const completeWindow=(from,to,pid)=>validDate(policy.historyConfirmedFrom)&&validDate(policy.historyConfirmedThrough)&&policy.historyConfirmedFrom<=from&&policy.historyConfirmedThrough>=to&&
    !(policy.stockoutPeriods||[]).some(s=>(!s.productId||s.productId===pid)&&s.start<=to&&s.end>=from)&&
    !(model.sales||[]).some(s=>!excluded.has(s.id)&&(!s.productId||s.productId===pid)&&(!s.date||s.date>=from&&s.date<=to)&&(!positive(s.quantity)||!validDate(s.stockDate)));
  const usage=months.map(m=>{
    const end=m===month?today:shiftInventoryDay(monthCycle(m+'-01',1),-1);
    return {month:m,current:m===month,formulas:products.filter(p=>p.active||fulfilled.some(s=>s.productId===p.id)).map(p=>{
      const rows=fulfilled.filter(s=>s.productId===p.id&&s.stockDate.slice(0,7)===m);
      return {productId:p.id,color:p.color,formula:p.formula,weight:p.weight,bags:sum(rows,s=>s.quantity),assumedBags:sum(rows.filter(s=>s.fulfillmentAssumed),s=>s.quantity),complete:completeWindow(m+'-01',end,p.id),records:rows.map(s=>s.id)};
    })};
  });
  const prevMonth=monthCycle(month+'-01',-1).slice(0,7),prevLast=shiftInventoryDay(month+'-01',-1),prevEnd=prevMonth+'-'+String(Math.min(Number(today.slice(8)),Number(prevLast.slice(8)))).padStart(2,'0');
  const comparisons=products.filter(p=>p.active).map(p=>({productId:p.id,color:p.color,formula:p.formula,weight:p.weight,
    current:sum(fulfilled.filter(s=>s.productId===p.id&&s.stockDate>=month+'-01'),s=>s.quantity),
    previousSamePeriod:sum(fulfilled.filter(s=>s.productId===p.id&&s.stockDate>=prevMonth+'-01'&&s.stockDate<=prevEnd),s=>s.quantity),
    through:prevEnd,complete:completeWindow(month+'-01',today,p.id)&&completeWindow(prevMonth+'-01',prevEnd,p.id)}));
  const activePlans=plans.filter(p=>p.status==='active'),cycles=[];
  const legacyPlans=(model.subscriptions||[]).filter(p=>p.status==='Active').map(p=>({...p,dated:validDate(p.next)&&p.next>=today,quantityKnown:positive(p.quantity)}));
  for(const p of legacyPlans)issues.push({id:p.id,kind:'subscription',message:!p.dated||!p.quantityKnown||!p.product?'Active Airtable subscription has overdue/missing date, quantity or formula; recurring coverage is incomplete.':'Active Airtable subscription needs exact native-plan reconciliation before forecasts can be combined.'});
  for(const plan of activePlans) {
    if(!validDate(plan.next_delivery_date)||plan.next_delivery_date<today){issues.push({id:plan.id,kind:'subscription',message:'Active recurring plan has missing or overdue next delivery; forecast is incomplete.'});continue;}
    for(let n=0;n<14;n++){const d=monthCycle(plan.next_delivery_date,n);if(d>shiftInventoryDay(today,Math.max(90,(policy.supplierLeadDays||0)+(policy.reviewDays||0))))break;
      for(const item of planItems.filter(i=>i.subscription_id===plan.id&&i.is_active&&positive(i.quantity))) {
        const p=products.find(p=>p.websiteId===item.product_id);if(!p){issues.push({id:plan.id,kind:'subscription',message:'Subscription SKU mapping missing.'});continue;}
        const generated=orders.filter(o=>o.subscription_id===plan.id&&(o.billing_cycle_key||o.scheduled_date||o.requested_delivery_date)===d);
        // A generated cycle owns the commitment, including cancellation. No second plan demand.
        const live=generated.filter(o=>!closed(o)&&o.status!=='fulfilled'&&o.delivery_status!=='delivered'&&o.pickup_status!=='collected');
        cycles.push({planId:plan.id,productId:p.id,date:d,quantity:generated.length&&!live.length?0:Number(item.quantity),generatedOrders:live.map(o=>o.id),generated:generated.length>0});
      }
    }
  }
  const forecast=products.filter(p=>p.active).map(p=>({productId:p.id,color:p.color,formula:p.formula,weight:p.weight,complete:!legacyPlans.some(l=>!l.product||l.product===p.id)&&activePlans.every(l=>validDate(l.next_delivery_date)&&l.next_delivery_date>=today),
    periods:[30,60,90].map(days=>({days,bags:sum(cycles.filter(c=>c.productId===p.id&&c.date<shiftInventoryDay(today,days)),c=>c.quantity),
      ungeneratedBags:sum(cycles.filter(c=>c.productId===p.id&&!c.generated&&c.date<shiftInventoryDay(today,days)),c=>c.quantity),
      cycles:cycles.filter(c=>c.productId===p.id&&c.date<shiftInventoryDay(today,days))}))}));
  const costRows=costs.map(c=>({...c,totalCents:c.unit_cost_cents==null?null:c.quantity*c.unit_cost_cents,product:products.find(p=>p.id===c.product_id)?.name||c.product_id,
    linked: c.checkpoint_id?(model.counts||[]).some(x=>x.id===c.checkpoint_id&&x.productId===c.product_id):(model.movements||[]).some(x=>x.id===c.movement_id&&x.productId===c.product_id)}));
  for(const c of costRows)if(!c.linked||!c.actual_date||c.totalCents==null||c.review_status!=='confirmed')issues.push({id:c.id,kind:'cost',message:!c.linked?'Cost source absent from current snapshot; verify archived/edited source.':c.review_status!=='confirmed'?'March personal-use classification awaits separate review; original sale retained.':!c.actual_date?'Historical use date unknown; cost is undated.':'Acquisition cost missing.'});
  const categorized=new Set(costs.filter(c=>c.movement_id).map(c=>c.movement_id));
  const uncategorized=(model.movements||[]).filter(m=>m.quantity<0&&m.type!=='Sale'&&m.type!=='Receipt'&&!categorized.has(m.id));
  const costTotals=inventoryCategories.map(category=>{const rows=costRows.filter(c=>c.category===category&&c.review_status==='confirmed'&&c.linked);return {category,bags:sum(rows,c=>c.quantity),knownCents:sum(rows,c=>c.totalCents||0),unknownCostBags:sum(rows.filter(c=>c.totalCents==null),c=>c.quantity),undatedBags:sum(rows.filter(c=>!c.actual_date),c=>c.quantity),ids:rows.map(c=>c.id)};});
  const replenishment=products.filter(p=>p.active).map(p=>{
    const historyRows=fulfilled.filter(s=>s.productId===p.id&&s.stockDate>=since),observed=sum(historyRows,s=>s.quantity),historyComplete=completeWindow(since,today,p.id);
    const rate=historyComplete?observed/90:null;
    const ownLots=lots.filter(l=>l.product_id===p.websiteId),lotTotal=sum(ownLots,l=>Number(l.usable_bags)),blocked=sum(ownLots.filter(l=>l.quarantined||l.best_before<today||l.expiry_assumed),l=>Number(l.usable_bags));
    // Subtract known excluded stock, without guessing which unknown lot a count belongs to.
    const eligibleTotal=lotTotal-blocked,lotMatches=!ownLots.length||lotTotal===p.onHand||eligibleTotal===p.onHand;
    const sellable=p.onHand==null||!lotMatches?null:Math.max(0,p.onHand-(lotTotal===p.onHand?blocked:0)),available=sellable==null?null:sellable-p.reserved;
    const incoming=(model.pos||[]).filter(po=>!['Cancelled','Received','Draft'].includes(po.status)).flatMap(po=>po.lines.filter(l=>l.productId===p.id&&positive(l.ordered)&&l.received>=0&&l.received<l.ordered).map(l=>({id:l.id,poId:po.id,number:po.number,quantity:l.ordered-l.received,expected:po.expected||null,bestBefore:l.bestBefore||null})));
    const lead=policy.supplierLeadDays,safety=policy.safetyDays,review=policy.reviewDays,multiple=policy.orderMultipleBags,minimum=policy.minimumOrderByColor?.[p.color]??policy.minimumOrderBags;
    const configured=[lead,safety,review,minimum,multiple].every(v=>v!=null),horizon=configured?lead+review:null;
    const through=horizon==null?null:shiftInventoryDay(today,horizon),timely=through?incoming.filter(i=>i.expected>=today&&i.expected<=through&&(!i.bestBefore||i.bestBefore>=i.expected)):[];
    const committed=(model.sales||[]).filter(s=>s.productId===p.id&&s.fulfillment==='Awaiting Delivery'&&!s.cancelled&&!nonCustomer(s)&&positive(s.quantity)&&!excluded.has(s.id));
    const unscheduledCycles=cycles.filter(c=>c.productId===p.id&&!c.generated&&through&&c.date<=through);
    const recurring=forecast.find(f=>f.productId===p.id),recurringHorizon=sum(unscheduledCycles,c=>c.quantity);
    // Reservations are already in available. The baseline includes past recurring
    // customers; use the larger baseline / ungenerated plan requirement, never add both.
    const baseline=rate==null||horizon==null?null:Math.max(0,rate*horizon-sum(committed,s=>s.quantity));
    const required=baseline==null?null:Math.max(baseline,recurringHorizon)+rate*safety;
    const cover=available==null||!rate?null:Math.max(0,available)/rate,point=rate==null||lead==null||safety==null?null:Math.ceil(rate*(lead+safety));
    let shortageDate=null,expiryWasteWithinHorizon=0;const wasteByLot=new Map();
    if(rate>0&&available!=null){
      let buckets=ownLots.length?ownLots.filter(l=>!l.quarantined&&!l.expiry_assumed&&l.best_before>=today).map(l=>({id:l.id,quantity:Number(l.usable_bags),expires:l.best_before})):[{quantity:Math.max(0,available),expires:null}];
      const sortBuckets=()=>buckets.sort((a,b)=>(a.expires||'9999').localeCompare(b.expires||'9999'));sortBuckets();
      // Reservations have already reduced availability. Remove them once from
      // FEFO lots before projecting the uncommitted stock, never from fallback twice.
      let reserve=ownLots.length?p.reserved:0;for(const b of buckets){const q=Math.min(reserve,b.quantity);b.quantity-=q;reserve-=q;}
      for(let n=0;n<=365;n++){
        const d=shiftInventoryDay(today,n);
        for(const b of buckets.filter(b=>b.quantity>1e-9&&b.expires&&b.expires<d)){if(horizon!=null&&n<=horizon)expiryWasteWithinHorizon+=b.quantity;if(b.id)wasteByLot.set(b.id,b.quantity);}
        buckets=buckets.filter(b=>b.quantity>1e-9&&(!b.expires||b.expires>=d));
        const arrivals=incoming.filter(i=>i.expected===d&&(!i.bestBefore||i.bestBefore>=d));
        if(arrivals.length){buckets.push(...arrivals.map(i=>({quantity:i.quantity,expires:i.bestBefore})));sortBuckets();}
        if(sum(buckets,b=>b.quantity)+1e-9<rate&&!shortageDate)shortageDate=d;
        let need=rate;for(const b of buckets){const used=Math.min(need,b.quantity);b.quantity-=used;need-=used;if(need<1e-9)break;}
      }
    }
    const shortage=required==null||available==null?null:Math.max(0,required-available-sum(timely,i=>i.quantity)+expiryWasteWithinHorizon);
    const suggested=configured&&shortage!=null&&recurring.complete?(shortage<1e-9?0:Math.ceil(Math.max(minimum,shortage-1e-9)/multiple)*multiple):null;
    const picking=[...ownLots].sort((a,b)=>String(a.best_before).localeCompare(String(b.best_before))||String(a.lot_number).localeCompare(String(b.lot_number))).map(l=>{
      const eligible=!l.quarantined&&!l.expiry_assumed&&l.best_before>=today,atRisk=eligible&&rate>0&&l.best_before<shiftInventoryDay(today,365)?Math.ceil((wasteByLot.get(l.id)||0)-1e-9):null;
      return {...l,eligible,atRisk};
    });
    const warnings=[];
    if(!historyComplete)warnings.push('History incomplete or contains stockouts; no supported daily rate or purchase quantity.');
    if(!recurring.complete)warnings.push('Recurring coverage is incomplete; reconcile overdue plans and Airtable/native overlap before using a purchase quantity.');
    if(!configured)warnings.push('Confirm supplier lead time, safety, review period, minimum and independent bag multiple.');
    if(!ownLots.length)warnings.push('Lots and expiration dates unverified; count is not an expiration audit.');
    else if(!lotMatches)warnings.push('Lot totals differ from physical stock; reconcile before fulfillment.');
    if(incoming.some(i=>!i.expected||i.expected<today))warnings.push('Undated or overdue incoming excluded from replenishment coverage.');
    if(available<0)warnings.push('Reservations exceed sellable inventory.');
    return {productId:p.id,name:p.name,color:p.color,formula:p.formula,weight:p.weight,physicalOnHand:p.onHand,onHand:sellable,reserved:p.reserved,available,blockedBags:blocked,
      observed90Bags:observed,historyComplete,historyRecords:historyRows.map(s=>s.id),dailyDemand:rate==null?null:round(rate),coverDays:cover==null?null:round(cover),projectedShortageDate:shortageDate,
      threshold:point,reorderDate:shortageDate==null||lead==null||safety==null?null:[today,shiftInventoryDay(shortageDate,-lead-safety)].sort().at(-1),suggestedBags:suggested,
      incoming,incomingBags:sum(incoming,i=>i.quantity),incomingTimely:sum(timely,i=>i.quantity),recurring,committedRecords:committed.map(s=>s.id),lots:picking,warnings,
      calculation:{leadDays:lead??null,safetyDays:safety??null,reviewDays:review??null,horizonDays:horizon,minimumBags:minimum??null,multipleBags:multiple??null,baselineBags:baseline==null?null:round(baseline),ungeneratedRecurringBags:recurringHorizon,requiredBags:required==null?null:round(required),projectedExpiryWasteBags:round(expiryWasteWithinHorizon),rawShortage:shortage==null?null:round(shortage)}};
  });
  const allCalculated=replenishment.every(r=>r.suggestedBags!==null),proposed=allCalculated?sum(replenishment,r=>r.suggestedBags):null,mixedConfigured=[policy.mixedPalletMinimumBags,policy.mixedPalletMultipleBags].every(v=>v!=null);
  const mixedTarget=proposed==null?null:proposed===0?0:!mixedConfigured?null:Math.ceil(Math.max(proposed,policy.mixedPalletMinimumBags)/policy.mixedPalletMultipleBags)*policy.mixedPalletMultipleBags;
  const mixed={proposedBags:proposed,targetBags:mixedTarget,unallocatedBags:mixedTarget==null?null:mixedTarget-proposed,freightCents:policy.freightCents??null,
    ready:replenishment.every(r=>r.suggestedBags!==null)&&mixedConfigured&&mixedTarget===proposed&&(policy.mixedPalletMaxBags==null||proposed<=policy.mixedPalletMaxBags),
    warnings:[...(!mixedConfigured?['Mixed-pallet minimum/multiple unconfirmed.']:[]),...(mixedTarget>proposed?['Choose the formula mix for additional bags; never allocate excess automatically.']:[]),...(policy.mixedPalletMaxBags!=null&&mixedTarget>policy.mixedPalletMaxBags?['Proposed mix exceeds confirmed pallet capacity.']:[])]};
  const financial=products.map(p=>{const rows=fulfilled.filter(s=>s.productId===p.id&&!s.cancelled&&!s.refundState&&!s.fulfillmentAssumed&&s.totalCents>0),priced=rows.filter(s=>s.acquisitionCostCents!=null);
    return {productId:p.id,name:p.name,bags:sum(rows,s=>s.quantity),revenueCents:rows.length?sum(rows,s=>s.revenueCents??s.totalCents):null,acquisitionCents:priced.length===rows.length&&rows.length?sum(priced,s=>s.quantity*s.acquisitionCostCents):null,
      grossProfitCents:priced.length===rows.length&&rows.length&&rows.every(s=>s.revenueCents!=null)?sum(rows,s=>s.revenueCents-s.quantity*s.acquisitionCostCents):null,records:rows.map(s=>s.id),basis:rows.length?'Explicit fulfillment; sale-date revenue, excluded refunds; margin requires acquisition cost and revenue excluding tax.':'No reliable fulfilled revenue rows'};});
  if(!completeWindow(since,today,''))issues.push({kind:'coverage',message:'90-day history has not been confirmed complete. Observed counts are not zero-demand evidence.'});
  for(const p of products.filter(p=>!p.active&&p.onHand==null))issues.push({kind:'inventory',id:p.id,message:`${p.name}: inactive quantity is unknown, not a verified zero or disposal.`});
  for(const m of uncategorized)issues.push({kind:'cost',id:m.id,message:`${m.type}: ${Math.abs(m.quantity)} bags await separate cost classification; not included as personal use or spoilage.`});



  issues.push(...reconciliationIssues.map(issue=>({...issue})));
  return {asOf:today,since,usage,comparisons,forecast,legacyPlans,replenishment,mixed,costRows,costTotals,uncategorized,financial,issues,
    salesReport:foodSalesProfitLoss(model,{costs,today}),stockSignals:monthlyFoodStockSignals(products,usage,replenishment,today),
    records:fulfilled.map(s=>({id:s.id,name:s.name,productId:s.productId,quantity:s.quantity,date:s.stockDate,assumed:Boolean(s.fulfillmentAssumed),revenueCents:s.revenueCents??null})),
    sync:{lastSuccessAt:sync.last_success_at||null,capturedAt:sync.capturedAt||null,error:sync.last_error||null,dirty:Boolean(sync.dirty)},
    evidence:{invoice:'4783',libraryFile:'libfile_2ac82e3845d48191914eaca844a02a2f',originalBags:240,originalCostCents:990000,paymentVerified:false},
    rules:['Available = physical on-hand − known expired/quarantined/assumed-expiry lots − reservations. Unknown lot coverage stays a warning.',
      'Daily rate = fulfilled customer bags / 90 only for a confirmed complete, stockout-free 90-day window. Blank fulfillment assumes delivery and is shown separately.',
      'Coverage = available / daily rate before future expiry. Projected shortage uses daily-rate demand, FEFO and known lot expiry plus dated receipts; overdue/undated receipts never provide coverage. Reservations are assigned to oldest lots for planning only.',
      'Reorder point = daily rate × (lead time + safety days). Replenishment horizon = lead time + review days.',
      'Required = max(historical horizon demand minus already-reserved commitments, ungenerated recurring demand) + safety stock. Subtract available and timely incoming once, add projected uncommitted expiry waste in that horizon, then apply minimum and independent bag multiple.',
      'Recurring forecast is calendar-month based, next 30/60/90 days, excludes the end date. Generated subscription cycles replace plan demand; they are not added twice.',
      'A refund alone does not restore stock. Cost annotations only classify existing deductions or usage already included in a checkpoint. Personal use creates no revenue or payment.',
      'Known cost totals exclude missing amounts and unresolved classifications. Gross profit requires explicit completion, cost evidence and revenue excluding tax. No QuickBooks entry or tax deduction is posted.']};
}
