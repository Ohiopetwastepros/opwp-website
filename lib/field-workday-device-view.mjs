import {
  technicianMember,
  technicianText,
  technicianWorkday,
  technicianWorkdayResult,
} from './field-technician-view.mjs';

export const DEVICE_PRIVACY_VERSION = 2;
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(value)
  && value.split(':').every(part => uuid(part) || technicianText(part) === part);
const number = value => typeof value === 'number' && Number.isFinite(value);
const string = value => typeof value === 'string';
const timestamp = value => string(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const boolean = value => typeof value === 'boolean';
const ids = value => Array.isArray(value) ? value.filter(token) : undefined;
const text = value => string(value) ? technicianText(value) : undefined;

// Commands are projected before they are first saved, so their idempotency
// receipt always hashes the same, already-private event. Preserve key order.
function fields(value, rules) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(rules, key)) continue;
    const rule = rules[key];
    if (Array.isArray(rule)) {
      if (Array.isArray(value[key])) result[key] = value[key].map(item => fields(item, rule[0]));
    } else if (rule === text || rule === ids) {
      const projected = rule(value[key]);
      if (projected !== undefined) result[key] = projected;
    } else if (rule(value[key])) result[key] = value[key];
  }
  return result;
}

const reading = { mileage: number, confirmMileage: boolean };
const bodyRules = {
  clock_in: { vehicle: token, mileage: number, notes: text },
  check_item: { key: token, checked: boolean },
  confirm_load: { items: [{ productId: token, quantity: number }] },
  start_route: {},
  on_way: { stopId: token, minutes: number },
  arrive: { stopId: token },
  start_task: { taskId: token, safe: boolean },
  save_note: { taskId: token, notes: text },
  add_photo: { taskId: token, photoId: token, purpose: token },
  complete_task: { taskId: token, secured: boolean, units: number, notes: text },
  skip_task: { taskId: token, confirm: boolean, reason: text, notes: text },
  start_break: { ...reading, breakType: token },
  end_break: reading,
  start_wrap: {},
  finish_day: { ...reading, items: [{ productId: token, returned: number, damaged: number, missing: number }], notes: text },
  clock_out: { ...reading, notes: text },
  accept_changes: { changeIds: ids },
  acknowledge: { issueId: token },
};

export function technicianDeviceEvent(event) {
  const rules = bodyRules[event?.type];
  const result = {};
  if (!event || typeof event !== 'object') return result;
  const envelope = { id: token, shiftId: token, expectedRevision: number, type: token, recordedAt: timestamp };
  for (const key of Object.keys(event)) {
    if (key === 'body') result.body = fields(event.body, rules || {});
    else if (Object.hasOwn(envelope, key) && envelope[key](event[key])) result[key] = event[key];
  }
  return result;
}

export function newTechnicianDeviceEvent(event) {
  if (!Object.hasOwn(bodyRules, event?.type)) throw new Error('Choose a supported field action.');
  return technicianDeviceEvent(event);
}

export function technicianDeviceRecord(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const result = technicianWorkdayResult(saved);
  const pending = [], privacyHolds = [];
  const held = new Set((saved.privacyHolds || []).map(item => item?.eventId).filter(token));
  for (const original of Array.isArray(saved.pending) ? saved.pending : []) {
    const projected = technicianDeviceEvent(original);
    pending.push(projected);
    // A changed lost-response retry must never be sent with the original ID:
    // the server may already have accepted and hashed its original content.
    if (held.has(projected.id) || !Object.hasOwn(bodyRules, projected.type) || JSON.stringify(original) !== JSON.stringify(projected)) {
      privacyHolds.push({ eventId: projected.id || 'unknown', reason: 'restricted_legacy_action' });
    }
  }
  const photos = {}, drafts = {};
  for (const [id, blob] of Object.entries(saved.photos || {})) {
    if (token(id) && typeof Blob !== 'undefined' && blob instanceof Blob && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) photos[id] = blob;
  }
  for (const [id, value] of Object.entries(saved.drafts || {})) {
    if (token(id) && typeof value === 'string') drafts[id] = technicianText(value);
  }
  return {
    ...(token(saved.key) ? { key: saved.key } : {}),
    privacyVersion: DEVICE_PRIVACY_VERSION,
    day: technicianWorkday(saved.day),
    member: technicianMember(saved.member),
    pending,
    privacyHolds,
    photos,
    drafts,
    acknowledged: number(saved.acknowledged) ? saved.acknowledged : 0,
    offlineUntil: timestamp(saved.offlineUntil) ? saved.offlineUntil : null,
    changes: result.changes,
    messages: result.messages,
    sourceChanged: saved.sourceChanged === true,
    customerTextsEnabled: saved.customerTextsEnabled === true,
  };
}
