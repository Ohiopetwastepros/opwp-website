import { PaymentsProviderError, paymentAmountCents, paymentIdempotencyKey, paymentOrderId, rejectSensitivePaymentData, safePaymentMethod, safePaymentResult } from './payments-provider.mjs';
import { fakeHostedTokenizerConfig } from './local-preview-payments.mjs';

// In-memory only: deterministic fixtures for tests and local review, never a live fallback.
export class FakePaymentsProvider {
  #profiles = new Map(); #orders = new Map(); #transactions = new Map(); #refunded = new Map(); #outcomes; #counter = 0; #tokenizerOrigin; calls = [];
  constructor({ outcomes = [], tokenizerOrigin = null } = {}) { this.#outcomes = [...outcomes]; this.#tokenizerOrigin = tokenizerOrigin; }
  orderIdForKey(key) { return paymentOrderId(key); }
  hostedTokenizerConfig({ methodType = 'card' } = {}) { return fakeHostedTokenizerConfig(this.#tokenizerOrigin, methodType) || { provider: 'fake', environment: 'test', methodType, origin: null, url: null }; }
  async createProfile(input) {
    rejectSensitivePaymentData(input, { allowToken: true });
    if (input.consent !== true || !/^9\d{15,18}$/.test(String(input.token || ''))) throw new PaymentsProviderError('invalid_token', 'A hosted test token and authorization are required.');
    const fixtureLast4 = input.token === '9000000000000002' && input.methodType === 'ach' ? '6789' : '4242';
    const method = safePaymentMethod({ provider: 'fake', processorCustomerId: input.processorCustomerId, profileId: `fake_profile_${++this.#counter}`, profileAccountId: '1', methodType: input.methodType, last4: input.last4 || fixtureLast4, expMonth: 12, expYear: 2030, brand: 'Visa', billingZip: input.billingZip, isDefault: input.isDefault });
    this.#profiles.set(method.profileId, method); this.calls.push({ operation: 'createProfile', profileId: method.profileId }); return structuredClone(method);
  }
  async getProfile(input) {
    rejectSensitivePaymentData(input); const method = this.#profiles.get(input.profileId);
    if (!method || method.profileAccountId !== input.profileAccountId) throw new PaymentsProviderError('profile_not_found', 'The test profile was not found.', 404);
    return structuredClone(method);
  }
  async #once(key, fingerprint, action) {
    paymentIdempotencyKey(key); const orderId = await paymentOrderId(key), previous = this.#orders.get(orderId);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new PaymentsProviderError('idempotency_conflict', 'The attempt was already used for different details.', 409); return structuredClone(previous.result); }
    const outcome = action(orderId); this.#orders.set(orderId, { fingerprint, result: outcome }); return structuredClone(outcome);
  }
  async charge(input) {
    rejectSensitivePaymentData(input); const method = safePaymentMethod(input.method), amountCents = paymentAmountCents(input.amountCents);
    if (method.provider !== 'fake' || input.recurring !== true || !input.invoiceId || !Number.isInteger(input.attempt) || input.attempt < 1) throw new PaymentsProviderError('invalid_charge', 'An approved test invoice attempt is required.');
    return this.#once(input.idempotencyKey, JSON.stringify(['charge', input.invoiceId, input.attempt, method.profileId, method.profileAccountId, method.methodType, amountCents]), orderId => {
      const outcome = this.#outcomes.shift() || {}, transactionId = `fake_tx_${++this.#counter}`;
      const saved = safePaymentResult({ provider: 'fake', transactionId, orderId, amountCents, status: outcome.status || (method.methodType === 'ach' ? 'pending' : 'paid'), processorCode: outcome.processorCode || '00', achReturnCode: outcome.achReturnCode, retryable: outcome.retryable, reconcileRequired: outcome.reconcileRequired });
      this.#transactions.set(transactionId, saved); this.calls.push({ operation: 'charge', transactionId, orderId, amountCents, methodType: method.methodType }); return saved;
    });
  }
  async inquire(input) {
    rejectSensitivePaymentData(input); paymentAmountCents(input.amountCents);
    const found = input.transactionId ? this.#transactions.get(input.transactionId) : this.#orders.get(input.orderId)?.result;
    this.calls.push({ operation: 'inquire', transactionId: input.transactionId || null, orderId: input.orderId || null });
    if (!found) return safePaymentResult({ provider: 'fake', status: 'not_found', orderId: input.orderId, amountCents: input.amountCents, reconcileRequired: true });
    if (found.amountCents !== input.amountCents) return safePaymentResult({ ...found, status: 'unknown', reconcileRequired: true });
    return structuredClone(found);
  }
  async #adjust(action, input) {
    rejectSensitivePaymentData(input); const amountCents = paymentAmountCents(input.amountCents);
    return this.#once(input.idempotencyKey, JSON.stringify([action, input.transactionId, amountCents]), orderId => {
      const found = this.#transactions.get(input.transactionId);
      const refundable = found ? found.amountCents - (this.#refunded.get(input.transactionId) || 0) : 0;
      if (!found || !['paid', 'pending'].includes(found.status) || action === 'refund' && found.status !== 'paid' || (action === 'refund' ? refundable : found.amountCents) < amountCents) return safePaymentResult({ provider: 'fake', status: 'failed', transactionId: input.transactionId, orderId, amountCents, processorCode: 'not_adjustable' });
      this.calls.push({ operation: action, transactionId: input.transactionId, orderId, amountCents });
      if (action === 'refund') this.#refunded.set(input.transactionId, (this.#refunded.get(input.transactionId) || 0) + amountCents);
      // Payment history stays immutable. An adjustment is a separate recorded result.
      return safePaymentResult({ provider: 'fake', status: action === 'void' ? 'voided' : 'refunded', transactionId: input.transactionId, orderId, amountCents, processorCode: '00' });
    });
  }
  void(input) { return this.#adjust('void', input); }
  refund(input) { return this.#adjust('refund', input); }
  async pollAch(input) { return this.inquire({ ...input, methodType: 'ach' }); }
  settleAch(transactionId, { achReturnCode } = {}) {
    const found = this.#transactions.get(transactionId);
    if (!found) throw new PaymentsProviderError('transaction_not_found', 'The test transaction was not found.', 404);
    const next = safePaymentResult({ ...found, status: achReturnCode ? 'failed' : 'paid', achReturnCode, retryable: ['R01', 'R09'].includes(achReturnCode) });
    this.#transactions.set(transactionId, next);
    const order = this.#orders.get(found.orderId); if (order) order.result = next;
    return structuredClone(next);
  }
}
export function createFakePaymentsProvider(config) { return new FakePaymentsProvider(config); }
