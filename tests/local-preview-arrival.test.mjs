import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalPreviewData, isLocalArrivalPreview } from '../app/local-preview/on-the-way/preview-data.mjs';

const now = new Date('2026-11-21T14:20:00Z');
const localEnv = { LOCAL_PREVIEW_ENABLED: 'true', APP_ENV: 'development', CRM_PAYMENTS_PROVIDER: 'fake', CRM_PAYMENTS_ENV: 'uat', ROUTE_OS_BILLING_ENABLED: 'true', LOCAL_PREVIEW_ORIGIN: 'http://localhost:8787' };

test('customer arrival preview requires every local fake environment flag and exact HTTP loopback host', () => {
  assert.equal(isLocalArrivalPreview(localEnv, 'localhost:8787', 'http'), true);
  assert.equal(isLocalArrivalPreview(localEnv, 'localhost:8787', null), true);
  for (const key of Object.keys(localEnv)) assert.equal(isLocalArrivalPreview({ ...localEnv, [key]: key === 'LOCAL_PREVIEW_ORIGIN' ? 'https://example.test' : 'other' }, 'localhost:8787', 'http'), false, key);
  for (const host of ['example.test', 'localhost:8788', '127.0.0.1:8787', null]) assert.equal(isLocalArrivalPreview(localEnv, host, 'http'), false);
  assert.equal(isLocalArrivalPreview(localEnv, 'localhost:8787', 'https'), false);
});

test('customer arrival projection exposes only fabricated visit fields and correctly preserves service add-ons and food', () => {
  for (let i = 1; i <= 12; i++) {
    const data = arrivalPreviewData({ customerId: `local-customer-${String(i).padStart(2, '0')}`, planId: `local-field-plan-${i <= 6 ? 1 : 2}-2026-11-21` }, now);
    assert.ok(data);
    assert.equal(data.stopNumber, (i - 1) % 6 + 1);
    assert.equal(data.technician.name, i <= 6 ? 'Alex Turner' : 'Jamie Miller');
    assert.deepEqual(Object.keys(data).sort(), ['arrivalTime', 'city', 'firstName', 'minutes', 'serviceDate', 'services', 'stopNumber', 'technician'].sort());
    assert.equal(/2468|7314|@|\+1419|gateCode|email|phone|price|accessNotes|placement/.test(JSON.stringify(data)), false);
  }
  assert.ok(arrivalPreviewData({}, now).services.some(service => service.title === 'Yard deodorization'));
  assert.ok(arrivalPreviewData({ customerId: 'local-customer-10' }, now).services.some(service => service.title === 'Dog food delivery' && service.detail.includes('40 lb')));
  assert.ok(arrivalPreviewData({ customerId: 'local-customer-12' }, now).services.some(service => service.title === 'Kitty litter change-out'));
});

test('customer arrival query allowlist validates ETA values, assigned customer and route pairing, calendar dates and scalar parameters', () => {
  for (const minutes of ['5', '10', '15', '20', '30', '45']) assert.equal(arrivalPreviewData({ minutes }, now).minutes, Number(minutes));
  assert.equal(arrivalPreviewData({ minutes: '15' }, now).arrivalTime, '9:35 AM');
  for (const query of [{ customerId: 'local-customer-13' }, { customerId: '../secrets' }, { customerId: ['local-customer-01'] }, { planId: 'local-field-plan-2-2026-11-21' }, { planId: 'local-field-plan-1-2026-02-31' }, { planId: 'production-route' }, { minutes: '999' }, { minutes: 15 }, { url: 'https://example.test' }]) assert.equal(arrivalPreviewData(query, now), null);
});
