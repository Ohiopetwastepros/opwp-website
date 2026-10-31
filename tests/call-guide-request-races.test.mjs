import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real request and input handlers without a browser or live provider.
const source = fs.readFileSync(new URL('../app/office/NewClientCallGuide.js', import.meta.url), 'utf8');
const requestSource = source.slice(source.indexOf('  async function analyzeRoute('), source.indexOf('  async function copyText('));
const updateSource = source.slice(source.indexOf('  const update ='), source.indexOf('  const toggleArray ='));
function guide() {
  const state = { route: null, error: '', loading: false };
  const requests = [];
  const scope = {
    form: { address: '123 Example Lane', city: 'Perrysburg', state: 'OH', zip: '43551', frequency: 'every_other_week', serviceDay: 'Friday' },
    routeEndpoint: '/api/office/route-assignment/', monthlyTotal: 87, routeRequest: { current: 0 },
    setRoute: value => { state.route = value; }, setRouteError: value => { state.error = value; }, setRouteLoading: value => { state.loading = value; },
    setForm: change => { scope.form = typeof change === 'function' ? change(scope.form) : change; },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, body: JSON.parse(options.body), resolve })),
  };
  const handlers = runPrivateInNewContext(`${requestSource}\n${updateSource}\n({analyzeRoute,update});`, scope);
  const finish = (index, day, status = 200) => requests[index].resolve({ status, ok: status === 200, json: async () => ({ ok: status === 200, recommendation: { eligible: true, recommendedDay: day }, error: status === 200 ? null : 'Route provider unavailable. Retry the route check.' }) });
  return { ...handlers, state, scope, requests, finish };
}

test('a changed address cannot restore an older route or overwrite the newer request', async () => {
  const g = guide();
  const old = g.analyzeRoute();
  g.update('address')({ target: { type: 'text', value: 'Second address' } });
  const current = g.analyzeRoute();
  g.finish(0, 'Monday'); await old;
  assert.equal(g.state.route, null);
  assert.equal(g.state.loading, true);
  assert.equal(g.scope.form.serviceDay, '');
  g.finish(1, 'Friday'); await current;
  assert.equal(g.state.route.recommendedDay, 'Friday');
  assert.equal(g.scope.form.serviceDay, 'Friday');
  assert.equal(g.requests[1].body.address, 'Second address');
});

test('an older failed response cannot replace a successful newer result with an error', async () => {
  const g = guide(); const old = g.analyzeRoute();
  g.update('frequency')({ target: { type: 'select-one', value: 'once_a_week' } });
  const current = g.analyzeRoute(); g.finish(1, 'Tuesday'); await current;
  g.finish(0, null, 502); await old;
  assert.equal(g.state.route.recommendedDay, 'Tuesday');
  assert.equal(g.state.error, '');
});

test('a refresh preserves the manually confirmed day and sends biweekly pricing', async () => {
  const g = guide(); const pending = g.analyzeRoute();
  g.finish(0, 'Monday'); await pending;
  assert.equal(g.scope.form.serviceDay, 'Friday');
  assert.equal(g.requests[0].body.frequency, 'every_other_week');
  assert.equal(g.requests[0].body.monthly_revenue, 87);
});

test('failed refresh removes old estimates, explains retry and keeps the confirmed day', async () => {
  const g = guide(); g.state.route = { recommendedDay: 'Friday', projectedMinutes: 200 };
  const pending = g.analyzeRoute(); assert.equal(g.state.route, null);
  g.finish(0, null, 502); await pending;
  assert.match(g.state.error, /Retry/);
  assert.equal(g.scope.form.serviceDay, 'Friday');
  assert.equal(g.state.loading, false);
});

test('expired sessions and aborted responses never become recommendations', async () => {
  const g = guide(); const pending = g.analyzeRoute();
  g.requests[0].resolve({ status: 401, ok: false, json: async () => { throw new Error('HTML login page'); } }); await pending;
  assert.match(g.state.error, /session expired/);
  assert.equal(g.state.route, null);
  const aborted = guide(); const signal = { aborted: false }; const request = aborted.analyzeRoute({ signal });
  signal.aborted = true; aborted.finish(0, 'Monday'); await request;
  assert.equal(aborted.state.route, null);
  assert.equal(aborted.scope.form.serviceDay, 'Friday');
});

test('provisional geography suggestions never fill the customer-confirmed service day', async () => {
  const g = guide(); g.scope.form.serviceDay = '';
  const pending = g.analyzeRoute();
  g.requests[0].resolve({ status: 200, ok: true, json: async () => ({ ok: true, recommendation: { eligible: true, recommendedDay: 'Tuesday', requiresOwnerConfirmation: true } }) });
  await pending;
  assert.equal(g.state.route.recommendedDay, 'Tuesday');
  assert.equal(g.scope.form.serviceDay, '');
});
