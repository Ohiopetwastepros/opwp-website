import {FoodError, foodDate, date, integer, text} from './dog-food-operations.mjs';
import {foodCheckoutTotals, FOOD_TAX_BASIS_POINTS} from './dog-food-checkout.mjs';
import {foodSaleIntake} from './food-sale-intake.mjs';
import {foodStaffCustomerComplete} from './food-customer-intake.mjs';
import {foodProfileComplete} from './dog-food-profile.mjs';
import {assertFoodWritesAvailable} from './dog-food-website-store.mjs';

export const salesUuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value || '');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export async function salesHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function foodSalesPolicy(db) {
  const policy=await db.prepare("SELECT enabled,pricing_policy,sng_enabled,stock_basis FROM dog_food_sales_settings WHERE id='org-opwp'").first();
  if(!policy?.enabled || policy.pricing_policy!=='catalog_lucas_775') throw new FoodError('Food sales are awaiting office rollout and pricing approval.',503);
  return policy;
}
export async function foodSalesOrder(db,id) {
  const order=await db.prepare(`SELECT o.*,m.recorded_by,m.billing_provider,
    COALESCE((SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0) received_cents,
    COALESCE((SELECT SUM(refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0) refunded_cents,
    COALESCE(d.status,CASE WHEN p.status='collected' THEN 'delivered' ELSE 'pending' END) handoff_status,
    c.first_name,c.last_name FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id
    LEFT JOIN dog_food_sales_order_metadata m ON m.order_id=o.id LEFT JOIN dog_food_deliveries d ON d.order_id=o.id
    LEFT JOIN dog_food_pickups p ON p.order_id=o.id WHERE o.id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL`).bind(id).first();
  if(!order)throw new FoodError('Order not found.',404);
  const credit=order.source==='staff_sales'?order.refunded_cents:0;
  return {...order,balance_cents:Math.max(0,order.total_cents-order.received_cents-credit),payment_status:credit>0?'refunded':order.received_cents>=order.total_cents?'paid':order.received_cents>0?'partial':'unpaid'};
}
const audit = (db,actor,action,id,details) => db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,id,JSON.stringify(details));
export function receiptStatements(db,{orderId,id=crypto.randomUUID(),amountCents,method,reference='',receivedAt,actor,eventId=null,evidence={}}) {
  integer(amountCents,'amount received',1,100000000);
  if(!['cash','check','venmo','zelle','paypal','card','sweep_and_go'].includes(method))throw new FoodError('Choose the actual payment method.');
  if(method!=='cash'&&!text(reference,160))throw new FoodError('A check or transaction reference is required. Do not enter card numbers.');
  if(method==='card'&&/^[\d -]+$/.test(String(reference))&&String(reference).replace(/\D/g,'').length>=13&&String(reference).replace(/\D/g,'').length<=19)throw new FoodError('Use the processor transaction reference, never the card number.');
  const provider=method==='sweep_and_go'?'sng_verified':`staff_${method}`;
  // Noncash references are unique across orders; cash uses the persistent command-derived payment ID.
  const key=method==='cash'?`staff_cash:${id}`:`${provider}:${text(reference,160)}`;
  return {id,statements:[
    db.prepare(`INSERT INTO dog_food_payments(id,order_id,provider,provider_transaction_id,idempotency_key,amount_cents,status,processed_at)
      VALUES(?,?,?,?,?,?,'captured',?)`).bind(id,orderId,provider,text(reference,160)||id,key,amountCents,receivedAt),
    db.prepare('INSERT INTO dog_food_sales_payment_evidence(payment_id,actor,method,reference,received_at,source_event_id,evidence) VALUES(?,?,?,?,?,?,?)').bind(id,actor,method,text(reference,160),receivedAt,eventId,JSON.stringify(evidence)),
    db.prepare(`UPDATE dog_food_orders SET status=CASE WHEN status='fulfilled' THEN status
      WHEN (SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=? AND status IN('captured','refunded'))>=total_cents THEN 'paid'
      ELSE 'pending_payment' END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(orderId,orderId),
  ]};
}
export function createFoodSalesService({readFoodOperations,reserveFoodLots,checkFoodLotReconciliation}) {
  const stockFor=(model,id)=>{const matches=model.products.filter(p=>p.websiteId===id);return matches.length===1?matches[0]:null;};
  async function quote(db,body) {
    const policy=await foodSalesPolicy(db),items=body.items;
    if(!Array.isArray(items)||!items.length||items.length>4)throw new FoodError('Choose one to four formulas.');
    const seen=new Set(),lines=[];
    for(const i of items) {
      if(!i||seen.has(i.productId)||typeof i.productId!=='string'||i.productId.length>80)throw new FoodError('Choose each formula once.');
      seen.add(i.productId);const quantity=integer(i.quantity,'bag quantity',1,100);
      const p=await db.prepare('SELECT id,name,color,formula_code,bag_weight_lb,retail_price_cents FROM dog_food_products WHERE id=? AND is_active=1 AND retail_price_cents>0').bind(i.productId).first();
      if(!p)throw new FoodError('Formula unavailable.',409);
      lines.push({...p,productId:p.id,quantity,unit_price_cents:p.retail_price_cents});
    }
    if(lines.reduce((n,i)=>n+i.quantity,0)>100)throw new FoodError('Contact the office for sales above 100 bags.');
    const totals=foodCheckoutTotals(lines);
    return {items:lines,...totals,taxBasisPoints:FOOD_TAX_BASIS_POINTS,policy:policy.pricing_policy,quoteHash:await salesHash({items:lines.map(i=>[i.id,i.quantity,i.unit_price_cents]).sort(),...totals,policy:policy.pricing_policy})};
  }
  async function replay(db,body,actor,hash) {
    const prior=await db.prepare('SELECT actor,payload_hash,result FROM dog_food_sales_commands WHERE id=?').bind(body.commandId).first();
    if(!prior)return null;
    if(prior.actor!==actor||prior.payload_hash!==hash)throw new FoodError('This submission ID belongs to different content or another account.',409);
    return JSON.parse(prior.result);
  }
  async function handoff(db,order,body,actor) {
    if(body.handoffConfirmed!==true||!text(body.receivedBy,120))throw new FoodError('Confirm the physical handoff and recipient.');
    if(order.handoff_status==='delivered'||['cancelled','refunded'].includes(order.status))throw new FoodError('This order requires an office review.',409);
    const rows=(await db.prepare(`SELECT i.product_id,i.quantity,COALESCE((SELECT SUM(a.quantity) FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id
      WHERE a.order_id=i.order_id AND l.product_id=i.product_id AND a.consumed_at IS NULL AND a.released_at IS NULL
      AND l.best_before>=? AND l.quarantined=0 AND l.expiry_assumed=0),0) allocated FROM dog_food_order_items i WHERE i.order_id=?`).bind(foodDate(),order.id).all()).results||[];
    const basis=await db.prepare('SELECT stock_basis FROM dog_food_sales_order_metadata WHERE order_id=?').bind(order.id).first(),countGuards=[];
    if(basis?.stock_basis==='confirmed_count') {
      const model=await readFoodOperations(db);
      for(const row of rows){
        const allocated=await db.prepare('SELECT quantity FROM dog_food_sales_count_allocations WHERE order_id=? AND product_id=?').bind(order.id,row.product_id).first();
        const stock=stockFor(model,row.product_id);
        if(!stock?.confirmed||stock.onHand<stock.reserved||allocated?.quantity!==row.quantity)throw new FoodError('Shared inventory needs reconciliation before this handoff.',409);
      }
      if(!rows.length)throw new FoodError('Order has no allocated bags.',409);
      const guard=crypto.randomUUID();
      countGuards.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_ops_state WHERE id='org-opwp' AND snapshot_id=?) THEN 1 ELSE 0 END)").bind(guard,model.sync.snapshot_id),db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard));
    } else if(!rows.length||rows.some(i=>i.quantity!==i.allocated))throw new FoodError('Reconcile unexpired allocated stock before handoff.',409);
    const at=new Date().toISOString().replace('T',' ').replace('Z','');
    const statements=[...countGuards,db.prepare('INSERT INTO dog_food_sales_handoffs(order_id,actor,received_by,method,completed_at,local_date,note) VALUES(?,?,?,?,?,?,?)').bind(order.id,actor,text(body.receivedBy,120),order.fulfillment_method,at,foodDate(),text(body.handoffNote,500))];
    if(order.fulfillment_method==='pickup')statements.push(db.prepare("UPDATE dog_food_pickups SET stage='arranged' WHERE order_id=? AND status='ready'").bind(order.id),db.prepare("UPDATE dog_food_pickups SET status='collected',collected_at=?,collected_by=?,received_by=? WHERE order_id=? AND status='ready'").bind(at,actor,text(body.receivedBy,120),order.id));
    else statements.push(db.prepare("UPDATE dog_food_deliveries SET status='delivered',delivered_at=?,placement_note=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='scheduled'").bind(at,text(body.handoffNote,500),order.id));
    return statements;
  }
  async function command(db,body,actor,{office=false}={}) {
    await assertFoodWritesAvailable(db);
    if(!salesUuid(body.commandId)||!actor)throw new FoodError('A persistent submission ID and signed-in account are required.');
    const hash=await salesHash(body),prior=await replay(db,body,actor,hash);if(prior)return prior;
    const policy=await foodSalesPolicy(db);
    const token=crypto.randomUUID();
    const lock=await db.prepare(`UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+2 minutes')
      WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id`).bind(token).first();
    if(!lock)throw new FoodError('Another inventory update is in progress. Retry this same submission.',409);
    try {
      const again=await replay(db,body,actor,hash);if(again)return again;
      const statements=[db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(
        SELECT 1 FROM dog_food_ops_state WHERE id='org-opwp' AND command_token=? AND command_until>CURRENT_TIMESTAMP) THEN 1 ELSE 0 END)`).bind(token,token)];
      let result;
      if(body.action==='save') {
        const priced=await quote(db,body);
        if(body.quoteHash!==priced.quoteHash)throw new FoodError('Prices changed or were not confirmed. Review the current total.',409);
        const method=body.fulfillmentMethod;
        if(!['pickup','delivery'].includes(method)||!['pending','completed'].includes(body.fulfillmentStatus))throw new FoodError('Choose pickup or delivery and actual handoff status.');
        if(!['manual','sweep_and_go'].includes(body.billingProvider))throw new FoodError('Choose who will collect the balance.');
        const today=foodDate(),scheduled=date(body.scheduledDate||today);
        if(scheduled<today)throw new FoodError('Use historical reconciliation for past sales.');
        if(body.fulfillmentStatus==='completed'&&scheduled!==today)throw new FoodError('Completed handoffs must be recorded today.');
        const amount=integer(body.amountReceivedCents??0,'amount received',0,priced.total);
        if(amount>0&&body.paymentReceivedConfirmed!==true)throw new FoodError('Confirm that money was actually received.');
        let customerId=body.customerId,customer;
        const newCustomer=body.newCustomer;
        if(newCustomer)throw new FoodError('Submit the complete customer form before recording the sale.');
        if(!customerId)throw new FoodError('Select a saved customer, or submit the new customer form first.');
        customer=await db.prepare("SELECT id,first_name,last_name,email,phone,customer_type FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL").bind(customerId).first();
        if(!customer)throw new FoodError('Customer not found.',404);
        const intake=foodSaleIntake(body,{total:priced.total,amount,customerType:customer.customer_type});
        if(body.intakeVersion===2){
          const primary=await db.prepare('SELECT * FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY updated_at DESC LIMIT 1').bind(customerId).first();
          if(!foodStaffCustomerComplete(customer,primary,method))throw new FoodError('Complete the customer name, phone, address and handoff instructions before saving this sale.',409);
        }
        if((body.intakeVersion===2||body.paymentMethod!==undefined)&&!['cash','check','venmo','zelle','paypal','card'].includes(body.paymentMethod))throw new FoodError('Choose the actual payment method.');
        let address;
        if(method==='delivery') {
          if(body.addressId)address=await db.prepare('SELECT id,line1,city,state,postal_code FROM dog_food_addresses WHERE id=? AND customer_id=?').bind(body.addressId,customerId).first();
          else if(customer)address=await db.prepare('SELECT id,line1,city,state,postal_code FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY updated_at DESC LIMIT 1').bind(customerId).first();
          if(!address) {
            const a=body.deliveryAddress;
            if(!a||!text(a.line1,200)||!text(a.city,100)||a.state!=='OH'||!/^\d{5}$/.test(a.postalCode||''))throw new FoodError('Choose a customer delivery address or enter a complete Ohio address.');
            address={id:crypto.randomUUID()};
            statements.push(db.prepare('INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,is_primary) VALUES(?,?,?,?,?,?,0)').bind(address.id,customerId,text(a.line1,200),text(a.city,100),'OH',a.postalCode));
          }
        } else {
          // Order-scoped pickup location satisfies the existing non-null address FK;
          // it is never the customer's home or a primary/profile address.
          address={id:crypto.randomUUID()};
          statements.push(db.prepare("INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,is_primary,placement_other) VALUES(?,?,'Pickup by office arrangement','','OH','00000',0,'Pickup location only; not a customer delivery address')").bind(address.id,customerId));
        }
        const model=await readFoodOperations(db);
        for(const i of priced.items) {
          const stock=stockFor(model,i.id);
          if(!stock?.confirmed||stock.available<i.quantity)throw new FoodError('Shared inventory cannot confirm this quantity. Office reconciliation is required.',409);
        }
        const countStock=policy.stock_basis==='confirmed_count';
        if(!countStock)await checkFoodLotReconciliation(db,model,priced.items);
        const id=crypto.randomUUID(),number=`EDF-${id.slice(0,8).toUpperCase()}`;
        statements.push(db.prepare(`INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type,status,subtotal_cents,delivery_fee_cents,tax_rate_basis_points,tax_cents,total_cents,source,placed_at,fulfillment_method,requested_delivery_date)
          VALUES(?,?,?,?,'on_demand','pending_payment',?,0,?,?,?,'staff_sales',CURRENT_TIMESTAMP,?,?)`).bind(id,number,customerId,address.id,priced.subtotal,FOOD_TAX_BASIS_POINTS,priced.tax,priced.total,method,scheduled));
        for(const i of priced.items)statements.push(db.prepare("INSERT INTO dog_food_order_items(id,order_id,product_id,quantity,unit_price_cents,line_total_cents,substitution_policy) VALUES(?,?,?,?,?,?,'none')").bind(crypto.randomUUID(),id,i.id,i.quantity,i.unit_price_cents,i.unit_price_cents*i.quantity));
        statements.push(db.prepare('INSERT INTO dog_food_sales_order_metadata(order_id,recorded_by,billing_provider,pricing_policy,stock_basis,sale_date,customer_type,payment_status_entered,payment_method_entered,sale_notes) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,actor,body.billingProvider,priced.policy,countStock?'confirmed_count':'lots',intake.saleDate,intake.customerType,intake.paymentStatus,body.paymentMethod||null,intake.notes));
        if(countStock){
          for(const item of priced.items){
            const stock=stockFor(model,item.id),count=model.counts.filter(c=>c.productId===stock.id).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdTime||'').localeCompare(a.createdTime||'')||b.id.localeCompare(a.id))[0];
            if(!model.sync?.snapshot_id||!count)throw new FoodError('A saved physical count is required for this formula.',409);
            statements.push(db.prepare('INSERT INTO dog_food_sales_count_allocations(order_id,product_id,quantity,available_before,source_snapshot_id,count_reference,count_date) VALUES(?,?,?,?,?,?,?)').bind(id,item.id,item.quantity,stock.available,model.sync.snapshot_id,count.id,count.date));
          }
        }else statements.push(...await reserveFoodLots(db,id,priced.items,scheduled));
        if(method==='pickup')statements.push(db.prepare("INSERT INTO dog_food_pickups(order_id,scheduled_date,instructions,confirmed_by) VALUES(?,?,'Office arrangement required',?)").bind(id,scheduled,actor));
        else statements.push(db.prepare("INSERT INTO dog_food_deliveries(id,order_id,customer_id,address_id,scheduled_date,delivery_type) VALUES(?,?,?,?,?,'on_demand')").bind(crypto.randomUUID(),id,customerId,address.id,scheduled));
        if(amount>0)statements.push(...receiptStatements(db,{orderId:id,amountCents:amount,method:body.paymentMethod,reference:body.paymentReference,receivedAt:today,actor,evidence:{confirmedReceived:true,commandId:body.commandId}}).statements);
        // Handoff validation for a new order runs inside the same atomic batch via guards.
        if(body.fulfillmentStatus==='completed') {
          if(body.handoffConfirmed!==true||!text(body.receivedBy,120))throw new FoodError('Confirm physical handoff and recipient.');
          const at=new Date().toISOString().replace('T',' ').replace('Z','');
          statements.push(db.prepare('INSERT INTO dog_food_sales_handoffs(order_id,actor,received_by,method,completed_at,local_date,note) VALUES(?,?,?,?,?,?,?)').bind(id,actor,text(body.receivedBy,120),method,at,foodDate(),text(body.handoffNote,500)));
          if(method==='pickup')statements.push(db.prepare("UPDATE dog_food_pickups SET stage='arranged' WHERE order_id=?").bind(id),db.prepare("UPDATE dog_food_pickups SET status='collected',collected_at=?,collected_by=?,received_by=? WHERE order_id=?").bind(at,actor,text(body.receivedBy,120),id));
          else statements.push(db.prepare("UPDATE dog_food_deliveries SET status='delivered',delivered_at=?,placement_note=? WHERE order_id=?").bind(at,text(body.handoffNote,500),id));
        }
        result={orderId:id,orderNumber:number,totalCents:priced.total,receivedCents:amount,balanceCents:priced.total-amount,fulfillmentStatus:body.fulfillmentStatus};
      } else {
        const order=await foodSalesOrder(db,body.orderId);
        if(!office&&(order.source!=='staff_sales'||order.recorded_by!==actor))throw new FoodError('This order requires the office.',403);
        if(body.action==='receipt') {
          if(['cancelled','refunded'].includes(order.status)||body.paymentReceivedConfirmed!==true)throw new FoodError('Confirm an actual receipt on an active order.');
          const amount=integer(body.amountReceivedCents,'amount received',1,order.balance_cents);
          const received=date(body.receivedDate||foodDate());if(received>foodDate())throw new FoodError('A receipt cannot be dated in the future.');
          statements.push(...receiptStatements(db,{orderId:order.id,amountCents:amount,method:body.paymentMethod,reference:body.paymentReference,receivedAt:received,actor,evidence:{confirmedReceived:true,commandId:body.commandId}}).statements);
          result={orderId:order.id,orderNumber:order.order_number,receivedCents:order.received_cents+amount,balanceCents:order.balance_cents-amount};
        } else if(body.action==='handoff') {
          if(order.source!=='staff_sales')throw new FoodError('Use the existing delivery proof workflow for online orders.',409);
          statements.push(...await handoff(db,order,body,actor));result={orderId:order.id,orderNumber:order.order_number,fulfillmentStatus:'completed',balanceCents:order.balance_cents};
        } else if(body.action==='correction') {
          if(!text(body.reason,1000))throw new FoodError('Describe the requested correction.');
          const id=crypto.randomUUID();statements.push(db.prepare("INSERT INTO dog_food_sales_review(id,kind,order_id,source_key,actor,reason,evidence) VALUES(?,'correction',?,?,?,?,?)").bind(id,order.id,`correction:${body.commandId}`,actor,text(body.reason,1000),JSON.stringify({orderNumber:order.order_number,receivedCents:order.received_cents,balanceCents:order.balance_cents})));
          result={orderId:order.id,reviewId:id,message:'Sent to office review. The original sale and receipts are retained.'};
        } else if(office&&body.action==='refund') {
          const p=await db.prepare('SELECT * FROM dog_food_payments WHERE id=? AND order_id=? AND status IN(\'captured\',\'refunded\')').bind(body.paymentId,order.id).first();
          if(!p||body.confirm!==true||!text(body.reason,1000)||!text(body.reference,160))throw new FoodError('Confirm an actual refund, receipt, reason and external reference.');
          const amount=integer(body.amountCents,'refund amount',1,p.amount_cents-p.refunded_amount_cents);
          statements.push(db.prepare('INSERT INTO dog_food_sales_refunds(id,payment_id,amount_cents,reference,actor,reason) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.id,amount,text(body.reference,160),actor,text(body.reason,1000)),db.prepare("UPDATE dog_food_payments SET refunded_amount_cents=refunded_amount_cents+?,status=CASE WHEN refunded_amount_cents+?=amount_cents THEN 'refunded' ELSE status END WHERE id=?").bind(amount,amount,p.id));
          result={orderId:order.id,message:'Actual refund recorded. No charge was initiated and no inventory was returned.'};
        } else if(office&&body.action==='return') {
          const allocation=await db.prepare(`SELECT a.quantity,l.product_id,l.best_before,l.quarantined,l.expiry_assumed,
            COALESCE((SELECT SUM(quantity) FROM dog_food_sales_returns r WHERE r.order_id=a.order_id AND r.lot_id=a.lot_id),0) returned
            FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id WHERE a.order_id=? AND a.lot_id=? AND a.consumed_at IS NOT NULL`).bind(order.id,body.lotId).first();
          if(!allocation||body.confirm!==true||body.usable!==true||!text(body.reference,160)||!text(body.reason,1000)||allocation.quarantined||allocation.expiry_assumed||allocation.best_before<foodDate())throw new FoodError('Confirm the actual usable, unexpired physical return against its original lot.');
          const quantity=integer(body.quantity,'returned bags',1,allocation.quantity-allocation.returned),id=crypto.randomUUID();
          statements.push(db.prepare('INSERT INTO dog_food_sales_returns(id,order_id,lot_id,quantity,reference,actor,reason) VALUES(?,?,?,?,?,?,?)').bind(id,order.id,body.lotId,quantity,text(body.reference,160),actor,text(body.reason,1000)),db.prepare('UPDATE dog_food_stock_lots SET usable_bags=usable_bags+? WHERE id=?').bind(quantity,body.lotId),db.prepare("INSERT INTO dog_food_inventory_movements(id,product_id,location_id,movement_type,quantity_delta,reference_type,reference_id,notes,created_by,occurred_at) VALUES(?,?,'opwp-main','return',?,'food_physical_return',?,?,?,?)").bind(id,allocation.product_id,quantity,order.id,text(body.reason,1000),actor,new Date().toISOString().replace('T',' ').replace('Z','')));
          result={orderId:order.id,message:'Usable physical return recorded against the original lot. Payment history retained.'};
        } else throw new FoodError('Action is not permitted.',403);
      }
      statements.push(audit(db,actor,`food_sales_${body.action}`,result.orderId,{commandId:body.commandId,result}),db.prepare('INSERT INTO dog_food_sales_commands(id,actor,payload_hash,result) VALUES(?,?,?,?)').bind(body.commandId,actor,hash,JSON.stringify(result)),db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(token));
      try{await db.batch(statements);}catch(error){const saved=await replay(db,body,actor,hash);if(saved)return saved;throw error;}
      return result;
    } catch(error) {
      if(error instanceof FoodError)error.definitive=true;
      throw error;
    } finally {await db.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(token).run();}
  }
  async function inventory(db) {
    const policy=await foodSalesPolicy(db),model=await readFoodOperations(db);
    if(policy.stock_basis==='confirmed_count')return {configured:model.products.some(p=>p.confirmed&&p.available>0),basis:policy.stock_basis,products:model.products.map(p=>({id:p.websiteId,available:p.confirmed?p.available:null}))};
    const lots=await db.prepare('SELECT COUNT(*) n FROM dog_food_stock_lots WHERE usable_bags>0 AND quarantined=0 AND expiry_assumed=0 AND best_before>=?').bind(foodDate()).first();
    return {configured:lots.n>0,basis:'lots',products:[]};
  }
  return {quote,command,inventory};
}
