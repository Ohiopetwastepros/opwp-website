import {FoodError} from './dog-food-operations.mjs';
import {foodEmail,foodTokenHash} from './dog-food-account.mjs';
import {FOOD_STATES,foodProfileComplete} from './dog-food-profile.mjs';
import {salesHash,salesUuid} from './food-sales-ledger.mjs';

// These preflight conflicts do not write a customer or invitation. Replay conflicts remain uncertain.
const customerConflict=(message,refreshRequired=false)=>Object.assign(new FoodError(message,409),{definitive:true,refreshRequired});
const required=(v,n,label)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>n)throw new FoodError(`Enter ${label}.`);return v.trim();};
const contactVersion=(c,addressId)=>salesHash({id:c.id,first:c.first_name,last:c.last_name,email:c.email,phone:c.phone,type:c.customer_type,addressId});
export function foodCustomerInput(body){
  const firstName=required(body.firstName,80,'the first name'),lastName=required(body.lastName,80,'the last name');
  let email;try{email=foodEmail(body.email);}catch{throw new FoodError('Enter a valid customer email.');}
  const digits=String(body.phone||'').replace(/\D/g,''),phone=digits.length===10?'+1'+digits:digits.length===11&&digits[0]==='1'?'+'+digits:'';
  if(!phone)throw new FoodError('Enter a valid US mobile phone number.');
  const address=required(body.address,200,'the street address'),city=required(body.city,100,'the city'),state=body.state,zip=body.zip;
  if(!FOOD_STATES.includes(state)||!/^\d{5}$/.test(zip||''))throw new FoodError('Choose the state and enter a five-digit ZIP code.');
  const dogCount=Number(body.dogCount),customerType=body.customerType,frequency=body.frequency,fulfillment=body.fulfillment,placement=body.placement;
  if(!Number.isSafeInteger(dogCount)||dogCount<1||dogCount>99)throw new FoodError('Enter the number of dogs, from 1 to 99.');
  if(!['on_demand','scoop','route_partner'].includes(customerType)||!['as_needed','weekly','biweekly','monthly'].includes(frequency)||!['pickup','delivery'].includes(fulfillment))throw new FoodError('Choose customer type, service frequency and pickup or delivery.');
  if(!['Front door','Side door','Garage','Other'].includes(placement))throw new FoodError('Choose the preferred delivery placement.');
  const placementOther=placement==='Other'?required(body.placementOther,300,'the delivery instructions'):'';
  if(body.smsConsent!==true)throw new FoodError('Confirm the customer agreed to receive their portal invitation and service texts.');
  const notes=typeof body.notes==='string'?body.notes.trim():'';if(notes.length>4000)throw new FoodError('Customer notes must be at most 4,000 characters.');
  return {firstName,lastName,email,phone,address,city,state,zip,dogCount,customerType,frequency,fulfillment,placement,placementOther,notes,smsConsent:true};
}
async function replay(db,body,actor,hash){const r=await db.prepare('SELECT actor,payload_hash,result FROM dog_food_customer_commands WHERE id=?').bind(body.commandId).first();if(!r)return null;if(r.actor!==actor||r.payload_hash!==hash)throw new FoodError('This submission belongs to different details. Search the customer hub before another submission.',409);return JSON.parse(r.result);}
const invitations=(db,commandId,id,email,phone)=>['email','sms'].map(channel=>db.prepare('INSERT INTO dog_food_customer_messages(id,command_id,customer_id,channel,recipient) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),commandId,id,channel,channel==='email'?email:phone));
export async function foodCustomerCommand(db,body,actor,{office=false}={}){
  if(!actor||!salesUuid(body.commandId))throw new FoodError('A signed-in staff account and persistent submission reference are required.');
  if(!['create_customer','update_customer','invite_customer'].includes(body.action)||body.action!=='create_customer'&&!office)throw new FoodError('This customer action requires the office.',403);
  const hash=await salesHash(body),prior=await replay(db,body,actor,hash);if(prior)return prior;
  const isCreate=body.action==='create_customer',id=isCreate?crypto.randomUUID():body.customerId;
  let existing=null,profile=null,input,primaryId=null;
  if(!isCreate){existing=await db.prepare("SELECT c.*,a.email account_email FROM dog_food_customers c LEFT JOIN dog_food_accounts a ON a.customer_id=c.id WHERE c.id=? AND c.deleted_at IS NULL AND c.status='active'").bind(id).first();profile=await db.prepare('SELECT * FROM dog_food_customer_profiles WHERE customer_id=?').bind(id).first();if(!existing)throw new FoodError('Active customer not found.',404);primaryId=(await db.prepare('SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1').bind(id).first())?.id||null;}
  if(body.action==='invite_customer'){
    if(body.confirm!==true||!profile)throw new FoodError('Complete the required customer profile before sending portal access instructions.');
    const inFlight=await db.prepare("SELECT id FROM dog_food_customer_messages WHERE customer_id=? AND (status IN('queued','sending') OR created_at>datetime('now','-5 minutes')) LIMIT 1").bind(id).first();
    if(inFlight)throw new FoodError('An invitation was recently queued or sent. Check its delivery status before resending.',409);
    input={email:existing.email,phone:existing.phone};
  }else{
    input=foodCustomerInput(body);
    if(existing?.account_email&&existing.account_email!==input.email)throw customerConflict('This email belongs to an active portal login. Keep that email; an email change requires customer verification.');
    if(!isCreate&&(!Number.isInteger(body.revision)||body.revision!==(profile?.revision||0)))throw customerConflict('The customer record changed. Refresh before saving.',true);
    if(!isCreate&&body.version!==await contactVersion(existing,primaryId))throw customerConflict('The contact or address changed. Refresh before saving.',true);
    const duplicate=await db.prepare("SELECT id FROM dog_food_customers WHERE lower(email)=? AND id<>? LIMIT 1").bind(input.email,id).first();
    if(duplicate)throw customerConflict('A customer with this email already exists. Search and select their record.');
  }
  const result={id,message:isCreate?'Customer created. Portal email and text are queued.':body.action==='invite_customer'?'Portal access instructions queued.':'Customer information saved. Existing sales and login remain linked.'};
  const statements=[],guard=crypto.randomUUID();
  if(body.action!=='invite_customer'){
    statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM dog_food_customers WHERE lower(email)=? AND id<>?) THEN 1 ELSE 0 END)").bind(guard,input.email,id));
    if(isCreate)statements.push(db.prepare('INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,customer_type) VALUES(?,?,?,?,?,?)').bind(id,input.firstName,input.lastName,input.email,input.phone,input.customerType));
    else{
      statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND deleted_at IS NULL AND status='active' AND first_name=? AND last_name=? AND email=? AND phone=? AND customer_type=?) AND (SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1) IS ? THEN 1 ELSE 0 END)").bind(guard+'-contact',id,existing.first_name,existing.last_name,existing.email,existing.phone,existing.customer_type,id,primaryId));
      statements.push(db.prepare('INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN COALESCE((SELECT revision FROM dog_food_customer_profiles WHERE customer_id=?),0)=? THEN 1 ELSE 0 END)').bind(guard+'-revision',id,body.revision));
      statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM dog_food_accounts WHERE customer_id=? AND email<>?) THEN 1 ELSE 0 END)").bind(guard+'-account',id,input.email));
      statements.push(db.prepare('UPDATE dog_food_customers SET first_name=?,last_name=?,email=?,phone=?,customer_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(input.firstName,input.lastName,input.email,input.phone,input.customerType,id));
      statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-account'));
      statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-contact'));
      statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-revision'));
    }
    // Preserve addresses referenced by historical orders; a correction creates a new primary address.
    statements.push(db.prepare('UPDATE dog_food_addresses SET is_primary=0 WHERE customer_id=? AND is_primary=1').bind(id));
    statements.push(db.prepare('INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,placement_preference,placement_other,is_primary) VALUES(?,?,?,?,?,?,?,?,1)').bind(crypto.randomUUID(),id,input.address,input.city,input.state,input.zip,input.placement,input.placementOther));
    statements.push(db.prepare(`INSERT INTO dog_food_customer_profiles(customer_id,dog_count,service_frequency,preferred_fulfillment,notes,sms_consent_at,created_by,updated_by)
      VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,?,?) ON CONFLICT(customer_id) DO UPDATE SET dog_count=excluded.dog_count,service_frequency=excluded.service_frequency,preferred_fulfillment=excluded.preferred_fulfillment,notes=excluded.notes,sms_consent_at=excluded.sms_consent_at,revision=revision+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(id,input.dogCount,input.frequency,input.fulfillment,input.notes,actor,actor));
    statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard));
    if(existing&&existing.email!==input.email)statements.push(db.prepare("UPDATE dog_food_customer_messages SET status='cancelled',detail='Customer contact changed before sending' WHERE customer_id=? AND status='queued'").bind(id));
  }
  statements.push(db.prepare('INSERT INTO dog_food_customer_commands(id,actor,payload_hash,result) VALUES(?,?,?,?)').bind(body.commandId,actor,hash,JSON.stringify(result)));
  if(isCreate||body.action==='invite_customer')statements.push(...invitations(db,body.commandId,id,input.email,input.phone));
  statements.push(db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,body.action,id,JSON.stringify({commandId:body.commandId,portalAccountCreated:false,invitationQueued:isCreate||body.action==='invite_customer'})));
  try{await db.batch(statements);}catch(error){const saved=await replay(db,body,actor,hash);if(saved)return saved;throw error;}
  return result;
}
export async function foodCustomerMessages(db,id){return (await db.prepare('SELECT id,channel,status,provider_message_id,detail,attempted_at,completed_at,created_at FROM dog_food_customer_messages WHERE customer_id=? ORDER BY created_at DESC,id LIMIT 20').bind(id).all()).results||[];}
export async function readFoodCustomerHub(db,{q='',id=null,offset=0}={}){
  const term=String(q||'').trim().slice(0,100),page=Math.floor(Math.max(0,Math.min(10000,Number(offset)||0)));
  const rows=(await db.prepare(`SELECT c.id,c.first_name,c.last_name,c.email,c.phone,c.customer_type,c.status,c.airtable_record_id,
    p.dog_count,p.service_frequency,p.preferred_fulfillment,p.notes,p.revision,p.sms_consent_at,
    a.id account_id,a.profile_completed_at,
    (SELECT COUNT(*) FROM dog_food_orders o WHERE o.customer_id=c.id AND o.deleted_at IS NULL) order_count,
    (SELECT COUNT(*) FROM dog_food_subscriptions s WHERE s.customer_id=c.id AND s.status='active') active_plans,
    (SELECT MAX(created_at) FROM dog_food_customer_messages WHERE customer_id=c.id) last_invited_at
    FROM dog_food_customers c LEFT JOIN dog_food_customer_profiles p ON p.customer_id=c.id LEFT JOIN dog_food_accounts a ON a.customer_id=c.id
    WHERE c.deleted_at IS NULL AND (? IS NULL OR c.id=?) AND (instr(lower(c.first_name||' '||c.last_name||' '||c.email||' '||c.phone),lower(?))>0)
    ORDER BY c.last_name,c.first_name,c.id LIMIT 101 OFFSET ?`).bind(id,id,term,page).all()).results||[];
  const hasMore=rows.length>100,customers=rows.slice(0,100);
  if(id&&customers.length){
    const customer=customers[0];
    customer.addresses=(await db.prepare("SELECT id,line1,city,state,postal_code,placement_preference,placement_other,is_primary FROM dog_food_addresses WHERE customer_id=? AND postal_code<>'00000' ORDER BY is_primary DESC,created_at DESC LIMIT 20").bind(id).all()).results||[];
    customer.version=await contactVersion(customer,customer.addresses.find(a=>a.is_primary)?.id||null);
    customer.messages=await foodCustomerMessages(db,id);
    customer.orders=(await db.prepare(`SELECT o.id,o.order_number,o.status,o.source,o.total_cents,o.fulfillment_method,o.created_at,
      COALESCE((SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0) received_cents,
      MAX(0,o.total_cents-COALESCE((SELECT SUM(amount_cents-CASE WHEN o.source='staff_sales' THEN 0 ELSE refunded_amount_cents END) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0)) balance_cents
      FROM dog_food_orders o WHERE o.customer_id=? AND o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 100`).bind(id).all()).results||[];
    customer.plans=(await db.prepare('SELECT id,status,payment_provider,next_delivery_date,next_charge_at FROM dog_food_subscriptions WHERE customer_id=? ORDER BY created_at DESC LIMIT 30').bind(id).all()).results||[];
    customer.sourceLinks=(await db.prepare('SELECT source_table,source_record_id FROM dog_food_sales_customer_sources WHERE customer_id=?').bind(id).all()).results||[];
  }
  return {customers,hasMore,offset:page};
}
export async function linkStaffFoodPortalProfile(db,sessionToken){
  if(!sessionToken)return;
  const account=await db.prepare(`SELECT a.id,a.customer_id,a.profile_completed_at FROM dog_food_account_sessions s JOIN dog_food_accounts a ON a.id=s.account_id AND a.auth_version=s.auth_version WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`).bind(await foodTokenHash(sessionToken),Math.floor(Date.now()/1000)).first();
  if(!account||account.profile_completed_at)return;
  const customer=await db.prepare('SELECT first_name,last_name,phone FROM dog_food_customers WHERE id=? AND deleted_at IS NULL').bind(account.customer_id).first();
  const address=await db.prepare('SELECT * FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1').bind(account.customer_id).first();
  const profile=await db.prepare('SELECT preferred_fulfillment FROM dog_food_customer_profiles WHERE customer_id=?').bind(account.customer_id).first();
  if(profile&&foodProfileComplete(customer,address))await db.prepare('UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP,preferred_fulfillment=? WHERE id=? AND profile_completed_at IS NULL').bind(profile.preferred_fulfillment,account.id).run();
}
