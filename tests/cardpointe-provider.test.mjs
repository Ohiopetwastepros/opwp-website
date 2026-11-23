import test from 'node:test';
import assert from 'node:assert/strict';
import { CardPointeProvider, createCardPointeProvider } from '../lib/cardpointe-provider.mjs';
import { assertPaymentsProvider, paymentOrderId } from '../lib/payments-provider.mjs';

const config = { appEnv: 'test', environment: 'uat', baseUrl: 'https://fts-uat.cardconnect.com/cardconnect/rest/', username: 'fixture-user', password: 'fixture-password', merchantId: '496082673888', enabled: true };
const method = { provider: 'cardpointe', processorCustomerId: null, profileId: '18854390708079407191', profileAccountId: '1', methodType: 'card', last4: '4242', expMonth: 12, expYear: 2030, brand: 'Visa', billingZip: '43601', isDefault: true };
const charge = (extra = {}) => ({ invoiceId: 'invoice_1', attempt: 1, idempotencyKey: 'invoice_1:1', amountCents: 10537, method, recurring: true, ...extra });
const auth = (extra = {}) => ({ respstat: 'A', respcode: '00', respproc: 'FNOR', retref: '123456789012', amount: '105.37', ...extra });
function fixture(responses, overrides = {}) {
  const calls = [], queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    if (next === undefined) throw new Error('Unexpected test request');
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { provider: createCardPointeProvider({ ...config, fetchImpl, ...overrides }), calls };
}

test('CardPointe implements the provider contract and accepts only assigned HTTPS UAT hosts', () => {
  const { provider } = fixture([]); assert.equal(assertPaymentsProvider(provider), provider); assert.ok(provider instanceof CardPointeProvider);
  for (const override of [
    { appEnv: 'production' }, { environment: 'production' }, { environment: undefined },
    { baseUrl: 'https://fts.cardconnect.com/cardconnect/rest/' }, { baseUrl: 'http://fts-uat.cardconnect.com/cardconnect/rest/' },
    { baseUrl: 'https://fts-uat.cardconnect.com.evil.example/cardconnect/rest/' }, { baseUrl: 'https://evil.example/cardconnect/rest/' },
    { baseUrl: 'https://user:pass@fts-uat.cardconnect.com/cardconnect/rest/' }, { baseUrl: 'https://fts-uat.cardconnect.com/cardconnect/rest/?redirect=production' },
    { baseUrl: 'https://fts-uat.cardconnect.com/cardconnect/rest/#fragment' }, { baseUrl: 'https://fts-uat.cardconnect.com:8443/cardconnect/rest/' },
    { achEntryCode: 'R' }, { achAccountType: 'RAW' },
  ]) assert.throws(() => fixture([], override), /UAT|ACH/);
});
test('UAT network access defaults off and no request occurs before explicit enablement', async () => {
  const { provider, calls } = fixture([], { enabled: false });
  await assert.rejects(provider.charge(charge()), /not been enabled/); assert.equal(calls.length, 0);
});
test('hosted tokenizer supports card and ACH solely inside the processor iframe', () => {
  const { provider } = fixture([]), card = provider.hostedTokenizerConfig({ methodType: 'card' }), ach = provider.hostedTokenizerConfig({ methodType: 'ach' });
  assert.equal(card.origin, 'https://fts-uat.cardconnect.com'); assert.equal(new URL(card.url).searchParams.get('usecvv'), 'true');
  assert.equal(new URL(card.url).searchParams.get('useexpiry'), 'true'); assert.equal(new URL(card.url).searchParams.get('tokenpropname'), 'token');
  assert.equal(new URL(ach.url).searchParams.get('fullmobilekeyboard'), 'true'); assert.equal(new URL(ach.url).searchParams.has('usecvv'), false);
  assert.match(ach.clearingTime, /pending/); assert.equal(JSON.stringify(card).includes(config.password), false);
});
test('profile creation uses an ephemeral hosted token, consent and a strict response allowlist', async () => {
  const { provider, calls } = fixture([{ respstat: 'A', profileid: method.profileId, acctid: '1', account: 'XXXXXXXXXXXX4242', expiry: '1230', accttype: 'VISA', postal: '43601', raw: { bankaba: 'discard' }, token: 'discard', name: 'discard' }]);
  const saved = await provider.createProfile({ token: '9412345678904242', methodType: 'card', expiry: '1230', billingZip: '43601', consent: true, isDefault: true });
  assert.deepEqual(saved, method);
  assert.equal(calls[0].method, 'PUT'); assert.equal(calls[0].body.account, '9412345678904242'); assert.equal(calls[0].body.cofpermission, 'Y');
  assert.equal(calls[0].body.expiry, '1230'); assert.equal(calls[0].redirect, 'error');
  assert.doesNotMatch(JSON.stringify(saved), /discard|9412345678904242|bankaba|token|name/);
});
test('profile metadata never infers last4 from an unmasked CardSecure token', async () => {
  const { provider } = fixture([{ profileid: method.profileId, acctid: '1', account: '9412345678904242', expiry: '1230', accttype: 'VISA' }]);
  const saved = await provider.createProfile({ token: '9412345678904242', methodType: 'card', consent: true });
  assert.equal(saved.last4, null); assert.equal(saved.expYear, 2030); assert.equal('account' in saved, false);
});
test('profile API rejects unconsented, raw or nested sensitive input before dispatch', async () => {
  const { provider, calls } = fixture([]), input = { token: '9412345678904242', methodType: 'card', consent: true };
  await assert.rejects(provider.createProfile({ ...input, consent: false }), /authorization/);
  await assert.rejects(provider.createProfile({ ...input, token: '4111111111111111' }), /hosted processor form/);
  for (const field of ['account', 'cardNumber', 'cvv', 'bankAccountNumber', 'routingNumber']) await assert.rejects(provider.createProfile({ ...input, metadata: { [field]: 'sensitive' } }), /hosted payment tokens/);
  assert.equal(calls.length, 0);
});
test('profile retrieval identifies the exact profile/account pair and returns safe display data', async () => {
  const { provider, calls } = fixture([[{ profileid: method.profileId, acctid: '2', lastfour: '1111' }, { profileid: method.profileId, acctid: '1', lastfour: '4242', expiry: '1230', accttype: 'VISA', postal: '43601', defaultacct: 'Y', cvv: 'discard' }]]);
  const saved = await provider.getProfile({ profileId: method.profileId, profileAccountId: '1', methodType: 'card' });
  assert.equal(calls[0].url, `${config.baseUrl}profile/${method.profileId}/1/${config.merchantId}`); assert.deepEqual(saved, method);
  await assert.rejects(provider.getProfile({ profileId: `${method.profileId}/1`, profileAccountId: '1', methodType: 'card' }), /valid processor profile/);
});
test('saved recurring card authorization uses profile/account IDs and exact decimal amount', async () => {
  const { provider, calls } = fixture([auth({ account: 'discard', token: 'discard', nested: { bankaba: 'discard' } })]);
  const paid = await provider.charge(charge()); assert.equal(paid.status, 'paid'); assert.equal(paid.amountCents, 10537);
  assert.deepEqual(calls[0].body, { merchid: config.merchantId, profile: `${method.profileId}/1`, amount: '105.37', currency: 'USD', capture: 'Y', orderid: await paymentOrderId('invoice_1:1'), ecomind: 'R', cof: 'M', cofscheduled: 'Y' });
  assert.match(calls[0].headers.Authorization, /^Basic /); assert.equal(calls[0].redirect, 'error');
  assert.doesNotMatch(JSON.stringify(paid), /discard|bankaba|account|token/);
});
test('concurrent charge calls dispatch once; altered amount/profile for a used key is rejected', async () => {
  const { provider, calls } = fixture([auth()]);
  const outcomes = await Promise.all([provider.charge(charge()), provider.charge(charge()), provider.charge(charge())]);
  assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[1], outcomes[2]); assert.equal(calls.length, 1);
  await assert.rejects(provider.charge(charge({ amountCents: 10538 })), /different details/);
  await assert.rejects(provider.charge(charge({ method: { ...method, profileAccountId: '2' } })), /different details/);
  assert.equal(calls.length, 1);
});
test('timeouts fail closed without resending; reconciliation queries the deterministic order ID', async () => {
  const { provider, calls } = fixture([new Error('do not expose account 4111111111111111'), auth({ setlstat: 'Queued for Capture' })]);
  const first = await provider.charge(charge()); assert.equal(first.status, 'unknown'); assert.equal(first.reconcileRequired, true); assert.equal(first.retryable, false);
  assert.deepEqual(await provider.charge(charge()), first); assert.equal(calls.length, 1);
  assert.equal((await provider.inquire({ orderId: first.orderId, amountCents: 10537, methodType: 'card' })).status, 'paid');
  assert.equal(calls.length, 2); assert.equal(calls[1].method, 'GET'); assert.match(calls[1].url, /inquireByOrderid\/opwp[a-f0-9]{40}\//);
  assert.doesNotMatch(JSON.stringify(first), /4111111111111111/);
});
test('processor HTTP errors, invalid JSON, and oversized responses require reconciliation', async () => {
  for (const response of [
    () => new Response('sensitive', { status: 503 }), () => new Response('not JSON', { status: 200 }), () => new Response(JSON.stringify({ text: 'x'.repeat(140_000) })),
  ]) {
    const { provider, calls } = fixture([response]);
    const unknown = await provider.charge(charge()); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.reconcileRequired, true); assert.equal(calls.length, 1);
  }
});
test('declines and retryable processor failures never become Paid', async () => {
  for (const [respstat, retryable] of [['C', false], ['B', true]]) {
    const { provider } = fixture([auth({ respstat, respcode: '05' })]);
    const failed = await provider.charge(charge()); assert.equal(failed.status, 'failed'); assert.equal(failed.processorCode, '05'); assert.equal(failed.retryable, retryable);
  }
});
test('partial approvals, mismatched order IDs and absent amounts never become Paid', async () => {
  for (const overrides of [{ amount: '100.00' }, { orderid: 'another_order' }, { amount: undefined }, { retref: undefined }]) {
    const { provider } = fixture([auth(overrides)]); const unknown = await provider.charge(charge());
    assert.equal(unknown.status, 'unknown'); assert.equal(unknown.reconcileRequired, true);
  }
});
test('a confirmed not-found inquiry is distinct from a timeout and never silently resends', async () => {
  const { provider, calls } = fixture([{ respstat: 'C', respproc: 'PPS', respcode: '29', resptext: 'Txn not found' }]);
  const missing = await provider.inquire({ orderId: 'order_1', methodType: 'card', amountCents: 10537 });
  assert.equal(missing.status, 'not_found'); assert.equal(missing.reconcileRequired, true); assert.equal(calls.length, 1);
});
test('inquiry verifies transaction and amount, including void settlement status', async () => {
  const { provider, calls } = fixture([auth({ setlstat: 'Accepted' }), auth({ retref: '999999999999', setlstat: 'Accepted' }), auth({ setlstat: 'Voided' })]);
  const input = { transactionId: '123456789012', methodType: 'card', amountCents: 10537 };
  assert.equal((await provider.inquire(input)).status, 'paid'); assert.equal((await provider.inquire(input)).status, 'unknown'); assert.equal((await provider.inquire(input)).status, 'voided');
  assert.match(calls[0].url, /inquire\/123456789012\/496082673888$/);
});
test('ACH authorization uses approved SEC and account type and always starts Pending', async () => {
  const { provider, calls } = fixture([auth({ respproc: 'PSTR', setlstat: 'Accepted' })], { achEntryCode: 'B', achAccountType: 'ESAV' });
  const pending = await provider.charge(charge({ method: { ...method, methodType: 'ach' } }));
  assert.equal(pending.status, 'pending'); assert.equal(calls[0].body.ecomind, 'B'); assert.equal(calls[0].body.accttype, 'ESAV');
  assert.equal('cof' in calls[0].body, false); assert.equal('account' in calls[0].body, false); assert.equal('bankaba' in calls[0].body, false);
});
test('ACH remains Pending on a Processed funding row without an accepted settlement', async () => {
  const { provider, calls } = fixture([auth({ setlstat: 'Queued for Capture' }), { perPageSize: 100, currentPageSize: 1, fundings: [{ ddanumber: 'discard', abanumber: 'discard' }], txns: [{ retref: '123456789012', amount: '105.37', status: 'Processed', bankaba: 'discard' }] }]);
  const pending = await provider.pollAch({ transactionId: '123456789012', amountCents: 10537, fundingDate: '2026-12-01' });
  assert.equal(pending.status, 'pending'); assert.match(calls[1].url, /date=20261201/); assert.match(calls[1].url, /paymenttype=ach/);
  assert.doesNotMatch(JSON.stringify(pending), /discard|ddanumber|abanumber|bankaba/);
});
test('ACH settles only with accepted/settled evidence and return codes override settlement', async () => {
  const { provider } = fixture([auth({ setlstat: 'Accepted' }), { txns: [] }]);
  assert.equal((await provider.pollAch({ transactionId: '123456789012', amountCents: 10537, fundingDate: '2026-12-01' })).status, 'paid');
  for (const code of ['R01', 'R07', 'R10']) {
    const fixtureReturn = fixture([auth({ setlstat: 'Accepted' }), { txns: [{ retref: '123456789012', amount: '105.37', status: 'Processed', achreturncode: code }] }]);
    const failed = await fixtureReturn.provider.pollAch({ transactionId: '123456789012', amountCents: 10537, fundingDate: '2026-12-01' });
    assert.equal(failed.status, 'failed'); assert.equal(failed.achReturnCode, code); assert.equal(failed.retryable, code === 'R01');
  }
});
test('ACH polling scans later funding pages for returns even after an earlier settled row', async () => {
  const { provider, calls } = fixture([auth({ setlstat: 'Accepted' }), { perPageSize: 1, currentPageSize: 1, txns: [{ retref: '123456789012', amount: '105.37', status: 'Settled' }] }, { perPageSize: 1, currentPageSize: 1, txns: [{ retref: '123456789012', achreturncode: 'R08' }] }]);
  const failed = await provider.pollAch({ transactionId: '123456789012', amountCents: 10537, fundingDate: '2026-12-01' });
  assert.equal(failed.status, 'failed'); assert.equal(failed.achReturnCode, 'R08'); assert.match(calls[2].url, /page=2/);
});
test('incomplete funding lookups fail closed even when inquiry was Accepted', async () => {
  const { provider } = fixture([auth({ setlstat: 'Accepted' }), new Error('funding timeout')]);
  const unknown = await provider.pollAch({ transactionId: '123456789012', amountCents: 10537, fundingDate: '2026-12-01' });
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.reconcileRequired, true);
  await assert.rejects(provider.pollAch({ transactionId: '123456789012', amountCents: 10537, fundingDate: '2026-02-30' }), /funding date/);
});
test('void/refund use original merchant/transaction and are locally idempotent', async () => {
  const { provider, calls } = fixture([auth({ amount: '5.37', authcode: 'REVERS' }), auth({ amount: '5.37', retref: '123456789013' })]);
  const adjustment = { transactionId: '123456789012', amountCents: 537, idempotencyKey: 'void_invoice_1:1' };
  const voided = await provider.void(adjustment); assert.equal(voided.status, 'voided'); assert.deepEqual(await provider.void(adjustment), voided);
  const refunded = await provider.refund({ ...adjustment, idempotencyKey: 'refund_invoice_1:1' }); assert.equal(refunded.status, 'refunded');
  assert.equal(calls.length, 2); assert.equal(calls[0].body.merchid, config.merchantId); assert.equal(calls[0].body.retref, adjustment.transactionId); assert.equal(calls[0].body.amount, '5.37');
  assert.match(calls[1].body.orderid, /^opwp[a-f0-9]{40}$/); assert.match(calls[1].url, /\/refund$/);
});
test('adjustment declines and uncertain responses do not report a successful refund', async () => {
  for (const response of [auth({ respstat: 'C', respcode: '05', amount: '5.37' }), auth({ amount: '1.00' }), new Error('timeout')]) {
    const { provider } = fixture([response]), outcome = await provider.refund({ transactionId: '123456789012', amountCents: 537, idempotencyKey: 'refund_1:1' });
    assert.ok(['failed', 'unknown'].includes(outcome.status)); assert.notEqual(outcome.status, 'refunded');
  }
});
