import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNaturalPlaybookReply as parse} from '../lib/lead-playbook-natural-replies.mjs';

const yard = {stage: 'collect_details', expected: 'yardTier'};
const cleanup = {stage: 'collect_details', expected: 'lastCleaned', now: '2026-11-21T12:00:00Z'};

const tiers = {
  tiny: ['1/8', '1/8th', '1/8 acre', 'an eighth', 'eighth acre', 'under 1/8', '1/8 or less', 'standard', 'standard yard', 'standard sized yard', 'average', 'average yard', 'normal', 'normal neighborhood yard', 'small', 'small yard', 'small backyard', 'tiny', 'super small', 'patio/small', 'townhouse', 'under 5500 sq ft', 'about 5000 sq ft', '30x30', '30 ft by 30 ft', '40x50', '⅛ acre', '1/8th of an acre', 'an eighth of an acre', "It's just a standard sized yard. Id say about 1/8th acre"],
  small: ['1/4', '1/4th', 'quarter acre', 'a quarter acre', 'quarter of an acre', '1/4 acre', 'between 1/8 and 1/4', 'slightly bigger than standard', 'medium-large', '6000 sq ft', '8000 sq ft', '10000 sq ft', '¼ acre'],
  medium: ['1/3', '1/3 acre', '1/2', 'half acre', 'half an acre', 'half of an acre', '1/2 acre', '0.5 acre', 'large', 'large yard', 'pretty big yard', '15000 sq ft', '20000 sq ft', '½ acre'],
  large: ['2/3 acre', '0.6 acre', 'over half an acre', '25000 sq ft', '30000 sq ft', '3/4', '3/4 acre', 'three quarters', '¾ acre'],
  xlarge: ['over 3/4 acre', '3/4 acre or larger', '1 acre', 'an acre', 'acre+', '2 acres', 'huge yard', 'acreage'],
};
for (const [tier, phrases] of Object.entries(tiers)) test(`approved natural yard answers resolve to ${tier}`, () => {
  for (const phrase of phrases) {
    const actual = parse(phrase, yard);
    assert.equal(actual.yardStatus, 'matched', phrase);
    assert.equal(actual.slots.yardTier, tier, phrase);
    assert.equal(actual.intent, 'correction', phrase);
  }
});

test('explicit area overrides a qualitative estimate and keeps exact acreage', () => {
  assert.equal(parse('a small yard, about half an acre', yard).slots.yardTier, 'medium');
  assert.equal(parse('standard sized, about 1/4 acre', yard).slots.yardTier, 'small');
  assert.equal(parse('large yard, about 5000 sq ft', yard).slots.yardTier, 'tiny');
  assert.equal(parse('an eighth of an acre', yard).slots.yardAcres, 0.125);
  assert.equal(parse('quarter of an acre', yard).slots.yardAcres, 0.25);
  assert.equal(parse('half an acre', yard).slots.yardAcres, 0.5);
  assert.equal(parse('average', yard).slots.yardAcres, null);
});

test('numeric tier boundaries preserve current pricing and the property-walk threshold', () => {
  for (const [area, tier] of [['0.125', 'tiny'], ['0.1251', 'small'], ['0.25', 'small'], ['0.2501', 'medium'], ['0.5', 'medium'], ['0.5001', 'large'], ['0.7499', 'large'], ['0.75', 'large'], ['0.7501', 'xlarge']]) assert.equal(parse(`${area} acre`, yard).slots.yardTier, tier, area);
  for (const [feet, tier] of [[5445, 'tiny'], [5446, 'small'], [10890, 'small'], [10891, 'medium'], [21780, 'medium'], [21781, 'large'], [32669, 'large'], [32670, 'large'], [32671, 'xlarge']]) assert.equal(parse(`${feet} sq ft`, yard).slots.yardTier, tier, String(feet));
});

test('legacy options/form labels and map-measurement contexts remain readable', () => {
  for (const [letter, tier] of [['A', 'tiny'], ['B.', 'small'], ['C', 'medium'], ['D', 'large'], ['E', 'xlarge']]) assert.equal(parse(letter, yard).slots.yardTier, tier);
  for (const [label, tier] of [['Up to 1/8 acre', 'tiny'], ['1/8 to 1/4 acre', 'small'], ['1/4 to 1/2 acre', 'medium'], ['1/2 to 3/4 acre', 'large'], ['Over 3/4 acre', 'xlarge']]) assert.equal(parse(label, yard).slots.yardTier, tier, label);
  for (const expected of ['yardMeasurement', 'yardMapAddress']) assert.equal(parse('1/8th', {expected}).slots.yardTier, 'tiny');
  assert.equal(parse('1/8', {expected: 'lastCleaned'}).slots.yardTier, undefined);
  assert.equal(parse('average', {expected: 'dogs'}).slots.yardTier, undefined);
});

test('unsure size and street address have dedicated measurement outcomes', () => {
  for (const phrase of ['not sure', 'no clue', "don't know", 'no idea', 'I live in a neighborhood']) {
    const actual = parse(phrase, yard);
    assert.equal(actual.yardStatus, 'unsure', phrase);
    assert.equal(actual.intent, 'correction');
    assert.equal(actual.slots.yardTier, undefined);
  }
  for (const phrase of ['123 Maple Street', 'My address is 123 Maple Street', '123 Maple St, Maumee OH 43537']) {
    const actual = parse(phrase, yard);
    assert.equal(actual.yardStatus, 'address', phrase);
    assert.match(actual.slots.address, /123 Maple St/);
  }
  assert.equal(parse('5000 sq ft', yard).slots.address, undefined);
  assert.equal(parse('5000 sq ft', yard).slots.yardTier, 'tiny');
});

test('invalid measurements, conflicts and unclear bounds request clarification without choosing a tier', () => {
  for (const phrase of ['1/0 acre', '1/8/2 acre', '0 acres', '-1 acre', '30x-30', '30x30 meters', 'over 1/8 acre', 'less than 1/4 acre', '1/8 acre in front and 1/4 acre in back', '1/8 acre or 1/4', '5000 sq ft or 15000 sq ft', 'small or large yard', 'not a small yard', 'big front and back, invisible fence', 'they use the whole lot or just backyard?', '1/8 to 1/2 acre']) {
    const actual = parse(phrase, yard);
    assert.equal(actual.yardStatus, 'ambiguous', phrase);
    assert.equal(actual.slots.yardTier, undefined, phrase);
    assert.equal(actual.intent, 'correction', phrase);
  }
  assert.equal(parse('1/8 acre, about 5445 sq ft', yard).slots.yardTier, 'tiny');
});

test('bounded affirmations accept natural short replies and preserve quote acceptance', () => {
  for (const phrase of ['yes', 'yep', 'yup', 'yeah', 'yes that is correct', 'correct', "that's right", 'all good', 'sounds right', 'y', '👍', '👍🏽', 'yes please']) assert.equal(parse(phrase).intent, 'confirm_yes', phrase);
  assert.equal(parse('sounds good', {stage: 'quote_sent'}).intent, 'ready_to_sign_up');
  assert.equal(parse("let's do it").intent, 'ready_to_sign_up');
  assert.equal(parse('yes but no thanks').intent, undefined);
  assert.equal(parse('STOP').intent, undefined);
});

test('partial confirmations return the corrected field rather than affirming stale form details', () => {
  for (const phrase of ["yes except it's 2 dogs", 'yes except 2 dogs']) {
    const actual = parse(phrase, {stage: 'confirm_details_sent'});
    assert.equal(actual.intent, 'correction');
    assert.equal(actual.slots.dogs, 2);
  }
  assert.equal(parse('actually 43528', {stage: 'confirm_details_sent'}).slots.zip, '43528');
  assert.equal(parse('43528', {stage: 'confirm_details_sent'}).slots.zip, '43528');
  assert.equal(parse('close, biweekly instead').slots.frequency, 'every_other_week');
  assert.equal(parse('3 dogs not 2').slots.dogs, 3);
  assert.equal(parse('3 dogs not 2 dogs').slots.dogs, 3);
  assert.equal(parse('Yes, we have no dogs').slots.dogs, 0);
  assert.equal(parse('everything right but we want weekly').slots.frequency, 'once_a_week');
});

test('dog counts accept natural totals while prospective dogs and puppies remain explicit questions', () => {
  for (const [phrase, dogs] of [['1', 1], ['one', 1], ['just one', 1], ['a single dog', 1], ['two', 2], ['2 large dogs', 2], ['3 corgis', 3], ['four', 4], ['five', 5], ['we have 3', 3], ['2 small and 1 big', 3]]) assert.equal(parse(phrase, {expected: 'dogs'}).slots.dogs, dogs, phrase);
  for (const phrase of ['1 now, thinking about a second', '4 dogs and 2 puppies', '2 dogs and 3 dogs']) {
    const actual = parse(phrase, {expected: 'dogs'});
    assert.equal(actual.dogsStatus, 'ambiguous', phrase);
    assert.equal(actual.slots.dogs, undefined, phrase);
  }
});

const frequencies = {
  once_a_week: ['weekly', 'once a week', '1x a week', '1x/wk', 'every week', 'once weekly'],
  every_other_week: ['biweekly', 'bi-weekly', 'every other week', 'every 2 weeks', 'every two weeks', 'twice a month', '2x a month', 'eow'],
  twice_a_week: ['twice a week', '2x a week', '2x/wk', 'two times a week', 'twice weekly', '2 times weekly'],
  one_time: ['one time', 'one-time', 'just once', 'single cleanup', 'spring cleanup', 'initial only', 'just need it caught up once'],
};
for (const [frequency, phrases] of Object.entries(frequencies)) test(`natural frequency aliases resolve to ${frequency}`, () => {
  for (const phrase of phrases) assert.equal(parse(phrase, {expected: 'frequency'}).slots.frequency, frequency, phrase);
});
test('competing frequencies do not choose the first mention', () => {
  const actual = parse('weekly or biweekly', {expected: 'frequency'});
  assert.equal(actual.slots.frequency, undefined);
  assert.equal(actual.reason, 'frequency_ambiguous');
});

test('cleanup estimates conservatively use the upper end of a bounded duration', () => {
  for (const [phrase, lastCleaned] of [['today', 'one_week'], ['yesterday', 'one_week'], ['just cleaned it', 'one_week'], ['raked it today', 'one_week'], ['this week', 'one_week'], ['last week', 'one_week'], ['a few days ago', 'one_week'], ['less than a week', 'one_week'], ['2 weeks', 'two_weeks'], ['two weeks', 'two_weeks'], ['2 to 3 weeks', 'three_weeks'], ['2-3 weeks', 'three_weeks'], ['3 weeks', 'three_weeks'], ['about a month', 'one_month'], ['couple months', 'two_months'], ['6 to 8 weeks', 'two_months'], ['2-3 months', '3_4_months'], ['4 months', '3_4_months']]) assert.equal(parse(phrase, cleanup).slots.lastCleaned, lastCleaned, phrase);
});
test('historical cleanup form letters retain bounded meanings without interpreting letters outside that question', () => {
  for (const [letter, lastCleaned] of [['A', 'one_week'], ['B', 'two_weeks'], ['C', 'three_weeks'], ['D', 'one_month'], ['E', 'two_months'], ['F', '3_4_months']]) assert.equal(parse(letter, cleanup).slots.lastCleaned, lastCleaned);
  assert.equal(parse('B', {expected: 'dogs'}).slots.lastCleaned, undefined);
});
test('seasonal uncertainty never invents an approved cleanup range', () => {
  for (const phrase of ['since winter', 'since before winter', 'since snow', 'all winter', 'end of summer', 'spring']) {
    const actual = parse(phrase, cleanup);
    assert.equal(actual.lastCleanedStatus, 'ambiguous', phrase);
    assert.equal(actual.reason, 'cleanup_season_uncertain', phrase);
    assert.equal(actual.slots.lastCleaned, undefined);
  }
  for (const phrase of ['never', '5 months', '6 to 8 months']) assert.equal(parse(phrase, cleanup).slots.lastCleaned, 'custom', phrase);
  assert.equal(parse('at least 3 weeks', cleanup).lastCleanedStatus, 'ambiguous');
  assert.equal(parse('3 to 2 weeks', cleanup).lastCleanedStatus, 'ambiguous');
  assert.equal(parse('since November').lastCleanedStatus, 'ambiguous');
  assert.equal(parse('since November', cleanup).slots.lastCleaned, 'three_weeks');
  assert.equal(parse('2 weeks or 3 months', cleanup).lastCleanedStatus, 'ambiguous');
  assert.equal(parse('since November 2025', cleanup).slots.lastCleaned, 'custom');
});

test('routine objections and policy questions receive stable intent signals', () => {
  for (const phrase of ['too expensive', 'too much', 'more than I expected', 'looking for something cheaper', 'no thanks, too pricey']) assert.equal(parse(phrase).intent, 'objection_price', phrase);
  for (const phrase of ['let me ask my husband', 'let me ask my wife', 'thinking about it', "I'll let you know"]) assert.equal(parse(phrase).intent, 'objection_thinking', phrase);
  assert.equal(parse('can I cancel anytime?').intent, 'question_contract');
  assert.equal(parse('how does haul away work?').intent, 'question_what_included');
});
