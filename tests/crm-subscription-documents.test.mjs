import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSubscriptionDocument, subscriptionMoney } from '../lib/crm-subscription-documents.mjs';

const line = (id, kind, label, totalCents, itemized = true) => ({ id, kind, label, quantity: 1, unitCents: totalCents, totalCents, itemized });
const document = () => ({ currency: 'USD', billingInterval: 'monthly', lineItems: [
  line('base', 'base_plan', 'Weekly 2 dogs', 10500), line('yard', 'yard_size', 'Large yard', 1500),
], totalCents: 12000, billingPeriodEnd: '2026-12-01' });

test('quote, invoice and prepared confirmation display one identical itemized pricing projection', () => {
  const outputs = ['quote', 'invoice', 'confirmation'].map(kind => renderSubscriptionDocument(kind, document(), { customerName: 'Sample Customer' }));
  for (const output of outputs) {
    assert.equal(output.totalCents, 12000);
    assert.deepEqual(output.pricing, outputs[0].pricing);
    assert.match(output.text, /Weekly 2 dogs: \$105\.00/);
    assert.match(output.text, /Large yard: \$15\.00/);
    assert.ok(output.text.includes(`${output.kind === 'invoice' ? 'Invoice total' : 'Fixed monthly total'}: $120.00`));
    assert.match(output.text, /Billing period ends: 2026-11-30/);
    assert.match(output.text, /Next billing period starts: 2026-12-01/);
    assert.equal(output.preparedOnly, true);
  }
});

test('rolled-in lines are hidden consistently while customer invoice totals stay exact', () => {
  const input = document(); input.lineItems[1].itemized = false;
  for (const kind of ['quote', 'invoice', 'confirmation']) {
    const rendered = renderSubscriptionDocument(kind, input);
    assert.equal(rendered.pricing.lineItems.reduce((sum, row) => sum + row.totalCents, 0), 12000);
    assert.ok(!rendered.text.includes('Large yard'));
    assert.match(rendered.text, /\$120\.00/);
  }
});

test('negative credit lines and cent boundaries are retained identically in every document', () => {
  const input = document(); input.lineItems.push(line('credit', 'credit', 'Promised service credit', -1234)); input.totalCents -= 1234;
  for (const kind of ['quote', 'invoice', 'confirmation']) {
    const result = renderSubscriptionDocument(kind, input);
    assert.equal(result.totalCents, 10766);
    assert.match(result.text, /Promised service credit: -\$12\.34/);
    assert.ok(result.text.includes(`${kind === 'invoice' ? 'Invoice total' : 'Fixed monthly total'}: $107.66`));
  }
  assert.equal(subscriptionMoney(Number.MAX_SAFE_INTEGER), '$90,071,992,547,409.91');
  assert.equal(subscriptionMoney(-1), '-$0.01');
  assert.throws(() => subscriptionMoney(1.1), /integer cents/);
});

test('HTML escapes customer and line content without leaking raw executable markup', () => {
  const input = document(); input.lineItems[0].label = '<img src=x onerror="alert(1)">';
  const rendered = renderSubscriptionDocument('confirmation', input, { customerName: '<script>alert(1)</script>', reference: '"<&\'' });
  assert.ok(!rendered.html.includes('<script>')); assert.ok(!rendered.html.includes('<img'));
  assert.match(rendered.html, /&lt;script&gt;/); assert.match(rendered.html, /&lt;img/);
  assert.match(rendered.html, /&quot;&lt;&amp;&#39;/);
});

test('unknown document kinds and invalid dates cannot produce a misleading customer artifact', () => {
  assert.throws(() => renderSubscriptionDocument('send', document()), /Choose quote/);
  assert.throws(() => renderSubscriptionDocument('invoice', document(), { billingPeriodEnd: '2026-02-30' }), /valid subscription date/);
});

test('customer artifacts expose no administrative rate reason, audit or nested source metadata', () => {
  const input = document();
  input.manualReason = 'PRIVATE-OVERRIDE-REASON'; input.bookRateCents = 99999;
  input.audit = [{ actor: 'PRIVATE-ADMIN', reason: 'PRIVATE-AUDIT-REASON' }];
  input.lineItems[0].source = { customerEmail: 'private@example.test', providerToken: 'PRIVATE-TOKEN' };
  const result = renderSubscriptionDocument('invoice', input);
  const encoded = JSON.stringify(result);
  for (const secret of ['PRIVATE-', 'private@example.test', 'bookRateCents', 'manualReason', 'audit', 'source']) assert.ok(!encoded.includes(secret), secret);
});

test('mismatched or fractional line totals never render a valid-looking invoice', () => {
  const mismatch = document(); mismatch.totalCents += 1;
  assert.throws(() => renderSubscriptionDocument('invoice', mismatch), /equal|match/);
  const fractional = document(); fractional.lineItems[0].totalCents = 10500.5;
  assert.throws(() => renderSubscriptionDocument('invoice', fractional), /line|cent|amount/);
});

test('confirmation labels lifecycle status and a promised next-invoice credit without reducing the recurring rate', () => {
  const result = renderSubscriptionDocument('confirmation', document(), { status: 'paused', promisedCreditCents: 2501 });
  assert.equal(result.totalCents, 12000);
  assert.match(result.text, /Subscription status: Paused/);
  assert.match(result.text, /Promised credit: \$25\.01\. Applied to your next invoice\./);
  assert.match(result.text, /Fixed monthly total: \$120\.00/);
  assert.throws(() => renderSubscriptionDocument('confirmation', document(), { promisedCreditCents: -1 }), /positive amount/);
  assert.throws(() => renderSubscriptionDocument('confirmation', document(), { status: 'unknown' }), /supported subscription status/);
});

test('all customer documents identify weekly service and dog count separately from the monthly billing total', () => {
  for (const kind of ['quote', 'invoice', 'confirmation']) {
    const result = renderSubscriptionDocument(kind, document(), { frequency: 'once_a_week', dogCount: 2 });
    assert.match(result.text, /Service schedule: Weekly/); assert.match(result.text, /Dogs: 2/);
    assert.match(result.html, /Service schedule: Weekly/); assert.match(result.html, /Dogs: 2/);
    assert.equal(result.totalCents, 12000);
  }
  assert.throws(() => renderSubscriptionDocument('quote', document(), { dogCount: 1.5 }), /whole dog count/);
});
