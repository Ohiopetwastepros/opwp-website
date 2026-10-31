import staffPrivate from './staff-private.json' with {type:'json'};
import { cents, date, foodDate, text } from './dog-food-operations.mjs';

export {collectionReference} from './dog-food-collection-format.mjs';
export const staffPhone=value=>/^\+[1-9]\d{7,14}$/.test(String(value||''))?value:'';
const dollars=n=>`$${(n/100).toFixed(2)}`;
const ascii=value=>String(value||'').normalize('NFKD').replace(/[^\x20-\x7e\n]/g,' ').replace(/[ \t]+/g,' ').trim();
export function smsSegments(content) {
  // Conservative UCS-2 estimate if any non-GSM character slips into the text.
  const gsm=/^[\x20-\x7e\n\r]*$/.test(content);
  const length=gsm?[...content].reduce((n,c)=>n+(/[\[\]{}\\^~|]/.test(c)?2:1),0):content.length;
  return length<=(gsm?160:70)?1:Math.ceil(length/(gsm?153:67));
}
export function isSngCollectionSale(sale) {
  const marker=/(?:^|[^a-z0-9])sng(?:$|[^a-z0-9])|sweep[\s&+_-]*(?:(?:and|n)[\s&+_-]*)?go\b/i;
  return Boolean(sale.sngRelated||sale.sngJobId||[sale.source,sale.paymentMethod,sale.paymentReference,sale.notes,
    ...(sale.receipts||[]).flatMap(r=>[r.method,r.reference])].some(value=>marker.test(String(value||''))));
}
export function collectorSales(model,state,at=new Date()) {
  return model.unpaid.filter(s=>!isSngCollectionSale(s)&&(!s.nextFollowUp||s.nextFollowUp<=foodDate(at))&&
    (!s.responsiblePhone||staffPhone(s.responsiblePhone)===state.collector_phone)&&
    (!s.responsible||s.responsible.toLowerCase()===state.collector_name.toLowerCase()||s.responsible.toLowerCase()===staffPrivate.primaryShort.toLowerCase()&&new RegExp('^'+staffPrivate.primaryShort.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(state.collector_name)));
}
export function isCollectionReminderTime(at) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
  const part=type=>parts.find(p=>p.type===type)?.value;
  return part('weekday')==='Sun'&&part('hour')==='21'&&part('minute')==='00';
}
const customerKey=s=>text(s.name).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
export function collectableSales(rows) {
  rows=rows.filter(s=>!isSngCollectionSale(s));
  // Never turn a conflicting source balance into a simple instruction to collect.
  // Hold the customer's whole due total if any of its sales needs office review.
  const held=new Set(rows.filter(s=>s.warnings?.length).map(customerKey));
  return rows.filter(s=>customerKey(s)&&!held.has(customerKey(s))&&Number.isSafeInteger(s.balanceCents)&&s.balanceCents>0);
}
export function collectionSms(rows) {
  const customers=new Map();
  for(const sale of collectableSales(rows)) {
    const key=customerKey(sale),customer=customers.get(key)||{name:ascii(sale.name).replace(/\n/g,' ').slice(0,100),balance:0};
    customer.balance+=sale.balanceCents;customers.set(key,customer);
  }
  return `OPWP dog-food collections\n${[...customers.values()].map(c=>`${c.name}: ${dollars(c.balance)}`).join('\n')}`;
}
export function parseCollectionReply(content,at=new Date()) {
  // Entire-message match: promises, negations, quotations, or "done" can never
  // turn into a payment. Ambiguous/multi-sale messages require office review.
  if(typeof content!=='string'||content.length>300)return {valid:false,reason:'Long or truncated reports require office review.'};
  const match=/^PAID\s+(DF-[A-Z0-9]{8})\s+\$?(\d+(?:\.\d{1,2})?)\s+(cash|check|venmo|zelle|paypal)\s+(\d{4}-\d{2}-\d{2})\s+ref\s+([A-Za-z0-9][A-Za-z0-9._/#-]{0,79})$/i.exec(text(content,4000));
  if(!match)return {valid:false,reason:'No unambiguous single-sale payment report. Review Tony’s text; no financial change was made.'};
  try {
    const amount=cents(match[2]),paymentDate=date(match[4]);
    if(!amount||paymentDate>foodDate(at))return {valid:false,reason:'Payment amount must be positive and payment date cannot be in the future.'};
    return {valid:true,reference:match[1].toUpperCase(),amountCents:amount,date:paymentDate,
      method:{cash:'Cash',check:'Check',venmo:'Venmo / Zelle / PayPal',zelle:'Venmo / Zelle / PayPal',paypal:'Venmo / Zelle / PayPal'}[match[3].toLowerCase()],receipt:match[5].trim()};
  }catch{return {valid:false,reason:'Invalid amount or payment date; office review is required.'};}
}
