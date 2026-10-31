export class FoodError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const foodDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0,max) : '';
export const choice = value => typeof value === 'string' ? value : text(value?.name);
export const links = value => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : v?.id).filter(Boolean) : [];
export const active = row => choice(row.fields?.['Record Status']) !== 'Archived';
export function integer(value, label, min = 0, max = 100000) {
  if (value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value)<min || Number(value)>max) throw new FoodError(`Enter a valid ${label}.`);
  return Number(value);
}
export function cents(value, label = 'amount') {
  if (value === '' || value == null || !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new FoodError(`Enter a valid ${label}, with no more than two decimal places.`);
  return integer(Math.round(Number(value)*100),label,0,100000000);
}
export function date(value, required = true) {
  if (!value && !required) return '';
  const parsed=new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) throw new FoodError('Enter a valid date.');
  return value;
}
const amount = value => Number.isFinite(Number(value)) ? Math.round(Number(value)*100) : 0;
const days = d => d ? Math.max(0,Math.floor((Date.parse(`${foodDate()}T12:00:00Z`)-Date.parse(`${d}T12:00:00Z`))/86400000)) : null;
const utcTime = value => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/.test(value||'')&&Number.isFinite(Date.parse(value.replace(' ','T').replace(/Z?$/,'Z')))?new Date(value.replace(' ','T').replace(/Z?$/,'Z')).toISOString():null;
export function operationModel(snapshot = {}, native = {}) {
  const tables = {...snapshot.tables}, issues = [];
  // D1 wins for website lines even while an Airtable write/reconciliation is pending.
  // Replace by exact line IDs, never names or a whole-order heuristic.
  const original=tables.Sales||[], replacement=[];
  for(const o of native.orders||[]) {
    if(!['customer_portal','subscription_renewal'].includes(o.source))continue;
    let remaining=Number(o.total_cents);
    const payments=(native.payments||[]).filter(p=>p.order_id===o.id&&['captured','refunded'].includes(p.status)),netPaid=payments.reduce((sum,p)=>sum+Number(p.amount_cents)-Number(p.refunded_amount_cents||0),0),refund=payments.reduce((sum,p)=>sum+Number(p.refunded_amount_cents||0),0);
    let remainingPaid=netPaid;
    const lines=[...(o.itemDetails||[])].sort((a,b)=>a.id.localeCompare(b.id));
    for(let n=0;n<lines.length;n++) {
      const i=lines[n],product=(tables.Products||[]).filter(p=>p.fields['Website Product ID']===i.product_id);
      if(product.length!==1){issues.push({kind:'inventory',id:o.id,message:'Native formula mapping needs review'});continue;}
      const total=n===lines.length-1?remaining:Number(i.line_total_cents)+Math.round(Number(i.unit_price_cents)*Number(o.tax_rate_basis_points)/10000)*Number(i.quantity);remaining-=total;
      const linePaid=n===lines.length-1?remainingPaid:Math.round(total*netPaid/Number(o.total_cents));remainingPaid-=linePaid;
      const delivered=o.delivery_status==='delivered',terminal=['cancelled','refunded'].includes(o.status)||Boolean(o.deleted_at);
      replacement.push({id:original.find(r=>r.fields['Website Line ID']===i.id)?.id||`native:${i.id}`,fields:{
        'Website Line ID':i.id,'Website Order ID':o.id,'Website Order State':o.deleted_at?'cancelled':refund>0&&refund<o.total_cents?'partial_refund':o.status,
        'Sold To':`${o.first_name} ${o.last_name}`.trim()||'Website customer',Product:[product[0].id],'Bag Quantity':i.quantity,
        'Sale Date':foodDate(new Date(o.created_at.replace(' ','T')+'Z')),'Sale Total':total/100,'Payments Received':linePaid/100,
        'Fulfillment Status':delivered?'Delivered':terminal?'Cancelled':'Awaiting Delivery',
        'Revenue Excluding Tax (Website)':Number(i.line_total_cents)/100,
        'Acquisition Cost Total (Website)':i.acquisition_cost_cents==null?null:Number(i.acquisition_cost_cents)/100,
        'Stock Movement Date (Website)':delivered&&o.delivered_at?foodDate(new Date(o.delivered_at.replace(' ','T')+'Z')):'',
        'Stock Movement At (Website)':delivered?utcTime(o.delivered_at)||'':''}});
    }
  }
  const nativeKeys=new Set(replacement.map(r=>r.fields['Website Line ID']));
  tables.Sales=[...original.filter(r=>!nativeKeys.has(r.fields['Website Line ID'])),...replacement];
  const all = name => tables[name] || [], rows = name => all(name).filter(active);
  const products = rows('Products').filter(r => r.fields['Product Name'] && r.fields['Formula Code'] && r.fields['Bag Weight']).map(r => ({
    id:r.id,name:r.fields['Product Name'],formula:r.fields['Formula Code'],weight:r.fields['Bag Weight'],
    active:Boolean(r.fields['Active Status']),costCents:r.fields['Dealer Price']==null?null:amount(r.fields['Dealer Price']),costBasis:'Dealer Price / owner acquisition cost; lot cost may differ',retailCents:amount(r.fields['Retail Price']),
    dealerCents:r.fields['Dealer Price']==null?null:amount(r.fields['Dealer Price']),reorderPoint:Number(r.fields['Reorder Point']||0),websiteId:r.fields['Website Product ID']||null,
    opening:Number(r.fields['Starting Count']||0),baseline:r.fields['Inventory Baseline Date']||'2026-06-18',
    confirmed:Boolean(r.fields['Inventory Confirmed']),sourceOnHand:Number(r.fields['On Hand']||0),color:/\(([^)]+)\)/.exec(r.fields['Product Name'])?.[1]||'Other',
  }));
  const productMap=new Map(products.map(p=>[p.id,p]));
  const receipts=rows('Payment Receipts'), referenceCounts=new Map();
  for(const r of receipts){const ref=text(r.fields['Receipt Reference']);if(ref)referenceCounts.set(ref,(referenceCounts.get(ref)||0)+1);}
  const sales=rows('Sales').filter(r=>text(r.fields['Sold To'])||r.fields['Bag Quantity']||r.fields['Amount Collected']).map(r=>{
    const f=r.fields,paid=choice(f['Payment Status'])==='Paid',total=amount(f['Sale Total'] ?? f['Amount Collected']),
      rr=receipts.filter(p=>links(p.fields.Sale).includes(r.id)),explicit=f['Payments Received']!=null,
      opening=explicit?amount(f['Payments Received']):paid&&rr.length===0?total:0,
      collected=opening+rr.reduce((sum,p)=>sum+amount(p.fields.Amount),0),productIds=links(f.Product),quantity=Number(f['Bag Quantity']||0),
      duplicate=rr.some(p=>referenceCounts.get(text(p.fields['Receipt Reference']))>1),cancelled=choice(f['Fulfillment Status'])==='Cancelled'||['cancelled','refunded'].includes(f['Website Order State']),
      fulfillment=choice(f['Fulfillment Status'])||'Delivered';
    const warnings=[];
    if(productIds.length!==1 || !productMap.has(productIds[0]))warnings.push('Choose exactly one valid product');
    if(!Number.isSafeInteger(quantity)||quantity<=0)warnings.push('Invalid bag quantity');
    if(!f['Sale Date'])warnings.push('Sale date missing');
    if(fulfillment==='Delivered'&&(f['Stock Movement Date (Website)']||f['Sale Date'])>foodDate())warnings.push('Physical fulfillment is dated in the future');
    if(total<=0)warnings.push('Price or complimentary-sale review');
    if(collected>total)warnings.push('Payments exceed sale total');
    if(duplicate)warnings.push('Duplicate payment reference');
    const reportingWarnings=[];
    if(!choice(f['Fulfillment Status']))reportingWarnings.push('Legacy blank fulfillment assumes Delivered; completion date unverified');
    if(paid&&!explicit&&!rr.length)reportingWarnings.push('Paid label alone is not verified cash collected');
    const noteBalance=/still\s+owes\s*\$([\d,.]+)/i.exec(text(f.Notes,4000));
    if(noteBalance&&Math.round(Number(noteBalance[1].replaceAll(',',''))*100)!==Math.max(0,total-collected))warnings.push('Collection note conflicts with recorded balance');
    if(!explicit&&rr.length&&paid)warnings.push('Historical payment amount needs confirmation');
    return {id:r.id,name:text(f['Sold To']),date:f['Sale Date']||'',productId:productIds[0],productName:productMap.get(productIds[0])?.name||'Product missing',
      quantity,stockDate:f['Stock Movement Date (Website)']||f['Sale Date']||'',stockAt:utcTime(f['Stock Movement At (Website)']),lineId:f['Website Line ID']||'',totalCents:total,collectedCents:collected,balanceCents:cancelled||f['Website Order State']==='partial_refund'?0:Math.max(0,total-collected),paymentMethod:choice(f['Payment Method']),
      paymentStatus:collected>=total&&total>0?'Paid':collected>0?'Partial':'Unpaid',recordedPaymentStatus:choice(f['Payment Status'])||null,recordedPaymentsReceivedCents:explicit?opening:null,fulfillment,fulfillmentAssumed:!choice(f['Fulfillment Status']),acquisitionCostCents:f['Acquisition Cost Total (Website)']==null?null:amount(f['Acquisition Cost Total (Website)'])/quantity,revenueCents:f['Revenue Excluding Tax (Website)']==null?null:amount(f['Revenue Excluding Tax (Website)']),verifiedCollectedCents:(explicit?opening:0)+rr.reduce((n,r)=>n+amount(r.fields.Amount),0),notes:text(f.Notes,4000),
      source:choice(f.Source),sngJobId:f['SNG Job ID']==null?'':String(f['SNG Job ID']).trim(),paymentReference:text(f['Payment Reference']),
      refundState:['refunded','partial_refund'].includes(f['Website Order State'])?f['Website Order State']:null,
      customerType:choice(f['Customer Type']),distributionCenter:text(f['Distribution Center']),createdAt:r.createdTime||null,
      responsible:text(f['Responsible Person']),responsibleEmail:text(f['Responsible Email']),responsiblePhone:text(f['Responsible Phone']),
      nextFollowUp:f['Next Follow-up']||'',orderId:text(f['Website Order ID']),ageDays:days(f['Sale Date']),warnings,reportingWarnings,receipts:rr.map(p=>({id:p.id,reference:p.fields['Receipt Reference'],amountCents:amount(p.fields.Amount),date:p.fields['Payment Date'],method:p.fields.Method})),
      inventoryEligible:fulfillment==='Delivered'&&warnings.every(w=>!['Choose exactly one valid product','Invalid bag quantity','Sale date missing','Physical fulfillment is dated in the future'].includes(w)),cancelled};
  }).sort((a,b)=>b.date.localeCompare(a.date));
  const poLines=rows('Purchase Order Lines'),pos=rows('Purchase Orders').map(r=>{const f=r.fields,lines=poLines.filter(l=>links(l.fields['Purchase Order']).includes(r.id)).map(l=>({
    id:l.id,productId:links(l.fields.Product)[0],productName:productMap.get(links(l.fields.Product)[0])?.name||'Product missing',ordered:Number(l.fields['Ordered Quantity']||0),received:Number(l.fields['Received Quantity']||0),costCents:amount(l.fields['Cost Per Bag']),date:l.fields['Received Date']||'',lot:text(l.fields['Lot Number']),bestBefore:l.fields['Best Before']||''}));
    return {id:r.id,number:f['PO Number'],supplier:f.Supplier,date:f['Order Date']||'',expected:f['Expected Date']||'',status:choice(f['PO Status']),notes:text(f.Notes),location:f['Stock Location ID']||'opwp-main',lines,
      totalCents:lines.reduce((s,l)=>s+l.ordered*l.costCents,0)+amount(f['Freight Cost']),paidCents:amount(f['Amount Paid']),freightCents:amount(f['Freight Cost']),reference:text(f['Payment Reference']),ordered:lines.reduce((s,l)=>s+l.ordered,0),received:lines.reduce((s,l)=>s+l.received,0)};}).sort((a,b)=>b.date.localeCompare(a.date));
  const movements=[],counts=[];
  for(const p of products)if(p.confirmed)counts.push({productId:p.id,date:p.baseline,quantity:p.opening,id:`opening:${p.id}`});
  for(const r of rows('Inventory Adjustments')){const f=r.fields,type=choice(f['Movement Type']),productId=links(f.Product)[0],quantity=Number(f['Quantity Change']||0),d=f['Movement Date'];
    if(!productMap.has(productId)||!d){issues.push({kind:'inventory',id:r.id,message:'Adjustment needs product and date'});continue;}
    if(d>foodDate()){issues.push({kind:'inventory',id:r.id,message:'Future physical adjustment excluded; verify the actual movement date'});continue;}
    if(type==='Stock Count'){const at=utcTime(f['Counted At (Website)']);if(f['Counted Quantity']==null||!Number.isSafeInteger(Number(f['Counted Quantity']))||Number(f['Counted Quantity'])<0||d>foodDate()||f['Counted At (Website)']&&(!at||foodDate(new Date(at))!==d))issues.push({kind:'inventory',id:r.id,message:'Invalid physical count'});else counts.push({id:r.id,createdTime:r.createdTime||at||'',productId,date:d,at,quantity:Number(f['Counted Quantity'])});continue;}
    if(!Number.isSafeInteger(quantity)||!quantity||(type==='Waste'&&quantity>=0)){issues.push({kind:'inventory',id:r.id,message:'Invalid signed stock movement'});continue;}
    movements.push({id:r.id,productId,date:d,quantity,type,reason:text(f.Reason,4000),costCents:f['Cost Per Bag']==null?null:amount(f['Cost Per Bag']),lot:text(f['Lot Number']),bestBefore:f['Best Before']||''});
  }
  const poReceiptKeys=new Set(all('Restock Log').filter(r=>r.fields['Purchase Order ID']).map(r=>`${r.fields['Purchase Order ID']}:${links(r.fields.Product)[0]}`)),inactivePOs=new Set(all('Purchase Orders').filter(r=>!active(r)).map(r=>r.id));
  for(const r of rows('Restock Log')){const f=r.fields,pid=links(f.Product);if(inactivePOs.has(f['Purchase Order ID']))continue;if(pid.length!==1||!productMap.has(pid[0])||!f['Date Received']||f['Date Received']>foodDate()||!Number.isSafeInteger(Number(f['Bags Received']))||Number(f['Bags Received'])<=0){issues.push({kind:'receipt',id:r.id,message:'Restock receipt needs one product, quantity and date'});continue;}if(f['Purchase Order ID'])poReceiptKeys.add(`${f['Purchase Order ID']}:${pid[0]}`);movements.push({id:r.id,productId:pid[0],date:f['Date Received'],quantity:Number(f['Bags Received']),type:'Receipt',reason:text(f.Notes),costCents:amount(f['Cost Per Bag']),lot:text(f['Lot Number']),bestBefore:f['Best Before']||''});}
  for(const po of pos){if(!po.lines.length)issues.push({kind:'purchase',id:po.id,message:'Purchase order is missing its product lines; review an interrupted save'});for(const l of po.lines)if(l.received>0&&!poReceiptKeys.has(`${po.id}:${l.productId}`)){if(l.received>l.ordered||!l.date||l.date>foodDate()||!productMap.has(l.productId)){issues.push({kind:'purchase',id:l.id,message:'Invalid purchase receipt'});continue;}movements.push({id:l.id,productId:l.productId,date:l.date,quantity:l.received,type:'Receipt',reason:po.number,costCents:l.costCents,lot:l.lot,bestBefore:l.bestBefore});}}
  for(const s of sales)if(s.inventoryEligible)movements.push({id:s.id,productId:s.productId,date:s.stockDate,at:s.stockAt,quantity:-s.quantity,type:'Sale',reason:s.name,costCents:productMap.get(s.productId)?.costCents||0});
  for(const p of products){const checkpoint=counts.filter(c=>c.productId===p.id).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdTime||'').localeCompare(a.createdTime||'')||b.id.localeCompare(a.id))[0];
    const ambiguous=Boolean(checkpoint?.at&&movements.some(m=>m.productId===p.id&&m.date===checkpoint.date&&!m.at));
    if(ambiguous)issues.push({kind:'inventory',id:p.id,message:'Intraday count overlaps a movement without an exact time; confirm the cutoff before releasing stock'});
    const relevant=movements.filter(m=>m.productId===p.id&&(!checkpoint||m.date>checkpoint.date||checkpoint.at&&m.date===checkpoint.date&&m.at&&m.at>checkpoint.at)),receiving=relevant.filter(m=>m.type==='Receipt');
    p.countDate=checkpoint?.date||null;p.countedAt=checkpoint?.at||null;p.confirmed=Boolean(checkpoint)&&!ambiguous;p.onHand=p.confirmed?checkpoint.quantity+relevant.reduce((s,m)=>s+m.quantity,0):null;
    p.unreconciledChange=movements.filter(m=>m.productId===p.id).reduce((s,m)=>s+m.quantity,0);
    p.reserved=sales.filter(s=>s.productId===p.id&&s.fulfillment==='Awaiting Delivery'&&!s.cancelled).reduce((s,m)=>s+m.quantity,0);
    p.available=p.onHand==null?null:p.onHand-p.reserved;
    p.received=movements.filter(m=>m.productId===p.id&&m.type==='Receipt').reduce((s,m)=>s+m.quantity,0);
    p.sold=sales.filter(s=>s.productId===p.id&&s.inventoryEligible).reduce((s,m)=>s+m.quantity,0);
    p.wasted=-movements.filter(m=>m.productId===p.id&&m.type==='Waste').reduce((s,m)=>s+m.quantity,0);
    p.latestCostCents=receiving.sort((a,b)=>b.date.localeCompare(a.date))[0]?.costCents??p.costCents;
    p.stockValueCents=p.onHand==null||p.latestCostCents==null?null:Math.max(0,p.onHand)*p.latestCostCents;
    p.reorder=p.available!=null&&p.available<=p.reorderPoint;
  }
  const customers=rows('Customers').filter(r=>text(r.fields['Customer Name'])).map(r=>({id:r.id,name:r.fields['Customer Name'],email:text(r.fields.Email),phone:text(r.fields.Phone),address:text(r.fields['Service Address']),city:text(r.fields.City),status:choice(r.fields['Customer Status']),notes:text(r.fields.Notes),websiteId:r.fields['Website Customer ID']}));
  const subscriptions=rows('Subscriptions').map(r=>({id:r.id,number:r.fields['Subscription ID'],customer:links(r.fields.Customer)[0],product:links(r.fields.Product)[0],status:choice(r.fields['Subscription Status']),quantity:r.fields['Quantity Per Delivery'],next:r.fields['Next Delivery Date'],frequency:choice(r.fields['Delivery Frequency']),notes:r.fields['Special Instructions']}));
  const archived=Object.entries(tables).filter(([t])=>['Sales','Customers','Purchase Orders','Inventory Adjustments','Payment Receipts','Restock Log'].includes(t)).flatMap(([table,rr])=>rr.filter(r=>!active(r)).map(r=>({id:r.id,table,label:r.fields['Sold To']||r.fields['Customer Name']||r.fields['PO Number']||r.fields['Adjustment ID']||r.id})));
  for(const m of movements)m.sourceTable=['Sales','Restock Log','Inventory Adjustments'].find(name=>all(name).some(r=>r.id===m.id))||null;
  const placeholders=rows('Products').filter(r=>!r.fields['Product Name']).length+rows('Customers').filter(r=>!r.fields['Customer Name']).length;
  if(placeholders)issues.push({kind:'setup',message:`${placeholders} blank catalog/customer placeholders excluded from operating totals`});
  for(const s of sales)for(const w of s.warnings)issues.push({kind:'sale',id:s.id,message:`${s.name}: ${w}`});
  for(const s of subscriptions)if(!s.customer||!s.product||!s.quantity)issues.push({kind:'subscription',id:s.id,message:'Subscription is missing its customer, product or quantity'});
  const months=new Map();for(const s of sales.filter(s=>!s.cancelled)){const key=s.date.slice(0,7)||'Undated';const v=months.get(key)||{month:key,salesCents:0,collectedCents:0,bags:0};v.salesCents+=s.totalCents;v.collectedCents+=s.collectedCents;v.bags+=s.quantity;months.set(key,v);}
  const unpaid=sales.filter(s=>s.balanceCents>0),aging=[{label:'0–7 days',min:0,max:7},{label:'8–30 days',min:8,max:30},{label:'31–60 days',min:31,max:60},{label:'61+ days',min:61,max:Infinity}].map(b=>({...b,max:Number.isFinite(b.max)?b.max:null,cents:unpaid.filter(s=>(s.ageDays||0)>=b.min&&(s.ageDays||0)<=(b.max??Infinity)).reduce((sum,s)=>sum+s.balanceCents,0)}));
  const salesPlaceholders=rows('Sales').filter(r=>!text(r.fields['Sold To'])&&!r.fields['Bag Quantity']&&!r.fields['Amount Collected']).map(r=>({id:r.id,name:'',date:r.fields['Sale Date']||'',productId:links(r.fields.Product)[0]||null,productName:productMap.get(links(r.fields.Product)[0])?.name||'Product missing',quantity:null,totalCents:amount(r.fields['Sale Total']),notes:text(r.fields.Notes,4000),source:choice(r.fields.Source),fulfillment:choice(r.fields['Fulfillment Status'])||'Unspecified',fulfillmentAssumed:!choice(r.fields['Fulfillment Status']),paymentStatus:choice(r.fields['Payment Status'])||'Unspecified',recordedPaymentStatus:choice(r.fields['Payment Status'])||null,recordedPaymentsReceivedCents:r.fields['Payments Received']==null?null:amount(r.fields['Payments Received']),collectedCents:0,balanceCents:0,receipts:[],warnings:['Incomplete source placeholder / partial quote'],reportingWarnings:[],sourcePlaceholder:true,createdAt:r.createdTime||null}));
  return {products,sales,salesPlaceholders,unpaid,pos,movements:movements.sort((a,b)=>b.date.localeCompare(a.date)),counts,customers,subscriptions,archived,issues,monthly:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),aging,
    metrics:{salesCents:sales.filter(s=>!s.cancelled).reduce((sum,s)=>sum+s.totalCents,0),collectedCents:sales.filter(s=>!s.cancelled).reduce((sum,s)=>sum+s.collectedCents,0),receivablesCents:unpaid.reduce((sum,s)=>sum+s.balanceCents,0),bagsSold:sales.filter(s=>s.inventoryEligible).reduce((sum,s)=>sum+s.quantity,0),stockBags:products.some(p=>p.active&&!p.confirmed)?null:products.filter(p=>p.active).reduce((s,p)=>s+(p.onHand||0),0),stockValueCents:products.some(p=>p.active&&(!p.confirmed||p.stockValueCents==null))?null:products.filter(p=>p.active).reduce((s,p)=>s+(p.stockValueCents||0),0),wasteBags:products.reduce((s,p)=>s+p.wasted,0),wasteCents:movements.filter(m=>m.type==='Waste').reduce((s,m)=>s-m.quantity*m.costCents,0),supplierPaidCents:pos.reduce((s,p)=>s+p.paidCents,0)},native};
}
