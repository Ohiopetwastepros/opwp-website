import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentInView } from '../lib/failed-payment-views.mjs';

test('main view excludes resolved and dismissed cases but retains unpaid sent cases', () => {
  for (const payment_state of ['paid','voided','settled','payment_recorded']) assert.equal(paymentInView({status:'awaiting_approval',payment_state},'active'),false);
  assert.equal(paymentInView({status:'payment_recorded'},'active'),false);
  assert.equal(paymentInView({status:'cancelled'},'active'),false);
  for (const status of ['awaiting_approval','failed','sent','sending']) assert.equal(paymentInView({status},'active'),true);
});
test('each summary drills into its own matching records', () => {
  assert.equal(paymentInView({status:'awaiting_approval'},'awaiting_approval'),true);
  assert.equal(paymentInView({status:'failed'},'awaiting_approval'),false);
  assert.equal(paymentInView({status:'payment_recorded',sms_status:'sent'},'sent'),true);
  assert.equal(paymentInView({status:'awaiting_approval',sync_error:'held'},'attention'),true);
  assert.equal(paymentInView({status:'payment_recorded',sync_error:'held'},'attention'),false);
  assert.equal(paymentInView({status:'payment_recorded'},'resolved'),true);
  assert.equal(paymentInView({status:'awaiting_approval'},'resolved'),false);
});
