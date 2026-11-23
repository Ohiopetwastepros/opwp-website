// Fixture-only QBO accounting boundary. No network, OAuth, provider credential,
// card/bank input or live QuickBooks module is imported by this file.
export class BillingQboError extends Error {
  constructor(message, code = 'QBO_MAPPING_REQUIRED') { super(message); this.name = 'BillingQboError'; this.code = code; }
}
const fail = (ok, message, code) => { if (!ok) throw new BillingQboError(message, code); };
const cents = value => { fail(Number.isSafeInteger(value) && Math.abs(value) <= 1000000000, 'Use bounded whole-cent accounting amounts.'); return value; };
const amount = value => Number((cents(value) / 100).toFixed(2));
const text = (value, label, max = 200) => { fail(typeof value === 'string' && value.trim() && value.length <= max, `Provide a reviewed ${label}.`); return value.trim(); };
const ref = (value, label) => ({ value: text(value, label, 100) });
const date = value => { const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN; fail(Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value, 'Provide a valid accounting date.'); return value; };
const lines = invoice => invoice.lineItems || invoice.lines || [];
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(value))))), b => b.toString(16).padStart(2, '0')).join('');
function reviewed(mapping) {
  fail(mapping?.reviewed === true, 'Review the customer, item and account mappings before syncing.');
  text(mapping.realmId, 'QBO company ID', 100);
}
function invoiceTotal(invoice) {
  fail(invoice && typeof invoice === 'object' && Array.isArray(lines(invoice)) && lines(invoice).length > 0 && lines(invoice).length <= 500, 'Provide bounded itemized invoice lines.');
  let total = 0;
  for (const item of lines(invoice)) total = cents(total + cents(item.totalCents));
  fail(total === cents(invoice.totalCents) && total >= 0, 'Invoice lines must match the gross invoice total exactly.', 'QBO_TOTAL_MISMATCH');
  return total;
}
async function operation(entity, sourceId, payload, totalCents, mapping) {
  reviewed(mapping);
  const digest = await hash({ realmId: mapping.realmId, entity, sourceId: text(sourceId, 'source ID', 200) });
  const requestId = `ros-${entity.toLowerCase()}_${digest.slice(0, 28)}`;
  const docNumber = `ROS_${digest.slice(0, 16)}`;
  fail(requestId.length <= 50, 'The QBO request ID is too long.');
  return { entity, sourceId, requestId, docNumber, expectedTotalCents: cents(totalCents), realmId: mapping.realmId,
    payload: { ...payload, PrivateNote: `${payload.PrivateNote || 'Route OS accounting'}; reference ${docNumber}`, ...(entity === 'Payment' ? {} : { DocNumber: docNumber }) }, fixtureOnly: true };
}
export async function buildQboInvoice(invoice, mapping) {
  reviewed(mapping); const total = invoiceTotal(invoice);
  fail(!invoice.held && ['approved', 'charging', 'paid', 'failed', 'pending', 'written_off'].includes(invoice.status), 'An unapproved invoice cannot become a final QBO invoice.', 'QBO_NOT_APPROVED');
  const sales = [], discounts = []; let tax = 0;
  for (const item of lines(invoice)) {
    const value = cents(item.totalCents);
    if (item.kind === 'tax') { fail(value >= 0, 'Tax lines cannot be negative.'); tax += value; continue; }
    if (value < 0) { discounts.push(item); continue; }
    if (!value) continue;
    const itemId = mapping.itemIds?.[item.id] || mapping.itemIds?.[item.kind];
    sales.push({ DetailType: 'SalesItemLineDetail', Amount: amount(value), Description: text(item.label || item.description, 'line description', 1000),
      SalesItemLineDetail: { ItemRef: ref(itemId, 'sales item ID'), Qty: 1, UnitPrice: amount(value), TaxCodeRef: ref(item.taxable === true ? mapping.taxCodeId : mapping.nonTaxCodeId || 'NON', 'tax code ID') } });
  }
  if (discounts.length) sales.push({ DetailType: 'DiscountLineDetail', Amount: amount(-discounts.reduce((n, item) => n + item.totalCents, 0)),
    Description: discounts.map(item => text(item.label, 'credit/discount description', 200)).join('; ').slice(0, 1000),
    DiscountLineDetail: { PercentBased: false, DiscountAccountRef: ref(mapping.discountAccountId, 'discount account ID') } });
  fail(sales.some(item => item.DetailType === 'SalesItemLineDetail'), 'QBO invoice needs a positive service line.');
  const payload = { CustomerRef: ref(mapping.customerId, 'customer ID'), TxnDate: date(invoice.invoiceDate || invoice.periodStart), DueDate: date(invoice.dueDate || invoice.periodStart), CurrencyRef: { value: 'USD' },
    Line: sales, AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: false, EmailStatus: 'NotSet', PrivateNote: 'Route OS invoice; gross accounting; external processor',
    TxnTaxDetail: { TotalTax: amount(tax) } };
  if (tax) {
    const taxableCents = invoice.taxableCents ?? invoice.taxableSubtotalCents ?? mapping.taxableCents;
    fail(Number.isSafeInteger(taxableCents) && taxableCents >= 0 && mapping.taxReviewed === true, 'Review the fixed tax amount and taxable basis before syncing.', 'QBO_TAX_REVIEW_REQUIRED');
    payload.TxnTaxDetail.TaxLine = [{ DetailType: 'TaxLineDetail', Amount: amount(tax), TaxLineDetail: { TaxRateRef: ref(mapping.taxRateId, 'tax rate ID'), PercentBased: false, NetAmountTaxable: amount(taxableCents) } }];
  }
  return operation('Invoice', invoice.id, payload, total, mapping);
}
export async function buildQboPayment(invoice, payment, mapping) {
  reviewed(mapping); const total = invoiceTotal(invoice);
  fail(['paid', 'settled'].includes(payment?.status) && payment.confirmed !== false, 'Only confirmed paid or settled funds enter QBO payments.', 'QBO_PAYMENT_UNCONFIRMED');
  fail(cents(payment.amountCents) === total, 'Processor payment must equal the invoice gross total.', 'QBO_TOTAL_MISMATCH');
  const payload = { CustomerRef: ref(mapping.customerId, 'customer ID'), TxnDate: date(payment.paidDate || payment.settledDate || String(payment.paidAt || '').slice(0, 10)), TotalAmt: amount(total),
    DepositToAccountRef: ref(mapping.undepositedFundsAccountId, 'Undeposited Funds account ID'), ProcessPayment: false,
    PaymentRefNum: text(payment.transactionId || payment.processorTransactionId, 'confirmed processor transaction ID'),
    Line: [{ Amount: amount(total), LinkedTxn: [{ TxnId: text(invoice.qboId || mapping.invoiceId, 'synced invoice ID'), TxnType: 'Invoice' }] }],
    PrivateNote: 'Route OS gross payment; processor fees recorded separately' };
  return operation('Payment', payment.id || `${invoice.id}:payment`, payload, total, mapping);
}
export async function buildQboRefund(invoice, refund, mapping) {
  reviewed(mapping);
  fail(refund?.confirmed === true && ['refunded', 'succeeded', 'paid'].includes(refund.status), 'Only a processor-confirmed refund can sync.', 'QBO_REFUND_UNCONFIRMED');
  fail(cents(refund.amountCents) > 0 && refund.amountCents <= invoiceTotal(invoice), 'Refund must be positive and no larger than the invoice.');
  const tax = refund.taxCents ?? 0;
  fail(Number.isSafeInteger(tax) && tax >= 0 && tax < refund.amountCents, 'Review the refund tax allocation.');
  fail(!invoice.taxCents || mapping.refundTaxReviewed === true && Number.isSafeInteger(refund.taxCents), 'Review tax treatment before refunding a taxable invoice.', 'QBO_TAX_REVIEW_REQUIRED');
  const payload = { CustomerRef: ref(mapping.customerId, 'customer ID'), TxnDate: date(refund.refundDate || String(refund.refundedAt || '').slice(0, 10)),
    DepositToAccountRef: ref(refund.kind === 'void' ? mapping.voidReturnAccountId : mapping.bankAccountId, refund.kind === 'void' ? 'void return/clearing account ID' : 'refund bank account ID'), PaymentRefNum: text(refund.processorTransactionId || refund.transactionId, 'refund transaction ID'),
    CurrencyRef: { value: 'USD' }, TxnTaxDetail: { TotalTax: amount(tax) },
    Line: [{ DetailType: 'SalesItemLineDetail', Amount: amount(refund.amountCents - tax), Description: 'Refund for Route OS invoice',
      SalesItemLineDetail: { ItemRef: ref(mapping.refundItemId, 'refund service item ID'), Qty: 1, UnitPrice: amount(refund.amountCents - tax), TaxCodeRef: ref(tax ? mapping.taxCodeId : mapping.nonTaxCodeId || 'NON', 'refund tax code ID') } }],
    PrivateNote: 'Route OS recorded refund; original payment remains gross' };
  if (tax) payload.TxnTaxDetail.TaxLine = [{ DetailType: 'TaxLineDetail', Amount: amount(tax), TaxLineDetail: { TaxRateRef: ref(mapping.taxRateId, 'tax rate ID'), PercentBased: false, NetAmountTaxable: amount(refund.amountCents - tax) } }];
  return operation('RefundReceipt', refund.id, payload, refund.amountCents, mapping);
}
export async function buildQboCredit(invoice, credit, mapping) {
  reviewed(mapping);
  fail(invoice?.status === 'paid' && credit?.confirmed === true && credit.affectsInvoiceTotal === false, 'Only a recorded, confirmed paid-invoice credit can create a separate credit memo.', 'QBO_CREDIT_UNCONFIRMED');
  fail(cents(credit.amountCents) > 0 && credit.amountCents <= invoiceTotal(invoice), 'Credit must be positive and no larger than the original invoice.');
  const tax = credit.taxCents ?? 0;
  fail(Number.isSafeInteger(tax) && tax >= 0 && tax < credit.amountCents, 'Review the credit tax allocation.');
  fail(!invoice.taxCents || mapping.creditTaxReviewed === true && Number.isSafeInteger(credit.taxCents), 'Review tax treatment before crediting a taxable invoice.', 'QBO_TAX_REVIEW_REQUIRED');
  const payload = { CustomerRef: ref(mapping.customerId, 'customer ID'), TxnDate: date(credit.creditDate || String(credit.at || '').slice(0, 10)), CurrencyRef: { value: 'USD' }, EmailStatus: 'NotSet',
    Line: [{ DetailType: 'SalesItemLineDetail', Amount: amount(credit.amountCents - tax), Description: text(credit.reason, 'credit reason', 1000),
      SalesItemLineDetail: { ItemRef: ref(mapping.creditItemId, 'credit service item ID'), Qty: 1, UnitPrice: amount(credit.amountCents - tax), TaxCodeRef: ref(tax ? mapping.taxCodeId : mapping.nonTaxCodeId || 'NON', 'credit tax code ID') } }],
    TxnTaxDetail: { TotalTax: amount(tax) }, PrivateNote: 'Route OS recorded credit for paid invoice; original invoice and payment unchanged' };
  if (tax) payload.TxnTaxDetail.TaxLine = [{ DetailType: 'TaxLineDetail', Amount: amount(tax), TaxLineDetail: { TaxRateRef: ref(mapping.taxRateId, 'tax rate ID'), PercentBased: false, NetAmountTaxable: amount(credit.amountCents - tax) } }];
  return operation('CreditMemo', credit.id, payload, credit.amountCents, mapping);
}
function customerJournalLine(value, postingType, accountId, mapping, description) {
  return { Amount: amount(value), DetailType: 'JournalEntryLineDetail', Description: description,
    JournalEntryLineDetail: { PostingType: postingType, AccountRef: ref(accountId, 'reviewed journal account ID'), Entity: { Type: 'Customer', EntityRef: ref(mapping.customerId, 'customer ID') } } };
}
export async function buildQboWriteOff(invoice, writeOff, mapping) {
  reviewed(mapping);
  fail(invoice?.status === 'written_off' && writeOff?.confirmed === true, 'Only a recorded, reconciled write-off can sync.', 'QBO_WRITEOFF_UNCONFIRMED');
  fail(cents(writeOff.amountCents) > 0 && writeOff.amountCents <= invoiceTotal(invoice), 'Review the outstanding amount before writing it off.');
  text(invoice.qboId || mapping.invoiceId, 'synced invoice ID');
  const reason = text(writeOff.reason, 'write-off reason', 1000);
  return operation('JournalEntry', `${writeOff.id}:writeoff`, { TxnDate: date(writeOff.writeOffDate || String(writeOff.at || '').slice(0, 10)),
    Line: [customerJournalLine(writeOff.amountCents, 'Debit', mapping.writeoffExpenseAccountId, mapping, reason), customerJournalLine(writeOff.amountCents, 'Credit', mapping.receivablesAccountId, mapping, 'Write off Route OS invoice')],
    PrivateNote: 'Route OS write-off; reviewed receivable adjustment; invoice price and payment history unchanged' }, writeOff.amountCents, mapping);
}
export async function buildQboAchReturn(invoice, returned, mapping) {
  reviewed(mapping);
  fail(invoice?.status === 'paid' && returned?.confirmed === true && returned.kind === 'ach_return', 'Only a confirmed return of a previously paid ACH invoice can sync.', 'QBO_ACH_RETURN_UNCONFIRMED');
  fail(cents(returned.amountCents) > 0 && returned.amountCents <= invoiceTotal(invoice), 'Review the ACH return gross amount.');
  const code = text(returned.achReturnCode || returned.returnCode, 'ACH return code', 10); text(returned.qboPaymentId || mapping.paymentId, 'original QBO payment ID');
  return operation('JournalEntry', `${returned.id}:ach-return`, { TxnDate: date(returned.returnDate || String(returned.at || '').slice(0, 10)),
    Line: [customerJournalLine(returned.amountCents, 'Debit', mapping.receivablesAccountId, mapping, `ACH return ${code}; Route OS invoice`), customerJournalLine(returned.amountCents, 'Credit', mapping.returnCashAccountId, mapping, text(returned.reason, 'ACH return reason', 1000))],
    PrivateNote: `Route OS ACH return ${code}; original QBO payment remains recorded; reviewed return account adjustment, no processor refund requested` }, returned.amountCents, mapping);
}
export async function buildQboDeposit(deposit, mapping) {
  reviewed(mapping); fail(Array.isArray(deposit?.payments) && deposit.payments.length > 0 && deposit.payments.length <= 500, 'Provide reviewed gross deposit payment links.');
  const seen = new Set(); let gross = 0;
  const Line = deposit.payments.map(item => {
    const paymentId = text(item.qboPaymentId, 'QBO payment ID'); fail(!seen.has(paymentId), 'A payment cannot be deposited twice in one batch.'); seen.add(paymentId);
    fail(cents(item.amountCents) > 0, 'Deposit payments must be gross positive amounts.'); gross = cents(gross + item.amountCents);
    return { Amount: amount(item.amountCents), LinkedTxn: [{ TxnId: paymentId, TxnType: 'Payment' }] };
  });
  fail(gross === cents(deposit.grossCents), 'A CardPointe deposit must equal the linked GROSS payments.', 'QBO_GROSS_DEPOSIT_REQUIRED');
  fail(!deposit.feeCents && (deposit.netCents == null || deposit.netCents === gross), 'Monthly fees must not be netted from CardPointe deposits.', 'QBO_GROSS_DEPOSIT_REQUIRED');
  return operation('Deposit', deposit.id, { TxnDate: date(deposit.depositDate), DepositToAccountRef: ref(mapping.bankAccountId, 'deposit bank account ID'), Line,
    PrivateNote: 'Route OS gross CardPointe deposit; monthly fees excluded' }, gross, mapping);
}
export async function buildQboFeeExpense(fee, mapping) {
  reviewed(mapping); fail(cents(fee?.amountCents) > 0, 'Record a positive monthly processor fee.');
  const start = date(fee.periodStart), end = date(fee.periodEnd); fail(end > start, 'Fee statement period must end after its start.');
  const payload = { TxnDate: date(fee.postedDate), PaymentType: 'Cash', AccountRef: ref(mapping.bankAccountId, 'fee-withdrawal bank account ID'),
    Line: [{ Amount: amount(fee.amountCents), DetailType: 'AccountBasedExpenseLineDetail', Description: `CardPointe fees for ${start} through ${end} (exclusive)`,
      AccountBasedExpenseLineDetail: { AccountRef: ref(mapping.feeExpenseAccountId, 'processor fee expense account ID'), BillableStatus: 'NotBillable' } }],
    PrivateNote: `Route OS monthly processor fee; statement period ${start}/${end}; no net-deposit adjustment` };
  return operation('Purchase', fee.id, payload, fee.amountCents, mapping);
}
export async function buildQboFeeAccrual(fee, mapping) {
  reviewed(mapping); fail(cents(fee?.amountCents) > 0, 'Record a positive monthly processor fee.');
  const end = date(fee.periodEnd), start = date(fee.periodStart); fail(end > start, 'Fee statement period must end after its start.');
  const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return operation('JournalEntry', `${fee.id}:accrual`, { TxnDate: lastDay,
    Line: [
      { Amount: amount(fee.amountCents), DetailType: 'JournalEntryLineDetail', Description: `Processor fees ${start}/${end}`, JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: ref(mapping.feeExpenseAccountId, 'fee expense account ID') } },
      { Amount: amount(fee.amountCents), DetailType: 'JournalEntryLineDetail', Description: 'Accrued monthly processor fees', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: ref(mapping.feePayableAccountId, 'processor fees payable account ID') } },
    ], PrivateNote: 'Route OS fee accrual; no cash moved' }, fee.amountCents, mapping);
}
export async function buildQboFeeSettlement(fee, mapping) {
  const result = await buildQboFeeExpense(fee, mapping);
  result.payload.Line[0].AccountBasedExpenseLineDetail.AccountRef = ref(mapping.feePayableAccountId, 'processor fees payable account ID');
  result.payload.PrivateNote = 'Route OS settlement of previously accrued fees';
  return operation('Purchase', `${fee.id}:settlement`, result.payload, fee.amountCents, mapping);
}
export async function buildQboOperation(kind, source, mapping) {
  if (kind === 'invoice') return buildQboInvoice(source, mapping);
  if (kind === 'payment') return buildQboPayment(source.invoice, source.payment, mapping);
  if (kind === 'refund') return buildQboRefund(source.invoice, source.refund, mapping);
  if (kind === 'credit') return buildQboCredit(source.invoice, source.credit, mapping);
  if (kind === 'write_off') return buildQboWriteOff(source.invoice, source.writeOff, mapping);
  if (kind === 'ach_return') return buildQboAchReturn(source.invoice, source.returned, mapping);
  if (kind === 'deposit') return buildQboDeposit(source, mapping);
  if (kind === 'fee') return buildQboFeeExpense(source, mapping);
  if (kind === 'fee_accrual') return buildQboFeeAccrual(source, mapping);
  if (kind === 'fee_settlement') return buildQboFeeSettlement(source, mapping);
  throw new BillingQboError('Choose a supported QBO accounting action.');
}

export function createFakeQboGateway({ failures = [] } = {}) {
  const receipts = new Map(), calls = [], pendingFailures = [...failures]; let sequence = 0;
  return { fixtureOnly: true, calls,
    async submit(item) {
      fail(item?.fixtureOnly === true, 'Only fixture accounting operations are accepted.', 'QBO_FIXTURE_ONLY');
      calls.push(structuredClone(item));
      const key = `${item.realmId}:${item.requestId}`, bodyHash = await hash({ entity: item.entity, payload: item.payload });
      const existing = receipts.get(key);
      if (existing) { fail(existing.bodyHash === bodyHash, 'A QBO request ID was reused with different content.', 'QBO_REQUEST_CONFLICT'); return { ...existing.receipt, duplicate: true }; }
      if (pendingFailures[0] === 'before_write') { pendingFailures.shift(); throw new BillingQboError('Fixture transport failed before acceptance.', 'QBO_TRANSPORT_UNCERTAIN'); }
      const receipt = { qboId: `fixture-qbo-${++sequence}`, syncToken: '0', entity: item.entity, totalCents: item.expectedTotalCents };
      receipts.set(key, { bodyHash, receipt });
      if (pendingFailures[0] === 'lost_response') { pendingFailures.shift(); throw new BillingQboError('Fixture response was lost after acceptance.', 'QBO_TRANSPORT_UNCERTAIN'); }
      return receipt;
    },
  };
}
export async function syncQboOutboxItem(job, gateway, { actor = 'system:qbo-fixtures', now = Date.now(), reason = 'Fixture accounting synchronization' } = {}) {
  fail(gateway?.fixtureOnly === true && typeof gateway.submit === 'function', 'Only a fixture QBO gateway is permitted in this phase.', 'QBO_FIXTURE_ONLY');
  const next = structuredClone(job), previous = { status: next.status, qboId: next.qboId || null, attempts: next.attempts || 0 };
  if (job.status === 'synced') return next;
  next.attempts = (next.attempts || 0) + 1;
  try {
    const item = next.payload?.entity ? next.payload : await buildQboOperation(next.kind, next.payload, next.mapping);
    const receipt = await gateway.submit(item);
    fail(receipt?.entity === item.entity && receipt.totalCents === item.expectedTotalCents && typeof receipt.qboId === 'string', 'QBO receipt does not match the reviewed gross amount.', 'QBO_RECEIPT_MISMATCH');
    Object.assign(next, { status: 'synced', qboId: receipt.qboId, syncToken: receipt.syncToken, requestId: item.requestId, syncedAt: new Date(now).toISOString(), lastErrorCode: null, retryAt: null });
  } catch (error) {
    Object.assign(next, { status: next.attempts >= 6 ? 'held' : 'unsynced', lastErrorCode: error instanceof BillingQboError ? error.code : 'QBO_FIXTURE_FAILURE', retryAt: next.attempts >= 6 ? null : new Date(now + Math.min(1440, 5 * 2 ** (next.attempts - 1)) * 60000).toISOString() });
  }
  next.audit = [...(next.audit || []), { actor: text(actor, 'sync author'), at: new Date(now).toISOString(), action: 'qbo_sync', oldValue: previous,
    newValue: { status: next.status, qboId: next.qboId || null, attempts: next.attempts, lastErrorCode: next.lastErrorCode }, reason: text(reason, 'sync reason', 2000) }];
  return next;
}
