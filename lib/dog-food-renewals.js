import { recordDogFoodPayment } from "./dog-food-payments";
import { createStripePaymentIntent, stripeConfigured } from "./stripe";
import { reserveFoodLots, checkFoodLotReconciliation } from './dog-food-fulfillment';
import { readFoodOperations } from './dog-food-ops-store';
import { readFoodDeliveryChoices } from './dog-food-routing';

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
  await db.batch(statements);
  return { subscriptionId: subscription.id, orderId: order.id, status: "payment_failed", reference };
}

async function ensureRenewalOrder(db, subscription) {
  const existing = await db.prepare(
    "SELECT id,order_number,total_cents,status,renewal_attempted_at FROM dog_food_orders WHERE subscription_id=? AND billing_cycle_key=? LIMIT 1"
  ).bind(subscription.id, subscription.next_delivery_date).first();
  if (existing) return { id: existing.id, orderNumber: existing.order_number, totalCents: Number(existing.total_cents), status:existing.status, attemptedAt:existing.renewal_attempted_at, existing: true };
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
  const statements = [
    db.prepare(
      `INSERT INTO dog_food_orders
        (id,order_number,customer_id,address_id,subscription_id,billing_cycle_key,order_type,status,subtotal_cents,delivery_fee_cents,
         tax_rate_basis_points,tax_cents,total_cents,requested_delivery_speed,source,notes,placed_at)
       VALUES (?,?,?,?,?,?,'subscription','pending_payment',?,0,775,?,?,'route_day','subscription_renewal',?,CURRENT_TIMESTAMP)`
    ).bind(orderId, orderNumber, subscription.customer_id, subscription.address_id, subscription.id, subscription.next_delivery_date,
      subtotal, tax, total, `Automatic monthly renewal for ${subscription.next_delivery_date}.`),
  ];
  for (const item of items.results || []) statements.push(db.prepare(
    `INSERT INTO dog_food_order_items
      (id,order_id,product_id,dog_id,quantity,unit_price_cents,line_total_cents,substitution_product_id,substitution_policy)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), orderId, item.product_id, item.dog_id, item.quantity, item.unit_price_cents,
    Number(item.quantity) * Number(item.unit_price_cents), item.substitution_product_id, item.substitution_policy));
  statements.push(db.prepare('UPDATE dog_food_orders SET fulfillment_method=?,requested_route_weekday=? WHERE id=?').bind(subscription.fulfillment_method||'delivery',subscription.fulfillment_method!=='pickup'&&subscription.delivery_cadence==='service_week'?subscription.service_weekday:null,orderId));
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
  if (['cancelled','refunded'].includes(order.status))return {orderId:order.id,status:'terminal_order_review'};
  if (order.attemptedAt&&Date.now()-Date.parse(order.attemptedAt.replace(' ','T')+'Z')>23*3600000) {
    await db.prepare("UPDATE dog_food_orders SET automation_review='Renewal acceptance uncertain; reconcile Stripe before retry beyond idempotency window' WHERE id=?").bind(order.id).run();
    return {orderId:order.id,status:'payment_review'};
  }
  const model=await readFoodOperations(db);
  if(model.sync.dirty||model.sync.last_error)throw new Error('Current shared inventory cannot be confirmed before renewal.');
  const renewalItems=(await db.prepare('SELECT product_id productId,quantity FROM dog_food_order_items WHERE order_id=?').bind(order.id).all()).results||[];
  await checkFoodLotReconciliation(db,model,renewalItems);
  if(subscription.fulfillment_method!=='pickup'&&subscription.delivery_cadence==='service_week') {
    const address=await db.prepare('SELECT * FROM dog_food_addresses WHERE id=? AND customer_id=?').bind(subscription.address_id,subscription.customer_id).first();
    const current=await readFoodDeliveryChoices(db,address);
    if(!current.days.some(d=>d.weekday===subscription.service_weekday)) {
      await db.prepare("UPDATE dog_food_orders SET automation_review='Renewal held: current OPWP route alignment requires office review' WHERE id=?").bind(order.id).run();
      return {orderId:order.id,status:'route_review'};
    }
  }
  const slots=(await db.prepare(`SELECT s.id FROM dog_food_delivery_capacity s JOIN dog_food_addresses a ON (a.postal_code=s.postal_code OR s.fulfillment_method='pickup')
    WHERE a.id=? AND s.fulfillment_method=? AND s.service_date=? AND s.enabled=1 AND s.bag_limit>=?+(SELECT COALESCE(SUM(bags),0) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL AND order_id<>?)
    AND s.stop_limit>(SELECT COUNT(*) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL AND order_id<>?)
    AND NOT EXISTS(SELECT 1 FROM dog_food_capacity_allocations x WHERE x.order_id=? AND x.released_at IS NULL AND x.slot_id<>s.id) LIMIT 1`)
    .bind(subscription.address_id,subscription.fulfillment_method||'delivery',subscription.next_delivery_date,renewalItems.reduce((n,i)=>n+i.quantity,0),order.id,order.id,order.id).all()).results||[];
  if(!slots.length){await db.prepare("UPDATE dog_food_orders SET automation_review='Renewal held: confirmed route capacity required' WHERE id=?").bind(order.id).run();return {orderId:order.id,status:'capacity_review'};}
  const allocated=await db.prepare('SELECT order_id FROM dog_food_lot_allocations WHERE order_id=? AND released_at IS NULL LIMIT 1').bind(order.id).first();
  await db.batch([
    ...(!allocated?await reserveFoodLots(db,order.id,renewalItems,subscription.next_delivery_date):[]),
    db.prepare('INSERT INTO dog_food_capacity_allocations(order_id,slot_id,bags) VALUES (?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(order.id,slots[0].id,renewalItems.reduce((n,i)=>n+i.quantity,0)),
    db.prepare('UPDATE dog_food_orders SET renewal_attempted_at=COALESCE(renewal_attempted_at,CURRENT_TIMESTAMP),automation_review=NULL WHERE id=?').bind(order.id),
  ]);
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
    if(intent.customer!==subscription.stripe_customer_id||intent.currency!=='usd'||intent.metadata?.order_id!==order.id)throw new Error('Stripe renewal ownership needs reconciliation.');
    await recordDogFoodPayment({
      db, orderId: order.id, provider: "stripe", reference: intent.id, actor: "dog-food-renewal-worker",
      amountCents: Number(intent.amount_received ?? intent.amount), paymentMethodId: subscription.payment_method_token,
      stripeCustomerId: subscription.stripe_customer_id, cardBrand: subscription.card_brand, lastFour: subscription.card_last_four,
    });
    return { subscriptionId: subscription.id, orderId: order.id, status: "captured" };
  } catch (error) {
    if (['requires_payment_method','requires_action','canceled'].includes(error?.paymentIntent?.status))return markRenewalFailed(db, { order, subscription, error, paymentIntent: error.paymentIntent });
    await db.prepare("UPDATE dog_food_orders SET automation_review='Stripe renewal acceptance uncertain; safe retry or provider reconciliation required' WHERE id=?").bind(order.id).run();
    throw error;
  }
}

export async function runScheduledDogFoodRenewals(env) {
  if (!env?.DB || !stripeConfigured(env)) return { configured: false, processed: 0 };
  const workflow=await env.DB.prepare("SELECT scheduling_enabled FROM dog_food_workflow_settings WHERE id='org-opwp'").first();
  if(!workflow?.scheduling_enabled)return {configured:true,processed:0,reason:'fulfillment_not_enabled'};
  const commandToken=crypto.randomUUID();
  const lock=await env.DB.prepare("UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+5 minutes') WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id").bind(commandToken).first();
  if(!lock)return {configured:true,processed:0,reason:'stock_busy'};
  try {
  const due = await env.DB.prepare(
    `SELECT s.*,c.stripe_customer_id,c.email,c.phone,c.customer_type,a.placement_preference,a.placement_other
     FROM dog_food_subscriptions s JOIN dog_food_customers c ON c.id=s.customer_id JOIN dog_food_addresses a ON a.id=s.address_id
     WHERE s.status='active' AND s.payment_provider='stripe' AND c.deleted_at IS NULL AND c.sng_client_id IS NULL AND date(s.next_charge_at)<=date(?)
     ORDER BY s.next_charge_at LIMIT 25`
  ).bind(easternDate()).all();
  const results = [];
  for (const subscription of due.results || []) {
    const leaseToken = crypto.randomUUID();
    const claimed = await env.DB.prepare(`UPDATE dog_food_subscriptions SET billing_lease_token=?,billing_lease_until=datetime('now','+5 minutes')
      WHERE id=? AND status='active' AND next_delivery_date=? AND (billing_lease_until IS NULL OR billing_lease_until<CURRENT_TIMESTAMP) RETURNING id`).bind(leaseToken, subscription.id, subscription.next_delivery_date).first();
    if (!claimed) continue;
    try {
      results.push(await chargeRenewal(env.DB, env, subscription));
    } catch (error) {
      console.error(JSON.stringify({ event: "dog_food_renewal_failed", subscriptionId: subscription.id, message: error instanceof Error ? error.message : "failed" }));
      results.push({ subscriptionId: subscription.id, status: "retry_required" });
    } finally {
      await env.DB.prepare('UPDATE dog_food_subscriptions SET billing_lease_token=NULL,billing_lease_until=NULL WHERE id=? AND billing_lease_token=?').bind(subscription.id, leaseToken).run();
    }
  }
  console.log(JSON.stringify({ event: "dog_food_renewals_complete", due: (due.results || []).length, results }));
  return { configured: true, processed: results.length, results };
  }finally {await env.DB.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(commandToken).run();}
}
