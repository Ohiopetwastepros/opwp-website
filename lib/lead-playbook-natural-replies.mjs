// Deterministic intake only. This module never generates a price or customer
// message. The caller retains consent, ownership, STOP and escalation priority.
const SQ_FT_PER_ACRE = 43560;
const NUMBERS = {zero: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20};
const COUNT = '(?:\\d{1,2}|no|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const VALUE = '(?:\\d+\\s*/\\s*\\d+(?:st|nd|rd|th)?|three[ -]+(?:quarters?|fourths?)|two[ -]+thirds?|(?:(?:an?|one)\\s+)?(?:eighth|quarter|fourth|third|half)|\\d+(?:\\.\\d+)?|\\.\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)';
const cleanText = text => String(text || '').normalize('NFKC').replace(/\u2044/g, '/').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
const countValue = value => Object.hasOwn(NUMBERS, value) ? NUMBERS[value] : Number(value);
const tierFor = acres => acres > 0.75 ? 'xlarge' : acres <= 0.125 ? 'tiny' : acres <= 0.25 ? 'small' : acres <= 0.5 ? 'medium' : 'large';
function acreageValue(value) {
  const raw = value.trim().replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (/^\d+\s*\//.test(raw)) {const [top, bottom] = raw.replace(/(?:st|nd|rd|th)$/, '').split('/').map(Number); return bottom > 0 ? top / bottom : NaN;}
  const words = raw.replace(/^(?:a|an|one) /, '');
  return ({eighth: 0.125, quarter: 0.25, fourth: 0.25, third: 1 / 3, half: 0.5, 'three quarter': 0.75, 'three quarters': 0.75, 'three fourth': 0.75, 'three fourths': 0.75, 'two third': 2 / 3, 'two thirds': 2 / 3, a: 1, an: 1, ...NUMBERS})[words] ?? Number(words);
}
function matchedYard(tier, acres, reason = 'yard_measurement') {return {yardStatus: 'matched', reason, slots: {yardTier: tier, yardAcres: acres}};}
function uncertainYard(reason, yardStatus = 'ambiguous') {return {yardStatus, reason, slots: {}};}

function parseYard(message, context, original) {
  const expected = ['yardTier', 'yardMapAddress', 'yardMeasurement'].includes(context.expected), mentionsYard = /\b(?:yard|backyard|lot|acre(?:s|age)?|sqft|square feet)\b/.test(message);
  if (expected && /^[a-e][.!]?$/.test(message)) return matchedYard(['tiny', 'small', 'medium', 'large', 'xlarge'][message.charCodeAt(0) - 97], null, 'yard_option');
  // Existing form labels and the specifically approved conversational intervals.
  const range = message.match(/^(?:between\s+)?(1\s*\/\s*[248])\s*(?:to|and|-)\s*(1\s*\/\s*[24]|3\s*\/\s*4)\s*(?:acres?)?[.!]?$/);
  if (range && (expected || /acre/.test(message))) {
    const low = acreageValue(range[1]), high = acreageValue(range[2]);
    const tier = low === 0.125 && high === 0.25 ? 'small' : low === 0.25 && high === 0.5 ? 'medium' : low === 0.5 && high === 0.75 ? 'large' : null;
    return tier ? matchedYard(tier, null, 'yard_approved_interval') : uncertainYard('yard_range_crosses_tiers');
  }
  if (/^(?:up to|under|less than)\s+1\s*\/\s*8(?:th)?\s*(?:acres?)?[.!]?$/.test(message) || /^1\s*\/\s*8(?:th)?\s*(?:acres?\s*)?or less[.!]?$/.test(message)) return matchedYard('tiny', null, 'yard_upper_bound');
  if (/^(?:under|less than)\s+5,?500\s*(?:sq\.?\s*ft|sqft|square feet)[.!]?$/.test(message)) return matchedYard('tiny', null, 'yard_approved_estimate');
  if (/^over (?:half|1\s*\/\s*2)(?: an?| of an?)?\s*(?:acres?)?[.!]?$/.test(message) && (expected || mentionsYard)) return matchedYard('large', null, 'yard_approved_estimate');
  if (/(?:\b(?:over|more than|larger than|at least) (?:3\s*\/\s*4|three quarters)|\b(?:3\s*\/\s*4|three quarters)(?:\s*acres?)?\s*(?:or (?:more|larger)|and (?:more|larger)|\+))/.test(message) && (expected || mentionsYard)) return matchedYard('xlarge', null, 'yard_large_boundary');
  if (expected && /^acre\+[.!]?$/.test(message)) return matchedYard('xlarge', null, 'yard_large_boundary');
  if ((expected || mentionsYard) && /(?:^|[\s(])-\s*\d|(?:x|by)\s*-\s*\d/.test(message)) return uncertainYard('yard_invalid_measurement');
  if (/^\s*\d+\s*\/\s*\d+\s*\//.test(message)) return uncertainYard('yard_invalid_measurement');

  const measurements = [];
  let invalid = false;
  function add(acres, match, kind) {
    if (!Number.isFinite(acres) || acres <= 0 || acres > 1000) invalid = true;
    else measurements.push({acres, index: match.index, end: match.index + match[0].length, kind});
  }
  for (const match of message.matchAll(new RegExp(`(?<![\\w./])(${VALUE})\\s*(?:of\\s+)?(?:an?\\s+)?acres?\\b`, 'g'))) add(acreageValue(match[1]), match, 'acres');
  for (const match of message.matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*(?:ft|feet)|square\s*(?:feet|foot)|ft\s*(?:2|\^2)|sqft)\b/g)) add(Number(match[1].replace(/,/g, '')) / SQ_FT_PER_ACRE, match, 'square_feet');
  for (const match of message.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by|\u00d7)\s*(\d+(?:\.\d+)?)\s*(ft|feet|foot|')?(?![\w.])/g)) {
    if (/^\s*(?:meters?|metres?|m)\b/.test(message.slice(match.index + match[0].length))) {invalid = true; continue;}
    if (expected || mentionsYard || /\b(?:ft|feet|foot)\b|['\u00d7]/.test(match[0])) add(Number(match[1]) * Number(match[2]) / SQ_FT_PER_ACRE, match, 'dimensions');
  }
  if (expected && measurements.length) {
    for (const match of message.matchAll(/(?<![\w./])\d+\s*\/\s*\d+(?:st|nd|rd|th)?(?![\w/])/g)) {
      if (!measurements.some(value => match.index >= value.index && match.index + match[0].length <= value.end)) add(acreageValue(match[0]), match, 'bare');
    }
  }
  // Bare fractions/word fractions only answer a yard-size question. Do not
  // interpret dates, dog counts, or a duration as acreage elsewhere.
  if (!measurements.length && !invalid && expected) {
    const bare = message.match(new RegExp(`^(?:about |around |roughly |approximately |i(?:'d|d) say |i think |maybe )*(${VALUE})(?:[.!])?$`));
    if (bare && /\/|\.|eighth|quarter|fourth|third|half/.test(bare[1])) add(acreageValue(bare[1]), bare, 'bare');
  }
  if (invalid) return uncertainYard('yard_invalid_measurement');
  if (measurements.length) {
    const first = measurements[0];
    if (measurements.some(value => Math.abs(value.acres - first.acres) * SQ_FT_PER_ACRE > 1)) return uncertainYard('yard_conflicting_measurements');
    if (/\b(?:between|over|more than|larger than|less than|under|at least|at most|up to)\b|\d\s*(?:-|to|or)\s*\d/.test(message) || /\b(?:or less|or more|or larger)\b/.test(message)) return uncertainYard('yard_open_or_crossing_bound');
    return matchedYard(tierFor(first.acres), first.acres);
  }
  if (!(expected || mentionsYard)) return {};
  // Location is distinct from area; square-foot and dimension matches above
  // cannot accidentally become street addresses.
  const address = original.match(/(?:\b(?:my address is|address is|i live at|it's at|it is at)\s+)?\b\d{1,6}\s+(?:[nsew]\.?\s+)?[\p{L}\d][\p{L}\d .'-]{1,90}?\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|circle|cir|way|boulevard|blvd|place|pl|trail|trl|terrace|ter)\b(?:[., ]+[\p{L} .'-]+)?(?:\s+\d{5}(?:-\d{4})?)?/iu);
  if (address) return {yardStatus: 'address', reason: 'yard_address_for_measurement', slots: {address: address[0].replace(/^(?:my address is|address is|i live at|it's at|it is at)\s+/i, '').trim()}};
  if (/\b(?:not sure|no clue|don'?t know|do not know|no idea|i live in a neighborhood)\b/.test(message)) return uncertainYard('yard_unsure', 'unsure');
  if (/\b(?:invisible fence|front and back|front yard and back|whole lot|whole yard|big front|both front)\b/.test(message)) return uncertainYard('yard_scope_ambiguous');
  if (/\bnot (?:a |very |really )?(?:small|large|huge|standard|average|tiny)\b|\b(?:small|average|standard).*\b(?:or|and)\b.*\b(?:large|huge)\b|\b(?:large|huge).*\bor\b.*\b(?:small|average|standard)\b/.test(message)) return uncertainYard('yard_conflicting_estimates');
  if (/\b(?:slightly (?:bigger|larger) than standard|medium[- ]large)\b/.test(message)) return matchedYard('small', null, 'yard_approved_shorthand');
  if (/\b(?:huge(?: yard)?|acreage)\b/.test(message)) return matchedYard('xlarge', null, 'yard_approved_shorthand');
  if (/\b(?:large yard|pretty big(?: yard)?)\b/.test(message) || expected && /^large[.!]?$/.test(message)) return matchedYard('medium', null, 'yard_approved_shorthand');
  if (/\b(?:standard(?: sized)?(?: yard)?|average(?: yard)?|normal(?: neighborhood)?(?: yard)?|small (?:yard|backyard)|tiny(?: yard)?|super small|patio\/small|townhouse)\b/.test(message) || expected && /^small[.!]?$/.test(message)) return matchedYard('tiny', null, 'yard_approved_shorthand');
  if (expected && /\b(?:big|medium|larger|size|acre|feet|foot|sqft)\b/.test(message)) return uncertainYard('yard_size_ambiguous');
  return {};
}

function parseDogs(message, context) {
  const expected = context.expected === 'dogs', dogWords = /\b(?:dogs?|puppies|corgis?|danes?|retrievers?|labradors?|labs?|beagles?|poodles?|husk(?:y|ies))\b/.test(message);
  if (!expected && !dogWords) return {};
  const futureGroup = message.match(new RegExp('\\b(' + COUNT + ')\\s+dogs?\\s+(?:and|plus)\\s+(' + COUNT + ')\\s+(?:puppies|pups)\\b'));
  if (futureGroup && /\b(?:all|both groups|puppies) (?:be |will |will be |use |will use ).{0,24}\byard\b/.test(message)) return {slots: {dogs: countValue(futureGroup[1]) + countValue(futureGroup[2])}};
  if (/\bpupp(?:y|ies)\b/.test(message)) return {dogsStatus: 'ambiguous', reason: 'dogs_puppy_yard_use_uncertain'};
  if (/\b(?:thinking|considering|might|maybe).*(?:second|another|more|dog)\b/.test(message)) return {dogsStatus: 'ambiguous', reason: 'dogs_future_count_uncertain'};
  const corrected = message.match(new RegExp(`\\b(${COUNT})\\s+dogs?\\s*,?\\s*(?:not|instead of)\\s+${COUNT}\\s*(?:dogs?)?\\b`));
  if (corrected) return {slots: {dogs: countValue(corrected[1])}};
  const grouped = message.match(new RegExp(`^(${COUNT})\\s+(?:small|little|big|large)(?: dogs?)?\\s+and\\s+(${COUNT})\\s+(?:small|little|big|large)(?: dogs?)?[.!]?$`));
  if (grouped) return {slots: {dogs: countValue(grouped[1]) + countValue(grouped[2])}};
  const matches = [...message.matchAll(new RegExp(`\\b(${COUNT})\\s+(?:(?:small|little|big|large)\\s+)?(?:dogs?|corgis?|danes?|retrievers?|labradors?|labs?|beagles?|poodles?|husk(?:y|ies))\\b`, 'g'))];
  if (matches.length > 1 && new Set(matches.map(match => countValue(match[1]))).size > 1) return {dogsStatus: 'ambiguous', reason: 'dogs_conflicting_counts'};
  if (matches.length) return {slots: {dogs: countValue(matches[0][1])}};
  if (/\ba single dog\b/.test(message)) return {slots: {dogs: 1}};
  if (expected) {
    const bare = message.match(new RegExp(`^(?:(?:just|only|actually) |(?:we|i) have )?(${COUNT})(?:\\s+(?:total|dogs?))?[.!]?$`));
    if (bare) return {slots: {dogs: countValue(bare[1])}};
  }
  return {};
}

function parseFrequency(message) {
  const patterns = [
    ['twice_a_week', /\b(?:twice (?:a week|weekly)|2\s*x\s*(?:a week|\/\s*wk)|two times a week|2 times weekly)\b/g],
    ['every_other_week', /\b(?:bi[- ]?weekly|every other week|every (?:2|two) weeks|twice a month|2\s*x\s*a month|eow)\b/g],
    ['once_a_week', /\b(?:once a week|1\s*x\s*(?:a week|\/\s*wk)|every week|once weekly|weekly)\b/g],
    ['once_a_month', /\b(?:once a month|monthly)\b/g],
    ['one_time', /\b(?:one[- ]time|just once|single clean\s?up|spring clean\s?up|initial only|just need it caught up once)\b/g],
  ];
  const matches = patterns.flatMap(([frequency, pattern]) => [...message.matchAll(pattern)].map(match => ({frequency, start: match.index, end: match.index + match[0].length})));
  const distinct = new Set(matches.filter(match => !matches.some(other => other !== match && other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start)).map(match => match.frequency));
  return distinct.size === 1 ? {slots: {frequency: [...distinct][0]}} : distinct.size > 1 ? {reason: 'frequency_ambiguous'} : {};
}

const cleanupTier = days => days <= 7 ? 'one_week' : days <= 14 ? 'two_weeks' : days <= 21 ? 'three_weeks' : days <= 31 ? 'one_month' : days <= 62 ? 'two_months' : days <= 124 ? '3_4_months' : null;
function parseCleanup(message, context, original) {
  if (context.expected !== 'lastCleaned' && !/\b(?:cleaned|clean up|cleanup|buildup|raked|since|last week|yesterday)\b/.test(message)) return {};
  // Historical form values remain readable after removing lettered SMS menus.
  if (context.expected === 'lastCleaned' && /^[a-f][.!]?$/.test(message)) return {slots: {lastCleaned: ['one_week', 'two_weeks', 'three_weeks', 'one_month', 'two_months', '3_4_months'][message.charCodeAt(0) - 97]}};
  const uncertain = reason => ({lastCleanedStatus: 'ambiguous', reason});
  const matched = (lastCleaned, answer) => ({slots: {lastCleaned, ...(answer ? {lastCleanedAnswer: answer} : {})}});
  const custom = answer => ({...matched('custom', answer), reason: 'cleanup_outside_priced_range'});
  if (/\b(?:since (?:before )?winter|since snow|all winter|end of summer|since spring|before winter)\b|^spring[.!]?$/.test(message)) return uncertain('cleanup_season_uncertain');
  if (/\bnever\b/.test(message)) return custom('never');
  if (/\b(?:not sure|no clue|don'?t know|been a while)\b/.test(message)) return uncertain('cleanup_duration_uncertain');
  if (/\b(?:(?:at least|more than|over|longer than) (?:[5-9]|[1-9]\d|five|six|seven|eight|nine|ten)|(?:five|six|seven|eight|nine|ten|[5-9]|[1-9]\d)\+)\s+months?\b|\b(?:a|one|\d+) years?\b/.test(message)) return custom('over four months');
  if (/\b(?:at least|more than|over|longer than)\b/.test(message) && /\b(?:days?|weeks?|months?)\b/.test(message)) return uncertain('cleanup_open_ended_range');
  const recent = message.match(/\b(?:today|yesterday|just cleaned|this week|last week|a few days|less than a week|within a week)\b/);
  if (recent) return matched('one_week', original.slice(recent.index, recent.index + recent[0].length));
  const durations = [...message.matchAll(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|a|an|couple(?: of)?|few)(?:\s*(?:-|to|or)\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten))?\s+(days?|weeks?|months?)\b/g)];
  if (durations.length > 1) return uncertain('cleanup_conflicting_durations');
  const duration = durations[0];
  if (duration) {
    const value = raw => /^couple/.test(raw) ? 2 : raw === 'a' || raw === 'an' ? 1 : raw === 'few' ? 3 : countValue(raw);
    const low = value(duration[1]), high = duration[2] ? value(duration[2]) : low;
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return uncertain('cleanup_invalid_duration');
    const tier = cleanupTier(high * (duration[3].startsWith('month') ? 31 : duration[3].startsWith('week') ? 7 : 1));
    const qualifier = message.slice(0, duration.index).match(/\b(?:about|around|roughly|approximately)\s*$/);
    const start = qualifier ? duration.index - qualifier[0].length : duration.index;
    const answer = original.slice(start, duration.index + duration[0].length);
    return tier ? matched(tier, answer) : custom(answer);
  }
  const month = message.match(/\bsince (january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/);
  if (month) {
    const now = new Date(context.now);
    if (!context.now || !Number.isFinite(now.getTime())) return uncertain('cleanup_date_context_required');
    const index = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(month[1]);
    const year = month[2] ? Number(month[2]) : now.getUTCFullYear() - (index > now.getUTCMonth() ? 1 : 0);
    const days = Math.ceil((now.getTime() - Date.UTC(year, index, 1)) / 86400000);
    if (days < 0) return uncertain('cleanup_future_date');
    const tier = cleanupTier(days);
    const answer = original.slice(month.index, month.index + month[0].length);
    return tier ? matched(tier, answer) : custom(answer);
  }
  return {};
}

export function parseNaturalPlaybookReply(text, context = {}) {
  const original = cleanText(text).slice(0, 4000), message = original.toLowerCase(), slots = {};
  if (!message || /^(?:stop|unsubscribe|wrong number|remove me)[.!]?$/.test(message)) return {slots};
  const result = {slots};
  for (const parsed of [parseDogs(message, context), parseFrequency(message), parseCleanup(message, context, original), parseYard(message, context, original)]) {
    Object.assign(slots, parsed.slots || {});
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'slots') continue;
      if (key !== 'reason' || !result.reason || /ambiguous|uncertain|outside|invalid|conflict/.test(value)) result[key] = value;
    }
  }
  const zip = message.match(/\b(?:actually|zip(?: code)?(?: is)?|in)\s+(\d{5})(?:-\d{4})?\b/) || (['confirm_details_sent', 'details_corrected'].includes(context.stage) || context.expected === 'zip' ? message.match(/^(\d{5})[.!]?$/) : null);
  if (zip) slots.zip = zip[1];
  if (/\b(?:too expensive|too much|too pricey|more than (?:i|we) expected|cheaper|can'?t afford|cannot afford)\b/.test(message)) result.intent = 'objection_price';
  else if (/\b(?:ask|talk (?:with|to)|check with) (?:my )?(?:husband|wife|spouse|partner)\b|\b(?:thinking about it|think about it|i'?ll let you know)\b/.test(message)) result.intent = 'objection_thinking';
  else if (/\b(?:cancel anytime|cancel any time|contract|contractual|try (?:one|1) month)\b/.test(message)) result.intent = 'question_contract';
  else if (/\b(?:haul[- ]?away|what (?:is|does).*include)\b/.test(message)) result.intent = 'question_what_included';
  else if (/\b(?:need to be home|have to be home|rain or shine)\b/.test(message)) result.intent = 'question_gate_access';
  else if (Object.keys(slots).length || result.yardStatus || result.lastCleanedStatus || result.dogsStatus || result.reason === 'frequency_ambiguous') result.intent = 'correction';
  else if (/^(?:yes|yep|yup|yeah|y|correct|that'?s (?:right|correct)|that is (?:right|correct)|all (?:good|correct)|sounds (?:right|good)|i'?m good with that)(?:[,;.! ]*(?:please|that is correct|that'?s correct|thanks))?[.! ]*$/.test(message) || /^\u{1f44d}[\u{1f3fb}-\u{1f3ff}]?\ufe0f?$/u.test(message)) result.intent = ['quote_sent', 'discount_offered'].includes(context.stage) ? 'ready_to_sign_up' : 'confirm_yes';
  else if (/\b(?:let'?s do it|sign me up|let'?s get started|i can do that)\b/.test(message)) result.intent = 'ready_to_sign_up';
  return result;
}
