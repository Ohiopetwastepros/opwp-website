import test from 'node:test';
import assert from 'node:assert/strict';
import {leadFollowUpDrafts} from '../lib/lead-assistant.mjs';
import {renderCraigReply, validateCraigReply, countCraigSentences} from '../lib/craig-voice.mjs';

test('lead follow-up drafts use the step-selected Craig renderer without changing their schedule', () => {
  const drafts = leadFollowUpDrafts('Avery Example');
  assert.deepEqual(drafts.map(({step, delay}) => ({step, delay})), [
    {step: 1, delay: '+1 day'}, {step: 2, delay: '+3 days'}, {step: 3, delay: '+7 days'},
  ]);
  for (const draft of drafts) {
    assert.equal(draft.body, renderCraigReply(`follow_up_${draft.step}`, {name: 'Avery'}));
    assert.deepEqual(validateCraigReply(draft.body, {step: 'follow_up'}), []);
    assert.ok(countCraigSentences(draft.body) >= 1 && countCraigSentences(draft.body) <= 3);
    assert.doesNotMatch(draft.body, /Reply STOP|Text STOP|poop|[\u2013\u2014]/i);
    assert.doesNotMatch(draft.body, /\$|\btomorrow\b|\bthis week\b/i);
  }
  assert.match(leadFollowUpDrafts()[0].body, /^Hey, this is Craig/);
  assert.throws(() => leadFollowUpDrafts('ＰＯＯＰ'), /forbidden_waste_slang/);
});
