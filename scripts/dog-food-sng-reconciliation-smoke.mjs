const base = process.env.DOG_FOOD_ADMIN_SMOKE_BASE || "http://127.0.0.1:8787";

async function post(path, body, expected = 200, verified = true) {
  const headers = { "Content-Type": "application/json" };
  if (path === "/api/sng-webhooks/" && verified) headers["x-opwp-local-smoke"] = "true";
  const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await response.json();
  if (response.status !== expected) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const created = await post("/api/admin/dog-food/", {
  action: "create_order", customerId: "qa-food-customer", plan: "on_demand", delivery: "route_day", scheduledDate: "2026-07-21", placement: "QA porch",
  items: [{ productId: "edf-22-12-pink-40", quantity: 1 }],
});
if (created.result.totalCents !== 6357) throw new Error(`Unexpected order total: ${JSON.stringify(created)}`);

const invoiceId = `99${Date.now()}`;
await post("/api/sng-webhooks/", {
  type: "client:invoice_finalized",
  data: {
    invoice_id: invoiceId, invoice_number: `QA-${invoiceId}`, client: "qa-sng-food-client", client_name: "QA Dog Food Reconciliation",
    total: "63.57", amount: "63.57", subtotal: "59.00", tax: "4.57", paid: "0.00", remaining: "63.57", pay_method: "credit_card",
    items: [{ description: "Dog Food Delivery – Pink Bag (22-12, 40lb)", quantity: "1.00", unit_amount: "59.00", amount: "59.00" }],
  },
});
const reference = `QA-SNG-${crypto.randomUUID()}`;
const payment = await post("/api/sng-webhooks/", {
  type: "client:client_payment_accepted",
  data: { client: "qa-sng-food-client", client_name: "QA Dog Food Reconciliation", amount: 63.57, reference_number: reference },
});
if (!payment.processing?.reconciliation?.matched || payment.processing?.reconciliation?.status !== "scheduled") {
  throw new Error(`SNG reconciliation failed: ${JSON.stringify(payment)}`);
}
const locked = await post("/api/admin/dog-food/", {
  action: "update_order", orderId: created.result.orderId, plan: "on_demand", delivery: "route_day", scheduledDate: "2026-07-21",
  items: [{ productId: "edf-22-12-pink-40", quantity: 2 }],
}, 400);
if (locked.ok !== false) throw new Error("A reconciled paid order remained editable.");

const unverifiedOrder = await post("/api/admin/dog-food/", {
  action: "create_order", customerId: "qa-food-customer", plan: "on_demand", delivery: "route_day", scheduledDate: "2026-07-22", placement: "QA porch",
  items: [{ productId: "edf-26-14-blue-40", quantity: 1 }],
});
const unverifiedInvoiceId = `98${Date.now()}`;
await post("/api/sng-webhooks/", {
  type: "client:invoice_finalized",
  data: { invoice_id: unverifiedInvoiceId, client: "qa-sng-food-client", client_name: "QA Dog Food Reconciliation", total: "63.57", subtotal: "59.00", tax: "4.57", items: [{ description: "Dog Food Delivery – Blue Bag", quantity: "1.00", unit_amount: "59.00", amount: "59.00" }] },
}, 200, false);
const unverifiedPayment = await post("/api/sng-webhooks/", {
  type: "client:client_payment_accepted",
  data: { client: "qa-sng-food-client", client_name: "QA Dog Food Reconciliation", amount: 63.57, reference_number: `QA-UNVERIFIED-${crypto.randomUUID()}` },
}, 200, false);
if (unverifiedPayment.processing?.reconciliation?.reason !== "webhook_not_verified") throw new Error("An unverified payment was not quarantined.");
const stillEditable = await post("/api/admin/dog-food/", {
  action: "update_order", orderId: unverifiedOrder.result.orderId, plan: "on_demand", delivery: "route_day", scheduledDate: "2026-07-22",
  items: [{ productId: "edf-26-14-blue-40", quantity: 2 }],
});
if (stillEditable.result.totalCents !== 12714) throw new Error("The unverified payment changed financial state.");

console.log(JSON.stringify({ ok: true, orderNumber: created.result.orderNumber, amountCents: created.result.totalCents, invoiceMatched: true, paymentReference: "recorded", paidOrderLocked: true, unverifiedPayment: "quarantined" }));
