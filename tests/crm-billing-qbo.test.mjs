import test from 'node:test';
import assert from 'node:assert/strict';
import * as qbo from '../lib/crm-billing-qbo.mjs';
import { assertNoPaymentSecrets } from '../lib/crm-billing-security.mjs';

const mapping = () => ({ reviewed: true, realmId: 'fixture-realm', customerId: 'fixture-customer', itemIds: { base_plan: 'item-service', yard_size: 'item-yard', addon: 'item-addon', manual_adjustment: 'item-service' }, discountAccountId: 'account-discounts', undepositedFundsAccountId: 'account-undeposited', bankAccountId: 'account-bank', feeExpenseAccountId: 'account-fees', feePayableAccountId: 'account-fees-payable', refundItemId: 'item-refunds' });
const invoice = () => ({ id: 'invoice-one', customerId: 'customer-one', status: 'approved', qboId: 'qbo-invoice-one', invoiceDate: '2026-12-01', dueDate: '2026-12-01', periodStart: '2026-12-01', periodEnd: '2027-01-01', totalCents: 12000,
  lineItems: [{ id: 'base', label: 'Weekly two-dog service', kind: 'base_plan', totalCents: 10500 }, { id: 'yard', label: 'Large yard', kind: 'yard_size', totalCents: 1500 }] });
const payment = () => ({ id: 'payment-one', status: 'paid', confirmed: true, transactionId: 'fixture-cardpointe-retref', paidDate: '2026-12-01', amountCents: 12000 });
function accountingTotal(item) {
  if (item.entity === 'Payment') return Math.round(item.payload.TotalAmt * 100);
  return Math.round((item.payload.Line.reduce((sum, line) => sum + (line.DetailType === 'DiscountLineDetail' ? -line.Amount : line.Amount), 0) + (item.payload.TxnTaxDetail?.TotalTax || 0)) * 100);
}

test('invoice and gross payment mapping reconcile without processor-fee netting or Intuit charging', async () => {
  const inv = await qbo.buildQboInvoice(invoice(), mapping()), paid = await qbo.buildQboPayment(invoice(), payment(), mapping());
  assert.equal(accountingTotal(inv), 12000); assert.equal(inv.expectedTotalCents, 12000);
  assert.equal(paid.payload.TotalAmt, 120); assert.equal(paid.payload.Line[0].Amount, 120);
  assert.equal(paid.payload.DepositToAccountRef.value, 'account-undeposited');
  assert.equal(paid.payload.ProcessPayment, false); assert.equal(paid.payload.CreditCardPayment, undefined);
  assert.equal(paid.payload.Line[0].LinkedTxn[0].TxnId, 'qbo-invoice-one');
  assert.equal(inv.payload.AllowOnlineCreditCardPayment, false); assert.equal(inv.payload.EmailStatus, 'NotSet');
});

test('tax and negative local credit lines use reviewed tax and positive QBO discount amounts exactly', async () => {
  const value = invoice(); value.totalCents = 10100; value.taxableCents = 10000;
  value.lineItems.push({ id: 'credit', kind: 'credit', label: 'Promised credit', totalCents: -2000 }, { id: 'tax', kind: 'tax', label: 'Tax', totalCents: 100 });
  await assert.rejects(qbo.buildQboInvoice(value, mapping()), /Review the fixed tax/);
  const result = await qbo.buildQboInvoice(value, { ...mapping(), taxReviewed: true, taxRateId: 'reviewed-rate', taxCodeId: 'reviewed-tax-code' });
  assert.ok(result.payload.Line.every(line => line.Amount >= 0));
  assert.equal(result.payload.Line.at(-1).DetailType, 'DiscountLineDetail'); assert.equal(result.payload.Line.at(-1).Amount, 20);
  assert.equal(result.payload.TxnTaxDetail.TotalTax, 1); assert.equal(accountingTotal(result), 10100);
});

test('drafts, pending ACH and failed payments cannot create final accounting payments', async () => {
  for (const status of ['draft', 'held', 'voided']) await assert.rejects(qbo.buildQboInvoice({ ...invoice(), status }, mapping()), /unapproved/);
  for (const status of ['pending', 'failed', 'charging']) await assert.rejects(qbo.buildQboPayment(invoice(), { ...payment(), status }, mapping()), /confirmed paid/);
  const settled = await qbo.buildQboPayment(invoice(), { ...payment(), status: 'settled', settledDate: '2026-12-04' }, mapping());
  assert.equal(settled.payload.TotalAmt, 120);
  await assert.rejects(qbo.buildQboPayment(invoice(), { ...payment(), amountCents: 11900 }, mapping()), /gross total/);
});

test('deposits link the gross settled payments and monthly fees remain a separate bank expense', async () => {
  const deposit = await qbo.buildQboDeposit({ id: 'deposit-one', depositDate: '2026-12-02', grossCents: 24000, payments: [{ qboPaymentId: 'qbo-paid-one', amountCents: 12000 }, { qboPaymentId: 'qbo-paid-two', amountCents: 12000 }] }, mapping());
  assert.equal(accountingTotal(deposit), 24000); assert.equal(deposit.payload.Line.length, 2);
  const fee = await qbo.buildQboFeeExpense({ id: 'fees-december', periodStart: '2026-12-01', periodEnd: '2027-01-01', postedDate: '2027-01-05', amountCents: 3465 }, mapping());
  assert.equal(fee.entity, 'Purchase'); assert.equal(fee.payload.TxnDate, '2027-01-05');
  assert.equal(fee.payload.AccountRef.value, 'account-bank'); assert.equal(fee.payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, 'account-fees');
  assert.equal(accountingTotal(fee), 3465); assert.ok(fee.payload.PrivateNote.includes('2026-12-01/2027-01-01'));
  await assert.rejects(qbo.buildQboDeposit({ id: 'netted', depositDate: '2026-12-02', grossCents: 12000, netCents: 11600, feeCents: 400, payments: [{ qboPaymentId: 'p', amountCents: 12000 }] }, mapping()), /not be netted/);
});

test('optional reviewed fee accrual and settlement preserve period expense and actual bank dates', async () => {
  const fee = { id: 'fees-december', periodStart: '2026-12-01', periodEnd: '2027-01-01', postedDate: '2027-01-05', amountCents: 3465 };
  const accrued = await qbo.buildQboFeeAccrual(fee, mapping()), settled = await qbo.buildQboFeeSettlement(fee, mapping());
  assert.equal(accrued.payload.TxnDate, '2026-12-31'); assert.equal(accrued.entity, 'JournalEntry');
  assert.equal(accrued.payload.Line[0].JournalEntryLineDetail.PostingType, 'Debit');
  assert.equal(accrued.payload.Line[1].JournalEntryLineDetail.PostingType, 'Credit');
  assert.equal(accrued.payload.Line[0].Amount, accrued.payload.Line[1].Amount);
  assert.equal(settled.payload.TxnDate, '2027-01-05'); assert.equal(settled.payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, 'account-fees-payable');
  assert.notEqual(accrued.requestId, settled.requestId);
});

test('confirmed refunds record a separate refund receipt without changing the gross payment', async () => {
  const refunded = await qbo.buildQboRefund(invoice(), { id: 'refund-one', status: 'refunded', confirmed: true, amountCents: 2000, refundDate: '2026-12-03', transactionId: 'refund-reference' }, mapping());
  assert.equal(refunded.entity, 'RefundReceipt'); assert.equal(accountingTotal(refunded), 2000);
  assert.equal(refunded.payload.DepositToAccountRef.value, 'account-bank'); assert.equal(refunded.payload.CustomerRef.value, 'fixture-customer');
  await assert.rejects(qbo.buildQboRefund(invoice(), { id: 'bad', status: 'approved', amountCents: 2000 }, mapping()), /processor-confirmed/);
  assert.equal((await qbo.buildQboPayment(invoice(), payment(), mapping())).payload.TotalAmt, 120);
});

test('refund mappings retain actual processor references and reviewed tax/void account allocation', async () => {
  const refund = { id: 'refund-reference-check', status: 'refunded', confirmed: true, amountCents: 2040, refundDate: '2026-12-03', transactionId: 'internal-order-id', processorTransactionId: 'actual-processor-refund-reference' };
  const plain = await qbo.buildQboRefund(invoice(), refund, mapping());
  assert.equal(plain.payload.PaymentRefNum, 'actual-processor-refund-reference'); assert.equal(plain.payload.Line[0].SalesItemLineDetail.TaxCodeRef.value, 'NON'); assert.equal(plain.payload.TxnTaxDetail.TotalTax, 0);
  await assert.rejects(qbo.buildQboRefund({ ...invoice(), taxCents: 200 }, refund, mapping()), /Review tax treatment/);
  const taxed = await qbo.buildQboRefund({ ...invoice(), taxCents: 200 }, { ...refund, taxCents: 40 }, { ...mapping(), refundTaxReviewed: true, taxCodeId: 'TAX', taxRateId: 'reviewed-tax-rate' });
  assert.equal(accountingTotal(taxed), 2040); assert.equal(taxed.payload.TxnTaxDetail.TotalTax, 0.4);
  await assert.rejects(qbo.buildQboRefund(invoice(), { ...refund, kind: 'void' }, mapping()), /void return\/clearing account ID/);
  const voided = await qbo.buildQboRefund(invoice(), { ...refund, kind: 'void' }, { ...mapping(), voidReturnAccountId: 'reviewed-undeposited-funds' });
  assert.equal(voided.payload.DepositToAccountRef.value, 'reviewed-undeposited-funds');
});

test('reviewed reference IDs are mandatory and unsafe or noncent totals are never guessed', async () => {
  await assert.rejects(qbo.buildQboInvoice(invoice(), { ...mapping(), reviewed: false }), /Review the customer/);
  await assert.rejects(qbo.buildQboInvoice(invoice(), { ...mapping(), customerId: undefined }), /customer ID/);
  await assert.rejects(qbo.buildQboInvoice(invoice(), { ...mapping(), itemIds: {} }), /sales item ID/);
  await assert.rejects(qbo.buildQboInvoice({ ...invoice(), totalCents: 11999 }, mapping()), /match the gross/);
  await assert.rejects(qbo.buildQboInvoice({ ...invoice(), totalCents: 12000.5 }, mapping()), /whole-cent/);
  await assert.rejects(qbo.buildQboInvoice({ ...invoice(), invoiceDate: '2026-99-99' }, mapping()), /valid accounting date/);
});

test('paid credits create distinct confirmed credit memos while unpaid inline credits cannot double count', async () => {
  const original = { ...invoice(), status: 'paid' }, credit = { id: 'credit-one', amountCents: 2500, at: '2026-12-04T14:00:00Z', reason: 'Promised service credit', confirmed: true, affectsInvoiceTotal: false };
  const result = await qbo.buildQboOperation('credit', { invoice: original, credit }, { ...mapping(), creditItemId: 'item-credits' });
  assert.equal(result.entity, 'CreditMemo'); assert.equal(accountingTotal(result), 2500); assert.equal(result.payload.Line[0].SalesItemLineDetail.ItemRef.value, 'item-credits'); assert.equal(result.payload.EmailStatus, 'NotSet');
  assert.equal(original.totalCents, 12000); assert.equal(original.status, 'paid');
  await assert.rejects(qbo.buildQboCredit(original, { ...credit, affectsInvoiceTotal: true }, mapping()), /separate credit memo/);
  await assert.rejects(qbo.buildQboCredit({ ...original, status: 'draft' }, credit, mapping()), /paid-invoice credit/);
  await assert.rejects(qbo.buildQboCredit(original, credit, mapping()), /credit service item ID/);
});

test('taxable paid credits require a reviewed tax allocation rather than guessing the tax portion', async () => {
  const original = { ...invoice(), status: 'paid', taxCents: 200 }, credit = { id: 'credit-tax', amountCents: 1020, at: '2026-12-04T14:00:00Z', reason: 'Partial taxable service credit', confirmed: true, affectsInvoiceTotal: false };
  const refs = { ...mapping(), creditItemId: 'credit-item', creditTaxReviewed: true, taxCodeId: 'TAX', taxRateId: 'reviewed-tax-rate' };
  await assert.rejects(qbo.buildQboCredit(original, credit, refs), /Review tax treatment/);
  const result = await qbo.buildQboCredit(original, { ...credit, taxCents: 20 }, refs);
  assert.equal(result.payload.TxnTaxDetail.TotalTax, 0.2); assert.equal(accountingTotal(result), 1020);
});

test('write-offs use balanced reviewed expense and customer receivable journal entries without changing price', async () => {
  const original = { ...invoice(), status: 'written_off' }, writeOff = { id: 'writeoff-one', confirmed: true, amountCents: 12000, at: '2026-12-15T13:00:00Z', reason: 'Uncollectible balance approved by owner' };
  const result = await qbo.buildQboOperation('write_off', { invoice: original, writeOff }, { ...mapping(), writeoffExpenseAccountId: 'expense-bad-debt', receivablesAccountId: 'account-ar' });
  assert.equal(result.entity, 'JournalEntry'); assert.equal(result.expectedTotalCents, 12000); assert.equal(result.payload.Line[0].Amount, result.payload.Line[1].Amount);
  assert.equal(result.payload.Line[0].JournalEntryLineDetail.PostingType, 'Debit'); assert.equal(result.payload.Line[0].JournalEntryLineDetail.AccountRef.value, 'expense-bad-debt');
  assert.equal(result.payload.Line[1].JournalEntryLineDetail.AccountRef.value, 'account-ar'); assert.equal(result.payload.Line[1].JournalEntryLineDetail.Entity.EntityRef.value, 'fixture-customer');
  assert.equal(original.totalCents, 12000); await assert.rejects(qbo.buildQboWriteOff(original, writeOff, mapping()), /journal account ID/);
});

test('confirmed ACH returns reverse reviewed cash to customer receivables without editing the original gross Payment', async () => {
  const original = { ...invoice(), status: 'paid' }, returned = { id: 'return-one', kind: 'ach_return', confirmed: true, amountCents: 12000, at: '2026-12-06T13:00:00Z', reason: 'Processor reported returned ACH after settlement', achReturnCode: 'R03', qboPaymentId: 'original-qbo-payment' };
  const result = await qbo.buildQboOperation('ach_return', { invoice: original, returned }, { ...mapping(), receivablesAccountId: 'account-ar', returnCashAccountId: 'reviewed-return-bank' });
  assert.equal(result.entity, 'JournalEntry'); assert.equal(result.payload.Line[0].JournalEntryLineDetail.PostingType, 'Debit'); assert.equal(result.payload.Line[0].JournalEntryLineDetail.AccountRef.value, 'account-ar');
  assert.equal(result.payload.Line[1].JournalEntryLineDetail.PostingType, 'Credit'); assert.equal(result.payload.Line[1].JournalEntryLineDetail.AccountRef.value, 'reviewed-return-bank'); assert.equal(result.payload.Line[0].Amount, result.payload.Line[1].Amount);
  assert.match(result.payload.PrivateNote, /original QBO payment remains recorded/); assert.equal(original.status, 'paid');
  assert.equal((await qbo.buildQboPayment(original, payment(), mapping())).payload.TotalAmt, 120);
  await assert.rejects(qbo.buildQboAchReturn(original, { ...returned, confirmed: false }, mapping()), /confirmed return/);
  await assert.rejects(qbo.buildQboAchReturn(original, returned, { ...mapping(), receivablesAccountId: 'account-ar' }), /journal account ID/);
});

test('stable request IDs are company-specific, under fifty characters and retain document references', async () => {
  const first = await qbo.buildQboInvoice(invoice(), mapping()), replay = await qbo.buildQboInvoice(invoice(), mapping()), other = await qbo.buildQboInvoice(invoice(), { ...mapping(), realmId: 'different-fixture-realm' });
  assert.equal(first.requestId, replay.requestId); assert.equal(first.payload.DocNumber, replay.payload.DocNumber);
  assert.notEqual(first.requestId, other.requestId); assert.ok(first.requestId.length <= 50); assert.ok(first.payload.DocNumber.length <= 21);
});

test('generated accounting notes use stable safe references while structural long QBO IDs remain exact', async () => {
  const sourceId = 'aabbccdd-aabb-4abc-8abc-123456789012', longQboId = '12345678901234567890';
  const refs = { ...mapping(), realmId: '1234567890123456', customerId: longQboId, invoiceId: longQboId, paymentId: longQboId, creditItemId: longQboId, receivablesAccountId: longQboId, writeoffExpenseAccountId: longQboId, returnCashAccountId: longQboId };
  const original = { ...invoice(), id: sourceId, qboId: longQboId, status: 'paid' };
  const fee = { id: sourceId, periodStart: '2026-12-01', periodEnd: '2027-01-01', postedDate: '2027-01-05', amountCents: 3465 };
  const operations = await Promise.all([
    qbo.buildQboInvoice(original, refs), qbo.buildQboPayment(original, { ...payment(), id: sourceId }, refs),
    qbo.buildQboRefund(original, { id: sourceId, status: 'refunded', confirmed: true, amountCents: 2000, refundDate: '2026-12-03', transactionId: longQboId }, refs),
    qbo.buildQboCredit(original, { id: sourceId, confirmed: true, affectsInvoiceTotal: false, amountCents: 2000, at: '2026-12-03T14:00:00Z', reason: 'Reviewed service credit' }, refs),
    qbo.buildQboWriteOff({ ...original, status: 'written_off' }, { id: sourceId, confirmed: true, amountCents: 12000, at: '2026-12-03T14:00:00Z', reason: 'Reviewed balance write-off' }, refs),
    qbo.buildQboAchReturn(original, { id: sourceId, confirmed: true, kind: 'ach_return', amountCents: 12000, at: '2026-12-03T14:00:00Z', reason: 'Confirmed processor return', achReturnCode: 'R03' }, refs),
    qbo.buildQboDeposit({ id: sourceId, depositDate: '2026-12-02', grossCents: 12000, payments: [{ qboPaymentId: longQboId, amountCents: 12000 }] }, refs),
    qbo.buildQboFeeExpense(fee, refs), qbo.buildQboFeeAccrual(fee, refs), qbo.buildQboFeeSettlement(fee, refs),
  ]);
  for (const operation of operations) {
    assert.doesNotThrow(() => assertNoPaymentSecrets(operation));
    assert.match(operation.payload.PrivateNote, /reference ROS_[a-f0-9]{16}/);
    assert.ok(!operation.payload.PrivateNote.includes(sourceId)); assert.ok(!operation.payload.PrivateNote.includes(longQboId));
  }
  assert.equal(operations[1].payload.Line[0].LinkedTxn[0].TxnId, longQboId); assert.equal(operations[6].payload.Line[0].LinkedTxn[0].TxnId, longQboId);
  assert.throws(() => assertNoPaymentSecrets({ PrivateNote: 'Card 4111111111111111' }), /raw payment details/);
});

test('a lost QBO response remains unsynced then reuses the exact request ID without a second entity', async () => {
  const gateway = qbo.createFakeQboGateway({ failures: ['lost_response'] });
  const job = { id: 'job-one', kind: 'invoice', sourceId: invoice().id, payload: invoice(), mapping: mapping(), status: 'unsynced', attempts: 0, audit: [] };
  const first = await qbo.syncQboOutboxItem(job, gateway, { actor: 'owner@example.test', now: Date.parse('2026-12-01T13:00:00Z') });
  assert.equal(first.status, 'unsynced'); assert.equal(first.lastErrorCode, 'QBO_TRANSPORT_UNCERTAIN'); assert.ok(first.retryAt);
  const second = await qbo.syncQboOutboxItem(first, gateway, { actor: 'owner@example.test', now: Date.parse('2026-12-01T13:05:00Z') });
  assert.equal(second.status, 'synced'); assert.equal(second.qboId, 'fixture-qbo-1');
  assert.equal(gateway.calls.length, 2); assert.equal(gateway.calls[0].requestId, gateway.calls[1].requestId);
  assert.equal(second.audit.length, 2); assert.equal(second.audit[1].oldValue.status, 'unsynced'); assert.equal(second.audit[1].newValue.status, 'synced');
  assert.equal((await qbo.syncQboOutboxItem(second, gateway)).attempts, 2);
});

test('fixture-only gateway rejects a production-shaped gateway and detects request-ID payload collisions', async () => {
  const item = await qbo.buildQboInvoice(invoice(), mapping()), gateway = qbo.createFakeQboGateway();
  await gateway.submit(item);
  await assert.rejects(gateway.submit({ ...item, payload: { ...item.payload, DueDate: '2026-12-02' } }), /different content/);
  await assert.rejects(qbo.syncQboOutboxItem({ status: 'unsynced' }, { submit() { throw new Error('Network would be unsafe'); } }), /fixture QBO/);
});

test('persistent mapping failures stop after bounded retries and audit safe error codes', async () => {
  const gateway = qbo.createFakeQboGateway(); let job = { id: 'unmapped', kind: 'invoice', payload: invoice(), mapping: { ...mapping(), reviewed: false }, status: 'unsynced', attempts: 0, audit: [] };
  for (let attempt = 0; attempt < 6; attempt++) job = await qbo.syncQboOutboxItem(job, gateway, { actor: 'owner@example.test', now: Date.parse('2026-12-01T13:00:00Z'), reason: 'Review missing mappings' });
  assert.equal(job.status, 'held'); assert.equal(job.retryAt, null); assert.equal(gateway.calls.length, 0); assert.equal(job.audit.length, 6);
  assert.equal(job.lastErrorCode, 'QBO_MAPPING_REQUIRED');
});
