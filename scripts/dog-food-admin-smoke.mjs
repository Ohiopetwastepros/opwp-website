const base = process.env.DOG_FOOD_ADMIN_SMOKE_BASE || "http://127.0.0.1:8787";

async function post(body) {
  const response = await fetch(`${base}/api/admin/dog-food/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(JSON.stringify(data));
  return data.result;
}

async function rejected(body) {
  const response = await fetch(`${base}/api/admin/dog-food/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (response.status !== 400 || data.ok !== false) throw new Error(`Expected rejection: ${JSON.stringify(data)}`);
}

const created = await post({
  action: "create_order",
  customerId: "qa-food-customer",
  plan: "subscription",
  delivery: "route_day",
  scheduledDate: "2026-07-20",
  placement: "QA placement",
  items: [{ productId: "edf-22-12-pink-40", quantity: 1 }, { productId: "edf-26-14-blue-40", quantity: 1 }],
});
if (!created.orderId || created.totalCents !== 12930) throw new Error(`Unexpected order: ${JSON.stringify(created)}`);
const paymentReference = `QA-${crypto.randomUUID()}`;
const paid = await post({ action: "mark_paid", orderId: created.orderId, provider: "sng_manual", reference: paymentReference });
if (paid.status !== "scheduled") throw new Error(`Unexpected payment result: ${JSON.stringify(paid)}`);
await rejected({ action: "mark_paid", orderId: created.orderId, provider: "sng_manual", reference: `QA-${crypto.randomUUID()}` });
const addedFormula = await post({
  action: "create_order", customerId: "qa-food-customer", plan: "subscription", delivery: "route_day", scheduledDate: "2026-08-17", placement: "QA placement",
  items: [{ productId: "edf-26-18-green-40", quantity: 1 }],
});
await post({ action: "mark_paid", orderId: addedFormula.orderId, provider: "sng_manual", reference: `QA-${crypto.randomUUID()}` });
const duplicateTarget = await post({
  action: "create_order", customerId: "qa-food-customer", plan: "on_demand", delivery: "route_day", scheduledDate: "2026-08-17", placement: "QA placement",
  items: [{ productId: "edf-30-20-red-40", quantity: 1 }],
});
await rejected({ action: "mark_paid", orderId: duplicateTarget.orderId, provider: "sng_manual", reference: paymentReference });
console.log(JSON.stringify({ ok: true, orderNumber: created.orderNumber, totalCents: created.totalCents, paymentStatus: paid.status, subscriptionMerge: "requested", duplicatePaymentReference: "rejected", duplicateOrderCapture: "rejected" }));
