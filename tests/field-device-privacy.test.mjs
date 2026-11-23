import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { technicianDeviceRecord } from '../lib/field-workday-device-view.mjs';
import { technicianWorkday } from '../lib/field-technician-view.mjs';
import { adoptServerWorkday, commitDeviceEvent, readWorkdayDevice, syncDeviceWorkday, updateWorkdayDevice } from '../lib/field-workday-device.mjs';
import { applyWorkdayEvent, PRECHECKS } from '../lib/field-workday-model.mjs';
const { IDBFactory } = createRequire(import.meta.url)('fake-indexeddb');

const key = 'org:member', database = 'opwp-workdays-v1';
const now = Date.parse('2026-11-20T18:00:00Z');
const phone = '(419) 555-0109', email = 'customer@example.test';
const id = digit => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
function day() {
  return {
    schema: 1, id: 'shift', organizationId: 'org', memberId: 'member', memberName: 'Technician', planId: 'plan',
    date: '2026-11-20', planVersion: 1, revision: 3, createdAt: '2026-11-20T12:00:00Z', lastEventAt: null,
    paymentStatus: 'passed', inventory: [],
    shift: { status: 'on_route', clockIn: '2026-11-20T13:00:00Z', clockOut: null, startMileage: 12345,
      endMileage: null, activeBreak: null, breaks: [], prechecks: {}, wrapchecks: {}, notes: '', endNotes: '' },
    stops: [{ id: 'stop', address: '123 Sample Street', name: 'Customer', hasGate: true, safety: 'clear',
      gateCode: '1234#', dogCount: 2, tasks: [{ id: 'task', serviceId: 'scoop', title: 'Yard cleanup', quantity: 1,
        unitLabel: 'visit', timed: true, entryRequired: true, proofKind: 'gate', instructions: 'Latch side gate.',
        estimatedMinutes: 10, status: 'working', startedAt: '2026-11-20T17:50:00Z', notes: '', photos: [], deliveryItems: [] }] }],
    issues: [], notices: [], acceptedChanges: [],
  };
}
function record(overrides = {}) {
  return { day: day(), member: { id: 'member', organizationId: 'org', name: 'Technician' }, pending: [], photos: {},
    drafts: {}, acknowledged: 3, offlineUntil: '2026-11-21T02:00:00Z', changes: [], messages: [], ...overrides };
}
const event = (type, body, digit = '1', expectedRevision = 3) => ({ id: id(digit), shiftId: 'shift', expectedRevision, type, body, recordedAt: new Date(now).toISOString() });
function assertPrivate(value) {
  const encoded = JSON.stringify(value);
  for (const secret of [phone, email, '4195550109', 'private-finance-value']) assert.ok(!encoded.includes(secret), secret);
  assert.ok(!/"(?:phone|cellPhone|homePhone|email|billing|balance|price|revenue|paymentStatus|metadata|source|field)"\s*:/i.test(encoded), encoded);
}
async function seedLegacy(records) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open(database, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('accounts'); open.result.createObjectStore('meta'); };
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['accounts', 'meta'], 'readwrite');
    for (const [account, value] of records) tx.objectStore('accounts').put(value, account);
    tx.objectStore('meta').put(key, 'active');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function rawRecord(account) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open(database, 2); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction('accounts', 'readonly'), get = tx.objectStore('accounts').get(account);
    get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error);
  });
  db.close(); return value;
}
test.beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

test('legacy cache upgrade scrubs every account and retains actual photo bytes', async () => {
  const original = record(), image = new Blob(['photo evidence'], { type: 'image/jpeg' });
  Object.assign(original, { phone, billing: { revenue: 'private-finance-value' } });
  Object.assign(original.day.stops[0], { phone, email, instructions: `Latch gate. Call ${phone}. Email ${email}. Balance $95.` });
  Object.assign(original.day.stops[0].tasks[0], { field: { nested: { cellPhone: phone, email, price: 'private-finance-value' } }, source: { email } });
  original.photos[id('9')] = image;
  original.drafts.task = `Gate latched. Call ${phone}. Invoice $95.`;
  await seedLegacy([[key, original], ['org:inactive', structuredClone(original)]]);
  const safe = await readWorkdayDevice(key);
  assertPrivate(safe); assertPrivate(await rawRecord(key)); assertPrivate(await rawRecord('org:inactive'));
  assert.equal(await safe.photos[id('9')].text(), 'photo evidence');
  assert.equal(safe.day.stops[0].gateCode, '1234#'); assert.equal(safe.day.stops[0].dogCount, 2);
  assert.equal(safe.day.shift.startMileage, 12345);
  assert.deepEqual(technicianDeviceRecord(safe), safe, 'repeated projection is stable');
});

test('every device write and pending-work adoption projects nested server changes and drafts', async () => {
  const action = event('save_note', { taskId: 'task', notes: 'Gate latched.' });
  await seedLegacy([[key, record({ pending: [action] })]]);
  const unsafeStop = { ...day().stops[0], phone, tasks: [{ ...day().stops[0].tasks[0], metadata: { email, revenue: 'private-finance-value' } }] };
  const result = { ...record(), changes: [{ id: 'change', kind: 'add_visit', payload: { stop: unsafeStop, reason: `Contact ${email}` } }],
    messages: [{ id: 'message', detail: `Call ${phone}. Revenue $99.`, recipient: phone, email }] };
  const safe = await updateWorkdayDevice(key, saved => ({ ...adoptServerWorkday(saved, result),
    ignored: { email }, drafts: { task: `Call ${phone} or ${email}. Price $12.` } }));
  assertPrivate(safe); assertPrivate(await rawRecord(key));
  assert.equal(JSON.stringify(safe.pending[0]), JSON.stringify(action));
  assert.equal(safe.changes[0].payload.stop.tasks[0].quantity, 1);
});

test('safe queued proof and completion survive a lost response and replay without duplicate application', async () => {
  const photo = event('add_photo', { taskId: 'task', photoId: id('9'), purpose: 'gate' });
  const complete = event('complete_task', { taskId: 'task', secured: true, units: 1, notes: 'Gate latched; side gate secure.\nDog remains inside.' }, '2', 4);
  await seedLegacy([[key, record({ pending: [photo, complete], photos: { [id('9')]: new Blob(['proof'], { type: 'image/jpeg' }) } })]]);
  const applied = new Map(), order = []; let loseResponse = true;
  const api = {
    async upload(input, blob) { order.push('upload'); assert.equal(input.id, photo.id); assert.equal(await blob.text(), 'proof'); },
    async event(input) {
      order.push(input.type); const bytes = JSON.stringify(input);
      if (applied.has(input.id)) assert.equal(applied.get(input.id), bytes);
      else applied.set(input.id, bytes);
      if (input.id === complete.id && loseResponse) { loseResponse = false; throw new Error('Response lost'); }
      return { accepted: true, revision: input.expectedRevision + 1 };
    },
  };
  await assert.rejects(syncDeviceWorkday(key, api), /Response lost/);
  const saved = await readWorkdayDevice(key);
  assert.equal(JSON.stringify(saved.pending[0]), JSON.stringify(complete)); assert.equal(saved.privacyHolds.length, 0);
  const synced = await syncDeviceWorkday(key, api);
  assert.deepEqual(order, ['upload', 'add_photo', 'complete_task', 'complete_task']);
  assert.equal(applied.size, 2); assert.equal(synced.pending.length, 0); assert.equal(synced.acknowledged, 5);
});

test('restricted legacy retry is scrubbed and held without uploading or replaying a changed action', async () => {
  const unsafe = event('save_note', { taskId: 'task', notes: `Call ${phone}; email ${email}; balance $95.`, metadata: { revenue: 'private-finance-value' } });
  await seedLegacy([[key, record({ pending: [unsafe], photos: { [id('9')]: new Blob(['proof'], { type: 'image/jpeg' }) } })]]);
  const safe = await readWorkdayDevice(key); assertPrivate(safe); assertPrivate(await rawRecord(key));
  assert.equal(safe.pending[0].id, unsafe.id); assert.equal(safe.pending[0].recordedAt, unsafe.recordedAt);
  assert.equal(safe.pending[0].expectedRevision, unsafe.expectedRevision); assert.equal(safe.day.revision, 3);
  assert.equal(safe.privacyHolds[0].eventId, unsafe.id);
  let calls = 0;
  await assert.rejects(syncDeviceWorkday(key, { upload: () => calls++, event: () => calls++ }), /office reconciliation/);
  assert.equal(calls, 0); assert.equal((await readWorkdayDevice(key)).pending.length, 1);
  assert.equal(await (await readWorkdayDevice(key)).photos[id('9')].text(), 'proof');
});

test('pending token and timestamp slots cannot carry contact data through the device allowlist', () => {
  const unsafe = event('save_note', { taskId: '4195550109', notes: 'Gate latched.' });
  unsafe.recordedAt = email;
  const safe = technicianDeviceRecord(record({ pending: [unsafe] }));
  assertPrivate(safe);
  assert.equal(safe.pending[0].body.taskId, undefined);
  assert.equal(safe.pending[0].recordedAt, undefined);
  assert.equal(safe.privacyHolds[0].eventId, unsafe.id);
});

test('new device commands are private before first persistence and never acquire a legacy retry hold', async () => {
  await updateWorkdayDevice(key, () => record());
  const saved = await commitDeviceEvent(key, 'save_note', { taskId: 'task', notes: `Latch gate. Call ${phone}. Email ${email}. Balance $95.`, billing: 'private-finance-value' }, { now });
  assertPrivate(saved); assertPrivate(await rawRecord(key)); assert.equal(saved.pending.length, 1);
  assert.equal(saved.privacyHolds.length, 0); assert.equal(saved.day.stops[0].tasks[0].notes, saved.pending[0].body.notes);
  assert.equal(saved.pending[0].body.taskId, 'task'); assert.ok(saved.pending[0].body.notes.includes('Latch gate.'));
  const image = new Blob(['gate evidence'], { type: 'image/jpeg' });
  const proofSaved = await commitDeviceEvent(key, 'add_photo', { taskId: 'task', photoId: id('9'), purpose: 'gate' }, { now, photo: image });
  assert.equal(proofSaved.day.stops[0].tasks[0].photos[0].id, id('9'), 'numeric UUID tails are proof IDs, not phone numbers');
  assert.equal(await proofSaved.photos[id('9')].text(), 'gate evidence');
});

test('generic technician departure clearance cannot override authoritative server payment checks', () => {
  const server = day(); server.shift.status = 'loading'; server.shift.prechecks = Object.fromEntries(PRECHECKS.map(([name]) => [name, true]));
  const command = event('confirm_load', { items: [] });
  assert.equal(applyWorkdayEvent(technicianWorkday(server), command, { now }).shift.status, 'loaded');
  server.paymentStatus = 'failed'; server.departureReady = true;
  assert.equal(technicianWorkday(server).departureReady, false);
  assert.throws(() => applyWorkdayEvent(server, command, { now }), /Departure requires office review/);
  assert.throws(() => applyWorkdayEvent(technicianWorkday(server), command, { now }), /Departure requires office review/);
});
