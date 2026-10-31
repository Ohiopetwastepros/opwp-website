import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../scripts/patch-open-next-worker.mjs', import.meta.url), 'utf8');
const task = source.slice(source.indexOf('        const task = '), source.indexOf('        ctx.waitUntil(task);'));
test('route book runs only at minute 35, never as the ten-minute scheduler fallback', async () => {
  for (const cron of ['*/10 * * * *', '35 * * * *']) {
    let calls = 0;
    const scope = { controller: { cron }, env: {}, ctx: {}, Request, atEasternMidnight: false,
      runWithCloudflareRequestContext: (_, __, ___, callback) => callback(),
      runScheduledRouteBookRefresh: async () => { calls++; } };
    await runPrivateInNewContext(`${task}\ntask;`, scope);
    assert.equal(calls, cron === '35 * * * *' ? 1 : 0);
  }
});

test('production pauses background road planning and dispatch while retaining the Operations tool', () => {
  const config = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"ROUTE_ROAD_CALCULATIONS_ENABLED": "false"/);
  assert.match(config, /"DISPATCH_AUTOMATION_ENABLED": "false"/);
  const navigation = fs.readFileSync(new URL('../app/admin/admin-navigation.mjs', import.meta.url), 'utf8');
  assert.match(navigation, /label: "Route Day Recommendation", href: "\/admin\/route-day-recommendation\/"/);
});
