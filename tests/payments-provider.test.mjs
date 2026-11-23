import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaymentsProvider, paymentAmountDecimal, paymentOrderId, safePaymentMethod, safePaymentResult } from '../lib/payments-provider.mjs';
import { createFakePaymentsProvider } from '../lib/fake-payments-provider.mjs';

const profileInput = { token: '9412345678904242', consent: true, methodType: 'card', billingZip: '43601', isDefault: true };
const chargeInput = method => ({ invoiceId: 'invoice_1', attempt: 1, idempotencyKey: 'invoice_1:1', amountCents: 10537, method, recurring: true });

test('payments boundary requires the complete replaceable adapter contract', () => {
  assert.equal(assertPaymentsProvider(createFakePaymentsProvider()).constructor.name, 'FakePaymentsProvider');
  assert.throws(() => assertPaymentsProvider({ charge() {} }), /complete payments provider/);
});
test('safe payment method persists only allowed identifiers and display metadata', () => {
  const method = safePaymentMethod({ provider: 'test', processorCustomerId: 'customer_1', profileId: 'profile_1', profileAccountId: '1', methodType: 'card', last4: '4242', expMonth: 12, expYear: 2030, brand: 'VISA', billingZip: '43601', isDefault: true, arbitrary: { phone: 'secret', email: 'secret' }, rawResponse: { note: 'discard' } });
  assert.deepEqual(Object.keys(method), ['provider', 'processorCustomerId', 'profileId', 'profileAccountId', 'methodType', 'last4', 'expMonth', 'expYear', 'brand', 'billingZip', 'isDefault']);
  assert.equal(method.brand, 'Visa'); assert.equal(JSON.stringify(method).includes('secret'), false);
  assert.throws(() => safePaymentMethod({ ...method, last4: '4111111111111111' }), /last four/);
  for (const field of ['cardNumber', 'cvv', 'bankAccount', 'routingNumber', 'bankaba', 'token', 'account']) assert.throws(() => safePaymentMethod({ ...method, extra: { [field]: 'not_allowed' } }), /hosted payment tokens/);
});
test('bounded order IDs are deterministic and amount conversion uses exact cents', async () => {
  const id = await paymentOrderId('invoice_1:1'); assert.match(id, /^opwp[a-f0-9]{40}$/);
  assert.equal(id, await paymentOrderId('invoice_1:1')); assert.notEqual(id, await paymentOrderId('invoice_1:2'));
  assert.equal(paymentAmountDecimal(10537), '105.37'); assert.equal(paymentAmountDecimal(1), '0.01');
  for (const invalid of [0, -1, 10.5, NaN, '100', Number.MAX_SAFE_INTEGER]) assert.throws(() => paymentAmountDecimal(invalid), /integer amount/);
  await assert.rejects(paymentOrderId(''), /idempotency key/);
});
test('normalized payment results discard raw processor payloads and unsupported statuses', () => {
  const safe = safePaymentResult({ provider: 'fake', status: 'pending', transactionId: 'txn_1', orderId: 'order_1', amountCents: 103, processorCode: '00', processor: 'PSTR', raw: { account: 'secret' }, token: 'secret', account: 'secret' });
  assert.equal(JSON.stringify(safe).includes('secret'), false); assert.equal(safe.amountCents, 103);
  assert.throws(() => safePaymentResult({ provider: 'fake', status: 'approved' }), /unsupported/);
});
test('fake adapter charges once on concurrent/repeated invoice attempts and rejects key drift', async () => {
  const fake = assertPaymentsProvider(createFakePaymentsProvider()), method = await fake.createProfile(profileInput), charge = chargeInput(method);
  const outcomes = await Promise.all([fake.charge(charge), fake.charge(charge), fake.charge(charge)]);
  assert.equal(outcomes[0].status, 'paid'); assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[1], outcomes[2]);
  assert.equal(fake.calls.filter(call => call.operation === 'charge').length, 1);
  await assert.rejects(fake.charge({ ...charge, amountCents: 10538 }), /different details/);
  assert.equal(JSON.stringify(fake.calls).includes(profileInput.token), false);
});
test('fake adapter ACH stays pending, then settles or returns without another charge', async () => {
  const fake = createFakePaymentsProvider(), method = await fake.createProfile({ ...profileInput, methodType: 'ach' }), pending = await fake.charge(chargeInput(method));
  assert.equal(pending.status, 'pending'); assert.equal(method.brand, null); assert.equal(method.expMonth, null);
  fake.settleAch(pending.transactionId);
  assert.equal((await fake.pollAch({ transactionId: pending.transactionId, amountCents: 10537 })).status, 'paid');
  fake.settleAch(pending.transactionId, { achReturnCode: 'R07' });
  const returned = await fake.pollAch({ transactionId: pending.transactionId, amountCents: 10537 });
  assert.equal(returned.status, 'failed'); assert.equal(returned.achReturnCode, 'R07'); assert.equal(returned.retryable, false);
  assert.equal(fake.calls.filter(call => call.operation === 'charge').length, 1);
});
test('fake failures never become Paid and refund/void actions are separately idempotent', async () => {
  const fake = createFakePaymentsProvider({ outcomes: [{ status: 'failed', processorCode: '05' }] }), method = await fake.createProfile(profileInput);
  const failed = await fake.charge(chargeInput(method)); assert.equal(failed.status, 'failed'); assert.equal(failed.processorCode, '05');
  assert.equal((await fake.refund({ transactionId: failed.transactionId, amountCents: 537, idempotencyKey: 'refund_failed:1' })).status, 'failed');
  const paid = await fake.charge({ ...chargeInput(method), invoiceId: 'invoice_2', idempotencyKey: 'invoice_2:1' });
  const adjustment = { transactionId: paid.transactionId, amountCents: 537, idempotencyKey: 'refund_invoice_2:1' };
  assert.deepEqual(await fake.refund(adjustment), await fake.refund(adjustment));
  assert.equal(fake.calls.filter(call => call.operation === 'refund').length, 1);
  assert.equal((await fake.inquire({ transactionId: paid.transactionId, amountCents: 10537 })).status, 'paid');
  assert.equal((await fake.void({ ...adjustment, idempotencyKey: 'void_invoice_2:1' })).status, 'voided');
  assert.equal((await fake.refund({ ...adjustment, amountCents: 10537, idempotencyKey: 'refund_invoice_2:2' })).status, 'failed');
});
test('fake rejects raw bank/card details and unconsented or unapproved operations', async () => {
  const fake = createFakePaymentsProvider();
  await assert.rejects(fake.createProfile({ ...profileInput, consent: false }), /authorization/);
  await assert.rejects(fake.createProfile({ ...profileInput, nested: { cardNumber: '4111111111111111' } }), /hosted payment tokens/);
  const method = await fake.createProfile(profileInput);
  await assert.rejects(fake.charge({ ...chargeInput(method), recurring: false }), /approved/);
  assert.equal((await fake.inquire({ orderId: 'missing', amountCents: 1 })).status, 'not_found');
});
