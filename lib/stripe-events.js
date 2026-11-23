import { activateDogFoodSubscriptionFromOrder, recordDogFoodPayment } from "./dog-food-payments";
import { retrieveStripePaymentMethod } from "./stripe";
import {archiveFoodExternalStripe} from './food-external-stripe.mjs';

async function claimEvent(db, event) {
  const existing = await db.prepare("SELECT status FROM dog_food_payment_events WHERE id=?").bind(event.id).first();
  if (["processed", "ignored"].includes(existing?.status)) return false;
  const token=crypto.randomUUID();
  const claimed=await db.prepare(
    `INSERT INTO dog_food_payment_events (id,provider,event_type,provider_object_id,status,lease_token,lease_until)
     VALUES (?,'stripe',?,?,'processing',?,datetime('now','+5 minutes'))
     ON CONFLICT(id) DO UPDATE SET status='processing',error_message=NULL,updated_at=CURRENT_TIMESTAMP,lease_token=excluded.lease_token,lease_until=excluded.lease_until
     WHERE dog_food_payment_events.status='failed' OR (dog_food_payment_events.status='processing' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)) RETURNING id`
  ).bind(event.id, event.type, String(event.data?.object?.id || ""),token).first();
  if(!claimed)throw new Error('Stripe event is already processing; retry later.');
  return token;
}

async function finishEvent(db, eventId, token, status, errorMessage = null) {
  await db.prepare(
    `UPDATE dog_food_payment_events SET status=?,error_message=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?`
  ).bind(status, errorMessage, eventId, token).run();
}

async function paymentSucceeded(db, intent, env, eventId) {
  const orderId = String(intent.metadata?.order_id || "").trim();
  if (!orderId) return { ignored: true, reason: "not_dog_food" };
  const order = await db.prepare(`SELECT o.id,o.total_cents,o.order_type,c.stripe_customer_id FROM dog_food_orders o
    JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL LIMIT 1`).bind(orderId).first();
  if (!order) return { ignored: true, reason: "order_not_found" };
  const amountCents = Number(intent.amount_received ?? intent.amount);
  if (amountCents !== Number(order.total_cents) || String(intent.currency || "").toLowerCase() !== "usd") {
    throw new Error("Stripe payment amount or currency did not match the dog-food order.");
  }
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (intent.status !== 'succeeded' || !customerId || customerId !== order.stripe_customer_id) throw new Error('Stripe customer did not match the dog-food order.');
  const paymentMethod = paymentMethodId ? await retrieveStripePaymentMethod(paymentMethodId, env) : null;
  const methodCustomer = typeof paymentMethod?.customer === 'string' ? paymentMethod.customer : paymentMethod?.customer?.id;
  if (methodCustomer && methodCustomer !== customerId || order.order_type === 'subscription' && methodCustomer !== customerId) throw new Error('Stripe payment method did not match the dog-food customer.');
  return recordDogFoodPayment({
    db,
    orderId,
    provider: "stripe",
    reference: intent.id,
    actor: "stripe-webhook",
    sourceEventId: eventId,
    amountCents,
    paymentMethodId,
    stripeCustomerId: typeof intent.customer === "string" ? intent.customer : intent.customer?.id,
    cardBrand: paymentMethod?.card?.brand || null,
    lastFour: paymentMethod?.card?.last4 || null,
  });
}

async function paymentFailed(db, intent, eventId) {
  const orderId = String(intent.metadata?.order_id || "").trim();
  if (!orderId) return { ignored: true, reason: "not_dog_food" };
  const order = await db.prepare(
    `SELECT o.id,o.status,o.subscription_id,o.total_cents,o.customer_id,c.email,c.phone,c.stripe_customer_id
     FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL LIMIT 1`
  ).bind(orderId).first();
  if (!order) return { ignored: true, reason: "order_not_found" };
  if(['cancelled','refunded','fulfilled'].includes(order.status))return {ignored:true,reason:'terminal_order'};
  const stripeCustomerId=typeof intent.customer==='string'?intent.customer:intent.customer?.id;
  if(stripeCustomerId!==order.stripe_customer_id||Number(intent.amount)!==order.total_cents||intent.currency!=='usd')throw new Error('Stripe failure did not match the order owner and amount.');
  const captured = await db.prepare("SELECT id FROM dog_food_payments WHERE order_id=? AND status='captured' LIMIT 1").bind(order.id).first();
  if (captured) return { ignored: true, reason: "already_captured" };
  const error = intent.last_payment_error || {};
  const message = String(error.message || "Stripe could not complete the payment.").slice(0, 500);
  const code = String(error.decline_code || error.code || "payment_failed").slice(0, 100);
  const statements = [
    db.prepare(
      `INSERT INTO dog_food_payments
        (id,order_id,subscription_id,provider,provider_transaction_id,idempotency_key,amount_cents,status,failure_code,failure_message,processed_at)
       VALUES (?,?,?,'stripe',?,?,?,'failed',?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(idempotency_key) DO UPDATE SET failure_code=excluded.failure_code,failure_message=excluded.failure_message,processed_at=CURRENT_TIMESTAMP`
    ).bind(crypto.randomUUID(), order.id, order.subscription_id, intent.id, `stripe-failure:${intent.id}:${eventId}`, Number(intent.amount || order.total_cents), code, message),
    db.prepare("UPDATE dog_food_orders SET status='payment_failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(order.id),
  ];
  if (order.subscription_id) statements.push(db.prepare(
    "UPDATE dog_food_subscriptions SET status='past_due',failure_count=failure_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(order.subscription_id));
  await db.batch(statements);
  return { orderId: order.id, status: "payment_failed" };
}

async function checkoutCompleted(db, session) {
  if (session.mode === "setup") {
    await db.prepare(
      "UPDATE dog_food_payment_setup_sessions SET status='succeeded',updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(session.id).run();
    return { setupSessionId: session.id, status: "succeeded" };
  }
  const orderId = String(session.metadata?.order_id || "").trim();
  if (!orderId) return { ignored: true, reason: "not_dog_food" };
  const owner=await db.prepare('SELECT o.stripe_checkout_session_id,c.stripe_customer_id FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL').bind(orderId).first();
  if(!owner||owner.stripe_customer_id!==session.customer||owner.stripe_checkout_session_id!==session.id)throw new Error('Checkout event did not match the recorded order and customer.');
  await db.prepare(
    `UPDATE dog_food_orders SET stripe_checkout_session_id=COALESCE(stripe_checkout_session_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(session.id, orderId).run();
  if (session.customer) {
    await db.prepare(
      `UPDATE dog_food_customers SET stripe_customer_id=COALESCE(stripe_customer_id,?),updated_at=CURRENT_TIMESTAMP
       WHERE id=(SELECT customer_id FROM dog_food_orders WHERE id=?)`
    ).bind(String(session.customer), orderId).run();
  }
  return { orderId, paymentStatus: session.payment_status || "unknown" };
}

async function setupIntentSucceeded(db, intent, env) {
  const customerId = String(intent.metadata?.dog_food_customer_id || "").trim();
  if (!customerId) return { ignored: true, reason: "not_dog_food" };
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (!paymentMethodId) throw new Error("Stripe did not return a saved payment method.");
  const method = await retrieveStripePaymentMethod(paymentMethodId, env);
  const customer = await db.prepare("SELECT stripe_customer_id FROM dog_food_customers WHERE id=? AND deleted_at IS NULL AND status='active'").bind(customerId).first();
  const stripeCustomerId = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  const methodCustomer = typeof method?.customer === 'string' ? method.customer : method?.customer?.id;
  if (intent.status !== 'succeeded' || !customer?.stripe_customer_id || customer.stripe_customer_id !== stripeCustomerId || methodCustomer !== stripeCustomerId) throw new Error('Stripe setup did not match the dog-food customer.');
  const orderId = String(intent.metadata?.order_id || "").trim();
  if (orderId && !await db.prepare("SELECT id FROM dog_food_orders WHERE id=? AND customer_id=? AND deleted_at IS NULL").bind(orderId,customerId).first()) throw new Error('Stripe setup order did not belong to this customer.');
  await db.prepare(
    `UPDATE dog_food_customers SET stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_payment_method_id=?,
     card_brand=?,card_last_four=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(typeof intent.customer === "string" ? intent.customer : intent.customer?.id, paymentMethodId,
    method?.card?.brand || null, method?.card?.last4 || null, customerId).run();
  await db.prepare(`UPDATE dog_food_subscriptions SET payment_method_token=?,card_brand=?,card_last_four=?,updated_at=CURRENT_TIMESTAMP
    WHERE customer_id=? AND payment_provider='stripe' AND status IN ('active','paused','past_due')`).bind(paymentMethodId, method?.card?.brand || null, method?.card?.last4 || null, customerId).run();
  const subscription = orderId ? await activateDogFoodSubscriptionFromOrder({
    db, orderId, provider: "stripe", paymentMethodId,
    stripeCustomerId: typeof intent.customer === "string" ? intent.customer : intent.customer?.id,
    cardBrand: method?.card?.brand || null, lastFour: method?.card?.last4 || null,
  }) : null;
  return { customerId, paymentMethodSaved: true, subscription };
}

async function chargeRefunded(db, charge) {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return { ignored: true, reason: "payment_intent_missing" };
  const payment = await db.prepare(
    `SELECT p.id,p.order_id,p.amount_cents,c.stripe_customer_id FROM dog_food_payments p JOIN dog_food_orders o ON o.id=p.order_id JOIN dog_food_customers c ON c.id=o.customer_id
     WHERE p.provider='stripe' AND p.provider_transaction_id=? AND p.status IN ('captured','refunded') LIMIT 1`
  ).bind(paymentIntentId).first();
  if (!payment) return { ignored: true, reason: "payment_not_found" };
  const amount=Number(charge.amount_refunded||0);
  if(charge.currency!=='usd'||charge.customer!==payment.stripe_customer_id||!Number.isSafeInteger(amount)||amount<1||amount>payment.amount_cents)throw new Error('Refund did not match the recorded payment.');
  if(amount<payment.amount_cents){await db.batch([
    db.prepare('UPDATE dog_food_payments SET refunded_amount_cents=MAX(refunded_amount_cents,?) WHERE id=?').bind(amount,payment.id),
    db.prepare("UPDATE dog_food_orders SET automation_review='Partial refund recorded; verify financial and fulfillment reconciliation',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(payment.order_id),
  ]);return {orderId:payment.order_id,status:'partial_refund_review'};}
  await db.batch([
    db.prepare("UPDATE dog_food_payments SET status='refunded',refunded_amount_cents=amount_cents,processed_at=CURRENT_TIMESTAMP WHERE id=?").bind(payment.id),
    db.prepare("UPDATE dog_food_orders SET status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(payment.order_id),
  ]);
  return { orderId: payment.order_id, status: "refunded" };
}
async function checkoutExpired(db,session) {
  const id=String(session.metadata?.order_id||'');if(!id)return {ignored:true};
  const o=await db.prepare('SELECT o.id,o.status,c.stripe_customer_id FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.stripe_checkout_session_id=?').bind(id,session.id).first();
  if(!o||o.stripe_customer_id!==session.customer||session.status!=='expired')throw new Error('Expired checkout did not match the recorded customer.');
  const paid=await db.prepare("SELECT id FROM dog_food_payments WHERE order_id=? AND status='captured'").bind(id).first();
  if(paid||!['pending_payment','payment_failed','draft'].includes(o.status))return {ignored:true,reason:'not_open'};
  await db.prepare("UPDATE dog_food_orders SET status='cancelled',automation_review='Stripe checkout expired; unpaid reservations released',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('draft','pending_payment','payment_failed')").bind(id).run();
  return {orderId:id,status:'cancelled'};
}

export async function processStripeEvent({ db, env, event }) {
  if(env?.STRIPE_SECRET_KEY&&event.livemode!==env.STRIPE_SECRET_KEY.startsWith('sk_live_'))throw new Error('Stripe event mode does not match this environment.');
  const claimed = await claimEvent(db, event);
  if (!claimed) return { duplicate: true };
  try {
    let result;
    if (event.type === "payment_intent.succeeded") result = await paymentSucceeded(db, event.data.object, env, event.id);
    else if (event.type === "payment_intent.payment_failed") result = await paymentFailed(db, event.data.object, event.id);
    else if (event.type === "checkout.session.completed") result = await checkoutCompleted(db, event.data.object);
    else if (event.type === "checkout.session.expired") result = await checkoutExpired(db, event.data.object);
    else if (event.type === "setup_intent.succeeded") result = await setupIntentSucceeded(db, event.data.object, env);
    else if (event.type === "charge.refunded") result = await chargeRefunded(db, event.data.object);
    else result = { ignored: true, reason: "event_not_used" };
    if(result?.ignored||event.type==='charge.refunded')await archiveFoodExternalStripe(db,event,{verified:true});
    await finishEvent(db, event.id, claimed, result?.ignored ? "ignored" : "processed");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Stripe event processing failed.";
    await finishEvent(db, event.id, claimed, "failed", message);
    throw error;
  }
}
