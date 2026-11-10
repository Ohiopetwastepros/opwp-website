import staffPrivate from './staff-private.json' with {type:'json'};
import schema from '../data/dog-food-airtable-schema.json';
import { outboundFetch } from './outbound-request';
import { readBoundedProviderJson } from './bounded-body.mjs';
import { FoodError, operationModel, text, links, choice, active, integer, cents, date, foodDate } from './dog-food-operations.mjs';
import {readFoodSalesIntelligence} from './dog-food-sales-intelligence.mjs';
import {foodWebsiteState,websiteFoodSnapshot,assertFoodWritesAvailable,websiteFoodContext,stageFoodBusinessRecord,standaloneFoodBusinessWrite,commitFoodBusinessContext,queueFoodStatement} from './dog-food-website-store.mjs';
import {receiptStatements,foodSalesOrder} from './food-sales-ledger.mjs';

export const foodSchema = schema;
const key = env => env.DOG_FOOD_AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
const table = name => { const t=schema.tables[name];if(!t)throw new FoodError('Unknown dog-food table');return t; };
function decode(name, record) {
  const map=table(name).fields;
  return {id:record.id,createdTime:record.createdTime,fields:Object.fromEntries(Object.entries(map).map(([name,id])=>[name,record.fields?.[id]]).filter(([,v])=>v!==undefined))};
}
export async function foodAirtable(env, path, options = {}) {
  if((await foodWebsiteState(env.DB)).backend==='website')throw new FoodError('Dog-food operations use the website ledger. Airtable access is retired.',409);
  if(!key(env))throw new FoodError('Airtable connection is not configured.',503);
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10),limit=Math.min(1000,Math.max(50,Number(env.DOG_FOOD_AIRTABLE_DAILY_REQUEST_LIMIT)||1000));
  const budget=await env.DB.prepare(`INSERT INTO dog_food_api_budget(usage_day,requests,next_request_ms) VALUES (?,1,?+300)
    ON CONFLICT(usage_day) DO UPDATE SET requests=requests+1,next_request_ms=MAX(next_request_ms,?)+300
    WHERE requests<? RETURNING next_request_ms`).bind(day,now,now,limit).first();
  if(!budget)throw new FoodError('The dog-food Airtable daily request cap has been reached; the last verified copy is retained.',503);
  const wait=Math.max(0,budget.next_request_ms-now-300);
  if(wait>5000)throw new FoodError('Airtable requests are busy; wait and refresh.',503);
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  const response=await outboundFetch(`https://api.airtable.com/v0/${path}`,{...options,headers:{Authorization:`Bearer ${key(env)}`,'Content-Type':'application/json',...options.headers}}, {provider:'airtable',operation:'dog_food_operations',timeoutMs:15000,retries:0});
  const data=await readBoundedProviderJson(response,1024*1024);
  if(!response.ok)throw new FoodError(`Airtable could not confirm this operation (${response.status}). The saved website copy is retained.`,503);
  return data;
}
async function listTable(env,name) {
  let offset='',records=[];
  do { const u=new URLSearchParams({pageSize:'100',returnFieldsByFieldId:'true'});if(offset)u.set('offset',offset);
    const data=await foodAirtable(env,`${schema.baseId}/${table(name).id}?${u}`);
    if(!Array.isArray(data.records))throw new FoodError('Airtable returned invalid records.',503);
    records.push(...data.records.map(r=>decode(name,r)));offset=data.offset||'';
    if(records.length>5000)throw new FoodError('Dog-food sync exceeds the bounded record capacity; no snapshot was replaced.',503);
  }while(offset);
  return records;
}
export async function readFoodSnapshot(db) {
  const website=await websiteFoodSnapshot(db);if(website)return website;
  const state=await db.prepare("SELECT snapshot_id,dirty,last_attempt_at,last_success_at,last_error,webhook_id,webhook_expires_at,alerts_enabled,alert_hour,default_recipient,last_alert_date,collector_name,collector_phone,collector_verified_at,collector_enabled,weekdays_only,collector_webhook_id,collector_reply_mode FROM dog_food_ops_state WHERE id='org-opwp'").first();
  const row=state?.snapshot_id?await db.prepare('SELECT payload,captured_at FROM dog_food_ops_snapshots WHERE id=?').bind(state.snapshot_id).first():null;
  return {snapshot:row?JSON.parse(row.payload):{tables:{}},sync:{...state,collector_default_name:staffPrivate.primaryName,capturedAt:row?.captured_at||null,configured:Boolean(row)}};
}
export async function readNativeFood(db) {
  const bounded=await db.prepare('SELECT (SELECT COUNT(*) FROM dog_food_orders) orders,(SELECT COUNT(*) FROM dog_food_order_items) items,(SELECT COUNT(*) FROM dog_food_payments) payments').first();
  if(bounded.orders>5000||bounded.items>20000||bounded.payments>5000)throw new FoodError('The native inventory history exceeds the reviewed sync bound. Retain the last copy and review capacity.',503);
  const [orders,customers,payments,subscriptions,products,items,planRequests]=await Promise.all([
    db.prepare(`SELECT o.id,o.customer_id,o.subscription_id,o.billing_cycle_key,o.order_number,o.order_type,o.status,o.source,o.deleted_at,o.tax_rate_basis_points,o.subtotal_cents,o.delivery_fee_cents,o.tax_cents,o.requested_delivery_date,o.automation_review,o.requested_delivery_speed,o.fulfillment_method,o.total_cents,o.created_at,c.first_name,c.last_name,c.phone,c.email,COALESCE(d.scheduled_date,pu.scheduled_date) scheduled_date,COALESCE(d.delivered_at,pu.collected_at) delivered_at,CASE WHEN pu.status='collected' THEN 'delivered' ELSE d.status END delivery_status,d.placement_note,
      CASE WHEN pu.status='ready' THEN pu.stage ELSE pu.status END pickup_status,pu.scheduled_date pickup_reserved_date,pu.arrangement_note pickup_instructions,d.technician_id,slot.technician_name,a.line1,a.city,a.state,a.postal_code,CASE WHEN d.proof_photo_url IS NOT NULL THEN 1 ELSE 0 END proof_recorded,
      (SELECT GROUP_CONCAT(p.color||' '||p.formula_code||' ×'||oi.quantity) FROM dog_food_order_items oi JOIN dog_food_products p ON p.id=oi.product_id WHERE oi.order_id=o.id) items
      FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id LEFT JOIN dog_food_deliveries d ON d.order_id=o.id LEFT JOIN dog_food_pickups pu ON pu.order_id=o.id
      LEFT JOIN dog_food_addresses a ON a.id=o.address_id AND a.customer_id=o.customer_id
      LEFT JOIN dog_food_capacity_allocations ca ON ca.order_id=o.id AND ca.released_at IS NULL LEFT JOIN dog_food_delivery_capacity slot ON slot.id=ca.slot_id ORDER BY o.created_at DESC LIMIT 5000`).all(),
    db.prepare('SELECT id,first_name,last_name,email,phone,customer_type,airtable_record_id,status FROM dog_food_customers WHERE deleted_at IS NULL ORDER BY last_name LIMIT 250').all(),
    db.prepare(`SELECT pay.id,pay.order_id,pay.provider,pay.amount_cents,pay.refunded_amount_cents,pay.status,pay.processed_at FROM dog_food_payments pay JOIN dog_food_orders o ON o.id=pay.order_id ORDER BY pay.created_at DESC LIMIT 5000`).all(),
    db.prepare(`SELECT s.id,s.status,s.next_delivery_date,s.payment_provider,c.first_name,c.last_name FROM dog_food_subscriptions s JOIN dog_food_customers c ON c.id=s.customer_id WHERE c.deleted_at IS NULL LIMIT 250`).all(),
    db.prepare('SELECT id,name,color,formula_code,bag_weight_lb,retail_price_cents FROM dog_food_products WHERE is_active=1 ORDER BY formula_code').all(),
    db.prepare(`SELECT oi.id,oi.order_id,oi.product_id,oi.quantity,oi.unit_price_cents,oi.line_total_cents,
      CASE WHEN (SELECT COALESCE(SUM(a.quantity),0) FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id
        WHERE a.order_id=oi.order_id AND l.product_id=oi.product_id AND a.consumed_at IS NOT NULL AND l.unit_cost_cents IS NOT NULL AND l.source_reference IS NOT NULL)=oi.quantity
      THEN (SELECT SUM(a.quantity*l.unit_cost_cents) FROM dog_food_lot_allocations a JOIN dog_food_stock_lots l ON l.id=a.lot_id
        WHERE a.order_id=oi.order_id AND l.product_id=oi.product_id AND a.consumed_at IS NOT NULL AND l.unit_cost_cents IS NOT NULL AND l.source_reference IS NOT NULL) END acquisition_cost_cents
      FROM dog_food_order_items oi JOIN dog_food_orders o ON o.id=oi.order_id ORDER BY o.created_at DESC LIMIT 20000`).all(),
    db.prepare('SELECT r.*,c.first_name,c.last_name FROM dog_food_plan_requests r JOIN dog_food_customers c ON c.id=r.customer_id WHERE c.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 250').all()
  ]);
  const physicalReturns=await db.prepare("SELECT id,product_id,quantity_delta,occurred_at,notes FROM dog_food_inventory_movements WHERE reference_type='food_physical_return' ORDER BY occurred_at DESC LIMIT 5000").all();
  const hasIntake=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_sales_order_metadata'").first();
  if(hasIntake){const intake=(await db.prepare('SELECT * FROM dog_food_sales_order_metadata LIMIT 5000').all()).results||[];for(const o of orders.results||[]){const m=intake.find(m=>m.order_id===o.id);if(m)Object.assign(o,{sale_date:m.sale_date,sale_customer_type:m.customer_type,sale_notes:m.sale_notes,sale_payment_method:m.payment_method_entered});}}
  return {physicalReturns:physicalReturns.results||[],planRequests:planRequests.results||[],orders:(orders.results||[]).map(o=>({...o,itemDetails:(items.results||[]).filter(i=>i.order_id===o.id)})),customers:customers.results||[],payments:payments.results||[],subscriptions:subscriptions.results||[],products:products.results||[]};
}
export async function readFoodOperations(db) {
  const {snapshot,sync}=await readFoodSnapshot(db),native=await readNativeFood(db),model=operationModel(snapshot,native);
  const [audit,deleted,alerts,replies,collectionItems]=await Promise.all([
    db.prepare('SELECT id,actor,action,entity_id,details,created_at FROM dog_food_ops_audit ORDER BY created_at DESC LIMIT 100').all(),
    db.prepare('SELECT id,entity_type,entity_id,label,deleted_by,deleted_at FROM dog_food_deleted_records WHERE restored_at IS NULL ORDER BY deleted_at DESC LIMIT 100').all(),
    db.prepare('SELECT id,recipient,alert_date,status,error,sent_at,channel,delivery_status,segments FROM dog_food_ops_alerts ORDER BY created_at DESC LIMIT 100').all(),
    db.prepare('SELECT * FROM dog_food_collection_replies ORDER BY created_at DESC LIMIT 100').all(),
    db.prepare('SELECT * FROM dog_food_collection_items ORDER BY updated_at DESC LIMIT 500').all()
  ]);
  const intelligence=await readFoodSalesIntelligence(db,model,sync);
  const legacyRequests=sync.backend==='website'?(await db.prepare('SELECT r.*,c.first_name,c.last_name FROM dog_food_legacy_plan_requests r JOIN dog_food_customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 250').all()).results||[]:[];
  const backups=sync.backend==='website'?(await db.prepare('SELECT id,status,byte_size,started_at,verified_at,error FROM dog_food_backup_runs ORDER BY started_at DESC LIMIT 10').all()).results||[]:[];
  for(const p of model.subscriptions){const raw=snapshot.tables.Customers?.find(c=>c.id===p.customer),mapped=raw?.fields?.['Website Customer ID'];const c=native.customers.find(c=>c.id===p.customer||c.id===mapped||c.airtable_record_id===p.customer);p.customerId=c?.id||'';p.customerName=c?[c.first_name,c.last_name].join(' '):raw?.fields?.['Customer Name']||'Customer link needs review';}
  return {...model,intelligence,sync,legacyRequests,backups,audit:audit.results||[],deleted:deleted.results||[],alerts:alerts.results||[],collectionReplies:replies.results||[],collectionItems:collectionItems.results||[]};
}
export async function syncFoodOperations(env,{force=false}={}) {
  const website=await foodWebsiteState(env.DB);if(website.writes_paused)return {configured:true,skipped:true,reason:'database_cutover'};
  if(website.backend==='website')return {configured:true,backend:'website',skipped:false};
  const db=env.DB;if(!db||!key(env))return {configured:false};
  const token=crypto.randomUUID();
  const claim=await db.prepare(`UPDATE dog_food_ops_state SET lease_token=?,lease_until=datetime('now','+5 minutes'),last_attempt_at=CURRENT_TIMESTAMP
    WHERE id='org-opwp' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)
      AND (?=1 OR last_attempt_at IS NULL OR last_attempt_at<datetime('now','-1 minute'))
      AND (?=1 OR dirty=1 OR last_success_at IS NULL OR last_success_at<datetime('now',CASE WHEN webhook_id IS NULL THEN '-30 minutes' ELSE '-24 hours' END)) RETURNING id`).bind(token,force?1:0,force?1:0).first();
  if(!claim)return {configured:true,skipped:true};
  try {
    // Clear before reading: notifications arriving during the scan keep dirty=1.
    await db.prepare("UPDATE dog_food_ops_state SET dirty=0 WHERE id='org-opwp' AND lease_token=?").bind(token).run();
    const tables={};for(const name of Object.keys(schema.tables))tables[name]=await listTable(env,name);
    const snapshot={tables,baseId:schema.baseId,capturedAt:new Date().toISOString()},model=operationModel(snapshot,await readNativeFood(db)),id=crypto.randomUUID();
    const statementsRepair=[];
    // A source edit to a managed website line becomes a visible idempotent repair,
    // while D1 continues to protect shared stock from stale/corrupted projections.
    for(const sale of model.sales.filter(s=>s.lineId)) {
      const raw=tables.Sales.find(r=>r.fields['Website Line ID']===sale.lineId);
      if(!raw||Number(raw.fields['Bag Quantity'])!==sale.quantity||links(raw.fields.Product)[0]!==sale.productId||raw.fields['Fulfillment Status']!==sale.fulfillment||Math.round(Number(raw.fields['Payments Received']||0)*100)!==sale.collectedCents) {
        statementsRepair.push(db.prepare(`INSERT INTO dog_food_sync_outbox(entity_key,kind,entity_id) VALUES (?,'order',?)
          ON CONFLICT(entity_key) DO UPDATE SET revision=revision+1,attempts=0,next_attempt_at=CURRENT_TIMESTAMP WHERE revision=synced_revision`).bind('order:'+sale.orderId,sale.orderId));
      }
    }
    for(const p of model.products){if(!p.active)continue;const r=tables.Products.find(r=>r.id===p.id),fields={
      'Usable Stock (Website)':p.onHand,'Reserved Stock (Website)':p.reserved,'Waste Bags (Website)':p.wasted,
      'Stock Count Date (Website)':p.countDate,'Stock Verified (Website)':p.confirmed,'Stock Value (Website)':p.stockValueCents==null?null:p.stockValueCents/100};
      const changed=Object.fromEntries(Object.entries(fields).filter(([k,v])=>v==null?r.fields[k]!=null:v!==(r.fields[k]??(typeof v==='boolean'?false:undefined))));
      if(Object.keys(changed).length){const saved=await writeFoodRecord(env,'Products',changed,p.id,{markDirty:false});tables.Products[tables.Products.findIndex(r=>r.id===p.id)]=saved;}
    }
    const totals=model.sales.filter(s=>tables.Sales.some(r=>r.id===s.id)).map(s=>({id:s.id,fields:{'Collected Total (Website)':s.collectedCents/100,'Outstanding Balance (Website)':s.balanceCents/100}}))
      .filter(v=>Object.entries(v.fields).some(([k,value])=>tables.Sales.find(r=>r.id===v.id).fields[k]!==value));
    if(totals.length){
      for(let n=0;n<totals.length;n+=10){const records=totals.slice(n,n+10).map(r=>({id:r.id,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[table('Sales').fields[k],v]))}));
        const saved=await foodAirtable(env,`${schema.baseId}/${table('Sales').id}`,{method:'PATCH',body:JSON.stringify({records,returnFieldsByFieldId:true})});
        if(saved.records?.length!==records.length)throw new FoodError('Airtable totals could not be verified.',503);
      }
      tables.Sales=await listTable(env,'Sales');
      for(const r of totals)for(const [k,v] of Object.entries(r.fields))if(tables.Sales.find(s=>s.id===r.id)?.fields[k]!==v)throw new FoodError('Airtable balance read-back differs; last verified copy retained.',409);
    }
    const statements=[...statementsRepair,db.prepare('INSERT INTO dog_food_ops_snapshots(id,payload) VALUES (?,?)').bind(id,JSON.stringify(snapshot))];
    // Exact product IDs only. Generic/placeholder and similarly coded products
    // never change checkout pricing or get treated as the same bag.
    for(const p of model.products){if(!p.websiteId)continue;
      statements.push(db.prepare(`UPDATE dog_food_products SET airtable_record_id=?,unit_cost_cents=?,reorder_point=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND formula_code=? AND bag_weight_lb=?`).bind(p.id,p.costCents,p.reorderPoint,p.websiteId,p.formula,p.weight));}
    for(const c of model.customers){if(!c.websiteId)continue;
      statements.push(db.prepare(`UPDATE dog_food_customers SET first_name=?,last_name=?,
        email=COALESCE((SELECT email FROM dog_food_accounts WHERE customer_id=dog_food_customers.id),?),phone=?,airtable_record_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM dog_food_accounts WHERE customer_id=dog_food_customers.id)
        AND NOT EXISTS(SELECT 1 FROM dog_food_orders WHERE customer_id=dog_food_customers.id AND source='staff_sales')`).bind(c.name.split(' ')[0],c.name.split(' ').slice(1).join(' '),c.email,c.phone,c.id,c.websiteId));
      const managed=await db.prepare("SELECT c.* FROM dog_food_customers c WHERE c.id=? AND EXISTS(SELECT 1 FROM dog_food_orders WHERE customer_id=c.id AND source='staff_sales')").bind(c.websiteId).first();
      if(managed&&(`${managed.first_name} ${managed.last_name}`.trim()!==c.name||managed.email!==c.email||managed.phone!==c.phone))statements.push(db.prepare(`INSERT INTO dog_food_sync_outbox(entity_key,kind,entity_id) VALUES(?,'customer',?)
        ON CONFLICT(entity_key) DO UPDATE SET revision=revision+1,attempts=0,next_attempt_at=CURRENT_TIMESTAMP WHERE revision=synced_revision`).bind('customer:'+managed.id,managed.id));
    }
    statements.push(db.prepare(`UPDATE dog_food_ops_state SET snapshot_id=?,last_success_at=CURRENT_TIMESTAMP,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id='org-opwp' AND lease_token=?`).bind(id,token));
    await db.batch(statements);
    return {configured:true,snapshotId:id,records:Object.values(tables).reduce((sum,rows)=>sum+rows.length,0)};
  }catch(error){await db.prepare("UPDATE dog_food_ops_state SET dirty=1,last_error=?,lease_token=NULL,lease_until=NULL WHERE id='org-opwp' AND lease_token=?").bind(text(error.message,500),token).run();throw error;}
}
export async function writeFoodRecord(env,name,fields,id=null,{markDirty=true}={}) {
  if((await foodWebsiteState(env.DB)).backend==='website')return env.foodBusinessContext||env.DB.foodBusinessContext?stageFoodBusinessRecord(env,name,fields,id):standaloneFoodBusinessWrite(env,name,fields,id);
  const t=table(name),encoded={};for(const [k,v] of Object.entries(fields)){if(!t.fields[k])throw new FoodError(`Unsupported ${name} field: ${k}`);encoded[t.fields[k]]=v;}
  const payload={records:[{...(id?{id}:{}),fields:encoded}],returnFieldsByFieldId:true};
  const data=await foodAirtable(env,`${schema.baseId}/${t.id}`,{method:id?'PATCH':'POST',body:JSON.stringify(payload)});
  if(!data.records?.[0]?.id)throw new FoodError('Airtable did not confirm the saved record.',503);
  const saved=data.records[0];
  const verify=await foodAirtable(env,`${schema.baseId}/${t.id}/${saved.id}?returnFieldsByFieldId=true`);
  for(const [k,v] of Object.entries(encoded)){
    const actual=verify.fields?.[k];
    const matches=Array.isArray(v)?JSON.stringify(v)===JSON.stringify(actual):v==null?actual==null:v===false?(actual??false)===false:v===''?(actual??'')==='':v===actual;
    if(!matches)throw new FoodError('Airtable read-back differs from the requested change. Review and refresh.',409);
  }
  if(markDirty)await env.DB.prepare("UPDATE dog_food_ops_state SET dirty=1 WHERE id='org-opwp'").run();
  return decode(name,verify);
}
const requireText=(value,label,max=200)=>{const v=text(value,max);if(!v)throw new FoodError(`${label} is required.`);return v;};
function find(snapshot,name,id){const row=snapshot.tables[name]?.find(r=>r.id===id&&active(r));if(!row)throw new FoodError('The record was not found in this dog-food business.',404);return row;}
const email=value=>{const v=text(value,200);if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new FoodError('Enter a valid email.');return v;};
export async function foodOperation(env,body,actor) {
  const db=env.DB,{snapshot}=await readFoodSnapshot(db),model=operationModel(snapshot,await readNativeFood(db));
  const action=text(body.action,40);
  if(action==='sync')return syncFoodOperations(env,{force:true});
  if(action==='save_sale'||action==='correct_history') {
    const correction=action==='correct_history'&&snapshot.backend==='website'&&body.id;
    if(correction){const row=find(snapshot,'Sales',body.id);if(body.correctionConfirmed!==true||!text(body.correctionReason,1000)||body.expectedRevision!==(row.revision||0))throw new FoodError('Confirm the current historical record and enter the correction evidence.',409);}
    if(!correction&&(env.FOOD_SALES_NATIVE_ENABLED==='true'&&env.FOOD_SALES_RECORDING_ENABLED==='true'||env.FOOD_SALES_LEGACY_WRITES_FROZEN==='true'))throw new FoodError('New sales use Record a food sale. Existing history has a separate reviewed correction action.',409);
    const old=body.id?find(snapshot,'Sales',body.id):null;
    if(old?.fields['Website Line ID'])throw new FoodError('Website sale lines are managed through the native order. Edit the unpaid order or record fulfillment there.',409);
    const link=old?await db.prepare('SELECT customer_id FROM dog_food_direct_sale_links WHERE sale_id=?').bind(old.id).first():null;
    const customerId=link?.customer_id||text(body.customerId,100);
    const customer=customerId?await db.prepare("SELECT id,first_name,last_name FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL").bind(customerId).first():null;
    if(body.handoff&&!['delivery','pickup'].includes(body.handoff))throw new FoodError('Choose pickup or delivery.');
    if(!old&&!customer)throw new FoodError('Select or create a customer account before recording a new direct sale.');
    if(link&&body.customerId&&body.customerId!==link.customer_id)throw new FoodError('A sale’s customer link is locked. A reviewed correction is required.',409);
    const product=find(snapshot,'Products',body.productId);
    if(!product.fields['Product Name'])throw new FoodError('Choose a named product.');
    const qty=integer(body.quantity,'bag quantity',1,10000),saleDate=date(body.date),total=cents(body.total,'sale total'),paid=cents(body.paid??'0','opening amount collected');
    if(!old&&paid>0&&body.paymentReceivedConfirmed!==true)throw new FoodError('Confirm the amount was actually received before recording a paid direct sale.');
    if(paid>total)throw new FoodError('Collected amount cannot exceed the sale total.');
    const priorReceipts=model.sales.find(s=>s.id===old?.id)?.receipts||[];
    if(priorReceipts.length && (qty!==Number(old.fields['Bag Quantity'])||total!==Math.round(Number(old.fields['Sale Total']??old.fields['Amount Collected'])*100)||paid!==Math.round(Number(old.fields['Payments Received']||0)*100)))throw new FoodError('Sales with payment receipts are locked against repricing. Review the original receipt evidence before correcting this history.');
    const fulfillment=['Delivered','Awaiting Delivery','Cancelled'].includes(body.fulfillment)?body.fulfillment:'Delivered';
    const orderId=text(body.orderId,100);
    if(orderId){const order=await db.prepare(`SELECT o.id FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL AND c.deleted_at IS NULL`).bind(orderId).first();if(!order)throw new FoodError('The linked website order was not found.',404);}
    if(fulfillment==='Delivered'&&saleDate>foodDate())throw new FoodError('A completed sale cannot be dated in the future.');
    const current=model.products.find(p=>p.id===product.id),prior=model.sales.find(s=>s.id===old?.id),
      priorQuantity=prior?.inventoryEligible&&prior.productId===product.id&&prior.date>current?.countDate?prior.quantity:0;
    const priorReservation=prior?.productId===product.id&&prior.fulfillment==='Awaiting Delivery'?prior.quantity:0;
    if(current?.confirmed&&(fulfillment==='Awaiting Delivery'||fulfillment==='Delivered'&&saleDate>current.countDate)&&current.onHand+priorQuantity-current.reserved+priorReservation<qty)throw new FoodError('There is not enough confirmed stock. Reconcile stock before completing the sale.');
    const fields={'Sold To':customer?customer.first_name+' '+customer.last_name:requireText(body.name,'Customer'),Product:[product.id],'Bag Quantity':qty,'Sale Date':saleDate,'Sale Total':total/100,'Payments Received':paid/100,
      'Amount Collected':total/100,'Payment Status':paid>=total?'Paid':'Unpaid','Payment Method':body.method||null,
      'Fulfillment Status':fulfillment,Notes:text(body.notes,4000),'Responsible Person':text(body.responsible,200),'Responsible Email':email(body.responsibleEmail),
      'Responsible Phone':text(body.responsiblePhone,40),'Next Follow-up':date(body.nextFollowUp,false)||null,'Website Order ID':orderId,'Record Status':'Active'};
    if(!['Cash','Check','Venmo / Zelle / PayPal','Credit/Debit Card'].includes(body.method))throw new FoodError('Choose a supported payment method.');
    if(correction){fields['Historical Correction Evidence']=requireText(body.correctionReason,'Correction evidence',1000);const changed={...snapshot,tables:{...snapshot.tables,Sales:snapshot.tables.Sales.map(r=>r.id===old.id?{...r,fields:{...r.fields,...fields}}:r)}};const next=operationModel(changed,await readNativeFood(db));if(next.products.some(p=>p.confirmed&&p.available<0))throw new FoodError('This correction would leave stock below committed bags. Reconcile physical stock first.',409);}
    const saved=await writeFoodRecord(env,'Sales',fields,old?.id);
    if(customer)await db.prepare('INSERT OR IGNORE INTO dog_food_direct_sale_links(sale_id,customer_id,recorded_by,fulfillment_method) VALUES (?,?,?,?)').bind(saved.id,customer.id,actor,body.handoff||'delivery').run();
    return saved;
  }
  if(action==='record_payment') {
    const sale=model.sales.find(s=>s.id===body.saleId),v=cents(body.amount,'payment amount');
    const website=(await foodWebsiteState(db)).backend==='website';
    const source=snapshot.tables.Sales?.find(s=>s.id===body.saleId);
    if(website&&sale?.orderId&&sale.lineId){
      if(!env.foodBusinessContext)throw new FoodError('Native receipts require the verified operating command.',409);
      if(!v||v>sale.balanceCents)throw new FoodError('Payment must be greater than zero and no more than the outstanding balance.');
      const method=({'Cash':'cash','Check':'check','Venmo / Zelle / PayPal':'venmo','Credit/Debit Card':'card',cash:'cash',check:'check',venmo:'venmo',zelle:'zelle',paypal:'paypal',card:'card'})[body.method];
      if(!method)throw new FoodError('Choose the actual payment method.');
      const order=await foodSalesOrder(db,sale.orderId);if(['cancelled','refunded'].includes(order.status)||v>order.balance_cents)throw new FoodError('This order requires payment review.',409);
      const receipt=receiptStatements(db,{orderId:sale.orderId,amountCents:v,method,reference:requireText(body.reference,'Receipt or transaction reference'),receivedAt:date(body.date),actor,evidence:{sourceSaleId:sale.id,commandId:body.commandId,officeRecorded:true}});
      env.foodBusinessContext.statements.push(...receipt.statements);return {id:receipt.id,orderId:order.id,message:'Receipt recorded against the website order.'};
    }
    if(!source)throw new FoodError('Sale not found.',404);
    if(source.fields['Website Line ID'])throw new FoodError('Website payments are managed by the native order/payment ledger. Do not add a duplicate Airtable receipt.',409);
    if(!v||!sale||v>sale.balanceCents)throw new FoodError('Payment must be greater than zero and no more than the outstanding balance.');
    const reference=requireText(body.reference,'Receipt or transaction reference');
    if(snapshot.tables['Payment Receipts']?.some(r=>text(r.fields['Receipt Reference'])===reference))throw new FoodError('That receipt reference has already been recorded.');
    return writeFoodRecord(env,'Payment Receipts',{'Receipt Reference':reference,Sale:[body.saleId],Amount:v/100,'Payment Date':date(body.date),Method:requireText(body.method,'Payment method'),Notes:text(body.notes,4000),'Record Status':'Active'});
  }
  if(action==='save_purchase') {
    const old=body.id?find(snapshot,'Purchase Orders',body.id):null,poNumber=requireText(body.number,'Purchase order number');
    if(snapshot.tables['Purchase Orders']?.some(r=>active(r)&&r.id!==old?.id&&r.fields['PO Number']===poNumber))throw new FoodError('That purchase order number already exists.');
    const inputs=body.lines===undefined?[body]:body.lines,existing=old?model.pos.find(p=>p.id===old.id)?.lines||[]:[];
    if(!Array.isArray(inputs)||!inputs.length||inputs.length>20)throw new FoodError('A purchase order needs one to twenty product lines.');
    const seen=new Set(),details=inputs.map(input=>{
      if(!input||typeof input!=='object')throw new FoodError('Invalid purchase line.');
      const product=find(snapshot,'Products',input.productId);
      if(!product.fields['Product Name']||seen.has(product.id))throw new FoodError('Choose one line per named product.');seen.add(product.id);
      const ordered=integer(input.quantity,'ordered quantity',1,100000),received=integer(input.received,'received quantity',0,ordered),cost=cents(input.cost,'unit cost'),
        matches=existing.filter(l=>l.productId===product.id),line=matches[0];
      if(matches.length>1)throw new FoodError('Consolidate repeated product lines in Airtable before editing this PO.');
      const restocks=(snapshot.tables['Restock Log']||[]).filter(r=>old&&r.fields['Purchase Order ID']===old.id&&links(r.fields.Product).includes(product.id)),
        activeRestocks=restocks.filter(active),priorReceived=restocks.length?activeRestocks.reduce((n,r)=>n+Number(r.fields['Bags Received']||0),0):line?.received||0;
      if(received<Math.max(priorReceived,line?.received||0))throw new FoodError('Received bags cannot be reduced. Record a reviewed stock adjustment instead.');
      if(restocks.some(r=>!active(r))&&priorReceived!==(line?.received||0))throw new FoodError('This PO has archived receipts. Restore or reconcile them before receiving more bags.');
      if(line?.received>0&&cost!==line.costCents)throw new FoodError('Cost is locked after receipt. Use a reviewed inventory cost correction.');
      const receivedDate=received?date(input.receivedDate):null,bestBefore=date(input.bestBefore,false)||null;
      if(receivedDate&&receivedDate>foodDate())throw new FoodError('A receipt cannot be dated in the future.');
      return {productId:product.id,line,restocks,priorReceived,ordered,received,cost,receivedDate,lot:text(input.lot,200),bestBefore};
    });
    if(existing.some(l=>!seen.has(l.productId)))throw new FoodError('Existing PO lines cannot be removed here. Retain them or archive the whole purchase for review.');
    const freight=cents(body.freight||'0','freight'),paid=cents(body.paid||'0','supplier payment'),
      total=details.reduce((n,l)=>n+l.ordered*l.cost,0)+freight,orderedTotal=details.reduce((n,l)=>n+l.ordered,0),receivedTotal=details.reduce((n,l)=>n+l.received,0);
    if(paid>total)throw new FoodError('Supplier payment exceeds the purchase total.');
    if(snapshot.backend==='website'){
      const previous=old?cents(old.fields['Amount Paid']||0,'prior supplier payment'):0;
      if(paid<previous)throw new FoodError('Recorded supplier payments cannot be reduced. Retain the receipt and record a reviewed supplier credit separately.',409);
      if(paid>previous){if(body.supplierPaymentConfirmed!==true||!text(body.reference,200))throw new FoodError('Confirm the supplier money was actually paid and enter its transaction reference.');if(snapshot.tables['Supplier Payments']?.some(r=>r.fields.Reference===body.reference))throw new FoodError('This supplier payment reference is already recorded.',409);}
    }
    const fields={'PO Number':poNumber,Supplier:requireText(body.supplier,'Supplier'),'Order Date':date(body.date),'Expected Date':date(body.expected,false)||null,
      'PO Status':receivedTotal===orderedTotal?'Received':receivedTotal>0?'Partially Received':'Ordered','Freight Cost':freight/100,'Amount Paid':paid/100,'Payment Reference':text(body.reference,200),'Stock Location ID':'opwp-main',Notes:text(body.notes,4000),'Record Status':'Active'};
    const saved=await writeFoodRecord(env,'Purchase Orders',fields,old?.id),lineIds=[];
    if(snapshot.backend==='website'){
      const previous=old?cents(old.fields['Amount Paid']||0):0;
      if(paid>previous)await writeFoodRecord(env,'Supplier Payments',{'Purchase Order':[saved.id],Amount:(paid-previous)/100,'Payment Date':date(body.paymentDate||body.date),Reference:text(body.reference,200),'Record Status':'Active'});
    }
    for(const l of details){
      // Preserve one dated stock event per partial shipment; cumulative line
      // quantities are purchasing totals, not a second inventory movement.
      if(!l.restocks.length&&l.line?.received>0)await writeFoodRecord(env,'Restock Log',{
        'Date Received':l.line.date,Product:[l.productId],'Bags Received':l.line.received,Supplier:fields.Supplier,
        'Cost Per Bag':l.line.costCents/100,'Purchase Order ID':saved.id,'Stock Location ID':'opwp-main',Notes:`Opening PO receipt ${poNumber}`,'Lot Number':l.line.lot,'Best Before':l.line.bestBefore||null,'Record Status':'Active'});
      if(l.received>l.priorReceived)await writeFoodRecord(env,'Restock Log',{
        'Date Received':l.receivedDate,Product:[l.productId],'Bags Received':l.received-l.priorReceived,Supplier:fields.Supplier,
        'Cost Per Bag':l.cost/100,'Purchase Order ID':saved.id,'Stock Location ID':'opwp-main',Notes:`PO ${poNumber}; operation ${body.commandId}`,'Lot Number':l.lot,'Best Before':l.bestBefore,'Record Status':'Active'});
      const detail=await writeFoodRecord(env,'Purchase Order Lines',{'Line ID':l.line?.id||`PO-${body.commandId}-${l.productId}`,'Purchase Order':[saved.id],Product:[l.productId],
        'Ordered Quantity':l.ordered,'Received Quantity':l.received,'Cost Per Bag':l.cost/100,'Received Date':l.received>l.priorReceived?l.receivedDate:l.line?.date||l.receivedDate,'Lot Number':l.lot,'Best Before':l.bestBefore,'Record Status':'Active'},l.line?.id);lineIds.push(detail.id);
    }
    return {id:saved.id,lineIds};
  }
  if(action==='stock_movement') {
    find(snapshot,'Products',body.productId);const type=body.type;
    if(!['Waste','Return','Adjustment','Stock Count'].includes(type))throw new FoodError('Choose a valid stock movement.');
    const qty=type==='Stock Count'?integer(body.quantity,'physical count'):integer(body.quantity,'bag quantity',type==='Adjustment'?-100000:1,100000),p=model.products.find(p=>p.id===body.productId);
    if(date(body.date)>foodDate())throw new FoodError('Physical stock movements cannot be dated in the future.');
    if(type!=='Stock Count'&&qty===0)throw new FoodError('Stock change cannot be zero.');
    if(snapshot.backend==='website'&&type==='Return'&&body.confirmUsable!==true)throw new FoodError('Confirm returned bags were inspected, unexpired and usable. Unusable bags belong in waste history.');
    if(type==='Waste'&&p?.confirmed&&qty>p.onHand)throw new FoodError('Waste exceeds confirmed stock.');
    return writeFoodRecord(env,'Inventory Adjustments',{'Adjustment ID':`STOCK-${body.commandId}`,Product:[body.productId],'Stock Location ID':'opwp-main','Movement Type':type,
      'Quantity Change':type==='Stock Count'?0:type==='Waste'?-qty:qty,'Counted Quantity':type==='Stock Count'?qty:null,
      'Movement Date':date(body.date),'Cost Per Bag':cents(body.cost||'0','unit cost')/100,'Lot Number':text(body.lot,200),Reason:requireText(body.reason,'Reason',4000),'Record Status':'Active'});
  }
  if(action==='archive'||action==='restore') {
    if(!['Sales','Customers','Purchase Orders','Inventory Adjustments','Payment Receipts','Restock Log'].includes(body.table))throw new FoodError('This record type cannot be deleted here.');
    const row=snapshot.tables[body.table]?.find(r=>r.id===body.id);if(!row)throw new FoodError('Record not found',404);
    if(body.table==='Sales'&&row.fields['Website Line ID'])throw new FoodError('Use native order cancellation or deletion to retain stock and payment history.',409);
    if(snapshot.backend==='website'&&action==='archive'&&body.table==='Purchase Orders'&&(Number(row.fields['Amount Paid'])>0||model.pos.find(p=>p.id===row.id)?.received>0))throw new FoodError('Received or paid purchases are retained. Use a stock adjustment or a documented supplier correction.',409);
    if(body.confirmed!==true)throw new FoodError('Confirm the record deletion or restoration.');
    const saved=await writeFoodRecord(env,body.table,{'Record Status':action==='archive'?'Archived':'Active'},row.id);
    if(body.table==='Purchase Orders'){for(const l of snapshot.tables['Purchase Order Lines']||[])if(links(l.fields['Purchase Order']).includes(row.id))await writeFoodRecord(env,'Purchase Order Lines',{'Record Status':action==='archive'?'Archived':'Active'},l.id);}
    return saved;
  }
  if(action==='save_customer') {
    if(snapshot.backend==='website')throw new FoodError('Edit the shared website customer in Customer information hub.',409);
    if(body.id)find(snapshot,'Customers',body.id);
    return writeFoodRecord(env,'Customers',{'Customer Name':requireText(body.name,'Customer name'),Email:email(body.email),Phone:text(body.phone,40),'Service Address':text(body.address,300),City:text(body.city,100),Notes:text(body.notes,4000),'Record Status':'Active'},body.id||null);
  }
  if(action==='catalog_product'&&snapshot.backend==='website'){
    const p=model.products.find(p=>p.id===body.id);if(!p?.websiteId||body.confirm!==true)throw new FoodError('Choose and confirm a website formula.');
    const price=cents(body.price,'catalog price'),cost=cents(body.cost,'acquisition cost'),reorder=integer(body.reorder,'reorder point',0,10000);if(price<=0)throw new FoodError('Catalog price must be positive.');
    await writeFoodRecord(env,'Products',{'Retail Price':price/100,'Dealer Price':cost/100,'Reorder Point':reorder},p.id);
    await queueFoodStatement(db,db.prepare('UPDATE dog_food_products SET retail_price_cents=?,unit_cost_cents=?,reorder_point=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(price,cost,reorder,p.websiteId));
    return {id:p.id,message:'Catalog settings saved. Historical sale prices and existing plan prices are unchanged.'};
  }
  if(action==='save_legacy_plan'&&snapshot.backend==='website'){
    const old=body.id?find(snapshot,'Subscriptions',body.id):null;
    if(body.confirm!==true||old&&(old.revision||0)!==body.expectedRevision)throw new FoodError('Confirm the current plan details.',409);
    const customer=await db.prepare("SELECT id,first_name,last_name,email,phone FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL").bind(text(body.customerId,100)).first();
    if(!customer)throw new FoodError('Choose an active website customer.');find(snapshot,'Products',body.productId);
    const quantity=integer(body.quantity,'bags per delivery',1,100),frequencies={Weekly:1,'Every two weeks':2,Monthly:4.345,'Every six weeks':6,'Every eight weeks':8};
    if(!Object.hasOwn(frequencies,body.frequency)||!['Active','Paused','Cancelled'].includes(body.status)||!['manual','sweep_and_go'].includes(body.billingOwner))throw new FoodError('Choose the plan frequency, status and actual billing owner.');
    if(body.billingOwner==='sweep_and_go'&&body.billingReviewed!==true)throw new FoodError('Confirm the corresponding Sweep & Go billing state was checked. This form does not change Sweep & Go billing.');
    const next=date(body.next,false);if(body.status==='Active'&&(!next||next<foodDate()))throw new FoodError('An active plan needs its actual next delivery date.');
    if(body.status==='Active'&&await db.prepare("SELECT id FROM dog_food_subscriptions WHERE customer_id=? AND status IN('active','past_due') LIMIT 1").bind(customer.id).first())throw new FoodError('This customer already has a website billing plan. Reconcile it before activating an office-managed plan.',409);
    await writeFoodRecord(env,'Customers',{'Website Customer ID':customer.id,'Customer Name':customer.first_name+' '+customer.last_name,Email:customer.email,Phone:customer.phone,'Record Status':'Active'},customer.id);
    const saved=await writeFoodRecord(env,'Subscriptions',{Customer:[customer.id],Product:[body.productId],'Quantity Per Delivery':quantity,'Delivery Frequency':body.frequency,'Frequency Weeks':frequencies[body.frequency],'Monthly Bag Equivalent':quantity*4.345/frequencies[body.frequency],'Next Delivery Date':next||null,'Subscription Status':body.status,'Billing Owner':body.billingOwner,'Special Instructions':text(body.notes,4000),'Record Status':'Active'},old?.id);
    return {id:saved.id,message:'Office-managed plan saved. No charge, enrollment or stock movement was created.'};
  }
  if(action==='review_legacy_plan_request'&&snapshot.backend==='website'){
    const request=await db.prepare('SELECT * FROM dog_food_legacy_plan_requests WHERE id=?').bind(text(body.id,100)).first();
    if(!request||request.status!=='pending'||!['completed','rejected'].includes(body.status)||body.confirm!==true||!text(body.officeNote,2000))throw new FoodError('Choose an open request, add the office outcome and confirm it.',409);
    await queueFoodStatement(db,db.prepare("UPDATE dog_food_legacy_plan_requests SET status=?,office_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(body.status,text(body.officeNote,2000),actor,request.id));
    return {message:'Office outcome saved. Plan changes and any external billing changes must be recorded separately.'};
  }
  if(action==='delete_native'||action==='restore_native') {
    if(body.confirmed!==true)throw new FoodError('Confirm this record deletion or restoration.');
    const customer=body.entity==='customer',order=body.entity==='order';if(!customer&&!order)throw new FoodError('Unknown record type');
    const id=text(body.id,100),entityTable=customer?'dog_food_customers':'dog_food_orders';
    const row=await db.prepare(`SELECT * FROM ${entityTable} WHERE id=?`).bind(id).first();if(!row)throw new FoodError('Record not found',404);
    const label=customer?`${row.first_name} ${row.last_name}`:row.order_number;
    if(action==='restore_native'){await db.batch([db.prepare(`UPDATE ${entityTable} SET deleted_at=NULL WHERE id=?`).bind(id),db.prepare('UPDATE dog_food_deleted_records SET restored_at=CURRENT_TIMESTAMP WHERE entity_type=? AND entity_id=?').bind(body.entity,id)]);return {restored:true};}
    const tasks=await db.prepare(`SELECT t.id FROM route_partner_tasks t JOIN dog_food_deliveries d ON d.id=t.dog_food_delivery_id WHERE ${customer?'d.customer_id':'d.order_id'}=? AND t.status NOT IN ('completed','failed','cancelled') LIMIT 1`).bind(id).first();
    if(tasks)throw new FoodError('Remove this record from open field tasks before deletion.');
    const statements=[db.prepare(`UPDATE ${entityTable} SET deleted_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id),
      db.prepare(`INSERT INTO dog_food_deleted_records(id,entity_type,entity_id,label,payload,deleted_by) VALUES (?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=CURRENT_TIMESTAMP,restored_at=NULL,deleted_by=excluded.deleted_by`).bind(crypto.randomUUID(),body.entity,id,label,JSON.stringify(row),actor)];
    if(customer)statements.push(db.prepare("UPDATE dog_food_subscriptions SET status='paused' WHERE customer_id=? AND status='active'").bind(id));
    await db.batch(statements);return {deleted:true,label};
  }
  if(action==='alert_settings') {
    const recipient=email(body.recipient);if(!recipient)throw new FoodError('An internal email recipient is required.');
    await db.prepare("UPDATE dog_food_ops_state SET alerts_enabled=?,default_recipient=?,alert_hour=? WHERE id='org-opwp'").bind(body.enabled===true?1:0,recipient,integer(body.hour,'alert hour',0,23)).run();return {saved:true};
  }
  throw new FoodError('The requested action is not supported.');
}
export async function runFoodCommand(env,body,actor,execute=null) {
  await assertFoodWritesAvailable(env.DB);
  if(!/^[a-f0-9-]{36}$/i.test(body.commandId||''))throw new FoodError('A unique operation ID is required.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const prior=await env.DB.prepare('SELECT actor,payload_hash,status,result FROM dog_food_ops_commands WHERE id=?').bind(body.commandId).first();
  if(prior){if(prior.actor!==actor||prior.payload_hash!==hash)throw new FoodError('Operation identity conflict.',409);if(prior.status==='complete')return JSON.parse(prior.result);throw new FoodError('This operation was already attempted. Refresh and inspect the records before trying again.',409);}
  const lock=await env.DB.prepare("UPDATE dog_food_ops_state SET command_token=?,command_until=datetime('now','+5 minutes') WHERE id='org-opwp' AND (command_until IS NULL OR command_until<CURRENT_TIMESTAMP) RETURNING id").bind(body.commandId).first();
  if(!lock)throw new FoodError('Another dog-food operation is being saved. Wait and refresh.',409);
  try {
    if((await foodWebsiteState(env.DB)).backend==='website'){
      const working=await websiteFoodContext(env,{commandId:body.commandId,actor,token:body.commandId});
      const result=execute?await execute(working):await foodOperation(working,body,actor);
      try{return await commitFoodBusinessContext(working,result,{commandBody:body,payloadHash:hash});}
      catch(error){const saved=await env.DB.prepare("SELECT actor,payload_hash,status,result FROM dog_food_ops_commands WHERE id=?").bind(body.commandId).first();if(saved?.status==='complete'&&saved.actor===actor&&saved.payload_hash===hash)return JSON.parse(saved.result);throw error;}
    }
    await env.DB.prepare("INSERT INTO dog_food_ops_commands(id,actor,action,payload_hash,status) VALUES (?,?,?,?,'running')").bind(body.commandId,actor,text(body.action,40),hash).run();
    if(!execute&&!['sync','delete_native','restore_native','alert_settings'].includes(body.action)){
      const synced=await syncFoodOperations(env,{force:true});
      if(synced.skipped||!synced.configured)throw new FoodError('Current Airtable data could not be confirmed. Refresh before editing.',409);
    }
    const result=execute?await execute(env):await foodOperation(env,body,actor);
    await env.DB.batch([env.DB.prepare("UPDATE dog_food_ops_commands SET status='complete',result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(result),body.commandId),
      env.DB.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor,text(body.action,40),text(body.id||body.saleId||result?.id||result?.orderId,100),JSON.stringify({beforeId:body.id||null,request:body,result}))]);
    return result;
  }catch(error){await env.DB.prepare("UPDATE dog_food_ops_commands SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'complete'").bind(text(error.message,500),body.commandId).run();throw error;}
  finally{await env.DB.prepare("UPDATE dog_food_ops_state SET command_token=NULL,command_until=NULL WHERE id='org-opwp' AND command_token=?").bind(body.commandId).run();}
}
