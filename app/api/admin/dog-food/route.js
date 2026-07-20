import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

async function pricedItems(db, requestedItems) {
  const quantities = new Map((Array.isArray(requestedItems) ? requestedItems : []).map((item) => [
    clean(item.productId, 100), Math.max(0, Math.min(10, Number(item.quantity) || 0)),
  ]));
  const productIds = [...quantities.entries()].filter(([, quantity]) => quantity > 0).map(([id]) => id);
  if (!productIds.length || productIds.length > 8) throw new Error("Add at least one active dog-food product.");
  const placeholders = productIds.map(() => "?").join(",");
  const products = await db.prepare(
    `SELECT id,retail_price_cents FROM dog_food_products
     WHERE id IN (${placeholders}) AND is_active=1 AND retail_price_cents IS NOT NULL`
  ).bind(...productIds).all();
  if ((products.results || []).length !== productIds.length) throw new Error("One or more selected products are unavailable.");
  return { quantities, products: products.results || [] };
}

function orderTotals(products, quantities, delivery) {
  const deliveryFee = delivery === "same_day" ? 1000 : delivery === "next_day" ? 500 : 0;
  const subtotal = products.reduce((sum, product) => sum + Number(product.retail_price_cents) * quantities.get(product.id), 0);
  const foodTax = products.reduce((sum, product) => sum + Math.round(Number(product.retail_price_cents) * 0.0775) * quantities.get(product.id), 0);
  const tax = foodTax + Math.round(deliveryFee * 0.0775);
  return { subtotal, deliveryFee, tax, total: subtotal + deliveryFee + tax };
}

async function context(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return { response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const db = getDb();
  if (!db) return { response: Response.json({ ok: false, error: "Dog-food storage is not configured." }, { status: 503 }) };
  return { auth, db };
}

async function markPaid(db, body, actor) {
  const orderId = clean(body.orderId, 100);
  const reference = clean(body.reference, 100);
  const provider = body.provider === "cardpointe" ? "cardpointe" : "sng_manual";
  if (!orderId || !reference) throw new Error("An order and SNG/CardPointe transaction reference are required.");
  const order = await db.prepare(
    `SELECT o.*,d.status AS delivery_status,d.scheduled_date
     FROM dog_food_orders o LEFT JOIN dog_food_deliveries d ON d.order_id=o.id WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) throw new Error("The order was not found.");
  if (["cancelled", "refunded"].includes(order.status)) throw new Error("A cancelled or refunded order cannot be marked paid.");
  if (order.order_type === "subscription" && !validDate(order.scheduled_date)) throw new Error("Set the first delivery date before activating this monthly subscription.");

  const paymentId = crypto.randomUUID();
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
       VALUES (?,?,?,?,?,?,'captured',CURRENT_TIMESTAMP)
       ON CONFLICT(idempotency_key) DO NOTHING`
    ).bind(paymentId, order.id, provider, reference, idempotencyKey, Number(order.total_cents) || 0),
    db.prepare("UPDATE dog_food_orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(nextStatus, order.id),
  ];

  if (order.order_type === "subscription") {
    const existing = await db.prepare("SELECT id FROM dog_food_subscriptions WHERE customer_id=? AND address_id=? AND status IN ('active','past_due') LIMIT 1").bind(order.customer_id, order.address_id).first();
    const orderItems = await db.prepare("SELECT product_id,dog_id,quantity,unit_price_cents,substitution_product_id,substitution_policy FROM dog_food_order_items WHERE order_id=?").bind(order.id).all();
    if (!existing) {
      const subscriptionId = crypto.randomUUID();
      const firstDate = validDate(order.scheduled_date) ? order.scheduled_date : new Date().toISOString().slice(0, 10);
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
  ).bind(crypto.randomUUID(), actor, JSON.stringify({ orderId: order.id, provider, reference, amountCents: order.total_cents })));
  await db.batch(statements);
  return { orderId: order.id, status: nextStatus };
}

async function scheduleOrder(db, body) {
  const orderId = clean(body.orderId, 100);
  const scheduledDate = clean(body.scheduledDate, 10);
  if (!orderId || !validDate(scheduledDate)) throw new Error("Choose an order and a valid delivery date.");
  const order = await db.prepare(
    `SELECT o.id,o.customer_id,o.address_id,o.status,o.requested_delivery_speed,c.customer_type,a.placement_preference,a.placement_other
     FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id JOIN dog_food_addresses a ON a.id=o.address_id WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) throw new Error("The order was not found.");
  if (["cancelled", "refunded", "fulfilled"].includes(order.status)) throw new Error("This order can no longer be scheduled.");
  const deliveryType = order.customer_type === "scoop" && order.requested_delivery_speed === "route_day" ? "scoop_route"
    : order.customer_type === "route_partner" && order.requested_delivery_speed === "route_day" ? "route_partner" : "on_demand";
  const placement = clean(body.placement, 200) || clean(order.placement_other || order.placement_preference, 200) || "Confirm placement before delivery";
  await db.prepare(
    `INSERT INTO dog_food_deliveries (id,order_id,customer_id,address_id,scheduled_date,delivery_type,status,placement_note)
     VALUES (?,?,?,?,?,?,'scheduled',?)
     ON CONFLICT(order_id) DO UPDATE SET scheduled_date=excluded.scheduled_date,delivery_type=excluded.delivery_type,
       placement_note=excluded.placement_note,status='scheduled',updated_at=CURRENT_TIMESTAMP`
  ).bind(crypto.randomUUID(), order.id, order.customer_id, order.address_id, scheduledDate, deliveryType, placement).run();
  return { orderId: order.id, scheduledDate };
}

async function updateOrder(db, body, actor) {
  const orderId = clean(body.orderId, 100);
  const plan = body.plan === "subscription" ? "subscription" : "on_demand";
  const delivery = ["route_day", "next_day", "same_day"].includes(body.delivery) ? body.delivery : "route_day";
  const scheduledDate = clean(body.scheduledDate, 10);
  if (!orderId) throw new Error("Choose an order to edit.");
  if (plan === "subscription" && delivery !== "route_day") throw new Error("Monthly delivery must use the free route day.");
  if (scheduledDate && !validDate(scheduledDate)) throw new Error("Enter a valid delivery date.");
  const order = await db.prepare(
    `SELECT o.id,o.order_number,o.customer_id,o.address_id,o.status,c.customer_type,d.id AS delivery_id,d.status AS delivery_status
     FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id
     LEFT JOIN dog_food_deliveries d ON d.order_id=o.id WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) throw new Error("The order was not found.");
  if (!["draft", "pending_payment", "payment_failed"].includes(order.status)) throw new Error("Product and price edits are locked after payment is recorded.");
  const captured = await db.prepare("SELECT id FROM dog_food_payments WHERE order_id=? AND status='captured' LIMIT 1").bind(orderId).first();
  if (captured) throw new Error("This order already has a captured payment and cannot be repriced.");
  const { quantities, products } = await pricedItems(db, body.items);
  const totals = orderTotals(products, quantities, delivery);
  const placement = clean(body.placement, 200) || "Confirm placement before delivery";
  const deliveryType = order.customer_type === "scoop" && delivery === "route_day" ? "scoop_route"
    : order.customer_type === "route_partner" && delivery === "route_day" ? "route_partner" : "on_demand";
  const statements = [
    db.prepare("DELETE FROM dog_food_order_items WHERE order_id=?").bind(orderId),
    db.prepare(
      `UPDATE dog_food_orders SET order_type=?,subtotal_cents=?,delivery_fee_cents=?,tax_cents=?,total_cents=?,requested_delivery_speed=?,
       notes=COALESCE(notes,'')||?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(plan, totals.subtotal, totals.deliveryFee, totals.tax, totals.total, delivery, `\nEdited by ${actor}.`, orderId),
  ];
  for (const product of products) {
    const quantity = quantities.get(product.id);
    statements.push(db.prepare(
      `INSERT INTO dog_food_order_items (id,order_id,product_id,quantity,unit_price_cents,line_total_cents,substitution_policy)
       VALUES (?,?,?,?,?,?,'same_formula_weight')`
    ).bind(crypto.randomUUID(), orderId, product.id, quantity, product.retail_price_cents, Number(product.retail_price_cents) * quantity));
  }
  if (order.delivery_id && order.delivery_status !== "delivered" && scheduledDate) {
    statements.push(db.prepare(
      `UPDATE dog_food_deliveries SET scheduled_date=?,delivery_type=?,placement_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(scheduledDate, deliveryType, placement, order.delivery_id));
  } else if (!order.delivery_id && scheduledDate) {
    statements.push(db.prepare(
      `INSERT INTO dog_food_deliveries (id,order_id,customer_id,address_id,scheduled_date,delivery_type,status,placement_note)
       VALUES (?,?,?,?,?,?,'scheduled',?)`
    ).bind(crypto.randomUUID(), order.id, order.customer_id, order.address_id, scheduledDate, deliveryType, placement));
  }
  statements.push(db.prepare(
    `INSERT INTO route_partner_plan_events (id,organization_id,event_type,actor_email,details)
     VALUES (?,'org-opwp','dog_food_order_edited',?,?)`
  ).bind(crypto.randomUUID(), actor, JSON.stringify({ orderId, orderNumber: order.order_number, ...totals })));
  await db.batch(statements);
  return { orderId, orderNumber: order.order_number, totalCents: totals.total };
}

async function createOrder(db, body, actor) {
  const customerId = clean(body.customerId, 100);
  const plan = body.plan === "subscription" ? "subscription" : "on_demand";
  const delivery = ["route_day", "next_day", "same_day"].includes(body.delivery) ? body.delivery : "route_day";
  const scheduledDate = clean(body.scheduledDate, 10);
  if (!customerId || !validDate(scheduledDate)) throw new Error("Choose a customer and a valid first delivery date.");
  if (plan === "subscription" && delivery !== "route_day") throw new Error("Monthly delivery must use the free route day.");

  const customer = await db.prepare("SELECT id,customer_type FROM dog_food_customers WHERE id=? AND status='active'").bind(customerId).first();
  const address = await db.prepare("SELECT id,placement_preference,placement_other FROM dog_food_addresses WHERE customer_id=? ORDER BY is_primary DESC,created_at DESC LIMIT 1").bind(customerId).first();
  if (!customer || !address) throw new Error("The selected customer needs an active profile and delivery address.");

  const { quantities, products } = await pricedItems(db, body.items);
  const totals = orderTotals(products, quantities, delivery);
  const orderId = crypto.randomUUID();
  const orderNumber = `EDF-${orderId.slice(0, 8).toUpperCase()}`;
  const placement = clean(body.placement, 200) || clean(address.placement_other || address.placement_preference, 200) || "Confirm placement before delivery";
  const deliveryType = customer.customer_type === "scoop" && delivery === "route_day" ? "scoop_route" : customer.customer_type === "route_partner" && delivery === "route_day" ? "route_partner" : "on_demand";
  const deliveryId = crypto.randomUUID();
  const statements = [
    db.prepare(
      `INSERT INTO dog_food_orders
        (id,order_number,customer_id,address_id,order_type,status,subtotal_cents,delivery_fee_cents,tax_rate_basis_points,tax_cents,total_cents,requested_delivery_speed,source,notes,placed_at)
       VALUES (?,?,?,? ,?,'pending_payment',?,?,775,?,?,?,'admin_manual',?,CURRENT_TIMESTAMP)`
    ).bind(orderId, orderNumber, customer.id, address.id, plan, totals.subtotal, totals.deliveryFee, totals.tax, totals.total, delivery, `Created by ${actor}. Charge must be confirmed before route release.`),
    db.prepare(
      `INSERT INTO dog_food_deliveries
        (id,order_id,customer_id,address_id,scheduled_date,delivery_type,status,placement_note)
       VALUES (?,?,?,?,?,?,'scheduled',?)`
    ).bind(deliveryId, orderId, customer.id, address.id, scheduledDate, deliveryType, placement),
  ];
  for (const product of products) {
    const quantity = quantities.get(product.id);
    statements.push(db.prepare(
      `INSERT INTO dog_food_order_items (id,order_id,product_id,quantity,unit_price_cents,line_total_cents,substitution_policy)
       VALUES (?,?,?,?,?,?,'same_formula_weight')`
    ).bind(crypto.randomUUID(), orderId, product.id, quantity, product.retail_price_cents, Number(product.retail_price_cents) * quantity));
  }
  await db.batch(statements);
  return { orderId, orderNumber, totalCents: totals.total };
}

export async function POST(request) {
  const current = await context(request);
  if (current.response) return current.response;
  try {
    const body = await request.json();
    const action = clean(body?.action, 40);
    const result = action === "mark_paid"
      ? await markPaid(current.db, body, current.auth.email)
      : action === "create_order"
        ? await createOrder(current.db, body, current.auth.email)
        : action === "update_order"
          ? await updateOrder(current.db, body, current.auth.email)
        : action === "schedule_order"
          ? await scheduleOrder(current.db, body)
        : null;
    if (!result) return Response.json({ ok: false, error: "The requested action is not supported." }, { status: 400 });
    console.log(JSON.stringify({ event: `dog_food_${action}`, actor: current.auth.email, ...result }));
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The dog-food operation failed.";
    console.error(JSON.stringify({ event: "dog_food_operation_failed", message }));
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
