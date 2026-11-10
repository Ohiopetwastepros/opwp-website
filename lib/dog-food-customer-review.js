import {FoodError,text} from './dog-food-operations.mjs';
import {readLiveDensity} from './live-density-store.mjs';
import {foodAirtable} from './dog-food-ops-store';
import {foodWebsiteState,queueFoodStatement} from './dog-food-website-store.mjs';
const normalized=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export async function foodCustomerReview(env,body,actor) {
  if(body.confirm!==true||!Number.isSafeInteger(body.revision)||body.revision<1||!['food_only','linked'].includes(body.relationship))throw new FoodError('Confirm the current customer review and relationship.');
  const customerId=text(body.customerId,100),row=await env.DB.prepare(`SELECT r.* FROM dog_food_customer_reviews r JOIN dog_food_customers c ON c.id=r.customer_id WHERE r.customer_id=? AND c.deleted_at IS NULL`).bind(customerId).first();
  if(!row||row.revision!==body.revision)throw new FoodError('The saved profile changed. Refresh before approving.',409);
  if((await foodWebsiteState(env.DB)).backend==='website'){
    await queueFoodStatement(env.DB,env.DB.prepare(`INSERT INTO dog_food_route_confirmations(customer_id,profile_revision,relationship,evidence,reviewed_by) VALUES(?,?,?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET profile_revision=excluded.profile_revision,relationship=excluded.relationship,evidence=excluded.evidence,reviewed_by=excluded.reviewed_by,reviewed_at=CURRENT_TIMESTAMP`).bind(customerId,row.revision,body.relationship,JSON.stringify({profile:JSON.parse(row.profile_json),officeConfirmed:true,billingIdentityChanged:false}),actor));
    await queueFoodStatement(env.DB,env.DB.prepare("UPDATE dog_food_customer_reviews SET status='reviewed',relationship=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND revision=?").bind(body.relationship,actor,customerId,body.revision));
    return {message:'Current website profile and service relationship reviewed. Billing identities remain unchanged; delivery uses office-confirmed capacity.'};
  }
  let id=null;
  if(body.relationship==='linked') {
    id=text(body.opwpRecordId,30);if(!/^rec[a-zA-Z0-9]{14}$/.test(id))throw new FoodError('Choose the actual OPWP record.');
    const source=await readLiveDensity(env.DB);
    if(source.stale||source.status!=='success'||!source.clients.some(c=>c.id===id))throw new FoodError('Refresh the active OPWP source before confirming a shared customer.',409);
    if(!env.AIRTABLE_API_KEY)throw new FoodError('The OPWP customer connection is unavailable.',503);
    const record=await foodAirtable({...env,DOG_FOOD_AIRTABLE_TOKEN:undefined},`appcAWPBQB8GmOrcT/tblhi8MGUOsWNmd37/${id}`),profile=JSON.parse(row.profile_json),f=record.fields||{};
    // This action records the office review; it never rewrites CRM contact details, service days, staff or SNG billing identities.
    if(record.id!==id||f.Status!=='Active'||profile.state!=='OH'||normalized(f['Client Name'])!==normalized(profile.firstName+' '+profile.lastName)||normalized(f.Address)!==normalized(profile.address)||normalized(f.City)!==normalized(profile.city)||String(f.ZIP)!==profile.zip)throw new FoodError('The OPWP identity/address differs. Reconcile the shared record and route in Airtable, then confirm this review.',409);
    const duplicate=await env.DB.prepare('SELECT customer_id FROM dog_food_customer_reviews WHERE opwp_record_id=? AND customer_id<>?').bind(id,customerId).first();
    if(duplicate)throw new FoodError('This OPWP record is already linked. Review identity before merging customers.',409);
  }
  const saved=await env.DB.prepare(`UPDATE dog_food_customer_reviews SET status='reviewed',relationship=?,opwp_record_id=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND revision=?`).bind(body.relationship,id,actor,customerId,body.revision).run();
  if(!saved.meta?.changes)throw new FoodError('The profile changed during review. Refresh before approving.',409);
  return {message:'Office review recorded. No OPWP contact, route or billing record was automatically changed.'};
}
