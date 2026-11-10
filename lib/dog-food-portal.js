import { foodCheckoutTotals, foodDeliveryPreference, FOOD_DELIVERY_OPTIONS, FOOD_TAX_BASIS_POINTS, foodSameDayOpen } from './dog-food-checkout.mjs';
import { FoodAccountError, foodTokenHash } from './dog-food-account.mjs';
import { nextFoodDelivery, shiftFoodDays, easternFoodDate } from './dog-food-cadence.mjs';
import { readFoodOperations } from './dog-food-ops-store';
import { reserveFoodLots, checkFoodLotReconciliation } from './dog-food-fulfillment';
import { foodProfileComplete, FOOD_STATES } from './dog-food-profile.mjs';
import { readFoodDeliveryChoices, locateFoodAddress } from './dog-food-routing';

const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''));
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export async function requireFoodProfile(db,account) {
  const c=await db.prepare('SELECT first_name,last_name,phone FROM dog_food_customers WHERE id=? AND deleted_at IS NULL').bind(account.customer_id).first();
  const a=await db.prepare('SELECT * FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY updated_at DESC LIMIT 1').bind(account.customer_id).first();
  const onboarding=await db.prepare('SELECT profile_completed_at FROM dog_food_accounts WHERE id=? AND customer_id=?').bind(account.id,account.customer_id).first();
  if(!onboarding?.profile_completed_at||!foodProfileComplete(c,a))throw new FoodAccountError('Save your delivery profile before continuing.',409);
  return a;
}
async function audit(db, account, action, entityId, details = {}) {
  await db.prepare('INSERT INTO dog_food_portal_audit(id,account_id,action,entity_id,details) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), account.id, action, entityId, JSON.stringify(details)).run();
}
export async function readFoodPortal(db, account) {
  const products = (await db.prepare(`SELECT id,name,formula_code,color,bag_weight_lb,retail_price_cents FROM dog_food_products
    WHERE is_active=1 AND is_customer_visible=1 AND retail_price_cents IS NOT NULL ORDER BY formula_code`).all()).results || [];
  const settings=await db.prepare("SELECT posting_enabled,scheduling_enabled FROM dog_food_workflow_settings WHERE id='org-opwp'").first();
  const deliveryPolicy = {orderingAvailable:Boolean(settings?.posting_enabled&&settings?.scheduling_enabled),sameDayOpen:foodSameDayOpen(),options:FOOD_DELIVERY_OPTIONS,taxBasisPoints:FOOD_TAX_BASIS_POINTS};
  if (!account) return { authenticated: false, products, deliveryPolicy };
  const onboarding=await db.prepare('SELECT profile_completed_at,preferred_fulfillment FROM dog_food_accounts WHERE id=? AND customer_id=?').bind(account.id,account.customer_id).first();
  const customer = await db.prepare(`SELECT id,first_name,last_name,email,phone,customer_type,sng_client_id,card_brand,card_last_four
    FROM dog_food_customers WHERE id=? AND deleted_at IS NULL`).bind(account.customer_id).first();
  const addresses = (await db.prepare(`SELECT id,line1,city,state,postal_code,placement_preference,placement_other,is_primary
    ,latitude,longitude FROM dog_food_addresses WHERE customer_id=? ORDER BY is_primary DESC,created_at DESC LIMIT 20`).bind(account.customer_id).all()).results || [];
  const orders = (await db.prepare(`SELECT o.id,o.source,o.order_number,o.order_type,o.status,o.subtotal_cents,o.delivery_fee_cents,o.tax_cents,o.tax_rate_basis_points,o.total_cents,o.placed_at,o.requested_delivery_speed,o.fulfillment_method,o.requested_route_weekday,
    (SELECT scheduled_date FROM dog_food_pickups WHERE order_id=o.id AND stage='arranged') pickup_date,
    (SELECT arrangement_note FROM dog_food_pickups WHERE order_id=o.id AND stage='arranged') pickup_instructions,
    (SELECT CASE WHEN status='ready' THEN stage ELSE status END FROM dog_food_pickups WHERE order_id=o.id) pickup_status,
    o.delivery_cadence,o.requested_month_day,o.requested_service_week,o.billing_consent_at,
    (SELECT scheduled_date FROM dog_food_deliveries WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) delivery_date,
    (SELECT status FROM dog_food_deliveries WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) delivery_status,
    EXISTS(SELECT 1 FROM dog_food_deliveries WHERE order_id=o.id AND status='delivered' AND proof_photo_url IS NOT NULL) proof_available,
    COALESCE((SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0) amount_received_cents,
    COALESCE((SELECT SUM(refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0) refunded_cents,
    MAX(0,o.total_cents-COALESCE((SELECT SUM(amount_cents-CASE WHEN o.source='staff_sales' THEN 0 ELSE refunded_amount_cents END) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0)) balance_cents,
    CASE WHEN COALESCE((SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0)>=o.total_cents
      THEN (SELECT provider FROM dog_food_payments WHERE order_id=o.id AND status='captured' LIMIT 1) END paid_provider
    FROM dog_food_orders o WHERE o.customer_id=? AND o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 100`).bind(account.customer_id).all()).results || [];
  const items = (await db.prepare(`SELECT i.order_id,i.product_id,i.quantity,i.unit_price_cents,p.name,p.formula_code,p.color,p.bag_weight_lb
    FROM dog_food_order_items i JOIN dog_food_orders o ON o.id=i.order_id JOIN dog_food_products p ON p.id=i.product_id
    WHERE o.customer_id=? AND o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 400`).bind(account.customer_id).all()).results || [];
  const subscriptions = (await db.prepare(`SELECT id,status,next_delivery_date,next_charge_at,payment_provider,delivery_cadence,billing_anchor_day,fulfillment_method,
    service_week,service_weekday,card_brand,card_last_four,charge_lead_days FROM dog_food_subscriptions WHERE customer_id=? ORDER BY created_at DESC LIMIT 20`).bind(account.customer_id).all()).results || [];
  const subscriptionItems = (await db.prepare(`SELECT si.subscription_id,si.product_id,si.quantity,si.unit_price_cents,p.formula_code,p.color,p.bag_weight_lb
    FROM dog_food_subscription_items si JOIN dog_food_subscriptions s ON s.id=si.subscription_id JOIN dog_food_products p ON p.id=si.product_id
    WHERE s.customer_id=? AND si.is_active=1 LIMIT 80`).bind(account.customer_id).all()).results || [];
  const links=(await db.prepare('SELECT sale_id,fulfillment_method FROM dog_food_direct_sale_links WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').bind(account.customer_id).all()).results||[];
  const directHistory=[];
  if(links.length){
    const model=await readFoodOperations(db),ids=new Set(links.map(l=>l.sale_id));
    for(const sale of model.sales.filter(s=>ids.has(s.id))){
      const pickup=links.find(l=>l.sale_id===sale.id)?.fulfillment_method==='pickup';
      const product=model.products.find(p=>p.id===sale.productId),catalog=products.find(p=>p.id===product?.websiteId);
      directHistory.push({id:'direct:'+sale.id,source:'direct',order_number:'Direct sale '+sale.id.slice(-6).toUpperCase(),order_type:'on_demand',status:sale.cancelled?'cancelled':sale.inventoryEligible?'fulfilled':'pending_payment',placed_at:sale.date,total_cents:sale.totalCents,tax_cents:0,delivery_fee_cents:0,paid_provider:sale.balanceCents===0&&sale.collectedCents>0?sale.paymentMethod:null,amount_received_cents:sale.collectedCents,balance_cents:sale.balanceCents,fulfillment_method:pickup?'pickup':'delivery',pickup_status:pickup&&sale.inventoryEligible?'collected':null,delivery_status:sale.inventoryEligible?'delivered':null,delivery_date:sale.inventoryEligible?sale.date:null,items:catalog?[{product_id:catalog.id,name:catalog.name,color:catalog.color,formula_code:catalog.formula_code,bag_weight_lb:catalog.bag_weight_lb,quantity:sale.quantity,unit_price_cents:Math.round(sale.totalCents/sale.quantity)}]:[],pickupEvents:[]});
    }
  }
  const planRequests=(await db.prepare('SELECT id,subscription_id,request_type,details,status,office_note,effective_date,created_at,updated_at FROM dog_food_plan_requests WHERE customer_id=? ORDER BY created_at DESC LIMIT 30').bind(account.customer_id).all()).results||[];
  const pickupEvents=(await db.prepare('SELECT e.order_id,e.stage,e.occurred_at,e.instructions FROM dog_food_pickup_events e JOIN dog_food_orders o ON o.id=e.order_id WHERE o.customer_id=? AND o.deleted_at IS NULL ORDER BY e.id LIMIT 500').bind(account.customer_id).all()).results||[];
  const profileRequired=!onboarding?.profile_completed_at||!foodProfileComplete(customer,addresses[0]);
  return { authenticated: true, profileRequired, preferredFulfillment:onboarding?.preferred_fulfillment||'delivery', deliveryChoices:profileRequired?null:await readFoodDeliveryChoices(db,addresses[0]), deliveryPolicy, customer: { ...customer, email:account.email }, addresses, products,
    planRequests, orders: [...orders.map(o => ({ ...o, pickupEvents:pickupEvents.filter(e=>e.order_id===o.id), items: items.filter(i => i.order_id === o.id) })),...directHistory].sort((a,b)=>String(b.placed_at||'').localeCompare(String(a.placed_at||''))),
    subscriptions: subscriptions.map(s => { const lines = subscriptionItems.filter(i => i.subscription_id === s.id); return { ...s, items: lines, total_cents: foodCheckoutTotals(lines).total }; }) };
}
export async function saveFoodProfile(db, account, body) {
  const p = body.profile || {}, phone = clean(p.phone, 40), state = clean(p.state, 2).toUpperCase();
  if (!clean(p.firstName, 80) || !clean(p.lastName, 80) || phone.replace(/\D/g, '').length < 10 || phone.replace(/\D/g, '').length > 11 ||
    !clean(p.address, 200) || !clean(p.city, 100) || !FOOD_STATES.includes(state) || !/^\d{5}$/.test(String(p.zip || '')) ||
    !['Front door','Side door','Garage','Other'].includes(p.placement) || (p.placement === 'Other' && !clean(p.placementOther, 200))) {
    throw new FoodAccountError('Complete your name, phone and address, including where to leave delivery bags. Pickup customers can save an address outside our service area.');
  }
  const preferred=p.fulfillmentMethod??'delivery';
  if(!['delivery','pickup'].includes(preferred))throw new FoodAccountError('Choose delivery or pickup.');
  // Keep historical order addresses immutable. Create a new primary address when the location changes.
  const prior = await db.prepare('SELECT * FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY updated_at DESC LIMIT 1').bind(account.customer_id).first();
  const same = prior && prior.line1 === clean(p.address, 200) && prior.city === clean(p.city, 100) && prior.state === state && prior.postal_code === p.zip && prior.placement_preference === p.placement && (prior.placement_other || '') === clean(p.placementOther, 200);
  const addressId = same ? prior.id : crypto.randomUUID();
  const statements = [db.prepare('UPDATE dog_food_customers SET first_name=?,last_name=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL').bind(clean(p.firstName, 80), clean(p.lastName, 80), phone, account.customer_id)];
  if (!same) {
    statements.push(db.prepare('UPDATE dog_food_addresses SET is_primary=0 WHERE customer_id=?').bind(account.customer_id));
    statements.push(db.prepare(`INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,placement_preference,placement_other,is_primary)
      VALUES (?,?,?,?,?,?,?,?,1)`).bind(addressId, account.customer_id, clean(p.address, 200), clean(p.city, 100), state, p.zip, p.placement, clean(p.placementOther, 200) || null));
  }
  statements.push(db.prepare('UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP,preferred_fulfillment=? WHERE id=? AND customer_id=?').bind(preferred,account.id,account.customer_id));
  await db.batch(statements);
  // An unavailable geocoder never loses a valid saved profile. ZIP-based route screening remains explicit.
  const saved=await db.prepare('SELECT * FROM dog_food_addresses WHERE id=? AND customer_id=?').bind(addressId,account.customer_id).first();
  const location=await locateFoodAddress(db,account,saved).catch(()=>null);
  if(location)await db.prepare('UPDATE dog_food_addresses SET latitude=?,longitude=? WHERE id=? AND customer_id=?').bind(location.latitude,location.longitude,addressId,account.customer_id).run();
  await audit(db, account, 'profile_saved', account.customer_id, { addressId, addressChanged: !same });
  return { message: same ? 'Delivery profile saved.' : 'Delivery profile saved. Existing orders and monthly plans keep their confirmed address; contact the office to move those deliveries.' };
}
export async function createFoodPortalOrder(db, account, body) {
  const token = crypto.randomUUID();
  const lock = await db.prepare(`UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+1 minute')
    WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id`).bind(token).first();
  if (!lock) throw new FoodAccountError('Another stock or order update is in progress. Please try again shortly.', 409);
  try { return await createLockedFoodOrder(db, account, body); }
  finally { await db.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(token).run(); }
}
async function createLockedFoodOrder(db, account, body) {
  if (!uuid(body.commandId)) throw new FoodAccountError('Refresh this page before ordering.');
  const quantities = new Map();
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 4) throw new FoodAccountError('Choose one to four formulas.');
  for (const i of body.items) {
    if (typeof i?.productId !== 'string' || i.productId.length > 80 || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 10 || quantities.has(i.productId)) throw new FoodAccountError('Choose a valid quantity for each formula.');
    quantities.set(i.productId, i.quantity);
  }
  if ([...quantities.values()].reduce((n, q) => n + q, 0) > 10) throw new FoodAccountError('Contact the office for orders larger than ten bags.');
  let preference;
  try { preference = foodDeliveryPreference(body); } catch(error) { throw new FoodAccountError(error.message); }
  const {deliverySpeed,cadence,monthDay,serviceWeek} = preference;
  const method=body.fulfillmentMethod??'delivery';
  if(!['delivery','pickup'].includes(method))throw new FoodAccountError('Choose delivery or pickup.');
  if(method==='pickup'&&(deliverySpeed!=='route_day'||body.plan==='subscription'&&cadence!=='fixed_day'))throw new FoodAccountError('Pickup uses no delivery fee and monthly pickup uses a calendar day.');
  const routeWeekday=body.routeWeekday==null?null:Number(body.routeWeekday);
  const tonyDate=body.tonyDate||null;
  if (body.plan === 'subscription' && body.billingConsent !== true) throw new FoodAccountError('Authorize the displayed monthly Stripe charges before checkout.');
  const requestedDate = tonyDate || (deliverySpeed === 'route_day' ? null : shiftFoodDays(easternFoodDate(),deliverySpeed === 'next_day' ? 1 : 0));
  const hash = await foodTokenHash(JSON.stringify({ items: [...quantities].sort(), plan: body.plan, cadence, monthDay, serviceWeek, deliverySpeed, requestedDate, method, routeWeekday }));
  const prior = await db.prepare('SELECT * FROM dog_food_portal_commands WHERE id=?').bind(body.commandId).first();
  if (prior) {
    if (prior.account_id !== account.id || prior.payload_hash !== hash) throw new FoodAccountError('This request reference is already in use. Refresh before ordering.', 409);
    return { orderId: prior.order_id, reused: true };
  }
  const customer = await db.prepare('SELECT * FROM dog_food_customers WHERE id=? AND deleted_at IS NULL AND status=\'active\'').bind(account.customer_id).first();
  const address = await db.prepare('SELECT * FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY updated_at DESC LIMIT 1').bind(account.customer_id).first();
  const onboarding=await db.prepare('SELECT profile_completed_at FROM dog_food_accounts WHERE id=? AND customer_id=?').bind(account.id,account.customer_id).first();
  if(!onboarding?.profile_completed_at||!foodProfileComplete(customer,address))throw new FoodAccountError('Save your delivery profile before ordering.');
  const choices=method==='delivery'?await readFoodDeliveryChoices(db,address):null;
  if(method==='delivery') {
    if(!choices.deliveryAvailable)throw new FoodAccountError('Delivery coverage cannot be confirmed. Choose pickup or contact the office for Tony delivery.',409);
    if(tonyDate) {
      if(body.plan!=='on_demand'||deliverySpeed!=='route_day'||routeWeekday!==null||!choices.tonyDates.includes(tonyDate))throw new FoodAccountError('Refresh the available one-time Tony delivery dates.',409);
    } else if(!choices.days.length||!choices.days.some(d=>d.weekday===routeWeekday))throw new FoodAccountError('Choose a recommended day from the current OPWP routes.',409);
  } else if(tonyDate||routeWeekday!==null)throw new FoodAccountError('Pickup does not use driver routes.');
  if (body.plan === 'subscription') {
    const existing = await db.prepare(`SELECT id FROM dog_food_subscriptions WHERE customer_id=? AND status IN ('active','paused','past_due') LIMIT 1`).bind(account.customer_id).first();
    const pending = await db.prepare(`SELECT id FROM dog_food_orders WHERE customer_id=? AND order_type='subscription' AND subscription_id IS NULL AND deleted_at IS NULL AND status NOT IN ('cancelled','refunded') LIMIT 1`).bind(account.customer_id).first();
    // SNG customers must be reviewed before parallel automatic billing can be enabled.
    if (existing || pending || customer.sng_client_id) throw new FoodAccountError('You may already have a monthly food plan. Contact the office to review or migrate it before enrolling in another. You can still place a one-time order.', 409);
  }
  const products = (await db.prepare(`SELECT * FROM dog_food_products WHERE id IN (${[...quantities].map(() => '?').join(',')})
    AND is_active=1 AND is_customer_visible=1 AND retail_price_cents>0`).bind(...quantities.keys()).all()).results || [];
  if (products.length !== quantities.size) throw new FoodAccountError('A selected formula is unavailable. Refresh the catalog.');
  const model = await readFoodOperations(db);
  if (model.sync?.last_error || model.sync?.dirty || !model.sync?.last_success_at || Date.now() - Date.parse(model.sync.last_success_at.replace(' ', 'T') + (model.sync.last_success_at.endsWith('Z') ? '' : 'Z')) > 3600000) throw new FoodAccountError('The inventory check is temporarily unavailable. Please try again shortly.', 503);
  for (const p of products) {
    const stock = model.products.find(s => s.websiteId === p.id);
    const queue = await db.prepare(`SELECT COALESCE(SUM(i.quantity),0) quantity FROM dog_food_order_items i JOIN dog_food_orders o ON o.id=i.order_id
      WHERE i.product_id=? AND o.deleted_at IS NULL AND o.status NOT IN ('cancelled','fulfilled','refunded')
      AND NOT EXISTS(SELECT 1 FROM dog_food_deliveries d WHERE d.order_id=o.id AND d.status='delivered')`).bind(p.id).first();
    // The operating model includes exact native lines after workflow migration.
    const queued = model.native ? 0 : Number(queue?.quantity || 0);
    if (!stock?.confirmed) throw new FoodAccountError('Opening inventory needs a verified physical count before online checkout. Contact the office.', 503);
    if (stock?.confirmed && quantities.get(p.id) > Number(stock.onHand) - Number(stock.reserved || 0) - queued) throw new FoodAccountError(`${p.color} is not available in that quantity. Contact the office for availability.`, 409);
  }
  const {subtotal,deliveryFee,tax,total} = foodCheckoutTotals(products.map(p=>({unit_price_cents:p.retail_price_cents,quantity:quantities.get(p.id)})),deliverySpeed);
  const orderId = crypto.randomUUID(), orderNumber = `EDF-${orderId.slice(0,8).toUpperCase()}`;
  const orderedItems=[...quantities].map(([productId,quantity])=>({productId,quantity}));
  await checkFoodLotReconciliation(db,model,orderedItems);
  const lotStatements=await reserveFoodLots(db,orderId,orderedItems,requestedDate||easternFoodDate());
  const requestDescription = body.plan === 'subscription' ? cadence === 'service_week' ? `Monthly week ${serviceWeek}, same day as service` : `Monthly calendar day ${monthDay}` : deliverySpeed === 'route_day' ? 'Next qualifying route day' : `${deliverySpeed === 'same_day' ? 'Same-day' : 'Next-day'} requested for ${requestedDate}`;
  const statements = [db.prepare(`INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,subtotal_cents,delivery_fee_cents,
    tax_rate_basis_points,tax_cents,total_cents,requested_delivery_speed,source,notes,placed_at,portal_account_id,billing_consent_at,delivery_cadence,requested_month_day,requested_service_week)
    VALUES (?,?,?,?,?,'pending_payment',?,?,?,?,?,?,'customer_portal',?,CURRENT_TIMESTAMP,?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,?,?,?)`).bind(orderId, orderNumber, account.customer_id, address.id, body.plan, subtotal, deliveryFee, FOOD_TAX_BASIS_POINTS, tax, total, deliverySpeed,
    method==='pickup'?'Pickup by arrangement. The office confirms location and date; no specific hours are offered. Tax origin: Lucas County, Ohio.':`Delivery request: ${requestDescription}. ${tonyDate?'Tony one-time drop-off requested.':`Preferred route weekday: ${routeWeekday}.`} Office confirmation required; requests depend on capacity and stock. Tax origin: Lucas County, Ohio.`, account.id, body.plan === 'subscription' ? 1 : 0, cadence, monthDay, serviceWeek)];
  for (const p of products) statements.push(db.prepare(`INSERT INTO dog_food_order_items(id,order_id,product_id,quantity,unit_price_cents,line_total_cents,substitution_policy)
    VALUES (?,?,?,?,?,?,'none')`).bind(crypto.randomUUID(), orderId, p.id, quantities.get(p.id), p.retail_price_cents, p.retail_price_cents * quantities.get(p.id)));
  statements.push(db.prepare('INSERT INTO dog_food_portal_commands(id,account_id,payload_hash,order_id) VALUES (?,?,?,?)').bind(body.commandId, account.id, hash, orderId));
  statements.push(...lotStatements);
  statements.push(db.prepare('UPDATE dog_food_orders SET requested_delivery_date=?,fulfillment_method=?,requested_route_weekday=?,route_source_at=? WHERE id=?').bind(requestedDate,method,routeWeekday,choices?.capturedAt||null,orderId));
  // Batch is atomic, including the unique command. A retry cannot leave orphan orders.
  await db.batch(statements);
  await audit(db, account, 'order_created', orderId, { plan: body.plan, deliverySpeed, deliveryFeeCents:deliveryFee, taxBasisPoints:FOOD_TAX_BASIS_POINTS, totalCents: total });
  return { orderId, orderNumber, totalCents: total };
}
export async function manageFoodSubscription(db, account, body) {
  if (!uuid(body.subscriptionId) || !['pause','resume','skip','cancel'].includes(body.action) || body.confirm !== true) throw new FoodAccountError('Confirm the subscription action.');
  const s = await db.prepare('SELECT * FROM dog_food_subscriptions WHERE id=? AND customer_id=?').bind(body.subscriptionId, account.customer_id).first();
  if (!s || s.payment_provider !== 'stripe') throw new FoodAccountError('This plan must be managed by the office. Existing SNG billing is not changed here.', 409);
  if (s.status === 'cancelled') throw new FoodAccountError('This plan has already been cancelled.', 409);
  let status = body.action === 'pause' ? 'paused' : body.action === 'cancel' ? 'cancelled' : s.status;
  let delivery = s.next_delivery_date, charge = s.next_charge_at;
  if (body.action === 'resume') {
    if (s.status !== 'paused' || !delivery || charge <= easternFoodDate()) throw new FoodAccountError('The office needs to confirm a new delivery date before this plan can resume.', 409);
    status = 'active';
  }
  if (body.action === 'skip') {
    if (s.status !== 'active' || !charge || charge <= easternFoodDate()) throw new FoodAccountError('This cycle may already be charging. Contact the office to change it.', 409);
    delivery = nextFoodDelivery(s); charge = shiftFoodDays(delivery, -Number(s.charge_lead_days || 2));
  }
  const changed = await db.prepare(`UPDATE dog_food_subscriptions SET status=?,next_delivery_date=?,next_charge_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND customer_id=? AND status=? AND next_delivery_date IS ?
    AND EXISTS(SELECT 1 FROM dog_food_customers c WHERE c.id=dog_food_subscriptions.customer_id AND c.status='active' AND c.deleted_at IS NULL)
    AND (billing_lease_until IS NULL OR billing_lease_until<CURRENT_TIMESTAMP) RETURNING id`).bind(status, delivery, charge, s.id, account.customer_id, s.status, s.next_delivery_date).first();
  if (!changed) throw new FoodAccountError('A payment or another update is in progress. Refresh and try again.', 409);
  await audit(db, account, `subscription_${body.action}`, s.id, { nextDelivery: delivery, nextCharge: charge });
  return { message: body.action === 'cancel' ? 'Future automatic charges cancelled. Existing paid orders are unchanged; contact the office for a refund or delivery change.' : 'Monthly plan updated. Existing orders are unchanged.' };
}
