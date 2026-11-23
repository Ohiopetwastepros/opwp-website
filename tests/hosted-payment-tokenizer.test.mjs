import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHostedTokenizerMessage, safeHostedTokenizerConfig } from '../lib/hosted-payment-tokenizer.mjs';

const origin = 'https://fts-uat.cardconnect.com', source = {}, token = '9412345678904242';
const message = payload => ({ source, origin, data: JSON.stringify(payload) });
const config = { provider: 'cardpointe', environment: 'uat', methodType: 'card', origin, url: `${origin}/itoke/ajax-tokenizer.html?tokenpropname=token` };

test('hosted messages require the exact UAT origin AND current iframe source', () => {
  assert.deepEqual(parseHostedTokenizerMessage(message({ token }), { origin, source }), { status: 'ready', token });
  assert.deepEqual(parseHostedTokenizerMessage(message({ token, errorCode: '0', errorMessage: '' }), { origin, source }), { status: 'ready', token });
  assert.equal(parseHostedTokenizerMessage({ ...message({ token }), origin: 'https://evil.example' }, { origin, source }), null);
  assert.equal(parseHostedTokenizerMessage({ ...message({ token }), source: {} }, { origin, source }), null);
  assert.equal(parseHostedTokenizerMessage(message({ token }), { origin, source: null }), null);
  assert.equal(parseHostedTokenizerMessage({ ...message({ token }), origin: `${origin}.evil.example` }, { origin, source }), null);
});
test('hosted parser retains the token only and rejects nested raw payment data', () => {
  const parsed = parseHostedTokenizerMessage(message({ token, errorCode: '', errorMessage: 'do not display', metadata: { phone: 'discard' } }), { origin, source });
  assert.deepEqual(parsed, { status: 'ready', token });
  for (const field of ['account', 'cardNumber', 'cvv', 'bankAccountNumber', 'routingNumber']) assert.deepEqual(parseHostedTokenizerMessage(message({ token, metadata: { [field]: 'sensitive' } }), { origin, source }), { status: 'invalid' });
  for (const payload of [{ token: '4111111111111111' }, { token: '' }, { message: token }, { token, errorCode: '1', errorMessage: 'sensitive' }, []]) assert.deepEqual(parseHostedTokenizerMessage(message(payload), { origin, source }), { status: 'invalid' });
});
test('invalid/empty hosted messages clear a stale token without echoing processor errors', () => {
  for (const event of [{ ...message({}), data: '' }, { ...message({}), data: 'not JSON' }, { ...message({ token }), validationError: 'sensitive data' }]) assert.deepEqual(parseHostedTokenizerMessage(event, { origin, source }), { status: 'invalid' });
});
test('hosted config permits only exact assigned UAT iframe URLs', () => {
  assert.equal(safeHostedTokenizerConfig(config)?.url, config.url);
  for (const bad of [
    { ...config, environment: 'production' }, { ...config, url: 'https://fts.cardconnect.com/itoke/ajax-tokenizer.html?tokenpropname=token', origin: 'https://fts.cardconnect.com' },
    { ...config, url: `${origin}.evil.example/itoke/ajax-tokenizer.html?tokenpropname=token` }, { ...config, origin: `${origin}/` },
    { ...config, url: `${origin}/another.html?tokenpropname=token` }, { ...config, url: `${origin}/itoke/ajax-tokenizer.html?tokenpropname=message` },
    { ...config, url: 'https://user:pass@fts-uat.cardconnect.com/itoke/ajax-tokenizer.html?tokenpropname=token' },
  ]) assert.equal(safeHostedTokenizerConfig(bad), null);
});
test('hosted component keeps payment secrets out of DOM inputs, URLs, and persistent browser storage', async () => {
  const code = await fs.readFile(new URL('../components/crm/HostedPaymentMethod.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|console\.|name=['"](?:token|pan|cardNumber|cvv|account|routingNumber)['"]/i);
  assert.match(code, /ephemeral\.current = null/); assert.match(code, /source: frame\.current\?\.contentWindow/);
  assert.match(code, /\/api\/admin\/crm\/billing\/methods/); assert.match(code, /methodType/);
});
