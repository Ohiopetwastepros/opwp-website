import {FoodError,foodDate,date,integer,text} from './dog-food-operations.mjs';
import {foodBusinessHash,assertFoodWritesAvailable} from './dog-food-website-store.mjs';
const stable=v=>typeof v==='number'&&Number.isSafeInteger(v)?String(v):typeof v==='string'&&/^[a-zA-Z0-9_:.-]{1,160}$/.test(v)?v:'';
const money=v=>v===null||v===undefined||v===''?null:/^\d+(\.\d{1,2})?$/.test(String(v))?Math.round(Number(v)*100):null;
export async function foodSourceReviewEnabled(db){return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_source_line_reviews'").first());}
export function foodInvoiceLines(row,products){
  let data;try{data=JSON.parse(row.payload).data;}catch{return [];}
  if(!data||!Array.isArray(data.items)||data.items.length>100)return [];
  const invoiceId=stable(row.invoice_id||data.invoice_id),clientRef=stable(data.client||row.client_ref),counts=new Map();for(const item of data.items){const key=stable(item.invoice_item_id||item.id);counts.set(key,(counts.get(key)||0)+1);}
  return data.items.flatMap(item=>{
    const description=String(item.description||'').slice(0,400);if(!/dog\s*food/i.test(description))return [];
    const lineId=stable(item.invoice_item_id||item.id),quantity=Number(item.quantity),amountCents=money(item.amount),invoiceTotal=money(row.total??data.total),paid=money(row.paid??data.paid),remaining=money(row.remaining??data.remaining),tax=money(row.tax??data.tax);
    const warnings=[];if(!invoiceId||!lineId||counts.get(lineId)!==1)warnings.push('A unique provider invoice and line ID are required');
    if(!clientRef)warnings.push('Stable provider customer reference is missing');
    if(!Number.isSafeInteger(quantity)||quantity<1)warnings.push('Bag quantity needs source evidence');
    if(amountCents===null||amountCents<=0)warnings.push('Food line amount needs source evidence');
    const normalized=description.toLowerCase().replace(/[^a-z0-9]+/g,' '),matches=products.filter(p=>normalized.includes(String(p.color).toLowerCase())&&normalized.includes(String(p.formula_code).replaceAll('-',' '))&&new RegExp('\\b'+p.bag_weight_lb+'\\s*(?:lb|lbs|pound|pounds)\\b','i').test(description));
    const product=matches.length===1?matches[0]:null;if(!product)warnings.push('Formula / bag color needs an office product mapping');
    const paymentConfirmed=Boolean(invoiceTotal>0&&paid!==null&&paid>=invoiceTotal&&remaining===0),taxResolved=tax===0;
    const line={provider:'sweep_and_go',documentId:invoiceId,lineId,clientRef,customerName:String(row.client_name||data.client_name||'').slice(0,200),description,quantity:Number.isSafeInteger(quantity)?quantity:null,amountCents,invoiceTotalCents:invoiceTotal,invoiceTaxCents:tax,paymentConfirmed,taxResolved,productId:product?.id||null,color:product?.color||null,formula:product?.formula_code||null,saleType:/subscription|recurr/i.test(String(row.invoice_type))||/monthly|weekly/i.test(description)?'subscription':'one_time',date:String(row.invoice_created_at||data.created_at||'').slice(0,10),sourceReceivedAt:row.received_at||null,sourceEventId:row.source_event_id||null,warnings};
    Object.defineProperty(line,'sourcePayload',{value:row.payload});return [line];
  });
}
export async function readFoodSourceReconciliation(db){
  if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sng_invoices'").first())return {enabled:false,lines:[],reviews:[],movements:[],externalStripe:[],coverage:{sng:'No invoice archive is available'}};
  const rows=(await db.prepare("SELECT i.*,e.payload,e.received_at FROM sng_invoices i LEFT JOIN sng_events e ON e.id=i.source_event_id WHERE lower(COALESCE(e.payload,'')) LIKE '%food%' ORDER BY i.invoice_created_at DESC LIMIT 1001").all()).results||[];
  const products=(await db.prepare('SELECT id,color,formula_code,bag_weight_lb FROM dog_food_products WHERE is_active=1').all()).results||[],enabled=await foodSourceReviewEnabled(db);
  const lines=rows.slice(0,1000).flatMap(r=>foodInvoiceLines(r,products));for(const l of lines)l.sourceHash=await foodBusinessHash(l);
  const reviews=enabled?(await db.prepare("SELECT * FROM dog_food_source_line_reviews ORDER BY reviewed_at DESC LIMIT 5000").all()).results||[]:[];
  const movements=enabled?(await db.prepare('SELECT * FROM dog_food_source_movements ORDER BY occurred_on,id LIMIT 10000').all()).results||[]:[];
  const externalStripe=enabled?(await db.prepare('SELECT * FROM dog_food_external_stripe_reviews ORDER BY updated_at DESC LIMIT 250').all()).results||[]:[];
  const last=await db.prepare("SELECT MAX(CASE WHEN event_type='client:invoice_finalized' THEN received_at END) last_invoice,MAX(CASE WHEN event_type='client:client_payment_accepted' THEN received_at END) last_payment FROM sng_events").first();
  for(const l of lines){l.review=reviews.find(r=>r.provider===l.provider&&r.document_id===l.documentId&&r.line_id===l.lineId)||null;l.sourceChanged=Boolean(l.review&&l.review.source_hash!==l.sourceHash);}
  return {enabled,lines,reviews,movements,externalStripe,coverage:{sng:{lastInvoiceReceivedAt:last?.last_invoice||null,lastPaymentReceivedAt:last?.last_payment||null,scope:'Archived invoice webhooks; payment events may lack invoice references. This is not a full current Sweep & Go export.',truncated:rows.length>1000},stripe:{scope:'Verified webhook evidence and explicit read-only provider lookups; unclassified payments stay outside food totals'},confirmedPaidUnits:lines.filter(l=>l.paymentConfirmed).reduce((n,l)=>n+(l.quantity||0),0),unreviewedUnits:lines.filter(l=>!l.review).reduce((n,l)=>n+(l.quantity||0),0)}};
}
export function sourceFoodOverlay(snapshot,source){
  const copy={...snapshot,tables:{...snapshot.tables,Sales:(snapshot.tables.Sales||[]).map(r=>({...r,fields:{...r.fields}})),'Inventory Adjustments':[...(snapshot.tables['Inventory Adjustments']||[])]}},byWebsite=new Map((snapshot.tables.Products||[]).filter(p=>p.fields['Website Product ID']&&(snapshot.tables.Products||[]).filter(x=>x.fields['Website Product ID']===p.fields['Website Product ID']).length===1).map(p=>[p.fields['Website Product ID'],p.id]));
  for(const review of source.reviews||[]){
    if(review.status==='linked'&&review.linked_sale_id?.startsWith('airtable:')){const id=review.linked_sale_id.slice(9),r=copy.tables.Sales.find(r=>r.id===id),sale=JSON.parse(review.source_snapshot);if(r){const receipts=(snapshot.tables['Payment Receipts']||[]).filter(x=>x.fields['Record Status']!=='Archived'&&x.fields.Sale?.includes(id)).reduce((n,x)=>n+Math.round(Number(x.fields.Amount||0)*100),0);r.fields={...r.fields,'Payments Received':Math.max(0,sale.grossCents-receipts)/100,'Payment Status':'Paid',Source:'Sweep & Go / linked Airtable','Source Customer ID':review.customer_id,'Source Document ID':review.document_id,'Source Line ID':review.line_id};}continue;}
    if(review.status!=='confirmed')continue;const sale=JSON.parse(review.source_snapshot),productId=byWebsite.get(review.product_id);if(!productId)continue;
    const done=(source.movements||[]).filter(m=>m.provider===review.provider&&m.document_id===review.document_id&&m.line_id===review.line_id).reduce((n,m)=>n+m.quantity,0),reserved=['delivery_pending','pickup_pending'].includes(review.fulfillment_state)?Math.max(0,sale.quantity-done):0;
    copy.tables.Sales.push({id:`source:${review.provider}:${review.document_id}:${review.line_id}`,fields:{'Sold To':sale.customerName,Product:[productId],'Bag Quantity':sale.quantity,'Sale Date':sale.date,'Sale Total':sale.grossCents/100,'Payments Received':sale.grossCents/100,'Payment Status':'Paid','Payment Method':'Sweep & Go','Fulfillment Status':done>=sale.quantity?'Delivered (source verified)':done?`Partially fulfilled (${done}/${sale.quantity})`:review.fulfillment_state==='unknown'?'Fulfillment unknown':'Handoff pending','Reserved Quantity (Source)':reserved,'Source Customer ID':review.customer_id,'Source Document ID':review.document_id,'Source Line ID':review.line_id,'Verified Fulfilled Quantity (Source)':done,Source:'Sweep & Go','SNG Job ID':review.document_id,'Payment Reference':sale.paymentReference,'Revenue Excluding Tax (Website)':sale.amountCents/100,'Record Status':'Active',Notes:'Paid food line verified by office. Payment does not establish delivery. '+review.note}});
  }
  for(const movement of source.movements||[]){const r=source.reviews.find(r=>r.provider===movement.provider&&r.document_id===movement.document_id&&r.line_id===movement.line_id);if(r?.status!=='confirmed')continue;const productId=byWebsite.get(r.product_id);if(!productId)continue;let evidence;try{evidence=JSON.parse(movement.evidence);}catch{}copy.tables['Inventory Adjustments'].push({id:'source-handoff:'+movement.id,fields:{Product:[productId],'Movement Type':'Source handoff','Movement Date':movement.occurred_on,'Movement At (Website)':evidence?.occurredAt||null,'Quantity Change':-movement.quantity,Reason:evidence?.note||movement.evidence,'Record Status':'Active'}});}
  return copy;
}
export async function runFoodSourceCommand(db,body,actor,build){
  if(!actor||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.commandId||''))throw new FoodError('A persistent signed-in submission reference is required.');
  const hash=await foodBusinessHash(body),replay=async()=>{const r=await db.prepare('SELECT actor,payload_hash,status,result FROM dog_food_ops_commands WHERE id=?').bind(body.commandId).first();if(!r)return null;if(r.actor!==actor||r.payload_hash!==hash||r.status!=='complete')throw new FoodError('Submission reference conflict. Review the existing result.',409);return JSON.parse(r.result);};
  const old=await replay();if(old)return old;await assertFoodWritesAvailable(db);if(!await foodSourceReviewEnabled(db))throw new FoodError('Source reconciliation awaits its separately approved migration.',503);
  const lock=await db.prepare("UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+2 minutes') WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id").bind(body.commandId).first();if(!lock)throw new FoodError('Another food operation is in progress. Retry this same submission.',409);
  try{await assertFoodWritesAvailable(db);const again=await replay();if(again)return again;const {statements,result,sourceKey,before=null,after=result}=await build();
    const writes=[db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_ops_state WHERE command_token=? AND command_until>CURRENT_TIMESTAMP) THEN 1 ELSE 0 END)").bind(body.commandId,body.commandId),...statements,
      db.prepare("INSERT INTO dog_food_ops_commands(id,actor,action,payload_hash,status,result) VALUES(?,?,?,?,'complete',?)").bind(body.commandId,actor,body.action,hash,JSON.stringify(result)),
      db.prepare('INSERT INTO dog_food_source_review_events(id,command_id,actor,action,source_key,before_state,after_state) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),body.commandId,actor,body.action,sourceKey,before?JSON.stringify(before):null,JSON.stringify(after)),
      db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,body.action,sourceKey,JSON.stringify({commandId:body.commandId})),db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(body.commandId)];
    try{await db.batch(writes);}catch(error){const saved=await replay();if(saved)return saved;throw error;}return result;
  }finally{await db.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE command_token=?").bind(body.commandId).run();}
}
export async function reviewFoodSourceLine(db,body,actor,readModel){
  return runFoodSourceCommand(db,body,actor,async()=>{
    if(body.confirm!==true||!['confirmed','linked','excluded'].includes(body.status)||!text(body.note,2000))throw new FoodError('Confirm the source outcome and retain the office evidence.');
    const source=await readFoodSourceReconciliation(db),line=source.lines.find(l=>l.documentId===body.documentId&&l.lineId===body.lineId);
    if(!line||line.sourceHash!==body.sourceHash)throw new FoodError('Source evidence changed. Refresh before reviewing.',409);
    const old=line.review;if((old?.revision||0)!==body.expectedRevision)throw new FoodError('This review changed. Reload its current revision.',409);
    if(old&&source.movements.some(m=>m.document_id===old.document_id&&m.line_id===old.line_id))throw new FoodError('This line has physical evidence. Retain it and request a reviewed correction.',409);
    const note=text(body.note,2000),statements=[],key=`sweep_and_go:${line.documentId}:${line.lineId}`;
    let snapshot={...line,review:undefined,sourceChanged:undefined},customerId=null,productId=null,linkedSale=null;
    if(body.status!=='excluded'){
      if(line.warnings.some(w=>!/product mapping/.test(w))||!line.quantity||!line.amountCents)throw new FoodError('Missing source IDs, quantity or amount must be resolved in a supported source import.');
      date(line.date);const customer=await db.prepare("SELECT id,first_name,last_name,sng_client_id FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL").bind(body.customerId).first();
      const product=await db.prepare('SELECT id FROM dog_food_products WHERE id=? AND is_active=1').bind(body.productId).first();if(!customer||!product)throw new FoodError('Choose the actual customer and catalog formula.');
      if(line.productId&&line.productId!==product.id)throw new FoodError('The selected formula differs from the source color, formula or bag size. Reconcile the source before confirming.');
      if(!line.productId&&body.confirmProductMapping!==true)throw new FoodError('Confirm the actual formula, color and bag size from source evidence before mapping an unclassified line.');
      const mapping=await db.prepare("SELECT customer_id FROM dog_food_source_customer_links WHERE provider='sweep_and_go' AND external_id=?").bind(line.clientRef).first();
      if(mapping&&mapping.customer_id!==customer.id||customer.sng_client_id&&customer.sng_client_id!==line.clientRef)throw new FoodError('The stable source customer belongs to a different profile. Review identity before linking.',409);
      if(!mapping&&customer.sng_client_id!==line.clientRef){if(body.confirmCustomer!==true)throw new FoodError('Confirm the exact provider customer reference and internal profile using office evidence. Names and email alone do not link accounts.');statements.push(db.prepare("INSERT INTO dog_food_source_customer_links(provider,external_id,customer_id,evidence,linked_by) VALUES('sweep_and_go',?,?,?,?)").bind(line.clientRef,customer.id,JSON.stringify({sourceKey:key,note}),actor));}
      const stockModel=await readModel();if(stockModel.products.filter(p=>p.websiteId===product.id).length!==1)throw new FoodError('A single exact catalog-to-stock mapping is required before confirming this source sale.',409);
      if(body.status==='confirmed'&&await db.prepare("SELECT external_id FROM dog_food_sales_external_links WHERE provider='sweep_and_go' AND entity_type='line' AND external_id IN(?,?) LIMIT 1").bind(line.lineId,line.documentId+':'+line.lineId).first())throw new FoodError('This exact source line already has a native link. Review the existing sale instead of creating another.',409);
      let reference=`invoice-paid:${line.documentId}`,paymentKind='invoice_paid_state';
      if(!line.paymentConfirmed){
        const e=await db.prepare("SELECT id,payload,received_at FROM sng_events WHERE id=? AND event_type='client:client_payment_accepted' AND status='processed' AND processing_error IS NULL").bind(body.paymentEventId||'').first();
        let p;try{p=JSON.parse(e?.payload||'{}').data;}catch{}
        if(body.confirmPaymentLink!==true||!p||stable(p.client)!==line.clientRef||!stable(p.reference_number)||money(p.amount)!==line.invoiceTotalCents)throw new FoodError('A processed payment with the exact provider customer, full invoice amount and an explicitly reviewed invoice/payment link is required.');
        reference=stable(p.reference_number);paymentKind='office_linked_provider_payment';
        const other=await db.prepare("SELECT document_id FROM dog_food_source_line_reviews WHERE status<>'excluded' AND json_extract(source_snapshot,'$.paymentReference')=? AND document_id<>? LIMIT 1").bind(reference,line.documentId).first();if(other)throw new FoodError('That payment already supports another invoice. Review its allocation.',409);
      }
      const tax=line.invoiceTaxCents===0?0:integer(body.foodTaxCents,'verified food tax allocation',0,line.invoiceTaxCents??0);
      if(line.invoiceTaxCents===null)throw new FoodError('The invoice tax evidence is missing; import the complete source before confirming a gross amount.');
      const allocatedTax=source.reviews.filter(r=>r.document_id===line.documentId&&r.line_id!==line.lineId&&r.status!=='excluded').reduce((n,r)=>n+Number(JSON.parse(r.source_snapshot).foodTaxCents||0),0);if(allocatedTax+tax>line.invoiceTaxCents)throw new FoodError('The food tax allocation exceeds the actual invoice tax across reviewed lines.');
      if(old?.status==='confirmed'&&['delivery_pending','pickup_pending'].includes(old.fulfillment_state)&&body.status==='confirmed'){const oldSale=JSON.parse(old.source_snapshot),p=stockModel.products.find(p=>p.websiteId===product.id),own=old.product_id===product.id?oldSale.quantity:0;if(!p?.confirmed||p.available+own<line.quantity)throw new FoodError('The revised source quantity exceeds usable stock after reservations.',409);}
      snapshot={...snapshot,customerName:customer.first_name+' '+customer.last_name,productId:product.id,grossCents:line.amountCents+tax,foodTaxCents:tax,paymentReference:reference,paymentKind,paymentDate:null,paymentDateKnown:false};customerId=customer.id;productId=product.id;
      if(body.status==='linked'){
        const model=await readModel(),sale=model.sales.find(s=>(s.lineId?'native:'+s.lineId:'airtable:'+s.id)===body.linkedSaleId&&!s.id.startsWith('source:'));
        if(!sale||sale.quantity!==line.quantity||sale.totalCents!==snapshot.grossCents||model.products.find(p=>p.id===sale.productId)?.websiteId!==productId)throw new FoodError('The exact existing sale must match the source formula, quantity and verified gross amount. Differences remain for review.');
        if(sale.lineId&&sale.verifiedCollectedCents<snapshot.grossCents)throw new FoodError('This native order has no matching recorded payment. Reconcile its provider receipt before linking this source line.');
        const owner=sale.orderId?model.native.orders.find(o=>o.id===sale.orderId)?.customer_id:(await db.prepare("SELECT customer_id FROM dog_food_sales_customer_sources WHERE source_table='Sales' AND source_record_id=? UNION SELECT customer_id FROM dog_food_direct_sale_links WHERE sale_id=?").bind(sale.id,sale.id).all()).results?.[0]?.customer_id;
        if(owner!==customerId)throw new FoodError('The existing sale is not linked to this exact customer identity.');linkedSale=body.linkedSaleId;
      }
    }
    if(line.sourceEventId)statements.push(db.prepare('INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM sng_invoices WHERE invoice_id=? AND source_event_id=?) AND EXISTS(SELECT 1 FROM sng_events WHERE id=? AND payload=?) THEN 1 ELSE 0 END)').bind(body.commandId+'-source',line.documentId,line.sourceEventId,line.sourceEventId,line.sourcePayload));
    statements.push(db.prepare('INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN COALESCE((SELECT revision FROM dog_food_source_line_reviews WHERE provider=? AND document_id=? AND line_id=?),0)=? THEN 1 ELSE 0 END)').bind(body.commandId+'-review','sweep_and_go',line.documentId,line.lineId,body.expectedRevision));
    statements.push(db.prepare(`INSERT INTO dog_food_source_line_reviews(provider,document_id,line_id,status,source_hash,source_snapshot,customer_id,product_id,linked_sale_id,note,reviewed_by)
      VALUES('sweep_and_go',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,document_id,line_id) DO UPDATE SET status=excluded.status,source_hash=excluded.source_hash,source_snapshot=excluded.source_snapshot,customer_id=excluded.customer_id,product_id=excluded.product_id,linked_sale_id=excluded.linked_sale_id,note=excluded.note,revision=revision+1,reviewed_by=excluded.reviewed_by,reviewed_at=CURRENT_TIMESTAMP`).bind(line.documentId,line.lineId,body.status,line.sourceHash,JSON.stringify(snapshot),customerId,productId,linkedSale,note,actor),db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id IN(?,?)').bind(body.commandId+'-source',body.commandId+'-review'));
    return {statements,sourceKey:key,before:old,after:{status:body.status,sourceHash:line.sourceHash,customerId,productId,linkedSale,note},result:{message:body.status==='confirmed'?'Paid source sale confirmed. Fulfillment stays unknown and no bags were deducted.':body.status==='linked'?'Source line linked to the existing sale; no duplicate sales or stock movement added.':'Source line excluded with retained evidence.'}};
  });
}
export async function recordFoodSourceHandoff(db,body,actor,readModel){
  return runFoodSourceCommand(db,body,actor,async()=>{
    const source=await readFoodSourceReconciliation(db),r=source.reviews.find(r=>r.document_id===body.documentId&&r.line_id===body.lineId&&r.status==='confirmed');if(!r||r.revision!==body.expectedRevision||body.confirm!==true||!text(body.evidence,2000))throw new FoodError('Choose the current confirmed source sale and retain actual handoff evidence.',409);
    if(source.lines.some(l=>l.documentId===r.document_id&&l.lineId===r.line_id&&l.sourceChanged))throw new FoodError('Source evidence changed. Review it before recording a physical handoff.',409);
    const sale=JSON.parse(r.source_snapshot),key=`sweep_and_go:${r.document_id}:${r.line_id}`;
    const done=source.movements.filter(m=>m.document_id===r.document_id&&m.line_id===r.line_id).reduce((n,m)=>n+m.quantity,0),statements=[];
    if(body.action==='source_pending'){
      if(!['delivery_pending','pickup_pending','unknown'].includes(body.fulfillmentState))throw new FoodError('Choose the confirmed pending handoff or unknown state.');
      if(body.fulfillmentState!=='unknown'){const m=await readModel(),p=m.products.find(p=>p.websiteId===r.product_id),own=['delivery_pending','pickup_pending'].includes(r.fulfillment_state)?sale.quantity-done:0;if(!p?.confirmed||p.available+own<sale.quantity-done)throw new FoodError('Usable stock cannot cover this reservation. Reconcile physical inventory first.',409);}
      statements.push(db.prepare('UPDATE dog_food_source_line_reviews SET fulfillment_state=?,revision=revision+1,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE provider=? AND document_id=? AND line_id=?').bind(body.fulfillmentState,actor,r.provider,r.document_id,r.line_id));
    }else{
      const quantity=integer(body.quantity,'bags actually handed over',1,sale.quantity-done),occurred=date(body.date);if(occurred>foodDate()||!['delivery','pickup'].includes(body.handoff))throw new FoodError('Choose the actual handoff method and a date that is not in the future.');
      const m=await readModel(),p=m.products.find(p=>p.websiteId===r.product_id),own=['delivery_pending','pickup_pending'].includes(r.fulfillment_state)?sale.quantity-done:0;
      const occurredAt=body.occurredAt?String(body.occurredAt):null;
      if(occurredAt&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(occurredAt)||!Number.isFinite(Date.parse(occurredAt))||Date.parse(occurredAt)>Date.now()||foodDate(new Date(occurredAt))!==occurred))throw new FoodError('Enter the actual handoff time matching its Eastern calendar date, not a future time.');
      if(p?.countDate===occurred&&(!p.countedAt||!occurredAt))throw new FoodError('A handoff on the count date needs both an exact count cutoff and actual handoff time. Verify these before changing stock.',409);
      if(!p?.confirmed||(occurred>p.countDate||occurred===p.countDate&&occurredAt>p.countedAt)&&p.available+own<quantity)throw new FoodError('Current physical stock cannot cover these bags. Reconcile inventory before posting this handoff.',409);
      statements.push(db.prepare('INSERT INTO dog_food_source_movements(id,command_id,provider,document_id,line_id,quantity,occurred_on,handoff,evidence,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),body.commandId,r.provider,r.document_id,r.line_id,quantity,occurred,body.handoff,JSON.stringify({note:text(body.evidence,2000),occurredAt}),actor),db.prepare('UPDATE dog_food_source_line_reviews SET fulfillment_state=?,revision=revision+1,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE provider=? AND document_id=? AND line_id=?').bind(done+quantity===sale.quantity?'complete':r.fulfillment_state,actor,r.provider,r.document_id,r.line_id));
    }
    return {statements,sourceKey:key,before:r,after:{action:body.action,date:body.date||null,quantity:body.quantity||null,state:body.fulfillmentState||null,evidence:text(body.evidence,2000)},result:{message:'Physical source handoff state recorded. Payment and sale totals were not changed.'}};
  });
}
