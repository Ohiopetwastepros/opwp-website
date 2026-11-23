import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLEANUP_RANGE_EXPLANATION } from '../app/free-quote/pricing.js';
import { callGuideProration } from '../lib/call-guide-proration.mjs';

const weekly = { frequency: 'once_a_week', startDate: '2026-10-07', serviceDay: 'Wednesday', monthlyTotal: 121 };

test('October 7 initial cleanup adds October 14, 21, 28 at monthly rate divided by 4.33', () => {
  const result = callGuideProration(weekly);
  assert.deepEqual(result.dates, ['2026-10-14', '2026-10-21', '2026-10-28']);
  assert.equal(result.quantity, 3);
  assert.equal(result.rate, 121 / 4.33);
  assert.equal(result.amount, 83.83);
});

test('uses the selected recurring weekday when the initial cleanup is off-route', () => {
  assert.deepEqual(callGuideProration({ ...weekly, serviceDay: 'Friday' }).dates,
    ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  assert.deepEqual(callGuideProration({ ...weekly, serviceDay: '' }).dates, callGuideProration(weekly).dates);
});

test('excludes the initial date and stops at month end, including leap years and year boundaries', () => {
  assert.equal(callGuideProration({ ...weekly, startDate: '2026-10-28' }).amount, 0);
  assert.deepEqual(callGuideProration({ ...weekly, startDate: '2024-02-01', serviceDay: 'Thursday' }).dates,
    ['2024-02-08', '2024-02-15', '2024-02-22', '2024-02-29']);
  assert.equal(callGuideProration({ ...weekly, startDate: '2026-12-31', serviceDay: 'Thursday' }).quantity, 0);
});

test('pending dates and custom prices never appear as a completed zero-dollar proration', () => {
  for (const patch of [{ startDate: '' }, { startDate: '2026-02-30' }, { startDatePending: true }, { monthlyTotal: null }, { monthlyTotal: NaN }, { monthlyTotal: -1 }, { frequency: 'unknown' }]) {
    const result = callGuideProration({ ...weekly, ...patch });
    assert.equal(result.pending, true);
    assert.equal(result.amount, null);
  }
});

test('biweekly, twice-weekly, monthly and one-time service preserve their cadence', () => {
  assert.deepEqual(callGuideProration({ ...weekly, frequency: 'every_other_week' }).dates, ['2026-10-21']);
  assert.deepEqual(callGuideProration({ ...weekly, frequency: 'twice_a_week', serviceDay: 'Monday + Thursday' }).dates,
    ['2026-10-08', '2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29']);
  assert.equal(callGuideProration({ ...weekly, frequency: 'twice_a_week' }).pending, true);
  assert.equal(callGuideProration({ ...weekly, frequency: 'once_a_month' }).amount, 0);
  assert.equal(callGuideProration({ frequency: 'one_time' }).amount, 0);
});

test('office customer scripts explain whole-dollar cleanup ranges and preserve prorated invoice cents', async () => {
  const result = await build({
    entryPoints: ['app/office/NewClientCallGuide.js'], outdir: 'tmp', write: false,
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: {'.js':'jsx'},
    alias: {'@':process.cwd()}, external: ['react', 'react/jsx-runtime'],
  });
  const source = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const Guide = runInNewContext(source + '\nmodule.exports.default', {require:createRequire(import.meta.url), module:{exports:{}}});
  const render = (frequency, lastCleaned) => renderToStaticMarkup(createElement(Guide, {initialDraft:{
    dogs:'2', frequency, lastCleaned, yardSize:'small', phone:'4195550100', startDate:'2026-11-04', serviceDay:'Wednesday',
  }}));
  const welcome = (html) => decodeURIComponent(html.match(/href="sms:[^?"]+\?body=([^"]+)"/)[1]);
  const oneTime = render('one_time', 'one_month');
  const recurring = render('once_a_week', 'one_month');
  for (const html of [oneTime, recurring]) assert.ok(html.includes('The initial cleanup portion stays within the displayed range unless the actual yard condition requires approval for a different amount.'));
  for (const [message, range] of [
    [welcome(recurring), '$58 to $70'],
    [welcome(oneTime), '$80 to $110'],
    [oneTime.match(/Let me read everything back[^<]+/)[0], '$80 to $110'],
  ]) {
    assert.ok(message.includes(range));
    assert.equal(message.split(CLEANUP_RANGE_EXPLANATION).length - 1, 1);
    assert.doesNotMatch(message, /[\u2013\u2014]/);
  }
  assert.match(recurring, /Subtotal<\/span><b>\$137\.68 to \$149\.68</);
  const custom = welcome(render('one_time', '5_6_months'));
  assert.match(custom, /Custom review/);
  assert.equal(custom.includes(CLEANUP_RANGE_EXPLANATION), false);
});
