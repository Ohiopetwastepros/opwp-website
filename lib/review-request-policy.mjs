export function reviewRequestsEnabled(env) { return env?.REVIEW_REQUESTS_ENABLED === 'true'; }

export function reviewPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : digits.length >= 11 && digits.length <= 15 ? `+${digits}` : '';
}
export function reviewEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
export async function reviewHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function reviewJobType(value) { return String(value || '').trim().toLowerCase().replace(/[- ]/g, '_'); }
export function reviewJobQualifies(value) { return ['initial', 'one_time'].includes(reviewJobType(value)); }
export function reviewEasternDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
export function reviewSendWindow(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  return hour >= 9 && hour < 20;
}
// SNG wall-clock timestamps without an offset use the organization's Eastern zone.
// Never use event receipt time to qualify a historical/replayed completion.
export function reviewCompletedAt(value) {
  const input = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(input)) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
    const time = Date.parse(input); return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  const wall = Date.parse(input.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(wall)) return null;
  let time = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)).map(p => [p.type, p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    time += wall - local;
  }
  return new Date(time).toISOString();
}
export function reviewMarketingAllowed(value) { return value === true || value === 1 || ['yes', 'true', '1', 'allowed'].includes(String(value ?? '').trim().toLowerCase()); }
export function reviewSkipReason({ jobType, completedAt, enabledAt, reviewed, suppressed, emailUnsubscribed, marketingAllowed, doNotContact, phone, email, customerKey }) {
  if (!reviewJobQualifies(jobType)) return 'ineligible_job_type';
  if (!completedAt) return 'missing_completion_time';
  if (!enabledAt || Date.parse(completedAt) <= Date.parse(enabledAt)) return 'before_go_live';
  if (reviewed) return 'already_reviewed';
  if (suppressed) return 'stop_or_suppression';
  if (emailUnsubscribed) return 'email_unsubscribed';
  if (!reviewMarketingAllowed(marketingAllowed)) return 'marketing_not_allowed';
  if (doNotContact) return 'manual_do_not_contact';
  if (!phone && !email) return 'no_contact';
  if (!customerKey) return 'missing_customer_identity';
  return null;
}
