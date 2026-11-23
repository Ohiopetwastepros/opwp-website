// Processor data has one boundary: hosted fields -> ephemeral profile creation.
// Everything retained by billing is an allowlisted profile or transaction ID.
const prohibited = new Set(['pan', 'account', 'cardnumber', 'cardno', 'creditcardnumber', 'debitcardnumber', 'cvv', 'cvv2', 'cvc', 'cvc2', 'securitycode', 'bankaccount', 'bankaccountnumber', 'bankaccountno', 'accountnumber', 'routing', 'routingnumber', 'routingno', 'bankroutingnumber', 'bankaba', 'aba', 'abanumber', 'ddanumber', 'iban', 'achaccount', 'rawresponse', 'password', 'secret', 'apikey', 'authorization', 'accesstoken', 'refreshtoken']);
const processorIds = new Set(['profileId', 'profileAccountId', 'processorCustomerId', 'transactionId', 'processorTransactionId', 'providerOrderId', 'orderId', 'invoiceId', 'subscriptionId', 'customerId', 'id', 'requestId', 'eventId', 'token']);
const uuid = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const generatedIdentifier = new RegExp(`^(?:${uuid})(?::[1-9]\\d{0,5})?$`, 'i');
const generatedInvoiceKey = new RegExp(`^(?:${uuid}):\\d{4}-\\d{2}-01:(?:monthly|new_client)$`, 'i');
const generatedAdjustmentKey = new RegExp(`^(?:${uuid}):(?:refund|void):(?:${uuid})$`, 'i');
const generatedIdentifierKeys = new Set(['invoiceIds', 'subscriptionIds', 'paymentMethodIds', 'versionId', 'idempotencyKey', 'key']);
const accountingIdKeys = new Set(['realmId', 'qboId', 'qboPaymentId', 'qboInvoiceId', 'sourceId']);
const accountingMappingIdKeys = new Set(['realmId', 'customerId', 'invoiceId', 'paymentId', 'discountAccountId', 'undepositedFundsAccountId', 'bankAccountId', 'voidReturnAccountId', 'writeoffExpenseAccountId', 'receivablesAccountId', 'returnCashAccountId', 'feeExpenseAccountId', 'feePayableAccountId', 'refundItemId', 'creditItemId', 'taxCodeId', 'nonTaxCodeId', 'taxRateId']);
const accountingRefKeys = new Set(['CustomerRef', 'ItemRef', 'AccountRef', 'DepositToAccountRef', 'DiscountAccountRef', 'TaxCodeRef', 'TaxRateRef', 'EntityRef']);
function accountingIdentifier(item, key, path) {
  if (typeof item !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(item)) return false;
  if (accountingIdKeys.has(key)) return true;
  const mapping = path.includes('qboMapping') || path.includes('mapping'), parent = path.at(-2);
  if (mapping && (accountingMappingIdKeys.has(key) || parent === 'itemIds')) return true;
  if (!path.includes('payload')) return false;
  return key === 'value' && accountingRefKeys.has(parent)
    || key === 'TxnId' && parent === 'LinkedTxn'
    || key === 'PaymentRefNum' && parent === 'payload';
}
export function assertNoPaymentSecrets(value, { allowToken = false } = {}) {
  function visit(item, key = '', depth = 0, path = []) {
    if (depth > 24) throw new Error('Payment metadata is too deeply nested.');
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (prohibited.has(normalized) || normalized === 'token' && !(allowToken && key === 'token' && depth === 1)) throw new Error('Use processor-hosted payment fields; raw payment details cannot be saved.');
    const generated = typeof item === 'string' && (generatedIdentifierKeys.has(key) && (generatedIdentifier.test(item) || ['idempotencyKey', 'key'].includes(key) && generatedInvoiceKey.test(item)) || ['adjustmentId', 'idempotencyKey'].includes(key) && generatedAdjustmentKey.test(item));
    if (typeof item === 'string' && !processorIds.has(key) && !generated && !accountingIdentifier(item, key, path)) {
      if (/\b(?:\d[ -]?){12,19}\b/.test(item) || /\b(?:routing(?: number)?|bank account|account number|bankaba|aba|cvv2?|cvc2?)\s*[:#]?\s*\d{3,}/i.test(item)) throw new Error('Remove raw payment details from notes and use processor-hosted fields.');
    } else if (Array.isArray(item)) item.forEach(entry => visit(entry, key, depth + 1, path));
    else if (item && typeof item === 'object') Object.entries(item).forEach(([name, entry]) => visit(entry, name, depth + 1, [...path, name]));
  }
  visit(value); return value;
}

export function crmBillingEnabled(env) {
  return env?.ROUTE_OS_BILLING_ENABLED === 'true' && env.CRM_PAYMENTS_ENV === 'uat'
    && ['development', 'test', 'preview', 'uat'].includes(env.APP_ENV);
}

// This authenticates our optional UAT relay, not a native CardPointe webhook.
// Compare fixed-length digests rather than branching on supplied secret bytes.
export async function verifyBillingUatRelayRequest(request, env) {
  const expected = env?.CRM_BILLING_UAT_RELAY_SECRET, authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (typeof expected !== 'string' || expected.length < 32 || expected.length > 256 || !supplied || supplied.length > 256 || /\s/.test(supplied)) return false;
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([digest(expected), digest(supplied)]);
  let difference = 0; for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function billingStaffAlert(invoice) {
  return `Billing review: invoice ${invoice.id} is ${invoice.status}. Review it in the office workspace.`;
}
