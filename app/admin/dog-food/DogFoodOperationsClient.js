"use client";

import { useMemo, useState } from "react";
import styles from "./dog-food.module.css";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
const number = (value) => new Intl.NumberFormat("en-US").format(Number(value) || 0);
const shortDate = (value) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : "Not scheduled";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function Status({ value }) {
  const label = String(value || "unknown").replaceAll("_", " ");
  return <span className={`${styles.status} ${styles[`status_${value}`] || ""}`}>{label}</span>;
}

async function operation(body) {
  const response = await fetch("/api/admin/dog-food/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "The operation could not be completed.");
  return data.result;
}

export default function DogFoodOperationsClient({ initialData }) {
  const [view, setView] = useState("orders");
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [scheduleOrder, setScheduleOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeProducts = useMemo(() => initialData.products.filter((product) => Number(product.is_active) === 1 && product.retail_price_cents !== null), [initialData.products]);
  const unpaid = initialData.orders.filter((order) => ["pending_payment", "payment_failed"].includes(order.status));

  async function markPaid(event) {
    event.preventDefault(); setBusy("payment"); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await operation({ action: "mark_paid", orderId: paymentOrder.id, provider: form.get("provider"), reference: form.get("reference") });
      setNotice(`${paymentOrder.order_number} is paid and its fulfillment state is updated.`); setPaymentOrder(null); window.location.reload();
    } catch (requestError) { setError(requestError.message); setBusy(""); }
  }

  async function createOrder(event) {
    event.preventDefault(); setBusy("order"); setError("");
    const form = new FormData(event.currentTarget);
    const items = activeProducts.map((product) => ({ productId: product.id, quantity: Number(form.get(`qty-${product.id}`)) || 0 }));
    try {
      const result = await operation({ action: "create_order", customerId: form.get("customerId"), plan: form.get("plan"), delivery: form.get("delivery"), scheduledDate: form.get("scheduledDate"), placement: form.get("placement"), items });
      setNotice(`${result.orderNumber} was created for ${money(result.totalCents)} and is awaiting payment confirmation.`); setOrderOpen(false); window.location.reload();
    } catch (requestError) { setError(requestError.message); setBusy(""); }
  }

  async function setDeliveryDate(event) {
    event.preventDefault(); setBusy("schedule"); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await operation({ action: "schedule_order", orderId: scheduleOrder.id, scheduledDate: form.get("scheduledDate"), placement: form.get("placement") });
      setNotice(`${scheduleOrder.order_number} now has a confirmed first delivery date.`); setScheduleOrder(null); window.location.reload();
    } catch (requestError) { setError(requestError.message); setBusy(""); }
  }

  async function updateOrder(event) {
    event.preventDefault(); setBusy("edit"); setError("");
    const form = new FormData(event.currentTarget);
    const items = activeProducts.map((product) => ({ productId: product.id, quantity: Number(form.get(`edit-qty-${product.id}`)) || 0 }));
    try {
      const result = await operation({ action: "update_order", orderId: editOrder.id, plan: form.get("plan"), delivery: form.get("delivery"), scheduledDate: form.get("scheduledDate"), placement: form.get("placement"), items });
      setNotice(`${result.orderNumber} was updated. The revised total is ${money(result.totalCents)}.`); setEditOrder(null); window.location.reload();
    } catch (requestError) { setError(requestError.message); setBusy(""); }
  }

  return <>
    <section className={styles.actionBar}>
      <div><span className={styles.eyebrow}>Live operating ledger</span><strong>{unpaid.length ? `${unpaid.length} payment ${unpaid.length === 1 ? "action" : "actions"} need attention` : "Orders and payments are current"}</strong><p>Dog-food subscriptions live here. Sweep &amp; Go remains the scooping source and temporary manual-charge path.</p></div>
      <button type="button" onClick={() => { setOrderOpen(true); setError(""); }}>+ New order</button>
    </section>
    <div className={styles.messages} aria-live="polite">{error ? <p className={styles.error}>{error}</p> : null}{notice ? <p className={styles.notice}>{notice}</p> : null}</div>
    <section className={styles.metrics} aria-label="Dog-food operating summary">
      <article><span>Active customers</span><strong>{number(initialData.summary.active_customers)}</strong><small>Scooping + route network</small></article>
      <article className={Number(initialData.summary.unpaid_orders) ? styles.metricAttention : ""}><span>Payment due</span><strong>{money(initialData.summary.unpaid_cents)}</strong><small>{number(initialData.summary.unpaid_orders)} open orders</small></article>
      <article><span>Monthly subscriptions</span><strong>{number(initialData.summary.active_subscriptions)}</strong><small>Owned by this system</small></article>
      <article><span>Delivery queue today</span><strong>{number(initialData.summary.due_today)}</strong><small>Not yet completed</small></article>
      <article><span>30-day recorded sales</span><strong>{money(initialData.summary.revenue_30_cents)}</strong><small>Paid and fulfilled orders</small></article>
    </section>
    <nav className={styles.tabs} aria-label="Dog-food workspace views">
      {[['orders','Orders'],['subscriptions','Subscriptions'],['inventory','Inventory'],['customers','Customers']].map(([key,label]) => <button type="button" key={key} className={view === key ? styles.tabActive : ""} aria-pressed={view === key} onClick={() => setView(key)}>{label}<span>{key === "orders" ? initialData.orders.length : key === "subscriptions" ? initialData.subscriptions.length : key === "inventory" ? initialData.products.length : initialData.customers.length}</span></button>)}
    </nav>

    {view === "orders" ? <section className={styles.panel}><header><div><span className={styles.eyebrow}>Commerce queue</span><h2>Orders and fulfillment</h2></div><p>Unpaid orders can be corrected before payment is recorded.</p></header><div className={styles.tableWrap}><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Delivery</th><th>Total</th><th>Payment</th><th>Action</th></tr></thead><tbody>{initialData.orders.length ? initialData.orders.map((order) => <tr key={order.id}><td><strong>{order.order_number}</strong><small>{order.order_type === "subscription" ? "Monthly" : "One time"}</small></td><td><strong>{order.first_name} {order.last_name}</strong><small>{String(order.customer_type).replaceAll("_", " ")}{order.sng_client_id ? " · SNG linked" : ""}</small></td><td className={styles.items}>{order.items || "No items"}</td><td><strong>{shortDate(order.scheduled_date)}</strong><small>{order.delivery_status ? <Status value={order.delivery_status} /> : "Date confirmation needed"}</small></td><td><strong>{money(order.total_cents)}</strong><small>{order.delivery_fee_cents ? `${money(order.delivery_fee_cents)} delivery` : "Free route delivery"}</small></td><td><Status value={order.status} /></td><td><div className={styles.rowActions}>{["draft","pending_payment","payment_failed"].includes(order.status) ? <button className={styles.editAction} type="button" onClick={() => { setEditOrder(order); setError(""); }}>Edit order</button> : null}{!order.scheduled_date ? <button className={styles.tableAction} type="button" onClick={() => { setScheduleOrder(order); setError(""); }}>Set delivery date</button> : ["pending_payment","payment_failed"].includes(order.status) ? <button className={styles.tableAction} type="button" onClick={() => { setPaymentOrder(order); setError(""); }}>Confirm payment</button> : <span className={styles.completeMark}>✓ Recorded</span>}</div></td></tr>) : <tr><td colSpan="7" className={styles.empty}>No dog-food orders have been entered.</td></tr>}</tbody></table></div></section> : null}

    {view === "subscriptions" ? <section className={styles.panel}><header><div><span className={styles.eyebrow}>Standalone recurring engine</span><h2>Monthly subscriptions</h2></div><p>Subscriptions activate after the first payment is confirmed.</p></header><div className={styles.cards}>{initialData.subscriptions.length ? initialData.subscriptions.map((subscription) => <article className={styles.subscription} key={subscription.id}><div><span>{subscription.first_name?.[0]}{subscription.last_name?.[0]}</span><div><strong>{subscription.first_name} {subscription.last_name}</strong><small>{subscription.items || "No active products"}</small></div></div><dl><div><dt>Frequency</dt><dd>Every {subscription.frequency_weeks} weeks</dd></div><div><dt>Next charge</dt><dd>{shortDate(subscription.next_charge_at)}</dd></div><div><dt>Next delivery</dt><dd>{shortDate(subscription.next_delivery_date)}</dd></div></dl><footer><Status value={subscription.status} /><small>{subscription.card_brand || "Payment method needed"}{subscription.card_last_four ? ` •••• ${subscription.card_last_four}` : ""}</small></footer></article>) : <div className={styles.emptyCard}><strong>No active subscriptions yet</strong><p>Create a monthly order and confirm its first payment to activate the recurring schedule here.</p></div>}</div></section> : null}

    {view === "inventory" ? <section className={styles.panel}><header><div><span className={styles.eyebrow}>Physical control</span><h2>Inventory by formula</h2></div><p>Opening counts are required before quantities can be trusted.</p></header><div className={styles.inventoryGrid}>{initialData.products.map((product) => <article className={`${styles.inventoryCard} ${!Number(product.is_active) ? styles.inactiveProduct : ""}`} key={product.id}><span className={styles[`bag_${String(product.color).toLowerCase()}`]}>{product.color}</span><div><strong>{product.formula_code}</strong><p>{product.name} · {product.bag_weight_lb} lb</p></div><div className={styles.stock}><b>{number(product.quantity_on_hand)}</b><small>on hand</small></div><footer><span>{product.retail_price_cents === null ? "Price needed" : money(product.retail_price_cents)}</span><Status value={Number(product.is_active) ? "active" : "inactive"} /></footer></article>)}</div></section> : null}

    {view === "customers" ? <section className={styles.panel}><header><div><span className={styles.eyebrow}>Unified customer record</span><h2>Dog-food customers</h2></div><p>SNG IDs link scooping customers without moving food subscriptions into SNG.</p></header><div className={styles.customerGrid}>{initialData.customers.map((customer) => <article key={customer.id}><span>{customer.first_name?.[0]}{customer.last_name?.[0]}</span><div><strong>{customer.first_name} {customer.last_name}</strong><p>{customer.email}</p><small>{customer.city || "Address needed"}{customer.route_day ? ` · ${customer.route_day} route` : ""}</small></div><div><Status value={customer.customer_type} />{customer.sng_client_id ? <small>SNG linked</small> : <small>Native customer</small>}</div></article>)}</div></section> : null}

    {paymentOrder ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentOrder(null); }}><form className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="payment-title" onSubmit={markPaid}><span className={styles.modalKicker}>Payment control</span><h2 id="payment-title">Confirm {money(paymentOrder.total_cents)} received</h2><p>This records payment for <strong>{paymentOrder.order_number}</strong>. It does not charge the card. Complete the charge in SNG or CardPointe first.</p><label><span>Payment source</span><select name="provider"><option value="sng_manual">Sweep &amp; Go manual charge</option><option value="cardpointe">CardPointe transaction</option></select></label><label><span>Transaction or invoice reference</span><input name="reference" required autoFocus placeholder="Required for audit trail" maxLength="100" /></label>{error ? <p className={styles.modalError}>{error}</p> : null}<div className={styles.modalActions}><button type="button" onClick={() => setPaymentOrder(null)}>Cancel</button><button type="submit" disabled={busy === "payment"}>{busy === "payment" ? "Recording…" : "Confirm paid"}</button></div></form></div> : null}

    {scheduleOrder ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScheduleOrder(null); }}><form className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="schedule-title" onSubmit={setDeliveryDate}><span className={styles.modalKicker}>Route checkpoint</span><h2 id="schedule-title">Set the first delivery date</h2><p>Confirm the route day for <strong>{scheduleOrder.first_name} {scheduleOrder.last_name}</strong> before collecting payment or activating a monthly subscription.</p><label><span>First delivery date</span><input type="date" name="scheduledDate" min={today()} defaultValue={today()} required autoFocus /></label><label><span>Placement note</span><input name="placement" placeholder="Use the saved customer preference" maxLength="200" /></label>{error ? <p className={styles.modalError}>{error}</p> : null}<div className={styles.modalActions}><button type="button" onClick={() => setScheduleOrder(null)}>Cancel</button><button type="submit" disabled={busy === "schedule"}>{busy === "schedule" ? "Saving…" : "Confirm delivery date"}</button></div></form></div> : null}

    {editOrder ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditOrder(null); }}><form className={`${styles.modal} ${styles.orderModal}`} role="dialog" aria-modal="true" aria-labelledby="edit-order-title" onSubmit={updateOrder}><span className={styles.modalKicker}>Unpaid order correction</span><h2 id="edit-order-title">Edit {editOrder.order_number}</h2><p>Update the order before collecting payment. Current catalog pricing and Lucas County tax will be recalculated automatically.</p><div className={styles.formGrid}><label><span>Order type</span><select name="plan" defaultValue={editOrder.order_type}><option value="on_demand">One-time order</option><option value="subscription">Monthly subscription</option></select></label><label><span>Delivery timing</span><select name="delivery" defaultValue={editOrder.requested_delivery_speed || "route_day"}><option value="route_day">Free route day</option><option value="next_day">Next day · $5</option><option value="same_day">Same day · $10</option></select></label><label><span>Delivery date</span><input type="date" name="scheduledDate" defaultValue={editOrder.scheduled_date || ""} disabled={editOrder.delivery_status === "delivered"} /></label><label><span>Placement</span><input name="placement" defaultValue={editOrder.placement_note || ""} placeholder="Delivery placement" maxLength="200" /></label></div>{editOrder.delivery_status === "delivered" ? <input type="hidden" name="scheduledDate" value={String(editOrder.scheduled_date || "").slice(0,10)} /> : null}<fieldset><legend>Bag quantities</legend><div className={styles.productPicker}>{activeProducts.map((product) => <label key={product.id}><span className={styles[`bag_${String(product.color).toLowerCase()}`]}>{product.color}</span><strong>{product.formula_code}</strong><small>{product.bag_weight_lb} lb · {money(product.retail_price_cents)}</small><input type="number" name={`edit-qty-${product.id}`} min="0" max="10" defaultValue={editOrder.lineItems.find((item) => item.productId === product.id)?.quantity || 0} inputMode="numeric" aria-label={`${product.color} ${product.formula_code} quantity`} /></label>)}</div></fieldset>{error ? <p className={styles.modalError}>{error}</p> : null}<div className={styles.modalActions}><button type="button" onClick={() => setEditOrder(null)}>Cancel</button><button type="submit" disabled={busy === "edit"}>{busy === "edit" ? "Saving…" : "Save revised order"}</button></div></form></div> : null}

    {orderOpen ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderOpen(false); }}><form className={`${styles.modal} ${styles.orderModal}`} role="dialog" aria-modal="true" aria-labelledby="order-title" onSubmit={createOrder}><span className={styles.modalKicker}>Internal order entry</span><h2 id="order-title">Create a dog-food order</h2><p>The order will begin as unpaid and cannot clear the field load check until payment is confirmed.</p><div className={styles.formGrid}><label className={styles.full}><span>Customer</span><select name="customerId" required autoFocus defaultValue=""><option value="" disabled>Select a customer</option>{initialData.customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.last_name}, {customer.first_name} · {String(customer.customer_type).replaceAll("_", " ")}</option>)}</select></label><label><span>Order type</span><select name="plan" defaultValue="on_demand"><option value="on_demand">One-time order</option><option value="subscription">Monthly subscription</option></select></label><label><span>Delivery timing</span><select name="delivery" defaultValue="route_day"><option value="route_day">Free route day</option><option value="next_day">Next day · $5</option><option value="same_day">Same day · $10</option></select></label><label><span>First delivery date</span><input type="date" name="scheduledDate" defaultValue={today()} required /></label><label><span>Placement</span><input name="placement" placeholder="Use saved preference if blank" maxLength="200" /></label></div><fieldset><legend>Bag quantities</legend><div className={styles.productPicker}>{activeProducts.map((product) => <label key={product.id}><span className={styles[`bag_${String(product.color).toLowerCase()}`]}>{product.color}</span><strong>{product.formula_code}</strong><small>{product.bag_weight_lb} lb · {money(product.retail_price_cents)}</small><input type="number" name={`qty-${product.id}`} min="0" max="10" defaultValue="0" inputMode="numeric" aria-label={`${product.color} ${product.formula_code} quantity`} /></label>)}</div></fieldset>{error ? <p className={styles.modalError}>{error}</p> : null}<div className={styles.modalActions}><button type="button" onClick={() => setOrderOpen(false)}>Cancel</button><button type="submit" disabled={busy === "order"}>{busy === "order" ? "Creating…" : "Create unpaid order"}</button></div></form></div> : null}
  </>;
}
