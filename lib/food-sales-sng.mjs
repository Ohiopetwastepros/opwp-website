import {FoodError,text,cents} from './dog-food-operations.mjs';
import {salesHash,foodSalesOrder,receiptStatements} from './food-sales-ledger.mjs';

const dataOf=body=>body?.data&&typeof body.data==='object'?body.data:body||{};
const stable=value=>typeof value==='number'&&Number.isSafeInteger(value)?String(value):typeof value==='string'&&/^[a-zA-Z0-9:_ .\/-]{1,160}$/.test(value)?value.trim():'';
export async function queueFoodSalesReview(db,{sourceKey,reason,evidence,orderId=null,actor='sng-webhook'}) {
  await db.prepare(`INSERT INTO dog_food_sales_review(id,kind,order_id,source_key,actor,reason,evidence) VALUES(?,'sng',?,?,?,?,?)
    ON CONFLICT(source_key) DO UPDATE SET reason=excluded.reason,evidence=excluded.evidence WHERE status='pending'`).bind(crypto.randomUUID(),orderId,sourceKey,actor,reason,JSON.stringify(evidence)).run();
  return {matched:false,review:true,reason};
}
async function reconcile(db,row) {
  const token=crypto.randomUUID(),lock=await db.prepare(`UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+2 minutes')
    WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id`).bind(token).first();
  if(!lock)return queueFoodSalesReview(db,{sourceKey:`sng-event:${row.event_id}`,reason:'payment_update_in_progress_retry_required',evidence:{eventId:row.event_id}});
  try{return await reconcileLocked(db,row,token);}
  finally{await db.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(token).run();}
}
async function reconcileLocked(db,row,token) {
  const body=JSON.parse(row.evidence),data=dataOf(body),invoiceId=stable(data.invoice_id),reference=stable(data.reference_number),client=stable(data.client);
  const review=reason=>queueFoodSalesReview(db,{sourceKey:`sng-event:${row.event_id}`,reason,evidence:{eventId:row.event_id,invoiceId,reference,client},actor:'sng-webhook'});
  let amount;try{amount=cents(data.amount,'verified payment amount');}catch{return review('invalid_payment_amount');}
  if(!reference||!client||amount<=0)return review('missing_stable_payment_or_customer_reference');
  if(!invoiceId)return review('payment_has_no_invoice_reference');
  const invoiceRows=(await db.prepare("SELECT * FROM dog_food_sales_sng_events WHERE json_extract(evidence,'$.type')='client:invoice_finalized' AND CAST(json_extract(evidence,'$.data.invoice_id') AS TEXT)=? ORDER BY created_at LIMIT 51").bind(invoiceId).all()).results||[];
  // Distinct received event IDs may repeat one invoice; only identical invoice data is safe.
  if(!invoiceRows.length)return review('invoice_not_received_yet');
  const invoice=dataOf(JSON.parse(invoiceRows[0].evidence));
  if(invoiceRows.length>50)return review('invoice_history_exceeds_reviewed_bound');
  const invoiceHash=await salesHash(invoice);
  for(const version of invoiceRows)if(invoiceHash!==await salesHash(dataOf(JSON.parse(version.evidence))))return review('conflicting_invoice_versions');
  if(!Array.isArray(invoice.items)||!invoice.items.length||invoice.items.some(i=>!/^.*dog\s*food.*$/i.test(String(i.description||''))))return review('mixed_or_unclassified_invoice');
  const link=await db.prepare("SELECT * FROM dog_food_sales_external_links WHERE provider='sweep_and_go' AND entity_type='invoice' AND external_id=?").bind(invoiceId).first();
  if(!link?.order_id)return review('invoice_requires_exact_office_order_link');
  const order=await foodSalesOrder(db,link.order_id);
  const customer=await db.prepare('SELECT sng_client_id FROM dog_food_customers WHERE id=?').bind(order.customer_id).first();
  if(customer?.sng_client_id!==client||stable(invoice.client)!==client)return review('customer_reference_conflict');
  let total;try{total=cents(invoice.total);}catch{return review('invoice_total_missing');}
  if(total!==order.total_cents)return review('invoice_total_requires_review');
  if(['cancelled','refunded'].includes(order.status))return review('order_not_open_for_payment');
  const prior=await db.prepare("SELECT * FROM dog_food_sales_external_links WHERE provider='sweep_and_go' AND entity_type='payment' AND external_id=?").bind(reference).first();
  if(prior) {
    const old=JSON.parse(prior.evidence);
    if(prior.order_id!==order.id||old.amountCents!==amount||old.client!==client||old.invoiceId!==invoiceId)return review('payment_reference_conflict');
    return {matched:true,orderId:order.id,paymentId:prior.payment_id,duplicate:true};
  }
  const receipts=(await db.prepare(`SELECT p.* FROM dog_food_payments p WHERE p.order_id=? AND p.status IN('captured','refunded')
    AND p.amount_cents=? AND p.provider IN('staff_cash','staff_check','staff_venmo','staff_zelle','staff_paypal','staff_card')`).bind(order.id,amount).all()).results||[];
  const exact=receipts.filter(p=>p.provider_transaction_id===reference&&p.provider!=='staff_cash');
  let paymentId,statements=[];
  if(exact.length===1)paymentId=exact[0].id;
  else if(receipts.length)return review('manual_receipt_may_already_cover_this_payment');
  else {
    if(amount>order.balance_cents)return review('payment_exceeds_remaining_balance');
    const receipt=receiptStatements(db,{orderId:order.id,amountCents:amount,method:'sweep_and_go',reference,receivedAt:row.created_at,actor:'sng-webhook',eventId:row.event_id,evidence:{invoiceId,client,verified:true}});
    paymentId=receipt.id;statements=receipt.statements;
  }
  const evidence={eventId:row.event_id,invoiceId,client,amountCents:amount,matchedExistingReceipt:exact.length===1};
  const result={matched:true,orderId:order.id,paymentId,linkedExistingReceipt:exact.length===1};
  statements.push(db.prepare("INSERT INTO dog_food_sales_external_links(provider,entity_type,external_id,order_id,payment_id,customer_id,evidence,linked_by) VALUES('sweep_and_go','payment',?,?,?,?,?,'sng-webhook')").bind(reference,order.id,paymentId,order.customer_id,JSON.stringify(evidence)),db.prepare("UPDATE dog_food_sales_sng_events SET status='linked',result=? WHERE event_id=?").bind(JSON.stringify(result),row.event_id),db.prepare("UPDATE dog_food_sales_review SET status='resolved',reviewed_by='sng-webhook',reviewed_at=CURRENT_TIMESTAMP,office_note='Exact source linkage confirmed' WHERE source_key=? AND status='pending'").bind(`sng-event:${row.event_id}`),db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,'sng-webhook','food_sales_sng_link',?,?)").bind(crypto.randomUUID(),order.id,JSON.stringify(evidence)));
  statements.unshift(db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_ops_state
    WHERE id='org-opwp' AND command_token=? AND command_until>CURRENT_TIMESTAMP) THEN 1 ELSE 0 END)`).bind(token,token));
  statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(token));
  try{await db.batch(statements);}catch(error){const found=await db.prepare("SELECT * FROM dog_food_sales_external_links WHERE provider='sweep_and_go' AND entity_type='payment' AND external_id=?").bind(reference).first();if(found&&found.order_id===order.id&&JSON.parse(found.evidence).amountCents===amount)return {matched:true,duplicate:true,orderId:order.id,paymentId:found.payment_id};throw error;}
  return result;
}
export async function retryFoodSalesSng(db) {
  const settings=await db.prepare("SELECT sng_enabled FROM dog_food_sales_settings WHERE id='org-opwp'").first();
  if(!settings?.sng_enabled)return {matched:false,reason:'sng_reconciliation_not_enabled'};
  const events=(await db.prepare("SELECT * FROM dog_food_sales_sng_events WHERE status='review' AND json_extract(evidence,'$.type')='client:client_payment_accepted' ORDER BY created_at LIMIT 50").all()).results||[];
  const results=[];for(const row of events)results.push(await reconcile(db,row));return {results};
}
export async function ingestFoodSalesSng(db,{eventId,eventType,body,verified=false}) {
  if(!verified)return {matched:false,reason:'webhook_not_verified'};
  if(!['client:invoice_finalized','client:client_payment_accepted'].includes(eventType))return {matched:false,reason:'unsupported_event'};
  // Store the normalized type without inventing IDs or undocumented provider fields.
  const evidence={type:eventType,data:dataOf(body)},hash=await salesHash(evidence);
  const prior=await db.prepare('SELECT * FROM dog_food_sales_sng_events WHERE event_id=?').bind(eventId).first();
  if(prior&&prior.payload_hash!==hash)throw new FoodError('Sweep & Go event ID content conflict.',409);
  if(!prior)await db.prepare('INSERT INTO dog_food_sales_sng_events(event_id,payload_hash,evidence) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING').bind(eventId,hash,JSON.stringify(evidence)).run();
  const stored=await db.prepare('SELECT * FROM dog_food_sales_sng_events WHERE event_id=?').bind(eventId).first();
  if(stored.payload_hash!==hash)throw new FoodError('Sweep & Go event ID content conflict.',409);
  if(stored.status==='linked')return {...JSON.parse(stored.result),duplicate:true};
  const settings=await db.prepare("SELECT sng_enabled FROM dog_food_sales_settings WHERE id='org-opwp'").first();
  if(!settings?.sng_enabled)return queueFoodSalesReview(db,{sourceKey:`sng-event:${eventId}`,reason:'sng_reconciliation_not_enabled',evidence:{eventId}});
  if(eventType==='client:client_payment_accepted')return reconcile(db,stored);
  await retryFoodSalesSng(db);return {matched:false,archived:true,reason:'invoice_is_not_payment_evidence'};
}
export async function linkFoodSalesInvoice(db,{eventId,orderId,reason,confirm},actor) {
  if(confirm!==true||!text(reason,1000))throw new FoodError('Record the office evidence for this exact invoice/order link.');
  const event=await db.prepare("SELECT * FROM dog_food_sales_sng_events WHERE event_id=? AND json_extract(evidence,'$.type')='client:invoice_finalized'").bind(eventId).first();
  if(!event)throw new FoodError('A verified archived invoice event is required.');
  const data=dataOf(JSON.parse(event.evidence)),invoiceId=stable(data.invoice_id),order=await foodSalesOrder(db,orderId),customer=await db.prepare('SELECT sng_client_id FROM dog_food_customers WHERE id=?').bind(order.customer_id).first();
  if(!invoiceId||!customer?.sng_client_id||customer.sng_client_id!==stable(data.client)||cents(data.total)!==order.total_cents)throw new FoodError('Invoice customer and total must match exact source references.');
  if(!Array.isArray(data.items)||!data.items.length||data.items.some(i=>!/dog\s*food/i.test(String(i.description||''))))throw new FoodError('Mixed invoices require a separate reviewed food allocation; automatic application is blocked.');
  const old=await db.prepare("SELECT order_id,evidence FROM dog_food_sales_external_links WHERE provider='sweep_and_go' AND entity_type='invoice' AND external_id=?").bind(invoiceId).first();
  if(old){if(old.order_id!==order.id)throw new FoodError('Invoice is already linked to another order.',409);return {orderId:order.id,reused:true,...await retryFoodSalesSng(db)};}
  await db.batch([db.prepare("INSERT INTO dog_food_sales_external_links(provider,entity_type,external_id,order_id,customer_id,evidence,linked_by) VALUES('sweep_and_go','invoice',?,?,?,?,?)").bind(invoiceId,order.id,order.customer_id,JSON.stringify({eventId,reason:text(reason,1000),invoiceHash:event.payload_hash}),actor),db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_invoice_review',?,?)").bind(crypto.randomUUID(),actor,order.id,JSON.stringify({eventId,invoiceId,reason:text(reason,1000)}))]);
  return {orderId:order.id,invoiceId,...await retryFoodSalesSng(db)};
}
export async function linkFoodSalesExistingPayment(db,{eventId,orderId,paymentId,reason,confirm},actor) {
  if(confirm!==true||!text(reason,1000))throw new FoodError('Confirm the existing receipt and record the source evidence.');
  const event=await db.prepare("SELECT * FROM dog_food_sales_sng_events WHERE event_id=? AND json_extract(evidence,'$.type')='client:client_payment_accepted'").bind(eventId).first();
  if(!event)throw new FoodError('Choose a verified archived payment event.');
  const data=dataOf(JSON.parse(event.evidence)),reference=stable(data.reference_number),client=stable(data.client),amount=cents(data.amount);
  const order=await foodSalesOrder(db,orderId),customer=await db.prepare('SELECT sng_client_id FROM dog_food_customers WHERE id=?').bind(order.customer_id).first();
  const payment=await db.prepare("SELECT * FROM dog_food_payments WHERE id=? AND order_id=? AND status IN('captured','refunded')").bind(paymentId,order.id).first();
  if(!reference||!client||!payment||payment.amount_cents!==amount||customer?.sng_client_id!==client)throw new FoodError('Exact customer, original receipt amount and payment references must be verified.');
  const existing=await db.prepare("SELECT * FROM dog_food_sales_external_links WHERE provider='sweep_and_go' AND entity_type='payment' AND external_id=?").bind(reference).first();
  if(existing){if(existing.payment_id!==paymentId||existing.order_id!==order.id)throw new FoodError('Source payment already belongs to a different receipt.',409);return {orderId:order.id,paymentId,reused:true};}
  const evidence={eventId,client,invoiceId:stable(data.invoice_id),amountCents:amount,reason:text(reason,1000),officeReviewed:true};
  const result={matched:true,orderId:order.id,paymentId,linkedExistingReceipt:true};
  await db.batch([db.prepare("INSERT INTO dog_food_sales_external_links(provider,entity_type,external_id,order_id,payment_id,customer_id,evidence,linked_by) VALUES('sweep_and_go','payment',?,?,?,?,?,?)").bind(reference,order.id,paymentId,order.customer_id,JSON.stringify(evidence),actor),db.prepare("UPDATE dog_food_sales_sng_events SET status='linked',result=? WHERE event_id=?").bind(JSON.stringify(result),eventId),db.prepare("UPDATE dog_food_sales_review SET status='resolved',office_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE source_key=? AND status='pending'").bind(text(reason,1000),actor,`sng-event:${eventId}`),db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'food_sales_receipt_evidence_link',?,?)").bind(crypto.randomUUID(),actor,order.id,JSON.stringify({...evidence,paymentId}))]);
  return result;
}
