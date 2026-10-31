// Invoice preview only. Monthly billing averages use the SNG decimal divisor.
export const BILLING_VISITS_PER_MONTH = { twice_a_week: 104 / 12, once_a_week: 4.33, every_other_week: 26 / 12, once_a_month: 1 };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function callGuideProration({ frequency, startDate, startDatePending = false, serviceDay = "", monthlyTotal }) {
  if (frequency === "one_time") return { dates: [], quantity: 0, rate: 0, amount: 0, pending: false };
  const divisor = BILLING_VISITS_PER_MONTH[frequency];
  const pending = { dates: [], quantity: 0, rate: null, amount: null, pending: true };
  if (!divisor || startDatePending || !/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") || !Number.isFinite(monthlyTotal) || monthlyTotal < 0) return pending;
  const initial = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(initial.getTime()) || initial.toISOString().slice(0, 10) !== startDate) return pending;
  const days = DAY_NAMES.flatMap((name, index) => new RegExp(`\\b${name}\\b`, "i").test(serviceDay) ? [index] : []);
  if (frequency === "twice_a_week" && days.length !== 2) return pending;
  if (frequency !== "twice_a_week" && days.length > 1) return pending;
  // Without a route day, estimate the cadence from the initial cleanup date.
  const weekday = days[0] ?? initial.getUTCDay();
  const dates = [];
  const cursor = new Date(initial);
  const offset = (weekday - initial.getUTCDay() + 7) % 7;
  const firstOffset = offset || (frequency === "every_other_week" ? 14 : 7);
  for (let elapsed = 1; elapsed <= 31; elapsed += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCMonth() !== initial.getUTCMonth()) break;
    const due = frequency === "twice_a_week" ? days.includes(cursor.getUTCDay())
      : frequency === "once_a_week" ? cursor.getUTCDay() === weekday
      : frequency === "every_other_week" ? elapsed >= firstOffset && (elapsed - firstOffset) % 14 === 0
      : false; // Monthly service resumes in the following month.
    if (due) dates.push(cursor.toISOString().slice(0, 10));
  }
  const rate = monthlyTotal / divisor;
  return { dates, quantity: dates.length, rate, amount: cents(rate * dates.length), divisor, pending: false };
}
