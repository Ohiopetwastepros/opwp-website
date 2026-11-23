// Explicit local end-to-end check. All requests are restricted to this PC's
// preview origin; it never reads a production credential or contacts a provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { PRECHECKS } from '../lib/field-workday-model.mjs';

const ORIGIN = 'http://localhost:8787';
const REPORT = 'tmp/local-preview-field-http-report.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const forbiddenKeys = new Set(['phone', 'cellPhone', 'homePhone', 'email', 'customerPhone', 'customerEmail', 'billing', 'billingZip', 'billingAddress', 'revenue', 'totalCents', 'bookRateCents', 'manualRateCents', 'paymentMethodId', 'profileId', 'last4', 'paymentStatus']);
function assertTechnicianPrivacy(value, cursor = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbiddenKeys.has(key), `Restricted key reached technician at ${cursor}.${key}`);
    assertTechnicianPrivacy(child, `${cursor}.${key}`);
  }
  assert.doesNotMatch(JSON.stringify(value), /@local-preview\.example\.test|\+1419555/);
}
function connection() {
  const cookies = new Map(), requests = [];
  async function request(relative, { method = 'GET', body = null, contentType = 'application/json', binary = false } = {}) {
    const url = new URL(relative, ORIGIN);
    assert.equal(url.origin, ORIGIN, 'This check only permits the local preview origin.');
    const headers = new Headers({ origin: ORIGIN });
    if (cookies.size) headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    if (body !== null) headers.set('content-type', contentType);
    const response = await fetch(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(20000), ...(body === null ? {} : { body: contentType === 'application/json' ? JSON.stringify(body) : body }) });
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'), index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    const data = binary ? new Uint8Array(await response.arrayBuffer()) : await response.json();
    requests.push({ method, path: url.pathname, status: response.status });
    return { response, data };
  }
  return { request, requests };
}
function fakeProof() {
  const width = 240, height = 160, rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4, bar = x % 60 < 15;
    rgba[offset] = bar ? 180 : 75; rgba[offset + 1] = bar ? 155 : 115; rgba[offset + 2] = bar ? 100 : 70; rgba[offset + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width, height }, 75).data;
}
export async function checkLocalPreviewField() {
  const first = connection(), second = connection(), report = { origin: ORIGIN, startedAt: new Date().toISOString(), modifiedTasks: [], actions: [], results: {} };
  const login = async (client, email, pin) => { const result = await client.request('/api/field/session/', { method: 'POST', body: { email, pin } }); assert.equal(result.response.status, 200, JSON.stringify(result.data)); assert.equal(result.data.ok, true); assertTechnicianPrivacy(result.data); return result; };
  const getDay = async client => { const result = await client.request('/api/field/workday/'); assert.equal(result.response.status, 200, JSON.stringify(result.data)); assert.equal(result.data.customerTextsEnabled, false); assert.match(result.response.headers.get('cache-control'), /no-store/); assertTechnicianPrivacy(result.data); return result.data; };
  await login(first, 'tech1@example.test', '246810');
  let current = await getDay(first);
  assert.equal(current.day.memberId, 'local-tech-1'); assert.equal(current.day.stops.length, 6); assert.equal(current.day.shift.status, 'ready', 'Run on a fresh seeded Technician 1 route; this check does not reset recorded work.');
  report.date = current.day.date; report.shiftId = current.day.id;
  const action = async (type, body = {}) => {
    const event = { id: crypto.randomUUID(), shiftId: current.day.id, expectedRevision: current.day.revision, type, body, recordedAt: new Date().toISOString() };
    const result = await first.request('/api/field/workday/', { method: 'POST', body: event });
    assert.equal(result.response.status, 200, `${type}: ${JSON.stringify(result.data)}`); assert.equal(result.data.accepted, true); assertTechnicianPrivacy(result.data);
    report.actions.push({ type, revision: result.data.revision }); current = await getDay(first);
  };
  await action('clock_in', { mileage: 12000, vehicle: 'company', notes: 'Local preview HTTP acceptance; fictitious odometer.' });
  for (const [key] of PRECHECKS) await action('check_item', { key, checked: true });
  await action('confirm_load', { items: [] }); await action('start_route');
  const stop = current.day.stops[0], task = stop.tasks.find(item => item.serviceId === 'scoop');
  await action('on_way', { stopId: stop.id, minutes: 15 });
  await action('arrive', { stopId: stop.id }); await action('start_task', { taskId: task.id, safe: true });
  await action('save_note', { taskId: task.id, notes: 'LOCAL PREVIEW QA: fake yard checked; synthetic gate proof attached.' });
  const id = crypto.randomUUID(), capturedAt = new Date().toISOString(), image = fakeProof();
  assert.ok(image.byteLength < 400 * 1024);
  fs.mkdirSync('tmp/local-preview', { recursive: true }); fs.writeFileSync('tmp/local-preview/fake-field-proof.jpg', image); fs.writeFileSync('tmp/local-preview-test-photo.jpg', image);
  const upload = await first.request(`/api/field/workday/photo/?${new URLSearchParams({ id, shiftId: current.day.id, taskId: task.id, purpose: 'gate', capturedAt })}`, { method: 'PUT', contentType: 'image/jpeg', body: image });
  assert.equal(upload.response.status, 201, JSON.stringify(upload.data)); assert.equal(upload.data.id, id);
  await action('add_photo', { taskId: task.id, photoId: id, purpose: 'gate' });
  await action('complete_task', { taskId: task.id, secured: true, units: task.quantity });
  const completed = current.day.stops[0].tasks.find(item => item.id === task.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.photos[0].id, id); assert.match(completed.notes, /LOCAL PREVIEW QA/);
  const reviewed = await first.request(`/api/field/workday/photo/?id=${id}`, { binary: true });
  assert.equal(reviewed.response.status, 200); assert.equal(reviewed.response.headers.get('content-type'), 'image/jpeg'); assert.equal(digest(reviewed.data), digest(image));
  const otherStop = current.day.stops[1], skipped = otherStop.tasks.find(item => item.serviceId === 'scoop');
  await action('skip_task', { taskId: skipped.id, reason: 'Locked gate', notes: 'LOCAL PREVIEW QA: fictitious locked gate; no customer contacted.', confirm: true });
  assert.equal(current.day.stops[1].tasks.find(item => item.id === skipped.id).status, 'skipped');
  assert.equal(current.day.issues.at(-1).reason, 'Locked gate');
  assert.ok(current.messages.length > 0); assert.ok(current.messages.every(message => message.status === 'held'));
  await login(second, 'tech2@example.test', '135790'); const untouched = await getDay(second);
  assert.equal(untouched.day.memberId, 'local-tech-2'); assert.equal(untouched.day.shift.status, 'ready'); assert.equal(untouched.day.revision, 0); assert.equal(untouched.day.stops.length, 6); assert.ok(untouched.day.stops.flatMap(item => item.tasks).every(item => item.status === 'pending'));
  const unauthorizedProof = await second.request(`/api/field/workday/photo/?id=${id}`); assert.equal(unauthorizedProof.response.status, 404);
  const adminDenied = await first.request('/api/admin/crm/billing/'); assert.equal(adminDenied.response.status, 401);
  report.modifiedTasks = [{ id: task.id, customer: stop.name, status: 'completed', proofId: id }, { id: skipped.id, customer: otherStop.name, status: 'skipped', reason: 'Locked gate' }];
  report.results = { realPinLogin: true, localD1Events: true, localR2UploadAndReadback: true, matchingJpegDigest: true, completionWithNote: true, skippedWithReason: true, noQueuedCustomerMessages: true, technicianPrivacy: true, otherTechnicianUntouched: true, crossTechnicianProofDenied: true, adminBillingDenied: true, tech1Revision: current.day.revision, tech2Revision: untouched.day.revision };
  report.requests = [...first.requests, ...second.requests]; report.finishedAt = new Date().toISOString();
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await checkLocalPreviewField(); console.log(JSON.stringify({ ok: true, report: REPORT, actions: result.actions.length, modifiedTasks: result.modifiedTasks, results: result.results }, null, 2)); }
  catch (error) { fs.mkdirSync('tmp', { recursive: true }); fs.writeFileSync(REPORT, `${JSON.stringify({ ok: false, error: error.message, at: new Date().toISOString() }, null, 2)}\n`); throw error; }
}
