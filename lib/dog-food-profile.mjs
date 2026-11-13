export const FOOD_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
export function foodProfileComplete(customer, address, fulfillment='delivery') {
  const phone=String(customer?.phone||'').replace(/\D/g,'');
  return Boolean(customer?.first_name?.trim() && customer?.last_name?.trim() && phone.length>=10 && phone.length<=11 &&
    address?.line1?.trim() && address?.city?.trim() && FOOD_STATES.includes(address?.state) && /^\d{5}$/.test(address?.postal_code||'') &&
    (fulfillment==='pickup'||['Front door','Side door','Garage','Other'].includes(address?.placement_preference) &&
    (address.placement_preference!=='Other'||address.placement_other?.trim())));
}
