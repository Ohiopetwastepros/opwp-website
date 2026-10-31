import test from 'node:test';
import assert from 'node:assert/strict';
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
