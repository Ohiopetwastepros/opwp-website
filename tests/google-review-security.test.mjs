import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseReviewAliases } from '../lib/google-review-matching.mjs';
import { protectJsonRequest } from './helpers/google-review-guard.mjs';

const source = fs.readFileSync(new URL('../app/api/admin/google-reviews/route.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function runtime({ authorized = true, limited = false, exists = true } = {}) {
  let writes = 0;
  const payload = JSON.stringify({ opwp: { reviewTracker: exists ? [{ id: 'rec12345678901234', fields: { 'Client Name': 'Test', 'Google Review': 'Not reviewed' } }] : [] } });
  const handler = runPrivateInNewContext(source + '\nPATCH', { Response, URL, console, headers: async () => new Headers(), verifyAdminRequest: async () => ({ authorized, email: 'admin' }), parseReviewAliases,
    protectJsonRequest: (req, options) => protectJsonRequest(req, options, limited),
    getDb: () => ({ prepare: () => ({ first: async () => ({ payload }), bind() { return this; }, run: async () => ({ meta: { changes: 1 } }) }) }),
    updateGoogleReviewTrackingRecord: async () => { writes++; return {}; },
    withRecordLease:async (_db,_key,callback)=>callback(),patchCockpitRecord:async()=>{},refreshSavedReviewAudit:async()=>{},RecordError:class extends Error{},
  });
  return { handler, writes: () => writes };
}
const request = (body = { recordId: 'rec12345678901234', field: 'reviewStatus', value: 'Reviewed' }, origin = 'https://example.com') => new Request('https://example.com/api/admin/google-reviews/', { method: 'PATCH', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('review updates reject unauthenticated, cross-origin, limited, oversized and foreign records', async () => {
  for (const [settings, req, status] of [[{ authorized: false }, request(), 401], [{}, request(undefined, 'https://evil.test'), 403], [{}, request(undefined, null), 403], [{ limited: true }, request(), 429], [{}, request({ value: 'x'.repeat(3000) }), 413], [{ exists: false }, request(), 404], [{}, request({ recordId: '../../other', field: 'reviewStatus', value: 'Reviewed' }), 400]]) {
    const r = runtime(settings); assert.equal((await r.handler(req)).status, status); assert.equal(r.writes(), 0);
  }
});
test('authenticated same-origin updates write only a known tracker record', async () => {
  const r = runtime(); const response = await r.handler(request()); assert.equal(response.status, 200); assert.equal(r.writes(), 1); assert.match(response.headers.get('cache-control'), /no-store/);
});
