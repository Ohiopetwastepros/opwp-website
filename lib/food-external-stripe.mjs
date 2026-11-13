import {FoodError,text} from './dog-food-operations.mjs';
import {foodSourceReviewEnabled,runFoodSourceCommand} from './food-source-reconciliation.mjs';
const id=(v,prefix)=>typeof v==='string'&&new RegExp('^'+prefix+'_[a-zA-Z0-9]+$').test(v)?v:null;
export async function archiveFoodExternalStripe(db,event,{verified=false}={}){
  if(!verified||!await foodSourceReviewEnabled(db))return {archived:false};
  const object=event.data?.object||{},refund=event.type==='charge.refunded',paymentId=id(refund?(typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id):object.id,'pi');
  if(!paymentId||!['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.processing','payment_intent.canceled','charge.refunded'].includes(event.type))return {archived:false};
  const customer=id(typeof object.customer==='string'?object.customer:object.customer?.id,'cus'),amount=Number(object.amount),received=refund?amount:Number(object.amount_received||0),refunded=refund?Number(object.amount_refunded):typeof object.latest_charge==='object'?Number(object.latest_charge.amount_refunded||0):0;
  if(!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(received)||received<0||!Number.isSafeInteger(refunded)||refunded<0||refunded>amount||!/^[a-z]{3}$/.test(object.currency||'')||typeof event.livemode!=='boolean')throw new FoodError('External Stripe evidence has invalid amounts, mode or currency.');
  const old=await db.prepare('SELECT * FROM dog_food_external_stripe_reviews WHERE payment_intent_id=?').bind(paymentId).first();
  const conflict=old&&(old.currency!==object.currency||old.stripe_customer_id!==customer||old.amount_cents!==amount||old.livemode!==Number(event.livemode));
  if(conflict){await db.prepare("UPDATE dog_food_external_stripe_reviews SET status='conflict',note='Provider identity, amount, mode or currency changed; investigate before linking',updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?").bind(paymentId).run();return {archived:true,conflict:true};}
  const evidence={paymentIntentId:paymentId,stripeCustomerId:customer,amountReceivedCents:received,metadataOrderId:text(object.metadata?.order_id,100)||null,source:verified==='lookup'?'read_only_stripe_lookup':'verified_stripe_webhook',eventId:event.id,refundEvent:refund,paidAtKnown:false};
  await db.prepare(`INSERT INTO dog_food_external_stripe_reviews(payment_intent_id,stripe_customer_id,currency,amount_cents,refunded_cents,livemode,provider_status,source_event_id,evidence)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_intent_id) DO UPDATE SET refunded_cents=MAX(refunded_cents,excluded.refunded_cents),provider_status=CASE WHEN excluded.provider_status='refunded' OR provider_status<>'refunded' THEN excluded.provider_status ELSE provider_status END,source_event_id=excluded.source_event_id,evidence=CASE WHEN excluded.provider_status='refunded' AND provider_status='succeeded' THEN evidence ELSE excluded.evidence END,updated_at=CURRENT_TIMESTAMP`).bind(paymentId,customer,object.currency,amount,refunded,Number(event.livemode),refund?'refunded':object.status||'unknown',String(event.id),JSON.stringify(evidence)).run();
  return {archived:true,paymentIntentId:paymentId};
}
export async function lookupFoodExternalStripe(db,body,actor,env,retrieve){
  const paymentId=id(body.paymentIntentId,'pi');if(!paymentId)throw new FoodError('Enter a Stripe PaymentIntent reference. Do not enter card details.');
  const intent=await retrieve(paymentId,env);if(intent.id!==paymentId||intent.livemode!==String(env.STRIPE_SECRET_KEY||'').startsWith('sk_live_'))throw new FoodError('Stripe lookup mode or identity did not match.');
  const type=intent.status==='succeeded'?'payment_intent.succeeded':intentEventType(intent.status);
  const r=await archiveFoodExternalStripe(db,{id:'lookup:'+crypto.randomUUID(),type,livemode:intent.livemode,data:{object:intent}},{verified:'lookup'});
  if(!r.archived)throw new FoodError('The Stripe review migration is required before retaining this evidence.',503);
  await db.prepare("INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,'external_stripe_lookup',?,?)").bind(crypto.randomUUID(),actor,paymentId,JSON.stringify({readOnly:true})).run();return {message:'Read-only Stripe evidence retained for review. No payment or customer was created.'};
}
const intentEventType=status=>status==='canceled'?'payment_intent.canceled':status==='processing'?'payment_intent.processing':'payment_intent.payment_failed';
export async function linkFoodExternalStripe(db,body,actor,env){
  return runFoodSourceCommand(db,body,actor,async()=>{
    const row=await db.prepare('SELECT * FROM dog_food_external_stripe_reviews WHERE payment_intent_id=?').bind(body.paymentIntentId).first();
    if(!row||row.status!=='unmatched'||body.confirm!==true||!text(body.note,2000))throw new FoodError('Choose an unmatched Stripe payment and confirm the office evidence.',409);
    if(row.updated_at!==body.expectedUpdatedAt)throw new FoodError('Stripe evidence changed. Refresh before linking.',409);
    const statements=[],note=text(body.note,2000);
    if(body.action==='exclude_external_stripe'){
      statements.push(db.prepare("UPDATE dog_food_external_stripe_reviews SET status='excluded',note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?").bind(note,actor,row.payment_intent_id));
      return {statements,sourceKey:row.payment_intent_id,before:row,after:{status:'excluded',note},result:{message:'Payment excluded from dog food with retained evidence. No provider records changed.'}};
    }
    const evidence=JSON.parse(row.evidence),mode=String(env.STRIPE_SECRET_KEY||'');if(!mode.startsWith('sk_')||row.livemode!==Number(mode.startsWith('sk_live_')))throw new FoodError('The provider evidence mode must match this environment.');
    const order=await db.prepare(`SELECT o.*,c.stripe_customer_id,c.status customer_status FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL`).bind(body.orderId).first();
    if(!order||order.customer_status!=='active'||!['draft','pending_payment','payment_failed'].includes(order.status))throw new FoodError('Choose the exact active unpaid order.');
    if(row.provider_status!=='succeeded'||row.refunded_cents||!row.stripe_customer_id||row.amount_cents!==order.total_cents||evidence.amountReceivedCents!==order.total_cents||row.currency!=='usd')throw new FoodError('Only an unrefunded successful USD payment for the exact order amount can be linked. Partial, refunded and asynchronous payments stay for review.');
    if(evidence.metadataOrderId&&evidence.metadataOrderId!==order.id&&await db.prepare('SELECT id FROM dog_food_orders WHERE id=?').bind(evidence.metadataOrderId).first())throw new FoodError('Stripe metadata points to a different existing order.',409);
    if(order.stripe_customer_id&&order.stripe_customer_id!==row.stripe_customer_id)throw new FoodError('Stripe customer identity conflicts with this order.',409);
    const duplicateOwner=await db.prepare('SELECT id FROM dog_food_customers WHERE stripe_customer_id=? AND id<>?').bind(row.stripe_customer_id,order.customer_id).first();if(duplicateOwner)throw new FoodError('This Stripe customer already belongs to another profile.',409);
    if(!order.stripe_customer_id){if(body.confirmCustomer!==true)throw new FoodError('Confirm the exact Stripe customer and internal identity using provider evidence; email alone cannot link them.');statements.push(db.prepare('UPDATE dog_food_customers SET stripe_customer_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stripe_customer_id IS NULL').bind(row.stripe_customer_id,order.customer_id));}
    if(await db.prepare("SELECT id FROM dog_food_payments WHERE order_id=? AND status IN('captured','refunded') LIMIT 1").bind(order.id).first())throw new FoodError('This order already has payment evidence. Reconcile existing receipts before adding any money.',409);
    const paymentId=crypto.randomUUID(),stamp=new Date().toISOString();
    statements.unshift(db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN
      EXISTS(SELECT 1 FROM dog_food_external_stripe_reviews WHERE payment_intent_id=? AND status='unmatched' AND updated_at=? AND refunded_cents=0 AND provider_status='succeeded' AND source_event_id=? AND evidence=? AND stripe_customer_id=? AND amount_cents=? AND currency='usd' AND livemode=?)
      AND EXISTS(SELECT 1 FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.customer_id=? AND o.status IN('draft','pending_payment','payment_failed') AND o.total_cents=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL AND c.status='active' AND c.stripe_customer_id IS ?)
      AND NOT EXISTS(SELECT 1 FROM dog_food_payments WHERE order_id=? AND status IN('captured','refunded'))
      AND NOT EXISTS(SELECT 1 FROM dog_food_customers WHERE stripe_customer_id=? AND id<>?)
      THEN 1 ELSE 0 END)`).bind(body.commandId+'-stripe',row.payment_intent_id,body.expectedUpdatedAt,row.source_event_id,row.evidence,row.stripe_customer_id,row.amount_cents,row.livemode,order.id,order.customer_id,order.total_cents,order.stripe_customer_id,order.id,row.stripe_customer_id,order.customer_id));
    statements.push(
      db.prepare("INSERT INTO dog_food_payments(id,order_id,provider,provider_transaction_id,idempotency_key,amount_cents,status,processed_at) VALUES(?,?,'stripe',?,?,?,'captured',?)").bind(paymentId,order.id,row.payment_intent_id,'stripe:'+row.payment_intent_id,row.amount_cents,stamp),
      db.prepare('INSERT INTO dog_food_sales_payment_evidence(payment_id,actor,method,reference,received_at,source_event_id,evidence) VALUES(?,?,?,?,?,?,?)').bind(paymentId,actor,'card',row.payment_intent_id,stamp,row.source_event_id,JSON.stringify({source:'reviewed_external_stripe',provider:'stripe',paidAtKnown:false,recordedAt:stamp,note})),
      db.prepare("UPDATE dog_food_orders SET status='paid',automation_review='Historical Stripe payment linked; no recurring billing was enrolled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(order.id),
      db.prepare("UPDATE dog_food_transactional_outbox SET status='cancelled',last_error='Historical reconciliation; no customer message authorized' WHERE order_id=? AND template='paid' AND status='queued'").bind(order.id),
      db.prepare("UPDATE dog_food_external_stripe_reviews SET status='linked',order_id=?,payment_id=?,note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?").bind(order.id,paymentId,note,actor,row.payment_intent_id),db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(body.commandId+'-stripe'));
    return {statements,sourceKey:row.payment_intent_id,before:row,after:{status:'linked',orderId:order.id,paymentId,note},result:{message:'Existing Stripe payment linked to the same customer and order. No charge, card setup, subscription or stock movement was created.'}};
  });
}
