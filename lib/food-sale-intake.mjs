import {FoodError,date,foodDate} from './dog-food-operations.mjs';
export const FOOD_SALE_CUSTOMER_TYPES=[['individual','Individual'],['dealer','Dealer'],['route_partner','Route Partner']];
export const FOOD_RECEIPT_METHODS=[['cash','Cash'],['check','Check'],['venmo','Venmo'],['zelle','Zelle'],['paypal','PayPal'],['card','Credit/Debit Card (already paid)']];
export const foodReceiptLabel=v=>FOOD_RECEIPT_METHODS.find(([id])=>id===v)?.[1]||(v==='sweep_and_go'?'Sweep & Go':v||'Not recorded');
export function foodSaleIntake(body,{total,amount,customerType}){
  const saleDate=date(body.saleDate||foodDate());
  if(saleDate>foodDate())throw new FoodError('Sale date cannot be in the future. Choose a handoff date separately.');
  const type=body.saleCustomerType||(customerType==='route_partner'?'route_partner':'individual');
  if(!FOOD_SALE_CUSTOMER_TYPES.some(([v])=>v===type))throw new FoodError('Choose Individual, Dealer or Route Partner.');
  const status=amount>=total?'paid':amount>0?'partial':'unpaid';
  if(body.paymentStatus!==undefined&&body.paymentStatus!==status)throw new FoodError('Payment status must match the amount actually collected: '+status+'.');
  const notes=body.saleNotes===undefined?'':body.saleNotes;
  if(typeof notes!=='string'||notes.trim().length>4000)throw new FoodError('Sale notes must be at most 4,000 characters.');
  return {saleDate,customerType:type,paymentStatus:status,notes:notes.trim()};
}
