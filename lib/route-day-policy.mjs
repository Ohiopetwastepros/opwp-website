const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isBowlingGreen(city, zip) {
  const cityKey = normalize(city);
  const postal = String(zip ?? '').trim();
  return cityKey === 'bowling green' || cityKey === 'haskins' || ['43402', '43525'].includes(postal);
}

function isSwanton(city, zip) {
  const cityKey = normalize(city);
  const postal = String(zip ?? '').trim();
  return cityKey === 'swanton' || ['43558'].includes(postal);
}

function isSylvania(city, zip) {
  const cityKey = normalize(city);
  const postal = String(zip ?? '').trim();
  return cityKey === 'sylvania' || postal === '43560';
}

export function allowedOperationalDays({ city, zip, frequency }) {
  if (isSylvania(city, zip)) {
    return frequency === 'Twice Weekly' ? ['Tuesday', 'Thursday'] : ['Tuesday'];
  }
  if (frequency === 'Twice Weekly') return [...WEEKDAYS];
  if (isBowlingGreen(city, zip)) return ['Friday'];
  if (isSwanton(city, zip)) return ['Wednesday'];
  return [...WEEKDAYS];
}

function scoreDay(day, dayResult, { city, zip, frequency }) {
  const base = new Map();
  for (const item of WEEKDAYS) base.set(item, 0);

  if (day === 'Monday') base.set('Monday', -30);
  if (day === 'Wednesday') base.set('Wednesday', 30);
  if (day === 'Friday') base.set('Friday', 10);

  if (isBowlingGreen(city, zip)) {
    base.set('Friday', 100);
    base.set('Monday', -40);
    base.set('Wednesday', 10);
  }

  if (isSwanton(city, zip) && frequency === 'Weekly') {
    base.set('Wednesday', 40);
    base.set('Monday', -15);
  }

  if (dayResult?.projectedMinutes > 390) {
    if (day === 'Monday') base.set('Monday', base.get('Monday') - 20);
    if (day === 'Wednesday') base.set('Wednesday', base.get('Wednesday') + 20);
    if (day === 'Friday') base.set('Friday', base.get('Friday') + 10);
  }

  if (dayResult?.projectedMinutes <= 300 && !isBowlingGreen(city, zip)) {
    if (day === 'Wednesday') base.set('Wednesday', base.get('Wednesday') + 10);
    if (day === 'Friday') base.set('Friday', base.get('Friday') + 10);
  }

  if (dayResult?.projectedMinutes <= 300 && isBowlingGreen(city, zip) && day === 'Wednesday') {
    base.set('Wednesday', base.get('Wednesday') + 10);
  }

  if (dayResult?.allowed === false) base.set(day, base.get(day) - 100);
  if (dayResult?.available === false) base.set(day, base.get(day) - 100);

  return base.get(day);
}

export function buildOperationalDayPreference({ city, zip, frequency, dayResults = [] }) {
  const byDay = new Map(dayResults.map((row) => [row.day, row]));
  const scores = new Map();
  const rankedDays = WEEKDAYS.map((day) => {
    const row = byDay.get(day);
    const score = scoreDay(day, row, { city, zip, frequency });
    scores.set(day, score);
    return { day, score, row };
  }).sort((left, right) => right.score - left.score || left.day.localeCompare(right.day));

  const preferredDays = rankedDays.filter((item) => item.score >= 0).map((item) => item.day);
  return {
    scores,
    preferredDays,
    rankedDays,
  };
}
