export const FOOD_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
export function foodPhone(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length === 10 ? '+1'+digits : digits.length === 11 && digits[0] === '1' ? '+'+digits : '';
}
export const FOOD_PLACEMENTS = ['Front door','Side door','Garage','Other'];
export function foodAddressInput(input, ErrorType) {
  const line1=String(input.address??'').trim(), city=String(input.city??'').trim(),
    state=String(input.state??'').trim().toUpperCase(), zip=String(input.zip??'').trim();
  if(!line1&&!city&&!zip)return null;
  if(!line1||line1.length>200||!city||city.length>100||!FOOD_STATES.includes(state)||!/^\d{5}$/.test(zip)||zip==='00000')
    throw new ErrorType('To save an address, enter a street, city, state and five-digit ZIP code. Leave the address blank to skip it.');
  const placement=input.placement||null, instructions=placement==='Other'?String(input.placementOther??'').trim():'';
  if(placement&&!FOOD_PLACEMENTS.includes(placement)||instructions.length>300)throw new ErrorType('Check the delivery placement and instructions.');
  return {line1,city,state,zip,placement,instructions};
}
export function foodProfileComplete(customer, address, fulfillment='delivery') {
  const phone=String(customer?.phone||'').replace(/\D/g,'');
  return Boolean(customer?.first_name?.trim() && customer?.last_name?.trim() && phone.length>=10 && phone.length<=11 &&
    address?.line1?.trim() && address?.city?.trim() && FOOD_STATES.includes(address?.state) && /^\d{5}$/.test(address?.postal_code||'') && address.postal_code!=='00000' &&
    (fulfillment==='pickup'||['Front door','Side door','Garage','Other'].includes(address?.placement_preference) &&
    (address.placement_preference!=='Other'||address.placement_other?.trim())));
}
