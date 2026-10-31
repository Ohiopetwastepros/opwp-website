import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = fs.readFileSync(new URL('../lib/airtable.js', import.meta.url), 'utf8');
const source = file.slice(file.indexOf('export async function ensureFreshAirtableCockpitSnapshot'), file.indexOf('export async function getAirtableSchema')).replace(/^export /gm, '');
function fixture() {
  const calls = [], capturedAt = new Date(Date.now() - 3600000).toISOString();
  const env = { DB: { prepare() { return { async first() { return { captured_at: capturedAt }; }, bind() { return this; }, async run() {} }; } } };
  const scope = { crypto, console: { log() {}, error() {} }, round: n => n,
    refreshAirtableCockpitSnapshot: async () => { calls.push('source'); return { capturedAt: new Date().toISOString(), status: 'success', warning: null }; },
    refreshAirtableRouteProfitability: async () => { calls.push('history'); } };
  return { env, calls, ...runPrivateInNewContext(source + '\n({ensureFreshAirtableCockpitSnapshot,runScheduledAirtableCockpitRefresh});', scope) };
}
test('foreground route-data refresh returns current customer data without rebuilding financial history', async () => {
  const h = fixture();
  const result = await h.ensureFreshAirtableCockpitSnapshot(h.env, 15, { refreshRouteHistory: false });
  assert.equal(result.refreshed, true);
  assert.deepEqual(h.calls, ['source']);
});
test('scheduled snapshot refresh still retains its financial-history work', async () => {
  const h = fixture();
  await h.runScheduledAirtableCockpitRefresh(h.env);
  assert.deepEqual(h.calls, ['source', 'history']);
});
