import { recordDogFoodPayment } from "./dog-food-payments";
import { createStripePaymentIntent, stripeConfigured } from "./stripe";

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function markRenewalFailed(db, { order, subscription, error, paymentIntent = null }) {
  const reference = paymentIntent?.id || `${subscription.id}:${subscription.next_delivery_date}`;
  const code = String(error?.code || paymentIntent?.last_payment_error?.decline_code || "payment_failed").slice(0, 100);
  const message = String(error?.message || paymentIntent?.last_payment_error?.message || "Stripe could not complete the monthly payment.").slice(0, 500);
  const statements = [
    db.prepare("UPDATE dog_food_orders SET status='payment_failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(order.id),
    db.prepare("UPDATE dog_food_subscriptions SET status='past_due',failure_count=failure_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(subscription.id),
    db.prepare(
      `INSERT INTO dog_food_payments
        (id,order_id,subscription_id,provider,provider_transaction_id,idempotency_key,amount_cents,status,failure_code,failure_message,processed_at)
       VALUES (?,?,?,'stripe',?,?,?,'failed',?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(idempotency_key) DO UPDATE SET failure_code=excluded.failure_code,failure_message=excluded.failure_message,processed_at=CURRENT_TIMESTAMP`
    ).bind(crypto.randomUUID(), order.id, subscription.id, paymentIntent?.id || null,
      `stripe-renewal-failure:${subscription.id}:${subscription.next_delivery_date}`, order.totalCents, code, message),
  ];
  if (subscription.phone) statements.push(db.prepare(
    `INSERT INTO dog_food_notifications (id,customer_id,order_id,subscription_id,channel,template_key,status,recipient)
     VALUES (?,?,?,?,'sms','payment_failed','queued',?)`
  ).bind(crypto.randomUUID(), subscription.customer_id, order.id, subscription.id, subscription.phone));
  if (subscription.email) statements.push(db.prepare(
    `INSERT INTO dog_food_notifications (id,customer_id,order_id,subscription_id,channel,template_key,status,recipient)
     VALUES (?,?,?,?,'email','payment_failed','queued',?)`
  ).bind(crypto.randomUUID(), subscription.customer_id, order.id, subscription.id, subscription.email));
  await db.batch(statements);
  return { subscriptionId: subscription.id, orderId: order.id, status: "payment_failed", reference };
}

async function ensureRenewalOrder(db, subscription) {
  const existing = await db.prepare(
    "SELECT id,order_number,total_cents FROM dog_food_orders WHERE subscription_id=? AND billing_cycle_key=? LIMIT 1"
  ).bind(subscription.id, subscription.next_delivery_date).first();
  if (existing) return { id: existing.id, orderNumber: existing.order_number, totalCents: Number(existing.total_cents), existing: true };
  const items = await db.prepare(
    `SELECT si.product_id,si.dog_id,si.quantity,si.unit_price_cents,si.substitution_product_id,si.substitution_policy
     FROM dog_food_subscription_items si JOIN dog_food_products p ON p.id=si.product_id
     WHERE si.subscription_id=? AND si.is_active=1 AND p.is_active=1 ORDER BY si.created_at`
  ).bind(subscription.id).all();
  if (!(items.results || []).length) throw new Error("The subscription has no active products.");
  const subtotal = (items.results || []).reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_cents), 0);
  const tax = (items.results || []).reduce((sum, item) => sum + Math.round(Number(item.unit_price_cents) * 0.0775) * Number(item.quantity), 0);
  const total = subtotal + tax;
  const orderId = crypto.randomUUID();
  const orderNumber = `EDF-${orderId.slice(0, 8).toUpperCase()}`;
  const deliveryType = subscription.customer_type === "scoop" ? "scoop_route" : "route_partner";
  const statements = [
    db.prepare(
      `INSERT INTO dog_food_orders
        (id,order_number,customer_id,address_id,subscription_id,billing_cycle_key,order_type,status,subtotal_cents,delivery_fee_cents,
         tax_rate_basis_points,tax_cents,total_cents,requested_delivery_speed,source,notes,placed_at)
       VALUES (?,?,?,?,?,?,'subscription','pending_payment',?,0,775,?,?,'route_day','subscription_renewal',?,CURRENT_TIMESTAMP)`
    ).bind(orderId, orderNumber, subscription.customer_id, subscription.address_id, subscription.id, subscription.next_delivery_date,
      subtotal, tax, total, `Automatic monthly renewal for ${subscription.next_delivery_date}.`),
    db.prepare(
      `INSERT INTO dog_food_deliveries
        (id,order_id,customer_id,address_id,scheduled_date,delivery_type,status,placement_note)
       VALUES (?,?,?,?,?,?,'scheduled',?)`
    ).bind(crypto.randomUUID(), orderId, subscription.customer_id, subscription.address_id, subscription.next_delivery_date,
      deliveryType, subscription.placement_other || subscription.placement_preference || "Confirm placement before delivery"),
  ];
  for (const item of items.results || []) statements.push(db.prepare(
    `INSERT INTO dog_food_order_items
      (id,order_id,product_id,dog_id,quantity,unit_price_cents,line_total_cents,substitution_product_id,substitution_policy)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), orderId, item.product_id, item.dog_id, item.quantity, item.unit_price_cents,
    Number(item.quantity) * Number(item.unit_price_cents), item.substitution_product_id, item.substitution_policy));
  await db.batch(statements);
  return { id: orderId, orderNumber, totalCents: total, existing: false };
}

async function chargeRenewal(db, env, subscription) {
  if (!subscription.stripe_customer_id || !subscription.payment_method_token) {
    await db.prepare("UPDATE dog_food_subscriptions SET status='past_due',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(subscription.id).run();
    return { subscriptionId: subscription.id, status: "payment_method_required" };
  }
  const order = await ensureRenewalOrder(db, subscription);
  const captured = await db.prepare("SELECT id FROM dog_food_payments WHERE order_id=? AND status='captured' LIMIT 1").bind(order.id).first();
  if (captured) return { subscriptionId: subscription.id, orderId: order.id, status: "already_paid" };
  try {
    const intent = await createStripePaymentIntent({
      customerId: subscription.stripe_customer_id,
      paymentMethodId: subscription.payment_method_token,
      amountCents: order.totalCents,
      orderId: order.id,
      orderNumber: order.orderNumber,
      subscriptionId: subscription.id,
      cycleKey: subscription.next_delivery_date,
      env,
    });
    if (intent.status !== "succeeded") throw Object.assign(new Error("Stripe did not complete the monthly payment."), { code: intent.status, paymentIntent: intent });
    await recordDogFoodPayment({
      db, orderId: order.id, provider: "stripe", reference: intent.id, actor: "dog-food-renewal-worker",
      amountCents: Number(intent.amount_received ?? intent.amount), paymentMethodId: subscription.payment_method_token,
      stripeCustomerId: subscription.stripe_customer_id, cardBrand: subscription.card_brand, lastFour: subscription.card_last_four,
    });
    return { subscriptionId: subscription.id, orderId: order.id, status: "captured" };
  } catch (error) {
    if (!error?.paymentIntent && Number(error?.status || 0) >= 500) throw error;
    return markRenewalFailed(db, { order, subscription, error, paymentIntent: error?.paymentIntent });
  }
}

export async function runScheduledDogFoodRenewals(env) {
  if (!env?.DB || !stripeConfigured(env)) return { configured: false, processed: 0 };
  const due = await env.DB.prepare(
    `SELECT s.*,c.stripe_customer_id,c.email,c.phone,c.customer_type,a.placement_preference,a.placement_other
     FROM dog_food_subscriptions s JOIN dog_food_customers c ON c.id=s.customer_id JOIN dog_food_addresses a ON a.id=s.address_id
     WHERE s.status='active' AND s.payment_provider='stripe' AND date(s.next_charge_at)<=date(?)
     ORDER BY s.next_charge_at LIMIT 25`
  ).bind(easternDate()).all();
  const results = [];
  for (const subscription of due.results || []) {
    try {
      results.push(await chargeRenewal(env.DB, env, subscription));
    } catch (error) {
      console.error(JSON.stringify({ event: "dog_food_renewal_failed", subscriptionId: subscription.id, message: error instanceof Error ? error.message : "failed" }));
      results.push({ subscriptionId: subscription.id, status: "retry_required" });
    }
  }
  console.log(JSON.stringify({ event: "dog_food_renewals_complete", due: (due.results || []).length, results }));
  return { configured: true, processed: results.length, results };
}
