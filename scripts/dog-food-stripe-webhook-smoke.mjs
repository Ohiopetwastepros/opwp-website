import { createHmac, randomUUID } from "node:crypto";

const base = process.env.DOG_FOOD_ADMIN_SMOKE_BASE || "http://127.0.0.1:8787";
const webhookSecret = process.env.STRIPE_SMOKE_WEBHOOK_SECRET || "whsec_opwp_local_stripe_smoke";

async function admin(body, expected = 200) {
  const response = await fetch(`${base}/api/admin/dog-food/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (response.status !== expected) throw new Error(`Admin returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function webhook(event, signature, expected) {
  const payload = JSON.stringify(event);
  const response = await fetch(`${base}/api/stripe/webhook/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  const data = await response.json();
  if (response.status !== expected) throw new Error(`Webhook returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const created = await admin({
  action: "create_order", customerId: "qa-food-customer", plan: "on_demand", delivery: "route_day",
  scheduledDate: "2026-07-23", placement: "QA Stripe porch",
  items: [{ productId: "edf-30-20-red-40", quantity: 1 }],
});
const event = {
  id: `evt_qa_${randomUUID().replaceAll("-", "")}`,
  type: "payment_intent.succeeded",
  data: { object: {
    id: `pi_qa_${randomUUID().replaceAll("-", "")}`,
    amount: created.result.totalCents,
    amount_received: created.result.totalCents,
    currency: "usd",
    customer: "cus_qa_stripe_smoke",
    payment_method: null,
    metadata: { order_id: created.result.orderId, order_number: created.result.orderNumber, order_type: "on_demand" },
  } },
};
await webhook(event, "t=1,v1=invalid", 400);
const payload = JSON.stringify(event);
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
await webhook(event, `t=${timestamp},v1=${signature}`, 200);
await webhook(event, `t=${timestamp},v1=${signature}`, 200);
const locked = await admin({
  action: "update_order", orderId: created.result.orderId, plan: "on_demand", delivery: "route_day", scheduledDate: "2026-07-23",
  items: [{ productId: "edf-30-20-red-40", quantity: 2 }],
}, 400);
if (locked.ok !== false) throw new Error("Stripe-paid order remained editable.");
console.log(JSON.stringify({ ok: true, orderNumber: created.result.orderNumber, totalCents: created.result.totalCents, invalidSignature: "rejected", validPayment: "captured", duplicateEvent: "idempotent", paidOrderEdit: "rejected" }));
