export class FieldError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const operatingDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!['number','string'].includes(typeof value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function mileage(value) {
  const n = optionalNumber(value);
  if (n === null || n < 0 || n > 9999999) throw new FieldError('Enter the full odometer reading (0 if mileage is not tracked).');
  return n;
}
export function coordinates(body) {
  const latitude = optionalNumber(body.latitude), longitude = optionalNumber(body.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { latitude: null, longitude: null };
  return { latitude, longitude };
}
export function parseMetadata(value) { try { const data = JSON.parse(value || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } }
const text = value => value == null || typeof value === 'object' ? '' : String(value).trim().slice(0, 2000);
// Preserve SNG identifiers independently. Never match a service to a customer by name/address.
export function sngFieldSnapshot(row = {}) {
  return {
    identity: Object.fromEntries(['id','organization_id','client_id','client_location_id','commercial_client_id','commercial_location_id','assigned_to_id','commercial','type'].map(key => [key, text(row[key])])),
    gateCode: text(row.gate_code), communityCode: text(row.gated_community),
    dogCount: optionalNumber(row.number_of_dogs), dogSafetySource: text(row.safe_dogs),
    frequency: text(row.clean_up_frequency), sourceNote: text(row.note),
    additionalServiceCount: optionalNumber(row.count_cross_sells),
    homePhone: text(row.home_phone), cellPhone: text(row.cell_phone), email: text(row.email),
    notificationPreference: ['sms','email','call'].includes(row.cleanup_notification_channel) && typeof row.cleanup_notification_type==='string' && row.cleanup_notification_type.split(',').every(v=>['on_the_way','completed','off_schedule'].includes(v.trim())) ? {channel:row.cleanup_notification_channel,events:row.cleanup_notification_type.split(',').map(v=>v.trim())} : null,
    workAreasPresent: Boolean(row.work_areas && row.work_areas !== 'null'),
  };
}
export function identityConflicts(snapshot, row, employeeId) {
  const expected = snapshot?.identity;
  if (!expected?.id || !expected.organization_id || !expected.client_location_id || !expected.assigned_to_id) return ['Missing original SNG job identity; re-import before field release.'];
  const keys = ['id','organization_id','client_location_id','client_id','commercial_client_id','commercial_location_id','assigned_to_id','commercial','type'];
  const conflicts = keys.filter(key => text(row?.[key]) !== text(expected[key]));
  if (text(employeeId) !== expected.assigned_to_id) conflicts.push('technician_mapping');
  return conflicts;
}
export function shiftTotals(shift, breaks = [], now = Date.now()) {
  const stamp = value => value ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`) : NaN;
  const start = stamp(shift.checked_in_at), end = stamp(shift.completed_at);
  const elapsed = Number.isFinite(start) ? Math.max(0, ((Number.isFinite(end) ? end : now) - start) / 60000) : 0;
  const unpaid = breaks.filter(b => b.break_type === 'lunch').reduce((total,b) => total + Math.max(0, ((Number.isFinite(stamp(b.ended_at)) ? stamp(b.ended_at) : (Number.isFinite(end) ? end : now)) - stamp(b.started_at)) / 60000),0);
  const breakMiles = breaks.filter(b => b.break_type === 'lunch' && b.starting_mileage != null && b.ending_mileage != null).reduce((total,b) => total + Math.max(0,b.ending_mileage-b.starting_mileage),0);
  return { elapsedMinutes: Math.round(elapsed), unpaidMinutes: Math.round(unpaid), paidMinutes: Math.round(Math.max(0,elapsed-unpaid)), workMiles: shift.ending_mileage == null || shift.starting_mileage == null ? null : Math.round(Math.max(0,shift.ending_mileage-shift.starting_mileage-breakMiles)*100)/100 };
}
export function imageMatches(bytes, type) {
  const ascii = (start,end) => new TextDecoder().decode(bytes.slice(start,end));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  if (type === 'image/webp') return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
  return false;
}
