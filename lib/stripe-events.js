import { activateDogFoodSubscriptionFromOrder, recordDogFoodPayment } from "./dog-food-payments";
import { retrieveStripePaymentMethod } from "./stripe";

async function claimEvent(db, event) {
  const existing = await db.prepare("SELECT status FROM dog_food_payment_events WHERE id=?").bind(event.id).first();
  if (["processed", "ignored"].includes(existing?.status)) return false;
  await db.prepare(
    `INSERT INTO dog_food_payment_events (id,provider,event_type,provider_object_id,status)
     VALUES (?,'stripe',?,?,'processing')
     ON CONFLICT(id) DO UPDATE SET status='processing',error_message=NULL,updated_at=CURRENT_TIMESTAMP`
  ).bind(event.id, event.type, String(event.data?.object?.id || "")).run();
  return true;
}

async function finishEvent(db, eventId, status, errorMessage = null) {
  await db.prepare(
    `UPDATE dog_food_payment_events SET status=?,error_message=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(status, errorMessage, eventId).run();
}

async function paymentSucceeded(db, intent, env, eventId) {
  const orderId = String(intent.metadata?.order_id || "").trim();
  if (!orderId) return { ignored: true, reason: "not_dog_food" };
  const order = await db.prepare("SELECT id,total_cents FROM dog_food_orders WHERE id=? LIMIT 1").bind(orderId).first();
  if (!order) return { ignored: true, reason: "order_not_found" };
  const amountCents = Number(intent.amount_received ?? intent.amount);
  if (amountCents !== Number(order.total_cents) || String(intent.currency || "").toLowerCase() !== "usd") {
    throw new Error("Stripe payment amount or currency did not match the dog-food order.");
  }
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  const paymentMethod = paymentMethodId ? await retrieveStripePaymentMethod(paymentMethodId, env) : null;
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
    `SELECT o.id,o.subscription_id,o.total_cents,o.customer_id,c.email,c.phone
     FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) return { ignored: true, reason: "order_not_found" };
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
  if (order.phone) statements.push(db.prepare(
    `INSERT INTO dog_food_notifications (id,customer_id,order_id,subscription_id,channel,template_key,status,recipient)
     VALUES (?,?,?,?, 'sms','payment_failed','queued',?)`
  ).bind(crypto.randomUUID(), order.customer_id, order.id, order.subscription_id, order.phone));
  if (order.email) statements.push(db.prepare(
    `INSERT INTO dog_food_notifications (id,customer_id,order_id,subscription_id,channel,template_key,status,recipient)
     VALUES (?,?,?,?, 'email','payment_failed','queued',?)`
  ).bind(crypto.randomUUID(), order.customer_id, order.id, order.subscription_id, order.email));
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
  await db.prepare(
    `UPDATE dog_food_customers SET stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_payment_method_id=?,
     card_brand=?,card_last_four=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(typeof intent.customer === "string" ? intent.customer : intent.customer?.id, paymentMethodId,
    method?.card?.brand || null, method?.card?.last4 || null, customerId).run();
  const orderId = String(intent.metadata?.order_id || "").trim();
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
    "SELECT id,order_id,amount_cents FROM dog_food_payments WHERE provider='stripe' AND provider_transaction_id=? AND status='captured' LIMIT 1"
  ).bind(paymentIntentId).first();
  if (!payment) return { ignored: true, reason: "payment_not_found" };
  if (Number(charge.amount_refunded || 0) < Number(payment.amount_cents)) return { ignored: true, reason: "partial_refund_review_required" };
  await db.batch([
    db.prepare("UPDATE dog_food_payments SET status='refunded',processed_at=CURRENT_TIMESTAMP WHERE id=?").bind(payment.id),
    db.prepare("UPDATE dog_food_orders SET status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(payment.order_id),
  ]);
  return { orderId: payment.order_id, status: "refunded" };
}

export async function processStripeEvent({ db, env, event }) {
  const claimed = await claimEvent(db, event);
  if (!claimed) return { duplicate: true };
  try {
    let result;
    if (event.type === "payment_intent.succeeded") result = await paymentSucceeded(db, event.data.object, env, event.id);
    else if (event.type === "payment_intent.payment_failed") result = await paymentFailed(db, event.data.object, event.id);
    else if (event.type === "checkout.session.completed") result = await checkoutCompleted(db, event.data.object);
    else if (event.type === "setup_intent.succeeded") result = await setupIntentSucceeded(db, event.data.object, env);
    else if (event.type === "charge.refunded") result = await chargeRefunded(db, event.data.object);
    else result = { ignored: true, reason: "event_not_used" };
    await finishEvent(db, event.id, result?.ignored ? "ignored" : "processed");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Stripe event processing failed.";
    await finishEvent(db, event.id, "failed", message);
    throw error;
  }
}
