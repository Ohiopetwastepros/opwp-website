// Public presentation and server policy share cents, fees and tax rounding.
// Order creation still loads all product prices and ownership from the database.
export const FOOD_TAX_BASIS_POINTS = 775;
export const FOOD_TAX_LABEL = 'Lucas County tax · 7.75%';
export const FOOD_DELIVERY_OPTIONS = Object.freeze([
  Object.freeze({id:'route_day',name:'Next route day',feeCents:0,detail:'Our next qualifying route in your area. We confirm the date.'}),
  Object.freeze({id:'next_day',name:'Next day',feeCents:500,detail:'Request delivery tomorrow, subject to route capacity and stock.'}),
  Object.freeze({id:'same_day',name:'Same day',feeCents:1000,detail:'Request delivery today before noon, subject to capacity and stock.'}),
]);

export function foodSameDayOpen(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now)) < 12;
}

export function foodCheckoutTotals(items = [], deliverySpeed = 'route_day') {
  const delivery = FOOD_DELIVERY_OPTIONS.find(o=>o.id===deliverySpeed);
  if (!delivery) throw new Error('Choose a valid delivery option.');
  const subtotal = items.reduce((n,i)=>n+Number(i.unit_price_cents)*Number(i.quantity),0);
  // Preserve the existing per-bag rounding used by monthly renewal billing.
  const foodTax = items.reduce((n,i)=>n+Math.round(Number(i.unit_price_cents)*FOOD_TAX_BASIS_POINTS/10000)*Number(i.quantity),0);
  const deliveryFee = items.length ? delivery.feeCents : 0;
  const tax = foodTax + Math.round(deliveryFee*FOOD_TAX_BASIS_POINTS/10000);
  return {subtotal,deliveryFee,tax,total:subtotal+deliveryFee+tax};
}

export function foodDeliveryPreference(body, now = new Date()) {
  if (!['on_demand','subscription'].includes(body.plan)) throw new Error('Choose a one-time order or monthly delivery.');
  const deliverySpeed = body.deliverySpeed ?? 'route_day';
  if (!FOOD_DELIVERY_OPTIONS.some(o=>o.id===deliverySpeed)) throw new Error('Choose a valid delivery option.');
  if (body.plan === 'on_demand') {
    if (deliverySpeed === 'same_day' && !foodSameDayOpen(now)) throw new Error('Same-day requests close at noon Eastern. Choose next-day or your next free route day.');
    return {deliverySpeed,cadence:'route_day',monthDay:null,serviceWeek:null};
  }
  if (deliverySpeed !== 'route_day') throw new Error('Monthly plans use free route delivery. Place a separate one-time order for faster delivery.');
  if (!['fixed_day','service_week'].includes(body.cadence)) throw new Error('Choose a monthly delivery preference.');
  const monthDay = body.cadence === 'fixed_day' ? Number(body.monthDay) : null;
  const serviceWeek = body.cadence === 'service_week' ? Number(body.serviceWeek) : null;
  if ((monthDay !== null && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31)) || (serviceWeek !== null && (!Number.isInteger(serviceWeek) || serviceWeek < 1 || serviceWeek > 4))) throw new Error('Choose a calendar day or service week.');
  return {deliverySpeed,cadence:body.cadence,monthDay,serviceWeek};
}
