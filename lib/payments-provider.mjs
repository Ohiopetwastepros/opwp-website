// The billing domain depends on this boundary; only provider adapters make network calls.
export const PAYMENT_PROVIDER_METHODS = Object.freeze(['hostedTokenizerConfig', 'createProfile', 'getProfile', 'charge', 'inquire', 'void', 'refund', 'pollAch']);
export const PAYMENT_STATUSES = Object.freeze(['paid', 'failed', 'pending', 'unknown', 'not_found', 'voided', 'refunded']);

export class PaymentsProviderError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'PaymentsProviderError'; this.code = code; this.status = status; }
}

export function assertPaymentsProvider(provider) {
  if (!provider || PAYMENT_PROVIDER_METHODS.some(method => typeof provider[method] !== 'function')) throw new PaymentsProviderError('invalid_provider', 'A complete payments provider is required.');
  return provider;
}

const forbidden = new Set(['pan', 'cardnumber', 'cardno', 'creditcardnumber', 'debitcardnumber', 'cvv', 'cvv2', 'cvc', 'cvc2', 'securitycode', 'bankaccount', 'bankaccountnumber', 'achaccount', 'accountnumber', 'routing', 'routingnumber', 'bankaba', 'abanumber', 'ddanumber', 'aba', 'iban', 'account', 'token']);
export function rejectSensitivePaymentData(value, { allowToken = false } = {}, depth = 0) {
  if (depth > 10) throw new PaymentsProviderError('invalid_payment_data', 'Payment data is too deeply nested.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (forbidden.has(normalized) && !(allowToken && depth === 0 && normalized === 'token')) throw new PaymentsProviderError('sensitive_payment_data', 'Only hosted payment tokens and safe profile metadata are accepted.');
    rejectSensitivePaymentData(child, {}, depth + 1);
  }
}

const identifier = (value, label, nullable = false) => {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new PaymentsProviderError('invalid_payment_method', `A valid ${label} is required.`);
  return value;
};
const brands = new Map([['visa', 'Visa'], ['mc', 'Mastercard'], ['mastercard', 'Mastercard'], ['master card', 'Mastercard'], ['amex', 'American Express'], ['american express', 'American Express'], ['discover', 'Discover'], ['diners', 'Diners Club'], ['diners club', 'Diners Club'], ['jcb', 'JCB'], ['unionpay', 'UnionPay'], ['unknown', 'Unknown']]);

// This is the complete persistence/browser projection. Never spread a processor response.
export function safePaymentMethod(input = {}) {
  rejectSensitivePaymentData(input);
  if (!['card', 'ach'].includes(input.methodType)) throw new PaymentsProviderError('invalid_payment_method', 'Payment method must be card or ACH.');
  const last4 = input.last4 == null || input.last4 === '' ? null : String(input.last4);
  if (last4 !== null && !/^\d{4}$/.test(last4)) throw new PaymentsProviderError('invalid_payment_method', 'Only the last four account digits may be retained.');
  const expMonth = input.expMonth == null ? null : Number(input.expMonth), expYear = input.expYear == null ? null : Number(input.expYear);
  if (expMonth !== null && (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12)) throw new PaymentsProviderError('invalid_payment_method', 'Expiration month is invalid.');
  if (expYear !== null && (!Number.isInteger(expYear) || expYear < 2000 || expYear > 2199)) throw new PaymentsProviderError('invalid_payment_method', 'Expiration year is invalid.');
  const billingZip = input.billingZip == null || input.billingZip === '' ? null : String(input.billingZip);
  if (billingZip !== null && !/^\d{5}(?:-\d{4})?$/.test(billingZip)) throw new PaymentsProviderError('invalid_payment_method', 'Billing ZIP is invalid.');
  return {
    provider: identifier(input.provider, 'provider'),
    processorCustomerId: identifier(input.processorCustomerId, 'processor customer ID', true),
    profileId: identifier(input.profileId, 'processor profile ID'),
    profileAccountId: identifier(input.profileAccountId, 'processor profile account ID'),
    methodType: input.methodType, last4,
    expMonth: input.methodType === 'card' ? expMonth : null,
    expYear: input.methodType === 'card' ? expYear : null,
    brand: input.methodType === 'card' ? (brands.get(String(input.brand || 'unknown').toLowerCase()) || 'Unknown') : null,
    billingZip, isDefault: input.isDefault === true,
  };
}

export function paymentAmountCents(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 99_999_999) throw new PaymentsProviderError('invalid_amount', 'A positive integer amount in cents is required.');
  return value;
}
export function paymentAmountDecimal(value) {
  const amount = paymentAmountCents(value); return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}
export function paymentIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300 || /[\u0000-\u001f]/.test(value)) throw new PaymentsProviderError('invalid_idempotency_key', 'An invoice attempt idempotency key is required.');
  return value;
}
// CardPointe orderid is limited to 50 characters. No invoice/customer PII in the ID.
export async function paymentOrderId(idempotencyKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(paymentIdempotencyKey(idempotencyKey)));
  return `opwp${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
}

export function safePaymentResult(input) {
  if (!PAYMENT_STATUSES.includes(input.status)) throw new PaymentsProviderError('invalid_provider_result', 'Processor returned an unsupported payment status.', 502);
  const safeCode = value => value == null ? null : (/^[A-Za-z0-9_-]{1,50}$/.test(String(value)) ? String(value) : null);
  return {
    provider: identifier(input.provider, 'provider'), status: input.status,
    transactionId: safeCode(input.transactionId), orderId: safeCode(input.orderId),
    amountCents: Number.isSafeInteger(input.amountCents) && input.amountCents >= 0 ? input.amountCents : null,
    processorCode: safeCode(input.processorCode), processor: safeCode(input.processor),
    achReturnCode: /^R\d{2}$/.test(String(input.achReturnCode || '')) ? input.achReturnCode : null,
    retryable: input.retryable === true, reconcileRequired: input.reconcileRequired === true,
  };
}
