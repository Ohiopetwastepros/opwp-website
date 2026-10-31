export function easternFoodDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function shiftFoodDays(value, days) {
  const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function nextFoodDelivery(subscription, from = subscription.next_delivery_date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from))) throw new Error('A confirmed delivery date is required.');
  const [year, month, day] = from.split('-').map(Number), confirmed = new Date(`${from}T12:00:00Z`);
  if (!Number.isFinite(confirmed.getTime()) || confirmed.toISOString().slice(0,10) !== from) throw new Error('A valid confirmed delivery date is required.');
  const d = new Date(Date.UTC(year, month, 1, 12));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (subscription.delivery_cadence === 'service_week') {
    const week = Number(subscription.service_week), weekday = Number(subscription.service_weekday);
    if (!Number.isInteger(week) || week < 1 || week > 4 || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Confirm the monthly service week and weekday first.');
    d.setUTCDate(1 + (weekday - d.getUTCDay() + 7) % 7 + (week - 1) * 7);
  } else {
    const anchor = subscription.billing_anchor_day == null ? day : Number(subscription.billing_anchor_day);
    if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) throw new Error('Confirm a monthly delivery day between 1 and 31.');
    d.setUTCDate(Math.min(anchor, last));
  }
  return d.toISOString().slice(0, 10);
}
