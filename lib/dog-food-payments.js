import { getDb } from "./db";

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

export async function recordDogFoodPayment({ db = getDb(), orderId, provider, reference, actor, sourceEventId = null, invoiceId = null }) {
  if (!db) throw new Error("Dog-food storage is not configured.");
  if (!orderId || !reference) throw new Error("An order and payment reference are required.");
  const order = await db.prepare(
    `SELECT o.*,d.status AS delivery_status,d.scheduled_date
     FROM dog_food_orders o LEFT JOIN dog_food_deliveries d ON d.order_id=o.id WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) throw new Error("The order was not found.");
  if (["cancelled", "refunded"].includes(order.status)) throw new Error("A cancelled or refunded order cannot be marked paid.");
  if (order.order_type === "subscription" && !validDate(order.scheduled_date)) throw new Error("Set the first delivery date before activating this monthly subscription.");

  const idempotencyKey = `${provider}:${reference}`;
  const priorPayment = await db.prepare("SELECT order_id FROM dog_food_payments WHERE idempotency_key=? LIMIT 1").bind(idempotencyKey).first();
  if (priorPayment && priorPayment.order_id !== order.id) throw new Error("That payment reference is already attached to another order.");
  const capturedPayment = await db.prepare("SELECT idempotency_key FROM dog_food_payments WHERE order_id=? AND status='captured' LIMIT 1").bind(order.id).first();
  if (capturedPayment?.idempotency_key === idempotencyKey) return { orderId: order.id, status: order.status, alreadyRecorded: true };
  if (capturedPayment) throw new Error("Payment has already been recorded for this order.");

  const nextStatus = order.delivery_status === "delivered" ? "fulfilled" : order.delivery_status ? "scheduled" : "paid";
  const statements = [
    db.prepare(
      `INSERT INTO dog_food_payments
        (id,order_id,provider,provider_transaction_id,idempotency_key,amount_cents,status,processed_at)
       VALUES (?,?,?,?,?,?,'captured',CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), order.id, provider, reference, idempotencyKey, Number(order.total_cents) || 0),
    db.prepare("UPDATE dog_food_orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(nextStatus, order.id),
  ];

  if (order.order_type === "subscription") {
    const existing = await db.prepare("SELECT id FROM dog_food_subscriptions WHERE customer_id=? AND address_id=? AND status IN ('active','past_due') LIMIT 1").bind(order.customer_id, order.address_id).first();
    const orderItems = await db.prepare("SELECT product_id,dog_id,quantity,unit_price_cents,substitution_product_id,substitution_policy FROM dog_food_order_items WHERE order_id=?").bind(order.id).all();
    if (!existing) {
      const subscriptionId = crypto.randomUUID();
      const firstDate = order.scheduled_date;
      statements.push(
        db.prepare(
          `INSERT INTO dog_food_subscriptions
            (id,customer_id,address_id,status,frequency_weeks,next_charge_at,next_delivery_date,payment_method_token,card_brand)
           VALUES (?,?,?,'active',4,date(?,'+26 days'),date(?,'+28 days'),?,'SNG card on file')`
        ).bind(subscriptionId, order.customer_id, order.address_id, firstDate, firstDate, `external:sng:${order.customer_id}`),
        db.prepare(
          `INSERT INTO dog_food_subscription_items
            (id,subscription_id,product_id,dog_id,quantity,unit_price_cents,substitution_product_id,substitution_policy)
           SELECT lower(hex(randomblob(16))),?,product_id,dog_id,quantity,unit_price_cents,substitution_product_id,substitution_policy
           FROM dog_food_order_items WHERE order_id=?`
        ).bind(subscriptionId, order.id),
      );
    } else {
      statements.push(db.prepare("UPDATE dog_food_subscriptions SET status='active',failure_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(existing.id));
      for (const item of orderItems.results || []) {
        const matchingItem = await db.prepare("SELECT id FROM dog_food_subscription_items WHERE subscription_id=? AND product_id=? AND dog_id IS ? AND is_active=1 LIMIT 1").bind(existing.id, item.product_id, item.dog_id).first();
        if (matchingItem) statements.push(db.prepare("UPDATE dog_food_subscription_items SET quantity=?,unit_price_cents=?,substitution_product_id=?,substitution_policy=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.quantity, item.unit_price_cents, item.substitution_product_id, item.substitution_policy, matchingItem.id));
        else statements.push(db.prepare("INSERT INTO dog_food_subscription_items (id,subscription_id,product_id,dog_id,quantity,unit_price_cents,substitution_product_id,substitution_policy) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), existing.id, item.product_id, item.dog_id, item.quantity, item.unit_price_cents, item.substitution_product_id, item.substitution_policy));
      }
    }
  }
  statements.push(db.prepare(
    `INSERT INTO route_partner_plan_events (id,organization_id,event_type,actor_email,details)
     VALUES (?,'org-opwp','dog_food_payment_confirmed',?,?)`
  ).bind(crypto.randomUUID(), actor, JSON.stringify({ orderId: order.id, provider, reference, amountCents: order.total_cents, sourceEventId, invoiceId })));
  await db.batch(statements);
  return { orderId: order.id, status: nextStatus };
}

export async function reconcileSngDogFoodPayment({ eventId, body }) {
  const db = getDb();
  if (!db) return { configured: false, matched: false };
  const data = body?.data && typeof body.data === "object" ? body.data : body || {};
  const clientRef = String(data.client || "").trim();
  const reference = String(data.reference_number || "").trim();
  const amountCents = Math.round(Number(data.amount || 0) * 100);
  if (!clientRef || !reference || amountCents <= 0) return { configured: true, matched: false, reason: "not_reconcilable" };

  const invoiceEvents = await db.prepare(
    `SELECT id,external_id FROM sng_events e
     WHERE e.event_type='client:invoice_finalized'
       AND json_extract(e.payload,'$.data.client')=?
       AND CAST(ROUND(CAST(json_extract(e.payload,'$.data.total') AS REAL)*100) AS INTEGER)=?
       AND e.received_at>=datetime('now','-2 days')
       AND EXISTS (SELECT 1 FROM json_each(e.payload,'$.data.items') WHERE lower(json_extract(value,'$.description')) LIKE '%dog food%')
       AND NOT EXISTS (SELECT 1 FROM json_each(e.payload,'$.data.items') WHERE lower(json_extract(value,'$.description')) NOT LIKE '%dog food%')
     ORDER BY e.received_at DESC LIMIT 2`
  ).bind(clientRef, amountCents).all();
  if ((invoiceEvents.results || []).length !== 1) return { configured: true, matched: false, reason: "no_unique_dog_food_invoice" };

  const orders = await db.prepare(
    `SELECT o.id FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id
     WHERE c.sng_client_id=? AND o.total_cents=? AND o.status IN ('draft','pending_payment','payment_failed')
       AND NOT EXISTS (SELECT 1 FROM dog_food_payments p WHERE p.order_id=o.id AND p.status='captured')
     ORDER BY o.created_at DESC LIMIT 2`
  ).bind(clientRef, amountCents).all();
  if ((orders.results || []).length !== 1) return { configured: true, matched: false, reason: "no_unique_open_order" };

  const invoiceEvent = invoiceEvents.results[0];
  const settled = await recordDogFoodPayment({
    db, orderId: orders.results[0].id, provider: "sng_webhook", reference,
    actor: "sng-webhook", sourceEventId: eventId, invoiceId: invoiceEvent.external_id,
  });
  return { configured: true, matched: true, ...settled, invoiceId: invoiceEvent.external_id };
}
