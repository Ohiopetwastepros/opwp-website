// Texting rates verified through Sweep&Go's residential quote GET for regular
// pricing in ZIP 43551 on 2026-11-24. The office call guide and Craig texting share this grid.
export const CRAIG_PRICING_VERSION = 'sng-texting-2026-11-24';
export const CRAIG_RATES = Object.freeze({
  twice_a_week: [175, 190, 225, 245, 275, 305, 335],
  once_a_week: [95, 105, 120, 130, 140, 150, 160],
  every_other_week: [72, 80, 92],
  once_a_month: [55, 65],
});
export const CRAIG_CLEANUP = Object.freeze({
  initial: {
    one_week: [[18.48,25],[21.93,28],[23.09,30],[24.25,31],[25.4,32]],
    two_weeks: [[25.4,32],[30.02,37],[32.33,39],[34.64,41],[36.95,43]],
    three_weeks: [[35.2,42],[42.51,49],[46.17,53],[49.82,56],[53.48,60]],
    one_month: [[45,55],[55,65],[60,70],[65,75],[80,90]],
    two_months: [[60,70],[70,80],[80,90],[90,110],[120,140]],
    '3_4_months': [[79,89],[85,95],[89,99],[99,119],[140,160]],
  },
  one_time: {
    one_week: [[27.72,37.5],[32.9,42],[34.64,45],[36.39,46.5],[38.1,48]],
    two_weeks: [[38.1,48],[45.03,55.5],[48.5,58.5],[51.96,61.5],[55.43,64.5]],
    three_weeks: [[52.8,63],[63.77,73.5],[69.26,79.5],[74.73,84],[80.22,90]],
    one_month: [[60,75],[75,100],[85,110],[105,130],[125,150]],
    two_months: [[75,100],[95,120],[105,130],[125,150],[145,170]],
    '3_4_months': [[95,120],[115,140],[125,150],[145,170],[165,190]],
  },
});
export const CRAIG_ADDONS = Object.freeze({sanitization: 35, recurringSanitization: 30, deodorization: 25, haulAway: 21, haulAwayLarge: 31, frontYard: 21, dogFood: 59});
const addonKeys = Object.freeze({sani_onetime: 'sanitization', sani_monthly: 'recurringSanitization', deodorize: 'deodorization', front_yard: 'frontYard'});
export function craigServiceAddonPrice(id, dogs) {
  const key = id === 'haul_away' ? (Number(dogs) >= 3 ? 'haulAwayLarge' : 'haulAway') : addonKeys[id];
  return Object.hasOwn(CRAIG_ADDONS, key) ? CRAIG_ADDONS[key] : null;
}
export const CRAIG_FIRST_MONTH_DISCOUNT = 15; // Office applies this manually.
export const craigRate = (frequency, dogs) => CRAIG_RATES[frequency]?.[Number(dogs) - 1] ?? null;
export const craigCleanupRange = (kind, gap, dogs) => CRAIG_CLEANUP[kind]?.[gap]?.[Number(dogs) - 1] ?? null;
export const craigRangeText = range => range.map(amount => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(amount)).join(' to ');
