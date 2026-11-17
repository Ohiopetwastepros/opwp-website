import {FOOD_STATES} from './dog-food-profile.mjs';
export async function foodOptionalIntakeEnabled(db){return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_customer_consent_events'").first());}
export function foodStaffCustomerContactComplete(customer){
  const phone=String(customer?.phone||'').replace(/\D/g,'');
  return Boolean(customer?.first_name?.trim()&&customer?.last_name?.trim()&&phone.length>=10&&phone.length<=11);
}
export function foodStaffCustomerComplete(customer,address,fulfillment='delivery'){
  if(!foodStaffCustomerContactComplete(customer)||!address?.line1?.trim()||!address.city?.trim()||!FOOD_STATES.includes(address.state)||!/^\d{5}$/.test(address.postal_code||'')||address.postal_code==='00000')return false;
  return fulfillment==='pickup'||['Front door','Side door','Garage'].includes(address.placement_preference)||address.placement_preference==='Other'&&Boolean(address.placement_other?.trim());
}
