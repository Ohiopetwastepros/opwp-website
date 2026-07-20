import { getRuntimeEnv } from "./cloudflare";

const STRIPE_API = "https://api.stripe.com/v1";
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function configuredEnv(env = getRuntimeEnv()) {
  return {
    secretKey: String(env.STRIPE_SECRET_KEY || "").trim(),
    webhookSecret: String(env.STRIPE_WEBHOOK_SECRET || "").trim(),
  };
}

export function stripeConfigured(env = getRuntimeEnv()) {
  return configuredEnv(env).secretKey.startsWith("sk_");
}

async function stripeRequest(path, { method = "POST", form, idempotencyKey, env = getRuntimeEnv() } = {}) {
  const { secretKey } = configuredEnv(env);
  if (!secretKey.startsWith("sk_")) throw new Error("Stripe payments are not configured.");
  const headers = { Authorization: `Bearer ${secretKey}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form);
  }
  const response = await fetch(`${STRIPE_API}${path}`, { method, headers, body });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result?.error?.message || "Stripe could not complete the payment request.");
    error.code = result?.error?.code || result?.error?.decline_code || "stripe_request_failed";
    error.status = response.status;
    error.paymentIntent = result?.error?.payment_intent || null;
    throw error;
  }
  return result;
}

async function ensureStripeCustomer(db, customer, env) {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const created = await stripeRequest("/customers", {
    env,
    idempotencyKey: `dog-food-customer-${customer.id}`,
    form: {
      email: customer.email,
      name: `${customer.first_name} ${customer.last_name}`.trim(),
      phone: customer.phone,
      "metadata[dog_food_customer_id]": customer.id,
      "metadata[source]": "opwp_dog_food",
    },
  });
  await db.prepare(
    "UPDATE dog_food_customers SET stripe_customer_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stripe_customer_id IS NULL"
  ).bind(created.id, customer.id).run();
  const saved = await db.prepare("SELECT stripe_customer_id FROM dog_food_customers WHERE id=?").bind(customer.id).first();
  return saved?.stripe_customer_id || created.id;
}

function addLineItem(form, index, { name, description, amountCents, quantity = 1 }) {
  form[`line_items[${index}][price_data][currency]`] = "usd";
  form[`line_items[${index}][price_data][unit_amount]`] = String(amountCents);
  form[`line_items[${index}][price_data][product_data][name]`] = name;
  if (description) form[`line_items[${index}][price_data][product_data][description]`] = description;
  form[`line_items[${index}][quantity]`] = String(quantity);
}

export async function createDogFoodCheckout({ db, orderId, origin, env = getRuntimeEnv() }) {
  const order = await db.prepare(
    `SELECT o.*,c.first_name,c.last_name,c.email,c.phone,c.stripe_customer_id
     FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id
     WHERE o.id=? LIMIT 1`
  ).bind(orderId).first();
  if (!order) throw new Error("The dog-food order was not found.");
  if (!['draft','pending_payment','payment_failed'].includes(order.status)) throw new Error("This order is not awaiting payment.");
  const items = await db.prepare(
    `SELECT oi.quantity,oi.unit_price_cents,p.formula_code,p.color,p.bag_weight_lb,p.name
     FROM dog_food_order_items oi JOIN dog_food_products p ON p.id=oi.product_id
     WHERE oi.order_id=? ORDER BY p.formula_code`
  ).bind(order.id).all();
  if (!(items.results || []).length) throw new Error("The dog-food order has no items.");

  const stripeCustomerId = await ensureStripeCustomer(db, order, env);
  const form = {
    mode: "payment",
    customer: stripeCustomerId,
    client_reference_id: order.order_number,
    success_url: `${origin}/dog-food/payment/success/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dog-food/?payment=cancelled&order=${encodeURIComponent(order.order_number)}`,
    "metadata[order_id]": order.id,
    "metadata[order_number]": order.order_number,
    "metadata[order_type]": order.order_type,
    "payment_intent_data[metadata][order_id]": order.id,
    "payment_intent_data[metadata][order_number]": order.order_number,
    "payment_intent_data[metadata][order_type]": order.order_type,
    "payment_intent_data[receipt_email]": order.email,
  };
  if (order.order_type === "subscription") form["payment_intent_data[setup_future_usage]"] = "off_session";

  let index = 0;
  for (const item of items.results || []) {
    addLineItem(form, index++, {
      name: `Extreme Dog Fuel ${item.formula_code} ${item.color}`,
      description: `${item.bag_weight_lb} lb bag · ${item.name}`,
      amountCents: Number(item.unit_price_cents),
      quantity: Number(item.quantity),
    });
  }
  if (Number(order.delivery_fee_cents) > 0) addLineItem(form, index++, { name: "Dog-food delivery", amountCents: Number(order.delivery_fee_cents) });
  if (Number(order.tax_cents) > 0) addLineItem(form, index++, { name: "Sales tax", description: "Lucas County, Ohio", amountCents: Number(order.tax_cents) });

  const session = await stripeRequest("/checkout/sessions", {
    env,
    idempotencyKey: `dog-food-checkout-${order.id}`,
    form,
  });
  await db.prepare(
    `UPDATE dog_food_orders SET stripe_checkout_session_id=?,checkout_expires_at=datetime(?,'unixepoch'),updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(session.id, Number(session.expires_at), order.id).run();
  return { checkoutUrl: session.url, checkoutSessionId: session.id, orderNumber: order.order_number };
}

export async function createDogFoodPaymentSetup({ db, customerId, orderId = null, origin, env = getRuntimeEnv() }) {
  const customer = await db.prepare(
    "SELECT id,first_name,last_name,email,phone,stripe_customer_id FROM dog_food_customers WHERE id=? AND status='active' LIMIT 1"
  ).bind(customerId).first();
  if (!customer) throw new Error("The active dog-food customer was not found.");
  if (orderId) {
    const order = await db.prepare("SELECT id FROM dog_food_orders WHERE id=? AND customer_id=? LIMIT 1").bind(orderId, customer.id).first();
    if (!order) throw new Error("The selected order does not belong to this customer.");
  }
  const stripeCustomerId = await ensureStripeCustomer(db, customer, env);
  const form = {
    mode: "setup",
    currency: "usd",
    customer: stripeCustomerId,
    "payment_method_types[0]": "card",
    success_url: `${origin}/dog-food/payment/success/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dog-food/`,
    "metadata[dog_food_customer_id]": customer.id,
    "setup_intent_data[metadata][dog_food_customer_id]": customer.id,
  };
  if (orderId) {
    form["metadata[order_id]"] = orderId;
    form["setup_intent_data[metadata][order_id]"] = orderId;
  }
  const session = await stripeRequest("/checkout/sessions", {
    env,
    idempotencyKey: `dog-food-payment-setup-${customer.id}-${orderId || "profile"}-${Math.floor(Date.now() / 60000)}`,
    form,
  });
  await db.prepare(
    `INSERT INTO dog_food_payment_setup_sessions (id,customer_id,order_id,status,expires_at)
     VALUES (?,?,?,'pending',datetime(?,'unixepoch'))
     ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`
  ).bind(session.id, customer.id, orderId, Number(session.expires_at)).run();
  return { checkoutUrl: session.url, checkoutSessionId: session.id, customerId: customer.id };
}

export async function createStripePaymentIntent({ customerId, paymentMethodId, amountCents, orderId, orderNumber, subscriptionId, cycleKey, env = getRuntimeEnv() }) {
  return stripeRequest("/payment_intents", {
    env,
    idempotencyKey: `dog-food-renewal-${subscriptionId}-${cycleKey}`,
    form: {
      amount: String(amountCents),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: "true",
      confirm: "true",
      description: `Extreme Dog Fuel order ${orderNumber}`,
      "metadata[order_id]": orderId,
      "metadata[order_number]": orderNumber,
      "metadata[order_type]": "subscription_renewal",
      "metadata[subscription_id]": subscriptionId,
      "metadata[billing_cycle_key]": cycleKey,
    },
  });
}

export async function retrieveStripePaymentMethod(paymentMethodId, env = getRuntimeEnv()) {
  if (!paymentMethodId) return null;
  return stripeRequest(`/payment_methods/${encodeURIComponent(paymentMethodId)}`, { method: "GET", env });
}

function hexBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

export async function readVerifiedStripeEvent(request, env = getRuntimeEnv()) {
  const { webhookSecret } = configuredEnv(env);
  if (!webhookSecret.startsWith("whsec_")) throw new Error("Stripe webhook verification is not configured.");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_WEBHOOK_BYTES) throw new Error("Stripe webhook payload is too large.");
  const signatureHeader = request.headers.get("stripe-signature") || "";
  const parts = signatureHeader.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) throw new Error("Stripe webhook signature is invalid or expired.");
  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > MAX_WEBHOOK_BYTES) throw new Error("Stripe webhook payload is too large.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  if (!signatures.some((signature) => equalBytes(digest, hexBytes(signature)))) throw new Error("Stripe webhook signature verification failed.");
  const event = JSON.parse(payload);
  if (!event?.id || !event?.type || !event?.data?.object) throw new Error("Stripe webhook payload is incomplete.");
  return event;
}
