import test from 'node:test';
import assert from 'node:assert/strict';
import { foodFinderDraft, foodOverview, foodReorder } from '../lib/dog-food-overview.mjs';

test('a saved recommendation only selects bags on an explicit, unexpired food-finder handoff', () => {
  const draft = {expiresAt:2000,items:[{productId:'blue',quantity:1}]};
  assert.equal(foodFinderDraft(draft,'',1000),null);
  assert.equal(foodFinderDraft(draft,'?start=signup',1000),null);
  assert.deepEqual(foodFinderDraft(draft,'?from=finder',1000),{blue:1});
  assert.equal(foodFinderDraft(draft,'?from=finder',2001),null);
  assert.equal(foodFinderDraft({...draft,items:[{productId:'blue',quantity:11}]},'?from=finder',1000),null);
});

test('overview prioritizes the earliest open delivery and keeps unpaid actions visible', () => {
  const data = {orders:[
    {id:'late',status:'pending_payment',delivery_date:'2026-11-20',items:[{product_id:'late-food'}]},
    {id:'delivered',status:'paid',delivery_status:'delivered',delivery_date:'2026-10-01'},
    {id:'next',status:'paid',paid_provider:'stripe',delivery_date:'2026-10-15',items:[{product_id:'next-food'}]},
    {id:'cancelled',status:'cancelled',delivery_date:'2026-10-02'},
  ]};
  const view = foodOverview(data);
  assert.equal(view.nextOrder.id,'next'); assert.equal(view.attentionOrder.id,'late');
  assert.equal(view.openCount,2); assert.equal(view.food[0].product_id,'next-food');
});
test('an unconfirmed paid order never inherits a confirmed subscription delivery date', () => {
  const view = foodOverview({orders:[{status:'paid',paid_provider:'stripe',items:[]}],subscriptions:[{status:'active',next_delivery_date:'2026-10-15'}]});
  assert.equal(view.deliveryDate,null);
});
test('paused plans have no upcoming delivery and new accounts have an honest empty state', () => {
  const view = foodOverview({subscriptions:[{status:'paused',next_delivery_date:'2026-10-15'}]});
  assert.equal(view.deliveryDate,null); assert.equal(view.nextPlan,null); assert.equal(view.plan.status,'paused');
  assert.equal(foodOverview().profileReady,false); assert.deepEqual(foodOverview().food,[]);
});

test('buy again uses actual purchases, current catalog and most recent quantity; never cancelled or unpaid orders', () => {
  const products=[{id:'food',retail_price_cents:5900}];
  const view=foodOverview({products,orders:[
    {id:'unpaid',status:'pending_payment',items:[{product_id:'food',quantity:8}]},
    {id:'refunded',status:'refunded',paid_provider:'stripe',items:[{product_id:'food',quantity:9}]},
    {id:'latest',status:'paid',paid_provider:'stripe',items:[{product_id:'food',quantity:2}]},
    {id:'old',status:'fulfilled',items:[{product_id:'food',quantity:1},{product_id:'removed',quantity:1}]},
  ]});
  assert.equal(view.buyAgain.length,1); assert.equal(view.buyAgain[0].quantity,2); assert.equal(view.repeatOrder.id,'latest');
});

test('repeat-order review flags missing formulas and current price changes while carrying delivery preferences', () => {
  const view=foodReorder({delivery_cadence:'fixed_day',requested_month_day:31,items:[
    {product_id:'food',quantity:2,unit_price_cents:4900},
    {product_id:'removed',name:'Old formula',quantity:1},
  ]},[{id:'food',retail_price_cents:5900}]);
  assert.deepEqual(view.quantities,{food:2}); assert.deepEqual(view.missing,['Old formula']);
  assert.equal(view.priceChanged,true); assert.equal(view.cadence,'fixed_day'); assert.equal(view.monthDay,31);
});
