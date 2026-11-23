import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupRecapClause} from '../lib/lead-cleanup-timeframe.mjs';
import {classifyPlaybookRules, nextPlaybookResponse} from '../lib/lead-playbook.mjs';

test('recap timeframe display keeps ranges, qualifiers and relative answers without rounding', () => {
  for (const [answer, clause] of [
    ['2-3 weeks', "it's been about 2 to 3 weeks since the last cleanup"],
    ['2\u20133 weeks ago.', "it's been about 2 to 3 weeks since the last cleanup"],
    ['6-8 weeks', "it's been about 6 to 8 weeks since the last cleanup"],
    ['about a month', "it's been about a month since the last cleanup"],
    ['roughly two to three weeks', "it's been roughly two to three weeks since the last cleanup"],
    ['yesterday', 'the last cleanup was yesterday'],
    ['last week', 'the last cleanup was last week'],
    ['on the 8th', 'the last cleanup was on the 8th'],
    ['since November', "the yard hasn't been cleaned since November"],
  ]) assert.equal(cleanupRecapClause(answer), clause, answer);
});

test('cleanup correction updates the displayed range even within the same pricing band', () => {
  const details = {dogs: 1, frequency: 'once_a_week', yardTier: 'tiny', lastCleaned: 'three_weeks', lastCleanedAnswer: '3 weeks', zip: '43528'};
  const state = {stage: 'confirm_details_sent', expected: 'confirmDetails', details};
  const decision = nextPlaybookResponse({conversation: {owner: 'backend'}, state, text: 'Actually, it was last cleaned 2-3 weeks ago'});
  assert.equal(decision.templateKey, 'confirm_details');
  assert.equal(decision.state.details.lastCleaned, 'three_weeks');
  assert.equal(decision.state.details.lastCleanedAnswer, '2-3 weeks');
  assert.match(decision.body, /and it's been about 2 to 3 weeks since the last cleanup\. Did I get that right\?$/);
  assert.equal(decision.state.details_confirmed, false);
});

test('an explicitly understood dated affirmation retains the exact date without changing its confirmation intent', () => {
  const classified = classifyPlaybookRules('Yes. Cleaned on the 8th.', {stage: 'confirm_details_sent', now: '2026-11-21T12:00:00Z', details: {lastCleaned: 'two_weeks'}});
  assert.equal(classified.intent, 'confirm_yes');
  assert.equal(classified.slots.lastCleanedAnswer, 'on the 8th');
});
