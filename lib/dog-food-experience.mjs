import {foodCustomerCommand} from './food-customer-hub.mjs';
import {FoodAccountError,foodTokenHash} from './dog-food-account.mjs';
import {FoodError} from './dog-food-operations.mjs';
import {requestWebsiteLegacyPlanChange} from './dog-food-legacy-plans.mjs';
const text=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v||'');
const types=['formula','quantity','delivery','pause','resume','skip','cancel','other'];
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;

export async function createFoodStaffCustomer(db,body,actor='office') {
  return foodCustomerCommand(db,{...body,action:'create_customer'},actor);
}

export async function requestFoodPlanChange(db,account,body) {
  if(String(body.subscriptionId||'').startsWith('legacy:'))return requestWebsiteLegacyPlanChange(db,account,body);
  const id=body.commandId,subscriptionId=text(body.subscriptionId,80)||null,type=body.requestType||body.subscriptionAction,details=text(body.details,2000);
  if(!uuid(id)||!types.includes(type)||!details)throw new FoodAccountError('Choose a change and describe what you need.');
  const customer=await db.prepare('SELECT sng_client_id FROM dog_food_customers WHERE id=? AND deleted_at IS NULL').bind(account.customer_id).first();
  const plan=subscriptionId?await db.prepare('SELECT id,status FROM dog_food_subscriptions WHERE id=? AND customer_id=?').bind(subscriptionId,account.customer_id).first():null;
  if(!customer||subscriptionId&&(!plan||plan.status==='cancelled')||!subscriptionId&&!customer.sng_client_id)throw new FoodAccountError('Choose your current monthly plan or contact the office.',409);
  const hash=await foodTokenHash(JSON.stringify({subscriptionId,type,details}));
  const prior=await db.prepare('SELECT account_id,payload_hash FROM dog_food_plan_requests WHERE id=?').bind(id).first();
  if(prior){if(prior.account_id!==account.id||prior.payload_hash!==hash)throw new FoodAccountError('Request reference conflict. Refresh and try again.',409);return {message:'Your request is saved for office review. Your current plan remains unchanged.'};}
  const open=await db.prepare("SELECT COUNT(*) n FROM dog_food_plan_requests WHERE customer_id=? AND status IN ('pending','clarification','approved')").bind(account.customer_id).first();
  if(open.n>=10)throw new FoodAccountError('You already have requests awaiting review. Please call the office.',409);
  await db.batch([
    db.prepare('INSERT INTO dog_food_plan_requests(id,account_id,customer_id,subscription_id,request_type,details,payload_hash) VALUES (?,?,?,?,?,?,?)').bind(id,account.id,account.customer_id,subscriptionId,type,details,hash),
    db.prepare("INSERT INTO dog_food_plan_request_events(request_id,status,note,actor) VALUES (?,'pending',?,'customer')").bind(id,details),
    db.prepare("INSERT OR IGNORE INTO dog_food_transactional_outbox(event_key,customer_id,template,subject,text_body) VALUES (?,?,'plan_request_received','My Dog Food: request received',?)").bind('plan_request_received:'+id,account.customer_id,'Your '+type+' request was received and is pending office review. Your current food, delivery and billing remain unchanged.\n\nReview your request: https://www.ohiopetwastepros.com/dog-food/account/'),
    db.prepare("INSERT INTO dog_food_portal_audit(id,account_id,action,entity_id,details) VALUES (?,?,'plan_change_requested',?,?)").bind(crypto.randomUUID(),account.id,id,JSON.stringify({subscriptionId,type}))
  ]);
  return {message:'Request received — pending office review. Your current food, deliveries and billing remain unchanged until the office confirms the change.'};
}

export async function reviewFoodPlanRequest(db,body,actor) {
  const id=text(body.requestId,80),status=body.status,note=text(body.note,2000);
  if(!uuid(id)||!['clarification','approved','rejected','applied'].includes(status)||!note||!Number.isSafeInteger(body.revision))throw new FoodError('Choose a request, review decision and explanation.');
  const row=await db.prepare('SELECT r.* FROM dog_food_plan_requests r JOIN dog_food_customers c ON c.id=r.customer_id WHERE r.id=? AND c.deleted_at IS NULL').bind(id).first();
  if(!row)throw new FoodError('Request not found.',404);
  if(['rejected','applied'].includes(row.status))throw new FoodError('This request is closed. Its history is preserved.',409);
  const effectiveDate=status==='applied'?text(body.effectiveDate,10):null,reference=status==='applied'?text(body.sourceReference,200):null;
  if(status==='applied'&&(row.status!=='approved'||body.sourceVerified!==true||!validDate(effectiveDate)||!reference))throw new FoodError('First approve the request. Then verify the real billing/operational source and record its reference and effective date.',409);
  const result=await db.batch([
    db.prepare('UPDATE dog_food_plan_requests SET status=?,office_note=?,effective_date=?,source_reference=?,reviewed_by=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?').bind(status,note,effectiveDate,reference,actor,id,body.revision),
    db.prepare('INSERT INTO dog_food_plan_request_events(request_id,status,note,actor) SELECT id,status,office_note,? FROM dog_food_plan_requests WHERE id=? AND revision=? AND changes()>0').bind(actor,id,body.revision+1),
    db.prepare("INSERT OR IGNORE INTO dog_food_transactional_outbox(event_key,customer_id,template,subject,text_body) SELECT ?,customer_id,'plan_request_update','My Dog Food: plan request update',? FROM dog_food_plan_requests WHERE id=? AND revision=? AND changes()>0").bind('plan_request_update:'+id+'-'+(body.revision+1),status==='applied'?'The office recorded a verified source update effective '+effectiveDate+'. '+note+'\n\nReview your account: https://www.ohiopetwastepros.com/dog-food/account/':'Your request status is '+status+'. Approval alone does not change billing or deliveries. '+note+'\n\nReview your account: https://www.ohiopetwastepros.com/dog-food/account/',id,body.revision+1)
  ]);
  if(!result[0]?.meta?.changes)throw new FoodError('Another review changed this request. Refresh before continuing.',409);
  return {id,message:status==='applied'?'Source verification and effective date recorded.':status==='approved'?'Approved for processing. The existing plan remains in force until its real source is updated and verified.':'Review saved. No billing change was made.'};
}
