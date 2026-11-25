import {FoodAccountError} from './dog-food-account.mjs';
import {foodWebsiteState,websiteFoodSnapshot,assertFoodWritesAvailable} from './dog-food-website-store.mjs';
export async function websiteCustomerSourceIds(db,customerId){
  const customer=await db.prepare('SELECT airtable_record_id FROM dog_food_customers WHERE id=?').bind(customerId).first();
  const links=(await db.prepare("SELECT source_record_id FROM dog_food_sales_customer_sources WHERE customer_id=? AND source_table='Customers'").bind(customerId).all()).results||[];
  return new Set([customerId,customer?.airtable_record_id,...links.map(r=>r.source_record_id)].filter(Boolean));
}
export async function websiteLegacyPlans(db,customerId){
  if((await foodWebsiteState(db)).backend!=='website')return [];
  const {snapshot}=await websiteFoodSnapshot(db),ids=await websiteCustomerSourceIds(db,customerId);
  return snapshot.tables.Subscriptions.filter(r=>r.fields['Record Status']!=='Archived'&&Array.isArray(r.fields.Customer)&&r.fields.Customer.length===1&&ids.has(r.fields.Customer[0]));
}
export async function requestWebsiteLegacyPlanChange(db,account,body){
  await assertFoodWritesAvailable(db);
  if(!/^[a-f0-9-]{36}$/i.test(body.commandId||'')||!['formula','quantity','delivery','pause','resume','skip','cancel','other'].includes(body.requestType)||typeof body.details!=='string'||!body.details.trim()||body.details.length>2000)throw new FoodAccountError('Choose the requested change and describe what you need.');
  const id=String(body.subscriptionId||'').replace(/^legacy:/,''),plans=await websiteLegacyPlans(db,account.customer_id);
  if(!plans.some(p=>p.id===id))throw new FoodAccountError('This plan is not linked to your account.',404);
  const details=JSON.stringify({requestType:body.requestType,message:body.details.trim()}),kind=['pause','resume','cancel'].includes(body.requestType)?body.requestType:'change';
  const old=await db.prepare('SELECT customer_id,plan_id,details FROM dog_food_legacy_plan_requests WHERE id=?').bind(body.commandId).first();
  if(old){if(old.customer_id!==account.customer_id||old.plan_id!==id||old.details!==details)throw new FoodAccountError('This submission belongs to different details.',409);return {message:'Your existing plan request is saved for office review.'};}
  await db.prepare('INSERT INTO dog_food_legacy_plan_requests(id,customer_id,plan_id,request_type,details) VALUES(?,?,?,?,?)').bind(body.commandId,account.customer_id,id,kind,details).run();
  return {message:'Your request is saved for the office. Billing and delivery stay unchanged until reviewed.'};
}
