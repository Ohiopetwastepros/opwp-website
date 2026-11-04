// Integration check against scripts/preview-food-sales.mjs only. Never production.
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4330';let cookie='';
async function send(path,{body,method,extraHeaders={},expected=200}={}) {
  const r=await fetch(origin+path,{method:method||(body?'POST':'GET'),headers:{origin,cookie,'Content-Type':'application/json',...extraHeaders},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(r.status,expected,await r.clone().text());return {response:r,data:await r.json()};
}
await send('/api/food-sales/',{expected:401});
const login=await send('/api/food-sales/session/',{body:{email:'seller@example.test',password:'Demo-only!Sales2026'}});cookie=login.response.headers.get('set-cookie').split(';')[0];
assert.ok(login.response.headers.get('set-cookie').includes('HttpOnly'));
const found=(await send('/api/food-sales/?q=Synthetic')).data;assert.equal(found.customers[0].id,'buyer');
const items=[{productId:'edf-22-12-pink-40',quantity:1},{productId:'edf-26-14-blue-40',quantity:1}],quote=(await send('/api/food-sales/',{body:{action:'quote',items}})).data.result;
const body={action:'save',commandId:crypto.randomUUID(),customerId:'buyer',items,fulfillmentMethod:'delivery',fulfillmentStatus:'completed',handoffConfirmed:true,receivedBy:'Synthetic Buyer',billingProvider:'sweep_and_go',amountReceivedCents:1000,paymentMethod:'cash',paymentReceivedConfirmed:true,quoteHash:quote.quoteHash};
await send('/api/food-sales/',{body,expected:403,extraHeaders:{origin:'https://attacker.test'}});
let lost=false;try{await send('/api/food-sales/',{body,extraHeaders:{'x-opwp-qa-drop-response':'1'}});}catch{lost=true;}assert.equal(lost,true);
const status=(await send('/api/food-sales/?submission='+body.commandId)).data;assert.equal(status.saved,true);const saved=status.result;
const retry=(await send('/api/food-sales/',{body})).data.result;assert.deepEqual(retry,saved);
await send('/api/food-sales/',{body:{...body,amountReceivedCents:2000},expected:409});
await send('/api/food-sales/',{body:{action:'delete_native'},expected:403});
const receipt={action:'receipt',commandId:crypto.randomUUID(),orderId:saved.orderId,amountReceivedCents:quote.total-1000,paymentMethod:'check',paymentReference:'qa-check-'+crypto.randomUUID(),paymentReceivedConfirmed:true};
await send('/api/food-sales/',{body:receipt});await send('/api/food-sales/',{body:receipt});
const recent=(await send('/api/food-sales/')).data.recent.filter(o=>o.id===saved.orderId);assert.equal(recent.length,1);assert.equal(recent[0].paymentStatus,'paid');assert.equal(recent[0].fulfillmentStatus,'completed');assert.equal(recent[0].balanceCents,0);
await send('/api/food-sales/session/',{body:{},method:'DELETE'});await send('/api/food-sales/',{expected:401});
console.log(JSON.stringify({dataClass:'synthetic',transport:'loopback HTTP; real handlers and SQLite; provider and rate-limit transports isolated',login:'individual session',customer:'existing shared customer',formulas:2,totalCents:quote.total,openingReceiptCents:1000,lostResponseRecovered:true,sameIdReplay:true,differentPayloadRejected:true,receiptReplay:true,finalPaymentStatus:'paid',fulfillmentStatus:'completed',balanceCents:0,recentOrderCount:recent.length,crossSiteRejected:true,forbiddenActionRejected:true,logoutRevoked:true}));
