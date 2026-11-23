import { readBoundedProviderJson } from './bounded-body.mjs';
import { PaymentsProviderError, paymentAmountCents, paymentAmountDecimal, paymentIdempotencyKey, paymentOrderId, rejectSensitivePaymentData, safePaymentMethod, safePaymentResult } from './payments-provider.mjs';

// References and UAT acceptance checklist: docs/ROUTE_OS_BILLING_UAT.md.
// This adapter intentionally has no production mode and never owns a recurring schedule.
const tokenPattern = /^9\d{15,18}$/;
const profilePattern = /^\d{1,20}$/;
const accountPattern = /^\d{1,3}$/;
const transactionPattern = /^\d{1,20}$/;
const orderPattern = /^[A-Za-z0-9_-]{1,50}$/;
const result = input => safePaymentResult({ provider: 'cardpointe', ...input });
const normalizedStatus = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const accepted = value => ['accepted', 'y', 'settled'].includes(normalizedStatus(value));
const rejected = value => ['rejected', 'n', 'declined', 'd'].includes(normalizedStatus(value));
const voided = value => ['voided', 'v'].includes(normalizedStatus(value));

function uatBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new PaymentsProviderError('uat_configuration', 'A CardPointe UAT gateway URL is required.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-uat\.cardconnect\.com$/.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !['/cardconnect/rest', '/cardconnect/rest/'].includes(url.pathname)) throw new PaymentsProviderError('uat_configuration', 'Only the assigned HTTPS CardPointe UAT gateway is permitted.');
  return `${url.origin}/cardconnect/rest/`;
}
function profilePair(profileId, profileAccountId) {
  if (typeof profileId !== 'string' || !profilePattern.test(profileId) || typeof profileAccountId !== 'string' || !accountPattern.test(profileAccountId)) throw new PaymentsProviderError('invalid_profile', 'A valid processor profile and account ID are required.');
  return `${profileId}/${profileAccountId}`;
}
function transactionId(value) {
  if (typeof value !== 'string' || !transactionPattern.test(value)) throw new PaymentsProviderError('invalid_transaction', 'A valid processor transaction ID is required.');
  return value;
}
function cents(value) {
  const amount = String(value ?? '');
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.'); return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function expiryMetadata(value) {
  const expiry = String(value || '');
  return /^(0[1-9]|1[0-2])\d{2}$/.test(expiry) ? { expMonth: Number(expiry.slice(0, 2)), expYear: 2000 + Number(expiry.slice(2)) } : {};
}
function safeLast4(row, fallback) {
  const explicit = row.lastfour ?? row.last4 ?? fallback;
  if (/^\d{4}$/.test(String(explicit || ''))) return String(explicit);
  // Never derive card digits from a CardSecure token or an unmasked account value.
  const mask = String(row.account || '');
  return /^(?:\d{0,6})[xX*• .-]{4,}(\d{4})$/.exec(mask)?.[1] || null;
}
function profileMetadata(row, input) {
  const billingZip = String(row.postal || input.billingZip || '');
  return safePaymentMethod({
    provider: 'cardpointe', processorCustomerId: input.processorCustomerId || null,
    profileId: String(row.profileid || input.profileId || ''), profileAccountId: String(row.acctid || input.profileAccountId || ''),
    methodType: input.methodType, last4: safeLast4(row, input.last4), ...expiryMetadata(row.expiry || input.expiry),
    brand: row.accttype || input.brand, billingZip: /^\d{5}(?:-\d{4})?$/.test(billingZip) ? billingZip : null,
    isDefault: row.defaultacct === 'Y' || input.isDefault === true,
  });
}
function rowsFromProfiles(data) { return Array.isArray(data) ? data : Array.isArray(data?.profiles) ? data.profiles : [data]; }
function codeFields(row) { return { processorCode: row?.respcode, processor: row?.respproc, achReturnCode: row?.achreturncode }; }

export class CardPointeProvider {
  #baseUrl; #username; #password; #merchantId; #fetch; #enabled; #achEntryCode; #achAccountType; #timeoutMs; #operations = new Map();
  constructor({ appEnv, environment, baseUrl, username, password, merchantId, fetchImpl = globalThis.fetch, enabled = false, achEntryCode = 'E', achAccountType = 'ECHK', timeoutMs = 15_000 } = {}) {
    if (String(appEnv ?? globalThis.process?.env?.APP_ENV ?? '').toLowerCase() === 'production' || environment !== 'uat') throw new PaymentsProviderError('uat_only', 'This payment adapter is restricted to UAT.');
    this.#baseUrl = uatBaseUrl(baseUrl);
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password || typeof merchantId !== 'string' || !/^\d{1,20}$/.test(merchantId) || typeof fetchImpl !== 'function') throw new PaymentsProviderError('uat_configuration', 'Assigned UAT credentials and merchant ID are required.');
    if (!['E', 'B', 'T'].includes(achEntryCode) || !['ECHK', 'ESAV'].includes(achAccountType)) throw new PaymentsProviderError('uat_configuration', 'An approved ACH entry code and account type are required.');
    this.#username = username; this.#password = password; this.#merchantId = merchantId; this.#fetch = fetchImpl;
    this.#enabled = enabled === true; this.#achEntryCode = achEntryCode; this.#achAccountType = achAccountType;
    this.#timeoutMs = Math.min(30_000, Math.max(100, Number(timeoutMs) || 15_000));
  }
  orderIdForKey(key) { return paymentOrderId(key); }
  hostedTokenizerConfig({ methodType = 'card' } = {}) {
    if (!['card', 'ach'].includes(methodType)) throw new PaymentsProviderError('invalid_payment_method', 'Payment method must be card or ACH.');
    const origin = new URL(this.#baseUrl).origin, url = new URL('/itoke/ajax-tokenizer.html', origin);
    url.searchParams.set('tokenpropname', 'token'); url.searchParams.set('enhancedresponse', 'true');
    url.searchParams.set('tokenizewheninactive', 'true'); url.searchParams.set('inactivityto', '2000');
    if (methodType === 'card') {
      url.searchParams.set('useexpiry', 'true'); url.searchParams.set('usecvv', 'true');
      url.searchParams.set('invalidcreditcardevent', 'true'); url.searchParams.set('invalidcvvevent', 'true'); url.searchParams.set('invalidexpiryevent', 'true');
    } else { url.searchParams.set('fullmobilekeyboard', 'true'); url.searchParams.set('invalidinputevent', 'true'); url.searchParams.set('cardtitle', 'Routing number / account number'); }
    return { provider: 'cardpointe', environment: 'uat', methodType, origin, url: url.toString(), clearingTime: methodType === 'ach' ? 'ACH stays pending until the processor confirms settlement. Bank returns may arrive later.' : null };
  }
  async #request(method, path, body) {
    if (!this.#enabled) throw new PaymentsProviderError('uat_disabled', 'UAT processor access has not been enabled.', 503);
    // Fetch never retries mutations and never follows redirects, including redirects out of UAT.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl).toString(), {
        method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Basic ${btoa(`${this.#username}:${this.#password}`)}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new PaymentsProviderError('processor_unavailable', 'The UAT processor response needs reconciliation.', 502);
      return await readBoundedProviderJson(response);
    } catch (error) {
      if (error instanceof PaymentsProviderError) throw error;
      throw new PaymentsProviderError('processor_unavailable', 'The UAT processor response needs reconciliation.', 502);
    } finally { clearTimeout(timer); }
  }
  async createProfile(input) {
    rejectSensitivePaymentData(input, { allowToken: true });
    if (input.consent !== true) throw new PaymentsProviderError('consent_required', 'Stored payment authorization is required.');
    if (!['card', 'ach'].includes(input.methodType) || typeof input.token !== 'string' || !tokenPattern.test(input.token)) throw new PaymentsProviderError('invalid_token', 'A token from the hosted processor form is required.');
    if (input.expiry && !Object.keys(expiryMetadata(input.expiry)).length) throw new PaymentsProviderError('invalid_expiry', 'Expiration must be MMYY.');
    const metadata = { ...input, profileId: '1', profileAccountId: '1' };
    // Validate safe metadata before dispatch, without passing the ephemeral token to projection.
    delete metadata.token; delete metadata.consent;
    safePaymentMethod({ ...metadata, provider: 'cardpointe', ...expiryMetadata(input.expiry) });
    const request = { merchid: this.#merchantId, account: input.token, cofpermission: 'Y', defaultacct: input.isDefault === true ? 'Y' : 'N' };
    if (input.methodType === 'card' && input.expiry) request.expiry = input.expiry;
    if (input.billingZip) request.postal = input.billingZip;
    if (input.methodType === 'ach') request.accttype = this.#achAccountType;
    const response = await this.#request('PUT', 'profile', request);
    if (response.respstat && response.respstat !== 'A') throw new PaymentsProviderError('profile_failed', 'The processor could not save this payment method.', 422);
    const row = rowsFromProfiles(response).find(item => typeof item?.profileid === 'string' && profilePattern.test(item.profileid) && typeof item.acctid === 'string' && accountPattern.test(item.acctid));
    if (!row) throw new PaymentsProviderError('profile_unknown', 'The processor profile requires UAT reconciliation.', 502);
    profilePair(String(row.profileid), String(row.acctid));
    return profileMetadata(row, input);
  }
  async getProfile(input) {
    rejectSensitivePaymentData(input); profilePair(input.profileId, input.profileAccountId);
    if (!['card', 'ach'].includes(input.methodType)) throw new PaymentsProviderError('invalid_payment_method', 'Payment method must be card or ACH.');
    const data = await this.#request('GET', `profile/${input.profileId}/${input.profileAccountId}/${this.#merchantId}`);
    const row = rowsFromProfiles(data).find(item => String(item?.profileid) === input.profileId && String(item?.acctid) === input.profileAccountId);
    if (!row) throw new PaymentsProviderError('profile_not_found', 'The processor profile was not found.', 404);
    return profileMetadata(row, input);
  }
  async #once(key, fingerprint, action) {
    paymentIdempotencyKey(key);
    const previous = this.#operations.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new PaymentsProviderError('idempotency_conflict', 'This payment attempt was already used for different details.', 409);
      return previous.promise;
    }
    // Parent billing storage must durably claim each attempt before calling the adapter.
    // This in-process guard is extra protection, not a cross-worker idempotency guarantee.
    const promise = action(); this.#operations.set(key, { fingerprint, promise }); return promise;
  }
  async charge(input) {
    rejectSensitivePaymentData(input);
    if (input.recurring !== true || typeof input.invoiceId !== 'string' || !input.invoiceId || !Number.isInteger(input.attempt) || input.attempt < 1) throw new PaymentsProviderError('invalid_charge', 'An approved recurring invoice attempt is required.');
    const amountCents = paymentAmountCents(input.amountCents), method = safePaymentMethod(input.method);
    if (method.provider !== 'cardpointe') throw new PaymentsProviderError('invalid_provider', 'This profile belongs to another processor.');
    const profile = profilePair(method.profileId, method.profileAccountId), orderId = await paymentOrderId(input.idempotencyKey);
    const fingerprint = JSON.stringify(['charge', input.invoiceId, input.attempt, amountCents, profile, method.methodType]);
    return this.#once(input.idempotencyKey, fingerprint, async () => {
      const request = { merchid: this.#merchantId, profile, amount: paymentAmountDecimal(amountCents), currency: 'USD', capture: 'Y', orderid: orderId };
      if (method.methodType === 'card') Object.assign(request, { ecomind: 'R', cof: 'M', cofscheduled: 'Y' });
      else Object.assign(request, { accttype: this.#achAccountType, ecomind: this.#achEntryCode });
      try { return this.#normalize(await this.#request('PUT', 'auth', request), { orderId, amountCents, methodType: method.methodType, authorization: true }); }
      catch (error) {
        if (error.code === 'uat_disabled') throw error;
        return result({ status: 'unknown', orderId, amountCents, processorCode: 'transport_unknown', reconcileRequired: true });
      }
    });
  }
  #normalize(row, { transactionId: expectedTransactionId, orderId, amountCents, methodType, authorization = false }) {
    const retref = transactionPattern.test(String(row?.retref || '')) ? String(row.retref) : null;
    const returnedOrder = orderPattern.test(String(row?.orderid || '')) ? String(row.orderid) : null;
    const returnedAmount = cents(row?.amount), base = { transactionId: retref, orderId: returnedOrder || orderId, amountCents: returnedAmount, ...codeFields(row) };
    if (row?.respproc === 'PPS' && String(row.respcode) === '29') return result({ ...base, amountCents, status: 'not_found', reconcileRequired: true });
    if ((expectedTransactionId && retref !== expectedTransactionId) || (orderId && returnedOrder && returnedOrder !== orderId) || (returnedAmount !== null && returnedAmount !== amountCents)) return result({ ...base, status: 'unknown', reconcileRequired: true });
    if (/^R\d{2}$/.test(String(row?.achreturncode || ''))) return result({ ...base, status: 'failed', retryable: ['R01', 'R09'].includes(row.achreturncode) });
    if (voided(row?.setlstat)) return result({ ...base, status: 'voided' });
    if (row?.respstat === 'C' || row?.respstat === 'B' || rejected(row?.setlstat)) return result({ ...base, amountCents: returnedAmount ?? amountCents, status: 'failed', retryable: row.respstat === 'B' });
    if (!retref || returnedAmount !== amountCents) return result({ ...base, status: 'unknown', reconcileRequired: true });
    if (methodType === 'ach') return result({ ...base, status: !authorization && accepted(row.setlstat) ? 'paid' : 'pending' });
    if (row?.respstat === 'A' && (authorization || accepted(row.setlstat) || ['queuedforcapture', 'r'].includes(normalizedStatus(row.setlstat)))) return result({ ...base, status: 'paid' });
    return result({ ...base, status: 'unknown', reconcileRequired: true });
  }
  async inquire(input) {
    rejectSensitivePaymentData(input);
    const amountCents = paymentAmountCents(input.amountCents);
    if (!['card', 'ach'].includes(input.methodType)) throw new PaymentsProviderError('invalid_payment_method', 'Payment method must be card or ACH.');
    let path;
    if (input.transactionId) path = `inquire/${transactionId(input.transactionId)}/${this.#merchantId}`;
    else if (typeof input.orderId === 'string' && orderPattern.test(input.orderId)) path = `inquireByOrderid/${input.orderId}/${this.#merchantId}`;
    else throw new PaymentsProviderError('invalid_inquiry', 'A processor transaction ID or order ID is required.');
    try { return this.#normalize(await this.#request('GET', path), input); }
    catch (error) {
      if (error.code === 'uat_disabled') throw error;
      return result({ status: 'unknown', transactionId: input.transactionId, orderId: input.orderId, amountCents, processorCode: 'transport_unknown', reconcileRequired: true });
    }
  }
  async #adjust(action, input) {
    rejectSensitivePaymentData(input); const retref = transactionId(input.transactionId), amountCents = paymentAmountCents(input.amountCents), orderId = await paymentOrderId(input.idempotencyKey);
    return this.#once(input.idempotencyKey, JSON.stringify([action, retref, amountCents]), async () => {
      try {
        const row = await this.#request('PUT', action, { merchid: this.#merchantId, retref, amount: paymentAmountDecimal(amountCents), ...(action === 'refund' ? { orderid: orderId } : {}) });
        const adjustedAmount = cents(row.amount);
        if (row.respstat === 'A' && adjustedAmount === amountCents && transactionPattern.test(String(row.retref || ''))) return result({ status: action === 'void' ? 'voided' : 'refunded', transactionId: String(row.retref), orderId, amountCents, ...codeFields(row) });
        if (row.respstat === 'B' || row.respstat === 'C') return result({ status: 'failed', transactionId: retref, orderId, amountCents, ...codeFields(row), retryable: row.respstat === 'B' });
        return result({ status: 'unknown', transactionId: retref, orderId, amountCents, ...codeFields(row), reconcileRequired: true });
      } catch (error) {
        if (error.code === 'uat_disabled') throw error;
        return result({ status: 'unknown', transactionId: retref, orderId, amountCents, processorCode: 'transport_unknown', reconcileRequired: true });
      }
    });
  }
  void(input) { return this.#adjust('void', input); }
  refund(input) { return this.#adjust('refund', input); }
  async pollAch(input) {
    rejectSensitivePaymentData(input); transactionId(input.transactionId); paymentAmountCents(input.amountCents);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.fundingDate || '')) || Number.isNaN(Date.parse(`${input.fundingDate}T12:00:00Z`)) || new Date(`${input.fundingDate}T12:00:00Z`).toISOString().slice(0, 10) !== input.fundingDate) throw new PaymentsProviderError('invalid_funding_date', 'An ACH funding date is required.');
    const inquiry = await this.inquire({ transactionId: input.transactionId, orderId: input.orderId, amountCents: input.amountCents, methodType: 'ach' });
    if (['failed', 'voided', 'unknown', 'not_found'].includes(inquiry.status)) return inquiry;
    try {
      // Returns can arrive after a prior settlement. Always inspect funding, even after Accepted.
      let hasSettlement = false;
      for (let page = 1; page <= 20; page++) {
        const query = new URLSearchParams({ merchid: this.#merchantId, date: input.fundingDate.replaceAll('-', ''), page: String(page), limit: '100', paymenttype: 'ach' });
        const data = await this.#request('GET', `funding?${query}`);
        const rows = Array.isArray(data) ? data : Array.isArray(data.txns) ? data.txns : Array.isArray(data.transactions) ? data.transactions : [];
        const matches = rows.filter(row => String(row.retref) === input.transactionId);
        const returned = matches.find(row => /^R\d{2}$/.test(String(row.achreturncode || '')));
        if (returned) return result({ status: 'failed', transactionId: input.transactionId, orderId: input.orderId, amountCents: input.amountCents, achReturnCode: returned.achreturncode, retryable: ['R01', 'R09'].includes(returned.achreturncode) });
        if (matches.some(row => rejected(row.setlstat) || rejected(row.status))) return result({ status: 'failed', transactionId: input.transactionId, orderId: input.orderId, amountCents: input.amountCents, reconcileRequired: true });
        const settled = matches.find(row => accepted(row.setlstat) || ['funded', 'settled'].includes(normalizedStatus(row.status)));
        // "Processed" alone is also used for rejected ACH and is never proof of payment.
        if (settled && cents(settled.amount) === input.amountCents) hasSettlement = true;
        const pageSize = Number(data.currentPageSize ?? rows.length), perPage = Number(data.perPageSize ?? 100);
        if (pageSize < perPage || pageSize === 0) return hasSettlement ? result({ status: 'paid', transactionId: input.transactionId, orderId: input.orderId, amountCents: input.amountCents }) : inquiry;
      }
      return result({ ...inquiry, status: 'unknown', reconcileRequired: true, processorCode: 'funding_page_limit' });
    } catch (error) {
      if (error.code === 'uat_disabled') throw error;
      // Do not mark ACH settled while a return/settlement lookup is incomplete.
      return result({ ...inquiry, status: 'unknown', reconcileRequired: true, processorCode: 'funding_unknown' });
    }
  }
}

export function createCardPointeProvider(config) { return new CardPointeProvider(config); }
