import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { callGuideRouteInput } from '../lib/call-guide-route-request.mjs';

const body = { address: '1200 Example Lane', city: 'Toledo', state: 'OH', zip: '43613', frequency: 'once_a_week', monthly_revenue: 115 };
const request = value => new Request('https://www.ohiopetwastepros.com/api/admin/route-assignment/', { method: 'POST', body: JSON.stringify(value) });
test('address requests are bounded, validated, and stripped of client permission flags and coordinates', async () => {
  const parsed = await callGuideRouteInput(request({ ...body, allowGeographicFallback: true, latitude: 0, home_address: 'other', role: 'admin' }));
  assert.deepEqual(parsed.body, body);
  assert.deepEqual((await callGuideRouteInput(request({ address: '1200 Example Lane, Toledo, OH 43613', frequency: 'once_a_week', monthly_revenue: 115 }))).body, body);
  for (const change of [{ address: {} }, { zip: 'abcde' }, { state: 'CA' }, { frequency: 'unknown' }, { monthly_revenue: -1 }, { monthly_revenue: { valueOf: null, toString: null } }]) assert.equal((await callGuideRouteInput(request({ ...body, ...change }))).response.status, 400);
  assert.equal((await callGuideRouteInput(request({ ...body, address: 'x'.repeat(5000) }))).response.status, 413);
});

for (const role of ['admin', 'office']) {
  const source = fs.readFileSync(new URL(`../app/api/${role}/route-assignment/route.js`, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  function handler(authorized, allowed = true) {
    const calls = [];
    const auth = { authorized, email: 'owner@example.test', member: { id: 'office-member' } };
    const scope = { Response, headers: async () => new Headers(), verifyAdminRequest: async () => auth, verifyOfficeRequest: async () => auth,
      getDb: () => ({}), getRuntimeEnv: () => ({}), callGuideRouteInput,
      checkRateLimit: async (_, options) => { calls.push(options); return { allowed }; }, rateLimitResponse: () => Response.json({}, { status: 429 }),
      ensureFreshAirtableCockpitSnapshot: async () => ({}), recommendOnboardingRoute: async (_, input, options) => { calls.push({ input, options }); return { eligible: true }; }, console: { log() {}, error() {} } };
    return { post: runPrivateInNewContext(source + '\nPOST;', scope), calls };
  }
  test(`${role} expired, unauthenticated and wrong-role sessions cannot analyze addresses or spend credits`, async () => {
    const h = handler(false); assert.equal((await h.post(request(body))).status, 401); assert.equal(h.calls.length, 0);
  });
  test(`${role} call guide enforces IP and account limits before provider work`, async () => {
    const h = handler(true, false); assert.equal((await h.post(request(body))).status, 429); assert.equal(h.calls.length, 1);
    const ok = handler(true); assert.equal((await ok.post(request(body))).status, 200);
    assert.equal(ok.calls.length, 3); assert.ok(ok.calls[1].identity);
    assert.equal(ok.calls[2].options.allowGeographicFallback, true);
  });
}
