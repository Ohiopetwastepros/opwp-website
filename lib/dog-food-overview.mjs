// Presentation only: payment, scheduling and ownership remain server-authoritative.
export function foodFinderDraft(draft, search, now = Date.now()) {
  if (new URLSearchParams(search).get('from') !== 'finder' || !(draft?.expiresAt > now) || !Array.isArray(draft.items) || draft.items.length > 4) return null;
  const items = draft.items.filter(i => typeof i.productId === 'string' && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 10);
  return items.length ? Object.fromEntries(items.map(i => [i.productId,i.quantity])) : null;
}

export function foodOverview(data = {}) {
  const orders = data.orders || [];
  const openOrders = orders.filter(o => !['fulfilled', 'cancelled', 'refunded'].includes(o.status) && o.delivery_status !== 'delivered');
  const nextOrder = [...openOrders].sort((a, b) => (a.pickup_date || a.delivery_date || '9999').localeCompare(b.pickup_date || b.delivery_date || '9999'))[0] || null;
  const plans = data.subscriptions || [];
  const nextPlan = [...plans.filter(s => s.status === 'active')].sort((a, b) => (a.next_delivery_date || '9999').localeCompare(b.next_delivery_date || '9999'))[0] || null;
  const attentionOrder = openOrders.find(o => o.source!=='direct'&&!o.paid_provider && ['pending_payment', 'payment_failed', 'draft'].includes(o.status)) || null;
  const address = data.addresses?.[0] || null;
  const profileReady = !data.profileRequired && Boolean(data.customer?.first_name && data.customer?.last_name && data.customer?.phone && address);
  const purchased = orders.filter(o => !['cancelled','refunded'].includes(o.status) && (o.paid_provider || o.status === 'fulfilled' || o.delivery_status === 'delivered'));
  const buyAgain = [], seen = new Set();
  for (const order of purchased) for (const item of order.items || []) {
    const product = data.products?.find(p => p.id === item.product_id);
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id); buyAgain.push({ ...item, product, order });
  }
  const repeatOrder = purchased.find(o => o.items?.length && o.items.every(i => data.products?.some(p => p.id === i.product_id))) || null;
  return { nextOrder, nextPlan, attentionOrder, address, profileReady, openCount: openOrders.length,
    buyAgain, repeatOrder,
    plan: nextPlan || plans.find(s => s.status !== 'cancelled') || null,
    food: nextOrder?.items?.length ? nextOrder.items : nextPlan?.items || [],
    deliveryDate: nextOrder ? nextOrder.pickup_date || nextOrder.delivery_date || null : nextPlan?.next_delivery_date || null,
    latestOrder: orders[0] || null };
}

export function foodReorder(order, products = []) {
  const quantities = {}, missing = [];
  let priceChanged = false;
  for (const item of order.items || []) {
    const product = products.find(p => p.id === item.product_id);
    if (!product) { missing.push(item.name || `${item.color} ${item.formula_code}`); continue; }
    quantities[product.id] = item.quantity;
    if (Number(item.unit_price_cents) !== Number(product.retail_price_cents)) priceChanged = true;
  }
  return { quantities, missing, priceChanged,
    cadence: order.delivery_cadence === 'fixed_day' ? 'fixed_day' : 'service_week',
    serviceWeek: [1,2,3,4].includes(Number(order.requested_service_week)) ? Number(order.requested_service_week) : 4,
    monthDay: Number.isInteger(Number(order.requested_month_day)) && Number(order.requested_month_day) >= 1 && Number(order.requested_month_day) <= 31 ? Number(order.requested_month_day) : 15 };
}
