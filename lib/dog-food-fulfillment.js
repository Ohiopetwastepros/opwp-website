import { FoodError, foodDate, integer, date, text, cents } from './dog-food-operations.mjs';
import { nextFoodDelivery, shiftFoodDays } from './dog-food-cadence.mjs';
import { readFoodOperations, writeFoodRecord, syncFoodOperations } from './dog-food-ops-store';
import { activateDogFoodSubscriptionFromOrder } from './dog-food-payments';
import { prepareFieldRelease } from './field-operations';
import { readFoodDeliveryChoices } from './dog-food-routing';
import {readFoodPlanning} from './dog-food-sales-intelligence.mjs';

export async function reserveFoodLots(db,orderId,items,deliveryDate=foodDate()) {
  const statements=[];
  for(const item of items) {
    let remaining=item.quantity;
    const lots=(await db.prepare(`SELECT l.*,l.usable_bags-COALESCE((SELECT SUM(a.quantity) FROM dog_food_lot_allocations a
      WHERE a.lot_id=l.id AND a.consumed_at IS NULL AND a.released_at IS NULL),0) available
      FROM dog_food_stock_lots l WHERE product_id=? AND best_before>=? AND quarantined=0 AND expiry_assumed=0 ORDER BY best_before,lot_number`).bind(item.productId,deliveryDate).all()).results||[];
    for(const lot of lots) {
      const q=Math.min(remaining,Number(lot.available));if(q<=0)continue;
      statements.push(db.prepare('INSERT INTO dog_food_lot_allocations(order_id,lot_id,quantity) VALUES (?,?,?)').bind(orderId,lot.id,q));
      remaining-=q;if(!remaining)break;
    }
    if(remaining)throw new FoodError('Verified, unexpired lot stock is insufficient. Reconcile physical inventory before taking payment.',409);
  }
  return statements;
}
export async function foodFulfillmentCommand(env,body,actor) {
  const db=env.DB;
  if(['pickup_ready','pickup_arrange'].includes(body.action)) {
    const orderId=text(body.orderId,100),p=await db.prepare("SELECT p.* FROM dog_food_pickups p JOIN dog_food_orders o ON o.id=p.order_id JOIN dog_food_customers c ON c.id=o.customer_id WHERE p.order_id=? AND p.status='ready' AND o.deleted_at IS NULL AND c.deleted_at IS NULL AND o.status IN ('paid','scheduled') AND EXISTS(SELECT 1 FROM dog_food_payments pay WHERE pay.order_id=o.id AND pay.status='captured')").bind(orderId).first();
    if(!p||body.confirm!==true)throw new FoodError('Choose a paid, allocated pickup and confirm the actual update.',409);
    if(body.action==='pickup_ready') {
      if(p.stage!=='preparing')throw new FoodError('This pickup is already ready or arranged.',409);
      const items=(await db.prepare('SELECT product_id productId,quantity FROM dog_food_order_items WHERE order_id=?').bind(orderId).all()).results||[];
      await checkFoodLotReconciliation(db,await readFoodOperations(db),items);
      await db.prepare("UPDATE dog_food_pickups SET stage='ready',confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND stage='preparing' AND status='ready'").bind(actor,orderId).run();
      return {message:'Food readiness confirmed. Pickup coordination notice queued; the customer has no appointment yet.'};
    }
    if(!['ready','arranged'].includes(p.stage)||!text(body.instructions,500))throw new FoodError('Confirm readiness before recording the agreed arrangement.',409);
    const arrangedDate=date(body.date);
    if(arrangedDate<foodDate()||arrangedDate>shiftFoodDays(foodDate(),90))throw new FoodError('Record an agreed pickup within the next 90 days.');
    // Allocation dates remain internal stock/capacity commitments. An arrangement
    // cannot silently move the reservation or outlive its validated stock.
    if(arrangedDate!==p.scheduled_date)throw new FoodError('The agreed date differs from the stock/capacity reservation. The office must reallocate capacity before confirming this date.',409);
    await db.prepare("UPDATE dog_food_pickups SET stage='arranged',arrangement_note=?,confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='ready'").bind(text(body.instructions,500),actor,orderId).run();
    await activateDogFoodSubscriptionFromOrder({db,orderId});
    return {message:'Agreed pickup recorded. Details are visible only in this customer’s account.'};
  }
  if(body.action==='pickup_complete') {
    if(body.confirm!==true||!text(body.receivedBy,100))throw new FoodError('Confirm the actual bag handoff and who received the bags.');
    const orderId=text(body.orderId,100),pickup=await db.prepare("SELECT p.*,o.customer_id FROM dog_food_pickups p JOIN dog_food_orders o ON o.id=p.order_id JOIN dog_food_customers c ON c.id=o.customer_id WHERE p.order_id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL").bind(orderId).first();
    if(!pickup||pickup.status!=='ready'||pickup.stage!=='arranged'||pickup.scheduled_date>foodDate())throw new FoodError('Choose an arranged, paid pickup scheduled for today or earlier.',409);
    const items=(await db.prepare('SELECT product_id productId,quantity FROM dog_food_order_items WHERE order_id=?').bind(orderId).all()).results||[];
    await checkFoodLotReconciliation(db,await readFoodOperations(db),items);
    const unusable=await db.prepare('SELECT l.id FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=? AND a.consumed_at IS NULL AND a.released_at IS NULL AND (l.best_before<? OR l.quarantined=1 OR l.expiry_assumed=1) LIMIT 1').bind(orderId,foodDate()).first();
    if(unusable)throw new FoodError('Allocated pickup stock is no longer sellable. Review and reallocate before handoff.',409);
    await db.prepare("UPDATE dog_food_pickups SET status='collected',collected_at=strftime('%Y-%m-%d %H:%M:%f','now'),collected_by=?,received_by=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='ready'").bind(actor,text(body.receivedBy,100),orderId).run();
    return {message:'Actual pickup recorded; allocated bags consumed once and customer history updated.'};
  }
  if(body.action==='pickup_capacity') {
    if(body.confirm!==true||!text(body.instructions,500))throw new FoodError('Confirm pickup availability and enter the agreed location/contact instructions.');
    const day=date(body.date);if(day<foodDate()||day>shiftFoodDays(foodDate(),90))throw new FoodError('Capacity must be within the next 90 days.');
    const bagLimit=integer(body.bagLimit,'bag capacity',1,100),stopLimit=integer(body.stopLimit,'pickup capacity',1,50);
    const prior=await db.prepare(`SELECT COALESCE(SUM(a.bags),0) bags,COUNT(a.order_id) stops FROM dog_food_delivery_capacity s LEFT JOIN dog_food_capacity_allocations a ON a.slot_id=s.id AND a.released_at IS NULL WHERE s.service_date=? AND s.technician_id='office-pickup'`).bind(day).first();
    if(prior.bags>bagLimit||prior.stops>stopLimit)throw new FoodError('Capacity is below already confirmed pickups.',409);
    await db.prepare(`INSERT INTO dog_food_delivery_capacity(id,service_date,technician_id,technician_name,postal_code,bag_limit,stop_limit,route_id,confirmed_by,fulfillment_method,pickup_instructions)
      VALUES (?,?,'office-pickup','Office pickup','00000',?,?,?,?, 'pickup',?) ON CONFLICT(service_date,technician_id,postal_code) DO UPDATE SET bag_limit=excluded.bag_limit,stop_limit=excluded.stop_limit,pickup_instructions=excluded.pickup_instructions,confirmed_by=excluded.confirmed_by,enabled=1`)
      .bind(crypto.randomUUID(),day,bagLimit,stopLimit,`food-pickup-${day}`,actor,text(body.instructions,500)).run();
    return {message:'Pickup availability saved. The office arranges the handoff; no public hours are posted.'};
  }
  if(body.action==='finalize_count') {
    if(body.confirm!==true)throw new FoodError('Confirm all usable lots for this formula were counted and reconciled.');
    const productId=text(body.productId,100),product=await db.prepare('SELECT airtable_record_id FROM dog_food_products WHERE id=? AND is_active=1').bind(productId).first();
    if(!product?.airtable_record_id)throw new FoodError('An exact shared-stock formula is required.',409);
    const lots=(await db.prepare('SELECT usable_bags,counted_date FROM dog_food_stock_lots WHERE product_id=? AND quarantined=0 AND expiry_assumed=0 AND best_before>=?').bind(productId,foodDate()).all()).results||[];
    if(!lots.length||lots.some(l=>l.usable_bags>0&&l.counted_date!==foodDate()))throw new FoodError('Count every remaining usable lot today before confirming the formula total.',409);
    const at=new Date().toISOString(),total=lots.reduce((n,l)=>n+Number(l.usable_bags),0);
    await writeFoodRecord(env,'Inventory Adjustments',{'Adjustment ID':`COUNT-${crypto.randomUUID().slice(0,8)}`,Product:[product.airtable_record_id],
      'Movement Type':'Stock Count','Counted Quantity':total,'Quantity Change':0,'Movement Date':foodDate(),
      'Counted At (Website)':at,Reason:`Actual full usable formula count confirmed by ${actor}; all lots counted.`, 'Record Status':'Active'});
    await syncFoodOperations(env,{force:true});
    const model=await readFoodOperations(db);
    await checkFoodLotReconciliation(db,model,[{productId}]);
    return {message:'Actual formula count saved with its exact cutoff and read back from shared stock.'};
  }
  if(body.action==='capacity_slot') {
    if(body.confirm!==true)throw new FoodError('Confirm spare delivery capacity and technician availability.');
    const day=date(body.date);if(day<foodDate()||day>shiftFoodDays(foodDate(),90))throw new FoodError('Capacity must be within the next 90 days.');
    const member=await db.prepare("SELECT external_employee_id,display_name FROM route_partner_members WHERE id=? AND organization_id='org-opwp' AND status='active' AND role='technician'").bind(text(body.memberId,100)).first();
    if(!member?.external_employee_id||!(/^(Tony|Craig)\b/i.test(member.display_name||'')))throw new FoodError('Choose a confirmed OPWP technician account.',409);
    const zip=text(body.zip,5);if(!/^\d{5}$/.test(zip))throw new FoodError('Choose an exact five-digit delivery ZIP.');
    const bagLimit=integer(body.bagLimit,'bag capacity',1,100),stopLimit=integer(body.stopLimit,'stop capacity',1,50);
    const committed=await db.prepare(`SELECT COALESCE(SUM(a.bags),0) bags,COUNT(a.order_id) stops FROM dog_food_delivery_capacity s
      LEFT JOIN dog_food_capacity_allocations a ON a.slot_id=s.id AND a.released_at IS NULL WHERE s.service_date=? AND s.technician_id=? AND s.postal_code=?`).bind(day,member.external_employee_id,zip).first();
    if(committed.bags>bagLimit||committed.stops>stopLimit)throw new FoodError('Capacity is below assigned work. Review those orders before reducing it.',409);
    const requestedRoute=text(body.routePlanId,150);
    const actualRoutes=(await db.prepare("SELECT id FROM route_partner_route_plans WHERE organization_id='org-opwp' AND service_date=? AND technician_external_id=? AND status='draft' AND source_provider<>'dog_food_automation' AND (?='' OR id=?) LIMIT 2").bind(day,member.external_employee_id,requestedRoute,requestedRoute).all()).results||[];
    if(requestedRoute&&actualRoutes.length!==1||actualRoutes.length>1)throw new FoodError('Choose one unreleased OPWP route for this technician and date.',409);
    const routeId=actualRoutes[0]?.id||`food-${member.external_employee_id}-${day}`;
    const previousSlot=await db.prepare('SELECT route_id FROM dog_food_delivery_capacity WHERE service_date=? AND technician_id=? AND postal_code=?').bind(day,member.external_employee_id,zip).first();
    if(committed.stops&&previousSlot?.route_id!==routeId)throw new FoodError('Assigned food work cannot be moved by changing its capacity slot.',409);
    const id=crypto.randomUUID();
    await db.prepare(`INSERT INTO dog_food_delivery_capacity(id,service_date,technician_id,technician_name,postal_code,bag_limit,stop_limit,route_id,confirmed_by)
      VALUES (?,?,?,?,?,?,?, ?,?) ON CONFLICT(service_date,technician_id,postal_code) DO UPDATE SET bag_limit=excluded.bag_limit,stop_limit=excluded.stop_limit,route_id=excluded.route_id,confirmed_by=excluded.confirmed_by,enabled=1`)
      .bind(id,day,member.external_employee_id,member.display_name,zip,bagLimit,stopLimit,routeId,actor).run();
    return {message:'Confirmed spare capacity saved. Existing scooping assignments and workloads are preserved.'};
  }
  if(body.action==='lot_count') {
    if(body.confirm!==true)throw new FoodError('Confirm the physical usable lot count.');
    const productId=text(body.productId,100),lot=text(body.lot,100),bestBefore=date(body.bestBefore),countDate=date(body.date),quantity=integer(body.quantity,'usable lot count',0,10000);
    if(!lot||countDate!==foodDate()||!await db.prepare('SELECT id FROM dog_food_products WHERE id=? AND is_active=1').bind(productId).first())throw new FoodError('Enter today\'s physical count, an active formula and an actual lot. Expired and quarantined bags remain excluded from sellable stock.');
    const prior=await db.prepare('SELECT id FROM dog_food_stock_lots WHERE product_id=? AND lot_number=? AND best_before=?').bind(productId,lot,bestBefore).first();
    const quarantined=body.quarantined===true||body.quarantined==='1',assumed=body.expiryAssumed===true||body.expiryAssumed==='1';
    const purchaseDate=date(body.purchaseDate,false)||null,receivedDate=date(body.receivedDate,false)||null;
    if(purchaseDate&&purchaseDate>countDate||receivedDate&&receivedDate>countDate||purchaseDate&&receivedDate&&purchaseDate>receivedDate)throw new FoodError('Purchase and receipt dates must be past and in order.');
    if(prior) {
      const reserved=await db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM dog_food_lot_allocations WHERE lot_id=? AND consumed_at IS NULL AND released_at IS NULL').bind(prior.id).first();
      if(quantity<reserved.quantity||reserved.quantity>0&&(quarantined||assumed))throw new FoodError('Count or quarantine conflicts with allocated bags. Review affected orders first.',409);
    }
    await db.prepare(`INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by,supplier,purchase_date,received_date,unit_cost_cents,source_reference,quarantined,expiry_assumed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(product_id,lot_number,best_before) DO UPDATE SET usable_bags=excluded.usable_bags,counted_date=excluded.counted_date,confirmed_by=excluded.confirmed_by,
      supplier=COALESCE(excluded.supplier,supplier),purchase_date=COALESCE(excluded.purchase_date,purchase_date),received_date=COALESCE(excluded.received_date,received_date),
      unit_cost_cents=COALESCE(excluded.unit_cost_cents,unit_cost_cents),source_reference=COALESCE(excluded.source_reference,source_reference),quarantined=excluded.quarantined,expiry_assumed=excluded.expiry_assumed`)
      .bind(prior?.id||crypto.randomUUID(),productId,lot,bestBefore,quantity,countDate,actor,text(body.supplier,200)||null,purchaseDate,receivedDate,body.cost==null||body.cost===''?null:cents(body.cost,'lot acquisition cost'),text(body.sourceReference,300)||null,quarantined?1:0,assumed?1:0).run();
    return {message:'Lot count saved. Also reconcile the shared Airtable formula count before releasing orders.'};
  }
  throw new FoodError('Choose a valid fulfillment command.');
}
export async function checkFoodLotReconciliation(db,model,items) {
  for(const item of items) {
    const stock=model.products.find(p=>p.websiteId===item.productId);
    const lots=await db.prepare('SELECT COALESCE(SUM(usable_bags),0) quantity FROM dog_food_stock_lots WHERE product_id=? AND quarantined=0 AND expiry_assumed=0 AND best_before>=?').bind(item.productId,foodDate()).first();
    if(!stock?.confirmed||stock.onHand!==Number(lots.quantity))throw new FoodError('Shared stock and physical lot counts need reconciliation.',409);
  }
}
export async function createFoodFieldTask(db,order,slot,deliveryId) {
  const linked=await db.prepare("SELECT id,status,technician_external_id,service_date FROM route_partner_route_plans WHERE id=? AND organization_id='org-opwp'").bind(slot.route_id).first();
  if(linked&&(linked.technician_external_id!==slot.technician_id||linked.service_date!==slot.service_date))throw new FoodError('Food capacity does not match the actual dated technician route.',409);
  const planId=linked?.id||`food-plan:${slot.technician_id}:${slot.service_date}`;
  const prior=await db.prepare('SELECT status FROM route_partner_route_plans WHERE id=?').bind(planId).first();
  if(prior&&prior.status!=='draft')throw new FoodError('The delivery route is already released. Office review is required.',409);
  const address=await db.prepare('SELECT * FROM dog_food_addresses WHERE id=? AND customer_id=?').bind(order.address_id,order.customer_id).first();
  const customer=await db.prepare('SELECT first_name,last_name FROM dog_food_customers WHERE id=?').bind(order.customer_id).first();
  const existing=await db.prepare('SELECT id FROM route_partner_tasks WHERE dog_food_delivery_id=? AND status<>\'cancelled\' LIMIT 1').bind(deliveryId).first();
  if(existing)return;
  const policy=await readFoodPlanning(db);
  if(policy.routeMode==='review')throw new FoodError('Office route addition approval is required.',409);
  const fullAddress=[address.line1,address.city,address.state,address.postal_code].join(', '),normal=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const candidates=linked?(await db.prepare("SELECT id,address FROM route_partner_locations WHERE route_plan_id=? AND organization_id='org-opwp' AND arrival_status='pending' LIMIT 501").bind(planId).all()).results||[]:[];
  if(candidates.length>500)throw new FoodError('The route exceeds the reviewed stop bound.',503);
  const matches=candidates.filter(l=>normal(l.address)===normal(fullAddress));
  if(matches.length>1)throw new FoodError('Duplicate route addresses require office review.',409);
  const shared=matches[0];if(!shared&&policy.routeMode==='existing')throw new FoodError('This delivery requires an existing actual scooping stop.',409);
  const minutes=shared?policy.existingStopMinutes:policy.foodStopMinutes;
  if(minutes==null)throw new FoodError('Confirm food stop service time before scheduling.',409);
  const locationId=shared?.id||`food-stop:${deliveryId}`,taskId=`food-task:${deliveryId}`;
  const attached=shared?await db.prepare("SELECT COALESCE(SUM(estimated_minutes),0) minutes FROM route_partner_tasks WHERE location_id=? AND source_provider='dog_food_automation' AND status<>'cancelled'").bind(locationId).first():null;
  const additionalMinutes=shared?Math.max(0,minutes-Number(attached?.minutes||0)):minutes;
  const seq=await db.prepare('SELECT COALESCE(MAX(sequence),0)+1 sequence FROM route_partner_locations WHERE route_plan_id=?').bind(planId).first();
  const summary=(await db.prepare('SELECT p.formula_code,p.color,p.bag_weight_lb,i.quantity FROM dog_food_order_items i JOIN dog_food_products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY p.formula_code').bind(order.id).all()).results.map(i=>`${i.quantity} x ${i.formula_code} ${i.color} ${i.bag_weight_lb} lb`).join('; ');
  const statements=[
    db.prepare(`INSERT OR IGNORE INTO route_partner_route_plans(id,organization_id,service_date,technician_external_id,technician_name,source_provider,source_route_id,source_fingerprint,version,status,imported_by)
      VALUES (?,'org-opwp',?,?,?,'dog_food_automation',?,'confirmed-capacity',1,'draft','dog-food-automation')`).bind(planId,slot.service_date,slot.technician_id,slot.technician_name,slot.route_id),
    shared?db.prepare("UPDATE route_partner_locations SET estimated_service_minutes=estimated_service_minutes+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND route_plan_id=? AND organization_id='org-opwp'").bind(additionalMinutes,locationId,planId):db.prepare(`INSERT INTO route_partner_locations(id,route_plan_id,organization_id,location_key,sequence,address,latitude,longitude,customer_display_name,estimated_service_minutes)
      VALUES (?,?,'org-opwp',?,?,?,?,?,?,?)`).bind(locationId,planId,locationId,seq.sequence,fullAddress,address.latitude,address.longitude,`${customer.first_name} ${customer.last_name}`,minutes),
    db.prepare(`INSERT INTO route_partner_tasks(id,route_plan_id,location_id,organization_id,task_type,source_provider,external_task_id,dog_food_delivery_id,customer_display_name,status,placement_note,product_summary,estimated_minutes)
      VALUES (?,?,?,'org-opwp','dog_food','dog_food_automation',?,?,?,'scheduled',?,?,?)`).bind(taskId,planId,locationId,deliveryId,deliveryId,`${customer.first_name} ${customer.last_name}`,address.placement_other||address.placement_preference,summary,additionalMinutes),
    db.prepare("UPDATE route_partner_route_plans SET food_task_count=food_task_count+1,location_count=location_count+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id='org-opwp'").bind(shared?0:1,planId),
  ];
  await db.batch(statements);
}
export async function scheduleFoodOrders(env) {
  const db=env.DB,settings=await db.prepare("SELECT scheduling_enabled FROM dog_food_workflow_settings WHERE id='org-opwp'").first();
  if(!settings?.scheduling_enabled)return {skipped:true,reason:'scheduling_disabled'};
  const model=await readFoodOperations(db);
  if(model.sync.dirty||model.sync.last_error)return {skipped:true,reason:'inventory_sync_pending'};
  const orders=(await db.prepare(`SELECT o.*,a.postal_code FROM dog_food_orders o JOIN dog_food_addresses a ON a.id=o.address_id JOIN dog_food_customers c ON c.id=o.customer_id
    WHERE o.status IN ('paid','scheduled') AND o.deleted_at IS NULL AND c.deleted_at IS NULL AND o.source IN ('customer_portal','subscription_renewal')
    AND NOT EXISTS(SELECT 1 FROM dog_food_deliveries d JOIN route_partner_tasks t ON t.dog_food_delivery_id=d.id WHERE d.order_id=o.id AND t.status<>'cancelled')
    AND NOT EXISTS(SELECT 1 FROM dog_food_pickups p WHERE p.order_id=o.id AND p.status IN ('ready','collected'))
    ORDER BY o.requested_delivery_speed='same_day' DESC,o.created_at LIMIT 20`).all()).results||[];
  const results=[];
  for(const order of orders) {
    try {
      const items=(await db.prepare('SELECT product_id productId,quantity FROM dog_food_order_items WHERE order_id=?').bind(order.id).all()).results||[];
      await checkFoodLotReconciliation(db,model,items);
      const method=order.fulfillment_method||'delivery';
      if(method==='delivery'&&order.requested_route_weekday) {
        const address=await db.prepare('SELECT * FROM dog_food_addresses WHERE id=? AND customer_id=?').bind(order.address_id,order.customer_id).first();
        const current=await readFoodDeliveryChoices(db,address);
        if(!current.days.some(d=>d.weekday===order.requested_route_weekday))throw new FoodError('The requested OPWP route changed or is unavailable. Office review required.',409);
      }
      const allSlots=(await db.prepare(`SELECT s.* FROM dog_food_delivery_capacity s WHERE s.enabled=1 AND s.fulfillment_method=? AND s.postal_code=? AND s.service_date>=? AND s.service_date<=?
        AND (SELECT COALESCE(SUM(bags),0) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL AND order_id<>?)+?<=s.bag_limit
        AND (SELECT COUNT(*) FROM dog_food_capacity_allocations WHERE slot_id=s.id AND released_at IS NULL AND order_id<>?)<s.stop_limit ORDER BY s.service_date,s.technician_id LIMIT 90`)
        .bind(method,method==='pickup'?'00000':order.postal_code,foodDate(),shiftFoodDays(foodDate(),31),order.id,items.reduce((n,i)=>n+i.quantity,0),order.id).all()).results||[];
      const committed=await db.prepare('SELECT slot_id FROM dog_food_capacity_allocations WHERE order_id=? AND released_at IS NULL').bind(order.id).first();
      const desired=order.billing_cycle_key||order.requested_delivery_date;
      const slot=allSlots.find(s=> {
        if(committed&&s.id!==committed.slot_id)return false;
        if(desired&&s.service_date!==desired)return false;
        if(method==='delivery'&&order.requested_delivery_speed==='route_day'&&order.requested_route_weekday&&order.delivery_cadence!=='fixed_day'&&new Date(s.service_date+'T12:00:00Z').getUTCDay()!==order.requested_route_weekday)return false;
        if(method==='delivery'&&order.source==='customer_portal'&&desired&&order.requested_delivery_speed==='route_day'&&!order.requested_route_weekday&&!/^Tony\b/i.test(s.technician_name))return false;
        if(order.order_type==='subscription'&&!order.billing_cycle_key) {
          const d=Number(s.service_date.slice(8));
          if(order.delivery_cadence==='fixed_day'&&d!==Math.min(order.requested_month_day,new Date(Date.UTC(Number(s.service_date.slice(0,4)),Number(s.service_date.slice(5,7)),0)).getUTCDate()))return false;
          if(order.delivery_cadence==='service_week'&&Math.ceil(d/7)!==order.requested_service_week)return false;
        }
        return true;
      });
      if(!slot)throw new FoodError('No confirmed capacity in the requested delivery area/date. Office review required.',409);
      const allocated=await db.prepare('SELECT lot_id FROM dog_food_lot_allocations WHERE order_id=? AND released_at IS NULL LIMIT 1').bind(order.id).first();
      const lotStatements=allocated?[]:await reserveFoodLots(db,order.id,items,slot.service_date);
      const expired=await db.prepare('SELECT l.id FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=? AND (l.best_before<? OR l.quarantined=1 OR l.expiry_assumed=1) LIMIT 1').bind(order.id,slot.service_date).first();
      if(expired)throw new FoodError('Allocated stock expires before delivery. Reallocate through the office.',409);
      const priorDelivery=await db.prepare('SELECT id FROM dog_food_deliveries WHERE order_id=?').bind(order.id).first();
      const deliveryId=priorDelivery?.id||crypto.randomUUID();
      if(method==='pickup') {
        await db.batch([
          ...lotStatements,
          db.prepare('INSERT INTO dog_food_capacity_allocations(order_id,slot_id,bags) VALUES (?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(order.id,slot.id,items.reduce((n,i)=>n+i.quantity,0)),
          db.prepare('INSERT INTO dog_food_pickups(order_id,scheduled_date,instructions,confirmed_by) VALUES (?,?,?,?)').bind(order.id,slot.service_date,slot.pickup_instructions,slot.confirmed_by),
          db.prepare("UPDATE dog_food_orders SET status='scheduled',automation_review=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('paid','scheduled')").bind(order.id),
        ]);
        results.push({orderId:order.id,status:'pickup_preparing',date:slot.service_date});continue;
      }
      await db.batch([
        ...lotStatements,
        db.prepare('INSERT INTO dog_food_capacity_allocations(order_id,slot_id,bags) VALUES (?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(order.id,slot.id,items.reduce((n,i)=>n+i.quantity,0)),
        db.prepare(`INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type,status,technician_id,route_id,placement_note)
          VALUES (?,?,?,?,?,'on_demand','assigned',?,?,(SELECT COALESCE(placement_other,placement_preference) FROM dog_food_addresses WHERE id=?))
          ON CONFLICT(order_id) DO UPDATE SET scheduled_date=excluded.scheduled_date,technician_id=excluded.technician_id,route_id=excluded.route_id,status='assigned' WHERE status='scheduled'`)
          .bind(deliveryId,order.id,order.customer_id,order.address_id,slot.service_date,slot.technician_id,slot.route_id,order.address_id),
        db.prepare("UPDATE dog_food_orders SET status='scheduled',automation_review=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('paid','scheduled')").bind(order.id),
      ]);
      await createFoodFieldTask(db,order,slot,deliveryId);
      await activateDogFoodSubscriptionFromOrder({db,orderId:order.id});
      results.push({orderId:order.id,status:'assigned',date:slot.service_date});
    }catch(error) {await db.prepare('UPDATE dog_food_orders SET automation_review=? WHERE id=?').bind(String(error.message).slice(0,300),order.id).run();results.push({orderId:order.id,status:'review'});}
  }
  // Dedicated food plans consume only owner-confirmed spare capacity. Their
  // release still uses the existing load, technician and payment checks.
  const plans=(await db.prepare("SELECT id FROM route_partner_route_plans WHERE source_provider='dog_food_automation' AND status='draft' AND service_date=? LIMIT 4").bind(foodDate()).all()).results||[];
  for(const p of plans) {
    await db.prepare("UPDATE route_partner_route_plans SET status='finalized',finalized_at=CURRENT_TIMESTAMP,finalized_by='dog-food-capacity-approval' WHERE id=? AND status='draft'").bind(p.id).run();
    try{await prepareFieldRelease(db,p.id);}catch(error){await db.prepare("UPDATE route_partner_route_plans SET status='draft' WHERE id=? AND status='finalized'").bind(p.id).run();}
  }
  return {results};
}
