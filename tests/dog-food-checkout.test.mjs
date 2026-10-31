import test from 'node:test';
import assert from 'node:assert/strict';
import {foodCheckoutTotals,foodDeliveryPreference,foodSameDayOpen} from '../lib/dog-food-checkout.mjs';
const beforeNoon=new Date('2026-10-07T15:59:59Z'),noon=new Date('2026-10-07T16:00:00Z');

test('one-time delivery fees are per order and Lucas County tax includes expedited delivery',()=>{
  const items=[{unit_price_cents:5900,quantity:2}];
  assert.deepEqual(foodCheckoutTotals(items),{subtotal:11800,deliveryFee:0,tax:914,total:12714});
  assert.deepEqual(foodCheckoutTotals(items,'next_day'),{subtotal:11800,deliveryFee:500,tax:953,total:13253});
  assert.deepEqual(foodCheckoutTotals(items,'same_day'),{subtotal:11800,deliveryFee:1000,tax:992,total:13792});
  assert.throws(()=>foodCheckoutTotals(items,'free_express'),/valid delivery/);
});

test('one-time orders ignore stale monthly fields; recurring orders validate only their selected schedule',()=>{
  assert.deepEqual(foodDeliveryPreference({plan:'on_demand',deliverySpeed:'next_day',cadence:'fixed_day',monthDay:99,serviceWeek:99}),{deliverySpeed:'next_day',cadence:'route_day',monthDay:null,serviceWeek:null});
  assert.deepEqual(foodDeliveryPreference({plan:'subscription',cadence:'service_week',serviceWeek:2,monthDay:99}),{deliverySpeed:'route_day',cadence:'service_week',monthDay:null,serviceWeek:2});
  assert.throws(()=>foodDeliveryPreference({plan:'subscription',deliverySpeed:'next_day',cadence:'service_week',serviceWeek:2}),/Monthly plans/);
  assert.throws(()=>foodDeliveryPreference({plan:'subscription',cadence:'service_week',serviceWeek:5}),/calendar day or service week/);
});

test('same-day cutoff uses Eastern time and rejects requests at noon including across daylight savings',()=>{
  assert.equal(foodSameDayOpen(beforeNoon),true);assert.equal(foodSameDayOpen(noon),false);
  assert.equal(foodSameDayOpen(new Date('2026-12-07T16:59:59Z')),true);
  assert.equal(foodSameDayOpen(new Date('2026-12-07T17:00:00Z')),false);
  assert.equal(foodDeliveryPreference({plan:'on_demand',deliverySpeed:'same_day'},beforeNoon).deliverySpeed,'same_day');
  assert.throws(()=>foodDeliveryPreference({plan:'on_demand',deliverySpeed:'same_day'},noon),/noon Eastern/);
});
