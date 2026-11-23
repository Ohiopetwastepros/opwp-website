import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceDisplayStatus,invoiceOutstandingCents,invoiceIsOwed,invoiceCollectionCutoff} from '../components/crm/InvoiceView.mjs';
const approved = {status:'approved',totalCents:12000,held:false,reconciliationRequired:false,scheduledChargeAt:'2026-12-01T14:00:00Z'};
test('collectible balances use the stored total once and exclude draft, settled and uncertain outcomes',()=>{
  assert.equal(invoiceOutstandingCents({...approved,credits:[{amountCents:1500}],totalCents:10500}),10500);
  assert.equal(invoiceOutstandingCents({...approved,status:'failed'}),12000);
  for(const status of ['draft','paid','void','written_off','pending','charging'])assert.equal(invoiceOutstandingCents({...approved,status}),0,status);
  assert.equal(invoiceOutstandingCents({...approved,reconciliationRequired:true}),0);
  assert.equal(invoiceIsOwed({...approved,status:'pending'}),false);
  assert.equal(invoiceIsOwed({...approved,status:'failed'}),true);
});
test('overdue follows the persisted collection cutoff rather than the invoice period',()=>{
  const now='2026-11-21T18:00:00Z';
  assert.equal(invoiceDisplayStatus({...approved,periodStart:'2026-10-01'},now),'open');
  assert.equal(invoiceDisplayStatus({...approved,scheduledChargeAt:'2026-11-20T14:00:00Z'},now),'overdue');
  assert.equal(invoiceDisplayStatus({...approved,scheduledChargeAt:null},now),'open');
  assert.equal(invoiceDisplayStatus({...approved,scheduledChargeAt:'invalid'},now),'open');
  assert.equal(invoiceDisplayStatus({...approved,totalCents:0,scheduledChargeAt:'2026-01-01T14:00:00Z'},now),'open');
});
test('a calendar due date remains due through its Eastern day and takes priority over the schedule',()=>{
  const invoice={...approved,dueDate:'2026-11-21',scheduledChargeAt:'2026-10-01T14:00:00Z'};
  assert.equal(invoiceCollectionCutoff(invoice),'2026-11-21');
  assert.equal(invoiceDisplayStatus(invoice,'2026-11-22T04:59:00Z'),'open');
  assert.equal(invoiceDisplayStatus(invoice,'2026-11-22T05:01:00Z'),'overdue');
  assert.equal(invoiceDisplayStatus({...invoice,dueDate:'2026-02-31'},'2026-11-22T05:01:00Z'),'open');
});
test('failed outcomes and pending settlements keep distinct native meanings without overlapping overdue totals',()=>{
  const past={...approved,scheduledChargeAt:'2026-01-01T14:00:00Z'};
  assert.equal(invoiceDisplayStatus({...past,status:'failed'},'2026-11-21T18:00:00Z'),'failed');
  assert.equal(invoiceDisplayStatus({...past,status:'pending'},'2026-11-21T18:00:00Z'),'open');
  assert.equal(invoiceDisplayStatus({...past,status:'charging'},'2026-11-21T18:00:00Z'),'open');
  assert.equal(invoiceDisplayStatus({...past,held:true},'2026-11-21T18:00:00Z'),'open');
  assert.equal(invoiceDisplayStatus({...past,reconciliationRequired:true},'2026-11-21T18:00:00Z'),'open');
});
test('display helpers never change the native invoice or manufacture a collectible amount',()=>{
  const invoice=Object.freeze({...approved,totalCents:1.25});
  assert.equal(invoiceOutstandingCents(invoice),0);assert.equal(invoiceDisplayStatus(invoice,'2026-12-02T18:00:00Z'),'open');
  assert.equal(invoice.status,'approved');assert.equal(invoice.totalCents,1.25);
});
