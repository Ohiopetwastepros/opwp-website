import {FoodError} from './dog-food-operations.mjs';
import {foodEmail,foodTokenHash} from './dog-food-account.mjs';
import {FOOD_STATES,foodProfileComplete} from './dog-food-profile.mjs';
import {salesHash,salesUuid} from './food-sales-ledger.mjs';
import {foodOptionalIntakeEnabled,foodStaffCustomerComplete} from './food-customer-intake.mjs';
import {assertFoodWritesAvailable,foodWebsiteState} from './dog-food-website-store.mjs';

// These preflight conflicts do not write a customer or invitation. Replay conflicts remain uncertain.
const customerConflict=(message,refreshRequired=false)=>Object.assign(new FoodError(message,409),{definitive:true,refreshRequired});
const required=(v,n,label)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>n)throw new FoodError(`Enter ${label}.`);return v.trim();};
const contactVersion=(c,addressId)=>salesHash({id:c.id,first:c.first_name,last:c.last_name,email:c.email,phone:c.phone,type:c.customer_type,addressId});
export function foodCustomerInput(body){
  const firstName=required(body.firstName,80,'the first name'),lastName=required(body.lastName,80,'the last name');
  let email='';if(String(body.email||'').trim())try{email=foodEmail(body.email);}catch{throw new FoodError('Enter a valid customer email, or leave it blank.');}
  const digits=String(body.phone||'').replace(/\D/g,''),phone=digits.length===10?'+1'+digits:digits.length===11&&digits[0]==='1'?'+'+digits:'';
  if(!phone)throw new FoodError('Enter a valid US phone number.');
  const address=required(body.address,200,'the street address'),city=required(body.city,100,'the city'),state=body.state,zip=body.zip;
  if(!FOOD_STATES.includes(state)||!/^\d{5}$/.test(zip||'')||zip==='00000')throw new FoodError('Choose the state and enter a five-digit ZIP code.');
  const dogCount=body.dogCount==null||body.dogCount===''?null:Number(body.dogCount),customerType=body.customerType||'on_demand',frequency=body.frequency||null,fulfillment=body.fulfillment,placement=fulfillment==='pickup'?null:body.placement;
  if(dogCount!==null&&(!Number.isSafeInteger(dogCount)||dogCount<1||dogCount>99))throw new FoodError('If supplied, the number of dogs must be from 1 to 99.');
  if(!['on_demand','scoop','route_partner'].includes(customerType)||frequency!==null&&!['as_needed','weekly','biweekly','monthly'].includes(frequency)||!['pickup','delivery'].includes(fulfillment))throw new FoodError('Choose the customer type and pickup or delivery.');
  if(fulfillment==='delivery'&&!['Front door','Side door','Garage','Other'].includes(placement))throw new FoodError('Choose the delivery placement or enter drop-off instructions.');
  const placementOther=placement==='Other'?required(body.placementOther,300,'the delivery instructions'):'';
  if(body.smsConsent!==undefined&&typeof body.smsConsent!=='boolean')throw new FoodError('SMS consent must be an explicit choice.');
  const notes=typeof body.notes==='string'?body.notes.trim():'';if(notes.length>4000)throw new FoodError('Customer notes must be at most 4,000 characters.');
  return {firstName,lastName,email,phone,address,city,state,zip,dogCount,customerType,frequency,fulfillment,placement,placementOther,notes,smsConsent:body.smsConsent===true};
}
async function replay(db,body,actor,hash){const r=await db.prepare('SELECT actor,payload_hash,result FROM dog_food_customer_commands WHERE id=?').bind(body.commandId).first();if(!r)return null;if(r.actor!==actor||r.payload_hash!==hash)throw new FoodError('This submission belongs to different details. Search the customer hub before another submission.',409);return JSON.parse(r.result);}
const invitations=(db,commandId,id,email,phone,channels)=>channels.map(channel=>db.prepare('INSERT INTO dog_food_customer_messages(id,command_id,customer_id,channel,recipient) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),commandId,id,channel,channel==='email'?email:phone));
const statusStamp=async(db,id)=>(await db.prepare("SELECT id FROM dog_food_ops_audit WHERE entity_id=? AND action='set_customer_status' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(id).first())?.id||null;
async function setCustomerStatus(db,body,actor,hash){
  if(!['active','inactive'].includes(body.status)||body.confirm!==true)throw new FoodError('Confirm active or inactive customer status.');
  const reason=required(body.reason,500,'a reason for this status change');
  const c=await db.prepare('SELECT id,status FROM dog_food_customers WHERE id=? AND deleted_at IS NULL').bind(body.customerId).first();
  if(!c)throw new FoodError('Customer not found.',404);
  const stamp=await statusStamp(db,c.id);
  if(body.expectedStatus!==c.status||body.statusVersion!==await salesHash({id:c.id,status:c.status,stamp}))throw new FoodError('Customer status changed. Refresh the profile before continuing.',409);
  if(c.status===body.status)throw new FoodError('The customer already has this status.',409);
  const guard=crypto.randomUUID(),deactivate=body.status==='inactive',now=Math.floor(Date.now()/1000);
  const result={id:c.id,message:deactivate?'Customer deactivated. Portal sessions ended and native Stripe plans paused. Existing orders and balances remain.':'Customer reactivated. They can sign in again; paused plans require a separate review.'};
  const statements=[
    db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN
      EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND deleted_at IS NULL AND status=?)
      AND (SELECT id FROM dog_food_ops_audit WHERE entity_id=? AND action='set_customer_status' ORDER BY created_at DESC,rowid DESC LIMIT 1) IS ?
      AND NOT EXISTS(SELECT 1 FROM dog_food_ops_state WHERE command_until>=CURRENT_TIMESTAMP)
      AND NOT EXISTS(SELECT 1 FROM dog_food_subscriptions WHERE customer_id=? AND billing_lease_until>=CURRENT_TIMESTAMP)
      AND NOT EXISTS(SELECT 1 FROM dog_food_customer_messages WHERE customer_id=? AND status='sending')
      THEN 1 ELSE 0 END)`).bind(guard,c.id,c.status,c.id,stamp,c.id,c.id),
    db.prepare('UPDATE dog_food_customers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.status,c.id),
  ];
  if(deactivate)statements.push(
    db.prepare("UPDATE dog_food_subscriptions SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND payment_provider='stripe' AND status IN('active','past_due')").bind(c.id),
    db.prepare('UPDATE dog_food_accounts SET auth_version=auth_version+1 WHERE customer_id=?').bind(c.id),
    db.prepare('UPDATE dog_food_account_sessions SET revoked_at=? WHERE account_id IN(SELECT id FROM dog_food_accounts WHERE customer_id=?) AND revoked_at IS NULL').bind(now,c.id),
    db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE email=(SELECT email FROM dog_food_customers WHERE id=?) AND used_at IS NULL').bind(now,c.id),
    db.prepare("UPDATE dog_food_customer_messages SET status='cancelled',detail='Customer deactivated before sending' WHERE customer_id=? AND status='queued'").bind(c.id),
  );
  statements.push(db.prepare('INSERT INTO dog_food_customer_commands(id,actor,payload_hash,result) VALUES(?,?,?,?)').bind(body.commandId,actor,hash,JSON.stringify(result)),
    db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,body.action,c.id,JSON.stringify({commandId:body.commandId,from:c.status,to:body.status,reason})),
    db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard));
  try{await db.batch(statements);}catch{const saved=await replay(db,body,actor,hash);if(saved)return saved;throw new FoodError('Status was not changed. Another sale, invitation or billing operation may be in progress. Refresh and try again.',409);}
  return result;
}
async function linkPortalAccount(db,body,actor,hash){
  if(!await foodOptionalIntakeEnabled(db))throw new FoodError('Secure profile linking awaits its approved migration.',503);
  if(body.confirm!==true||!textReason(body.reason))throw new FoodError('Confirm the exact verified account and retain the identity verification evidence.');
  const target=await db.prepare("SELECT * FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL").bind(body.customerId).first();
  const account=await db.prepare('SELECT a.*,c.first_name,c.last_name,c.phone,c.sng_client_id,c.stripe_customer_id FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id WHERE a.id=? AND c.deleted_at IS NULL').bind(body.accountId).first();
  if(!target||!account||account.customer_id!==body.expectedCustomerId||account.customer_id===target.id||account.profile_completed_at||account.first_name||account.last_name||account.phone||account.sng_client_id||account.stripe_customer_id)throw customerConflict('Only a verified, incomplete portal signup with no customer history can be linked here. Other merges require a separate review.',true);
  if(target.email&&target.email!==account.email||await db.prepare('SELECT id FROM dog_food_accounts WHERE customer_id=?').bind(target.id).first())throw customerConflict('The target already has a different email or portal account. Review identity before linking.',true);
  const profile=await db.prepare('SELECT preferred_fulfillment,revision FROM dog_food_customer_profiles WHERE customer_id=?').bind(target.id).first(),address=await db.prepare('SELECT * FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1').bind(target.id).first();
  if(body.targetVersion!==await contactVersion(target,address?.id||null))throw customerConflict('The target contact changed. Reload before linking.',true);
  const complete=Boolean(profile&&foodProfileComplete(target,address,profile.preferred_fulfillment)),guard=crypto.randomUUID(),stamp=Math.floor(Date.now()/1000),result={id:target.id,message:'Verified portal account linked to the existing customer. History and password retained; prior sessions ended. No invitation or payment was created.'};
  const statements=[db.prepare(`INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN
    EXISTS(SELECT 1 FROM dog_food_accounts WHERE id=? AND customer_id=? AND profile_completed_at IS NULL AND auth_version=?)
    AND EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND first_name='' AND last_name='' AND phone='' AND sng_client_id IS NULL AND stripe_customer_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM dog_food_orders WHERE customer_id=?) AND NOT EXISTS(SELECT 1 FROM dog_food_subscriptions WHERE customer_id=?)
    AND NOT EXISTS(SELECT 1 FROM dog_food_sales_customer_sources WHERE customer_id=?) AND NOT EXISTS(SELECT 1 FROM dog_food_direct_sale_links WHERE customer_id=?)
    AND NOT EXISTS(SELECT 1 FROM dog_food_accounts WHERE customer_id=?)
    AND EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL AND email=? AND phone=? AND first_name=? AND last_name=?)
    AND (SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1) IS ?
    AND (SELECT revision FROM dog_food_customer_profiles WHERE customer_id=?) IS ?
    AND NOT EXISTS(SELECT 1 FROM dog_food_customers WHERE lower(email)=? AND id NOT IN(?,?))
    THEN 1 ELSE 0 END)`).bind(guard,account.id,account.customer_id,account.auth_version,account.customer_id,account.customer_id,account.customer_id,account.customer_id,account.customer_id,target.id,target.id,target.email,target.phone,target.first_name,target.last_name,target.id,address?.id||null,target.id,profile?.revision??null,account.email,account.customer_id,target.id),
    db.prepare("UPDATE dog_food_customers SET email='',status='inactive',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(account.customer_id),
    db.prepare('UPDATE dog_food_customers SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(account.email,target.id),
    db.prepare('UPDATE dog_food_accounts SET customer_id=?,auth_version=auth_version+1,profile_completed_at=?,preferred_fulfillment=? WHERE id=?').bind(target.id,complete?new Date().toISOString():null,profile?.preferred_fulfillment||'delivery',account.id),
    db.prepare('UPDATE dog_food_account_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL').bind(stamp,account.id),
    db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE email=? AND used_at IS NULL').bind(stamp,account.email),
    db.prepare('INSERT INTO dog_food_customer_commands(id,actor,payload_hash,result,action) VALUES(?,?,?,?,?)').bind(body.commandId,actor,hash,JSON.stringify(result),body.action),
    db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,body.action,target.id,JSON.stringify({accountId:account.id,previousCustomerId:account.customer_id,customerId:target.id,verifiedEmail:account.email,reason:body.reason})),db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard)];
  if(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_source_line_reviews'").first())statements.unshift(db.prepare('INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM dog_food_source_line_reviews WHERE customer_id=?) THEN 1 ELSE 0 END)').bind(guard+'-source',account.customer_id)),statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-source'));
  try{await db.batch(statements);}catch{const saved=await replay(db,body,actor,hash);if(saved)return saved;throw customerConflict('A profile or history changed during linking. Reload and review both identities.',true);}return result;
}
const textReason=v=>typeof v==='string'&&v.trim().length>=10&&v.length<=2000;
export async function foodCustomerCommand(db,body,actor,{office=false,staffIntake=false}={}){
  await assertFoodWritesAvailable(db);
  if(!actor||!salesUuid(body.commandId))throw new FoodError('A signed-in staff account and persistent submission reference are required.');
  if(!['create_customer','update_customer','invite_customer','set_customer_status','link_portal_account'].includes(body.action)||body.action!=='create_customer'&&!office&&!(staffIntake&&body.action==='update_customer'))throw new FoodError('This customer action requires the office.',403);
  const hash=await salesHash(body),prior=await replay(db,body,actor,hash);if(prior)return prior;
  const optionalIntake=await foodOptionalIntakeEnabled(db);
  if(body.action==='link_portal_account')return linkPortalAccount(db,body,actor,hash);
  if(body.action==='set_customer_status')return setCustomerStatus(db,body,actor,hash);
  const isCreate=body.action==='create_customer',id=isCreate?crypto.randomUUID():body.customerId;
  let existing=null,profile=null,input,primaryId=null,channels=[];
  if(!isCreate){existing=await db.prepare("SELECT c.*,a.email account_email FROM dog_food_customers c LEFT JOIN dog_food_accounts a ON a.customer_id=c.id WHERE c.id=? AND c.deleted_at IS NULL AND c.status='active'").bind(id).first();profile=await db.prepare('SELECT * FROM dog_food_customer_profiles WHERE customer_id=?').bind(id).first();if(!existing)throw new FoodError('Active customer not found.',404);primaryId=(await db.prepare('SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1').bind(id).first())?.id||null;}
  if(!office&&!isCreate&&(await db.prepare('SELECT profile_completed_at FROM dog_food_accounts WHERE customer_id=?').bind(id).first())?.profile_completed_at)throw new FoodError('This customer has taken over their portal profile. The customer or office must update their information.',409);
  if(body.action==='invite_customer'){
    if(!optionalIntake)throw new FoodError('Explicit invitations await the approved customer intake migration.',503);
    if(body.confirm!==true||!profile||!existing.email)throw new FoodError('Save this customer with their own email address before sending a portal invitation.');
    channels=body.channels||['email'];if(!Array.isArray(channels)||!channels.length||new Set(channels).size!==channels.length||channels.some(c=>!['email','sms'].includes(c)))throw new FoodError('Choose email and, optionally, an authorized service text.');
    if(channels.includes('sms')&&(!profile.sms_consent_at||optionalIntake&&profile.sms_consent_phone!==existing.phone))throw new FoodError('Record the customer’s actual consent for this phone before sending a text.');
    const matches=(await db.prepare('SELECT id FROM dog_food_customers WHERE lower(email)=? LIMIT 3').bind(existing.email).all()).results||[];if(matches.length!==1||matches[0].id!==id)throw customerConflict('This email has an ambiguous customer match. Reconcile the identity before inviting.');
    const inFlight=await db.prepare("SELECT id FROM dog_food_customer_messages WHERE customer_id=? AND (status IN('queued','sending') OR created_at>datetime('now','-5 minutes')) LIMIT 1").bind(id).first();
    if(inFlight)throw new FoodError('An invitation was recently queued or sent. Check its delivery status before resending.',409);
    input={email:existing.email,phone:existing.phone};
  }else{
    input=foodCustomerInput(body);
    if(!optionalIntake&&(input.dogCount===null||input.frequency===null||!input.smsConsent))throw new FoodError('Optional customer intake awaits the approved database migration. No customer or message was created.',503);
    if(existing?.account_email&&existing.account_email!==input.email)throw customerConflict('This email belongs to an active portal login. Keep that email; an email change requires customer verification.');
    if(!isCreate&&(!Number.isInteger(body.revision)||body.revision!==(profile?.revision||0)))throw customerConflict('The customer record changed. Refresh before saving.',true);
    if(!isCreate&&body.version!==await contactVersion(existing,primaryId))throw customerConflict('The contact or address changed. Refresh before saving.',true);
    const duplicate=input.email?await db.prepare("SELECT id FROM dog_food_customers WHERE lower(email)=? AND id<>? LIMIT 1").bind(input.email,id).first():null;
    if(duplicate)throw customerConflict('A customer with this email already exists. Search and select their record.');
    if(isCreate){const candidates=(await db.prepare("SELECT id FROM dog_food_customers WHERE replace(replace(replace(replace(replace(phone,'+',''),'-',''),'(',''),')',''),' ','') IN (?,?) OR (lower(trim(first_name))=? AND lower(trim(last_name))=?) LIMIT 3").bind(input.phone.slice(1),input.phone.slice(2),input.firstName.toLowerCase(),input.lastName.toLowerCase()).all()).results||[];if(candidates.length)throw customerConflict('A possible customer with this phone or name already exists. Review the customer hub; no profiles were merged.');}
  }
  const result={id,message:isCreate?'Customer saved. No invitation, login or payment account was created.':body.action==='invite_customer'?'Portal access instructions queued.':'Customer information saved. Existing sales and login remain linked.'};
  const statements=[],guard=crypto.randomUUID();
  if(body.action==='invite_customer')statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND status='active' AND deleted_at IS NULL) THEN 1 ELSE 0 END)").bind(guard+'-invite',id));
  if(body.action!=='invite_customer'){
    statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN (?='' OR NOT EXISTS(SELECT 1 FROM dog_food_customers WHERE lower(email)=? AND id<>?)) THEN 1 ELSE 0 END)").bind(guard,input.email,input.email,id));
    if(isCreate)statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM dog_food_customers WHERE replace(replace(replace(replace(replace(phone,'+',''),'-',''),'(',''),')',''),' ','') IN (?,?) OR (lower(trim(first_name))=? AND lower(trim(last_name))=?)) THEN 1 ELSE 0 END)").bind(guard+'-identity',input.phone.slice(1),input.phone.slice(2),input.firstName.toLowerCase(),input.lastName.toLowerCase()));
    if(isCreate)statements.push(db.prepare('INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,customer_type) VALUES(?,?,?,?,?,?)').bind(id,input.firstName,input.lastName,input.email,input.phone,input.customerType));
    else{
      if(!office)statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM dog_food_accounts WHERE customer_id=? AND profile_completed_at IS NOT NULL) THEN 1 ELSE 0 END)").bind(guard+'-intake',id));
      statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND deleted_at IS NULL AND status='active' AND first_name=? AND last_name=? AND email=? AND phone=? AND customer_type=?) AND (SELECT id FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 ORDER BY created_at DESC LIMIT 1) IS ? THEN 1 ELSE 0 END)").bind(guard+'-contact',id,existing.first_name,existing.last_name,existing.email,existing.phone,existing.customer_type,id,primaryId));
      statements.push(db.prepare('INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN COALESCE((SELECT revision FROM dog_food_customer_profiles WHERE customer_id=?),0)=? THEN 1 ELSE 0 END)').bind(guard+'-revision',id,body.revision));
      statements.push(db.prepare("INSERT INTO dog_food_sales_write_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM dog_food_accounts WHERE customer_id=? AND email<>?) THEN 1 ELSE 0 END)").bind(guard+'-account',id,input.email));
      statements.push(db.prepare('UPDATE dog_food_customers SET first_name=?,last_name=?,email=?,phone=?,customer_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(input.firstName,input.lastName,input.email,input.phone,input.customerType,id));
      statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-account'));
      statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-contact'));
      statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-revision'));
      if(!office)statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-intake'));
    }
    // Preserve addresses referenced by historical orders; a correction creates a new primary address.
    statements.push(db.prepare('UPDATE dog_food_addresses SET is_primary=0 WHERE customer_id=? AND is_primary=1').bind(id));
    statements.push(db.prepare('INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,placement_preference,placement_other,is_primary) VALUES(?,?,?,?,?,?,?,?,1)').bind(crypto.randomUUID(),id,input.address,input.city,input.state,input.zip,input.placement,input.placementOther));
    const consentAt=input.smsConsent?(profile?.sms_consent_at&&existing?.phone===input.phone&&(!optionalIntake||profile.sms_consent_phone===input.phone)?profile.sms_consent_at:new Date().toISOString()):null;
    if(optionalIntake){
      statements.push(db.prepare(`INSERT INTO dog_food_customer_profiles(customer_id,dog_count,service_frequency,preferred_fulfillment,notes,sms_consent_at,sms_consent_phone,created_by,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET dog_count=excluded.dog_count,service_frequency=excluded.service_frequency,preferred_fulfillment=excluded.preferred_fulfillment,notes=excluded.notes,sms_consent_at=excluded.sms_consent_at,sms_consent_phone=excluded.sms_consent_phone,revision=revision+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(id,input.dogCount,input.frequency,input.fulfillment,input.notes,consentAt,consentAt?input.phone:null,actor,actor));
      if(consentAt!==(profile?.sms_consent_at||null)||existing&&existing.phone!==input.phone&&profile?.sms_consent_at)statements.push(db.prepare("INSERT INTO dog_food_customer_consent_events(id,customer_id,channel,phone,status,consent_at,evidence,recorded_by) VALUES(?,?,'sms',?,?,?,?,?)").bind(crypto.randomUUID(),id,input.phone,consentAt?'granted':'cleared',consentAt,JSON.stringify({commandId:body.commandId,source:'office_profile',explicitConsent:input.smsConsent,phoneChanged:Boolean(existing&&existing.phone!==input.phone)}),actor));
    }else statements.push(db.prepare(`INSERT INTO dog_food_customer_profiles(customer_id,dog_count,service_frequency,preferred_fulfillment,notes,sms_consent_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET dog_count=excluded.dog_count,service_frequency=excluded.service_frequency,preferred_fulfillment=excluded.preferred_fulfillment,notes=excluded.notes,sms_consent_at=excluded.sms_consent_at,revision=revision+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(id,input.dogCount,input.frequency,input.fulfillment,input.notes,consentAt,actor,actor));
    statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard));
    if(isCreate)statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-identity'));
    if(existing&&existing.email!==input.email)statements.push(db.prepare("UPDATE dog_food_customer_messages SET status='cancelled',detail='Customer contact changed before sending' WHERE customer_id=? AND status='queued'").bind(id));
  }
  statements.push(db.prepare('INSERT INTO dog_food_customer_commands(id,actor,payload_hash,result) VALUES(?,?,?,?)').bind(body.commandId,actor,hash,JSON.stringify(result)));
  if(body.action==='invite_customer')statements.push(...invitations(db,body.commandId,id,input.email,input.phone,channels));
  if(body.action==='invite_customer')statements.push(db.prepare('DELETE FROM dog_food_sales_write_guards WHERE id=?').bind(guard+'-invite'));
  statements.push(db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,body.action,id,JSON.stringify({commandId:body.commandId,portalAccountCreated:false,invitationQueued:body.action==='invite_customer'})));
  if(optionalIntake)statements.push(db.prepare('UPDATE dog_food_customer_commands SET action=? WHERE id=?').bind(body.action,body.commandId));
  try{await db.batch(statements);}catch(error){const saved=await replay(db,body,actor,hash);if(saved)return saved;throw error;}
  return result;
}
export async function foodCustomerMessages(db,id){return (await db.prepare('SELECT id,channel,status,provider_message_id,detail,attempted_at,completed_at,created_at FROM dog_food_customer_messages WHERE customer_id=? ORDER BY created_at DESC,id LIMIT 20').bind(id).all()).results||[];}
export async function readStaffFoodCustomerIntake(db,id){
  if(typeof id!=='string'||id.length>100)throw new FoodError('Choose a customer.');
  const optionalIntake=await foodOptionalIntakeEnabled(db);
  const c=await db.prepare(`SELECT c.id,c.first_name,c.last_name,c.email,c.phone,c.customer_type,c.status,p.dog_count,p.service_frequency,p.preferred_fulfillment,p.notes,p.revision,p.sms_consent_at,${optionalIntake?'p.sms_consent_phone':'NULL'} sms_consent_phone,a.id account_id,a.profile_completed_at
    FROM dog_food_customers c LEFT JOIN dog_food_customer_profiles p ON p.customer_id=c.id LEFT JOIN dog_food_accounts a ON a.customer_id=c.id WHERE c.id=? AND c.deleted_at IS NULL AND c.status='active'`).bind(id).first();
  if(!c)throw new FoodError('Active customer not found.',404);
  c.addresses=(await db.prepare("SELECT id,line1,city,state,postal_code,placement_preference,placement_other,is_primary FROM dog_food_addresses WHERE customer_id=? AND is_primary=1 AND postal_code<>'00000' ORDER BY created_at DESC LIMIT 1").bind(id).all()).results||[];
  c.version=await contactVersion(c,c.addresses[0]?.id||null);c.canEditIntake=!c.profile_completed_at;
  c.intakeComplete=foodStaffCustomerComplete(c,c.addresses[0],c.preferred_fulfillment||'delivery');return c;
}
export async function readFoodCustomerHub(db,{q='',id=null,offset=0,status='all'}={}){
  const optionalIntake=await foodOptionalIntakeEnabled(db);
  if(!['all','active','inactive'].includes(status))throw new FoodError('Choose an active, inactive or all-customer view.');
  const term=String(q||'').trim().slice(0,100),page=Math.floor(Math.max(0,Math.min(10000,Number(offset)||0)));
  const rows=(await db.prepare(`SELECT c.id,c.first_name,c.last_name,c.email,c.phone,c.customer_type,c.status,c.airtable_record_id,
    p.dog_count,p.service_frequency,p.preferred_fulfillment,p.notes,p.revision,p.sms_consent_at,${optionalIntake?'p.sms_consent_phone':'NULL'} sms_consent_phone,
    a.id account_id,a.profile_completed_at,
    (SELECT COUNT(*) FROM dog_food_orders o WHERE o.customer_id=c.id AND o.deleted_at IS NULL) order_count,
    (SELECT COUNT(*) FROM dog_food_subscriptions s WHERE s.customer_id=c.id AND s.status='active') active_plans,
    (SELECT MAX(created_at) FROM dog_food_customer_messages WHERE customer_id=c.id) last_invited_at
    FROM dog_food_customers c LEFT JOIN dog_food_customer_profiles p ON p.customer_id=c.id LEFT JOIN dog_food_accounts a ON a.customer_id=c.id
    WHERE c.deleted_at IS NULL AND (? IS NULL OR c.id=?) AND (?='all' OR (?='inactive' AND c.status<>'active') OR c.status=?) AND (instr(lower(c.first_name||' '||c.last_name||' '||c.email||' '||c.phone),lower(?))>0)
    ORDER BY c.last_name,c.first_name,c.id LIMIT 101 OFFSET ?`).bind(id,id,status,status,status,term,page).all()).results||[];
  const hasMore=rows.length>100,customers=rows.slice(0,100);
  if(id&&customers.length){
    const customer=customers[0];
    customer.backend=(await foodWebsiteState(db)).backend;
    customer.statusVersion=await salesHash({id,status:customer.status,stamp:await statusStamp(db,id)});
    customer.activity=(await db.prepare("SELECT id,actor,action,details,created_at FROM dog_food_ops_audit WHERE entity_id=? AND action IN('create_customer','update_customer','invite_customer','set_customer_status') ORDER BY created_at DESC,rowid DESC LIMIT 30").bind(id).all()).results?.map(r=>{const d=JSON.parse(r.details||'{}');return {id:r.id,actor:r.actor,action:r.action,created_at:r.created_at,reason:r.action==='set_customer_status'?d.reason:null,from:d.from,to:d.to};})||[];
    customer.addresses=(await db.prepare("SELECT id,line1,city,state,postal_code,placement_preference,placement_other,is_primary FROM dog_food_addresses WHERE customer_id=? AND postal_code<>'00000' ORDER BY is_primary DESC,created_at DESC LIMIT 20").bind(id).all()).results||[];
    customer.version=await contactVersion(customer,customer.addresses.find(a=>a.is_primary)?.id||null);
    customer.messages=await foodCustomerMessages(db,id);
    customer.portalLinkCandidates=(await db.prepare("SELECT a.id,a.email,a.customer_id,a.created_at FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id WHERE a.customer_id<>? AND a.profile_completed_at IS NULL AND c.deleted_at IS NULL AND c.first_name='' AND c.last_name='' AND c.phone='' AND NOT EXISTS(SELECT 1 FROM dog_food_orders o WHERE o.customer_id=c.id) ORDER BY a.created_at DESC LIMIT 50").bind(id).all()).results||[];
    customer.orderSummary=await db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(o.total_cents),0) total_cents,
      COALESCE(SUM(MAX(0,o.total_cents-COALESCE((SELECT SUM(amount_cents-CASE WHEN o.source='staff_sales' THEN 0 ELSE refunded_amount_cents END) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0))),0) balance_cents
      FROM dog_food_orders o WHERE o.customer_id=? AND o.deleted_at IS NULL`).bind(id).first();
    customer.orders=(await db.prepare(`SELECT o.id,o.order_number,o.status,o.source,o.total_cents,o.fulfillment_method,o.created_at,
      COALESCE((SELECT SUM(amount_cents-refunded_amount_cents) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0) received_cents,
      MAX(0,o.total_cents-COALESCE((SELECT SUM(amount_cents-CASE WHEN o.source='staff_sales' THEN 0 ELSE refunded_amount_cents END) FROM dog_food_payments WHERE order_id=o.id AND status IN('captured','refunded')),0)) balance_cents
      FROM dog_food_orders o WHERE o.customer_id=? AND o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 100`).bind(id).all()).results||[];
    const salesIntake=(await db.prepare('SELECT * FROM dog_food_sales_order_metadata WHERE order_id IN(SELECT id FROM dog_food_orders WHERE customer_id=?)').bind(id).all()).results||[];
    for(const o of customer.orders){const m=salesIntake.find(m=>m.order_id===o.id);if(m)Object.assign(o,{sale_date:m.sale_date,sale_customer_type:m.customer_type,sale_notes:m.sale_notes});}
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
  if(profile&&foodProfileComplete(customer,address,profile.preferred_fulfillment))await db.prepare('UPDATE dog_food_accounts SET profile_completed_at=CURRENT_TIMESTAMP,preferred_fulfillment=? WHERE id=? AND profile_completed_at IS NULL').bind(profile.preferred_fulfillment,account.id).run();
}
