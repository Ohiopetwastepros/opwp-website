import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOperationalDays, buildOperationalDayPreference } from '../lib/route-day-policy.mjs';

test('locks flexible Bowling Green and Swanton quotes to the planned territory days', () => {
  assert.deepEqual(allowedOperationalDays({ city: 'Bowling Green', zip: '43402', frequency: 'Weekly' }), ['Friday']);
  assert.deepEqual(allowedOperationalDays({ city: 'Swanton', zip: '43558', frequency: 'Biweekly' }), ['Wednesday']);
});

test('does not change twice-weekly day availability outside the existing Sylvania rule', () => {
  assert.deepEqual(allowedOperationalDays({ city: 'Swanton', zip: '43558', frequency: 'Twice Weekly' }), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  assert.deepEqual(allowedOperationalDays({ city: 'Sylvania', zip: '43560', frequency: 'Twice Weekly' }), ['Tuesday', 'Thursday']);
});

test('prefers Friday for Bowling Green customers', () => {
  const preference = buildOperationalDayPreference({
    city: 'Bowling Green',
    zip: '43402',
    frequency: 'Weekly',
    dayResults: [
      { day: 'Monday', projectedMinutes: 300, allowed: true, available: true },
      { day: 'Wednesday', projectedMinutes: 240, allowed: true, available: true },
      { day: 'Friday', projectedMinutes: 180, allowed: true, available: true },
    ],
  });

  assert.ok((preference.scores.get('Friday') ?? 0) > (preference.scores.get('Monday') ?? 0));
  assert.ok((preference.scores.get('Friday') ?? 0) > (preference.scores.get('Wednesday') ?? 0));
  assert.deepEqual(preference.preferredDays.slice(0, 2), ['Friday', 'Wednesday']);
});

test('prefers Wednesday when Monday is overloaded and Wednesday is available', () => {
  const preference = buildOperationalDayPreference({
    city: 'Toledo',
    zip: '43615',
    frequency: 'Weekly',
    dayResults: [
      { day: 'Monday', projectedMinutes: 430, allowed: true, available: true },
      { day: 'Wednesday', projectedMinutes: 260, allowed: true, available: true },
      { day: 'Friday', projectedMinutes: 220, allowed: true, available: true },
    ],
  });

  assert.ok((preference.scores.get('Wednesday') ?? 0) > (preference.scores.get('Monday') ?? 0));
  assert.ok((preference.scores.get('Wednesday') ?? 0) > (preference.scores.get('Friday') ?? 0));
  assert.deepEqual(preference.preferredDays.slice(0, 2), ['Wednesday', 'Friday']);
});
