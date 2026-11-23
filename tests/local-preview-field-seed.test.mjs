import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { createLocalPreviewFieldSeed, LOCAL_PREVIEW_FIELD_SECRET } from '../scripts/local-preview-field-seed.mjs';
import { operatingDate } from '../lib/field-policy.mjs';
import { getWorkday, saveWorkdayEvent } from '../lib/field-workday-store.mjs';
import { PRECHECKS } from '../lib/field-workday-model.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(new URL('../tmp/test-migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(new URL(`../tmp/test-migrations/${file}`, import.meta.url), 'utf8'));
  const seed = createLocalPreviewFieldSeed({ today: operatingDate() }); sql.exec(seed.sql);
  const db = {
    prepare(query) { return { bind(...args) { return { query, args, async first() { return sql.prepare(query).get(...args) || null; }, async all() { return { results: sql.prepare(query).all(...args) }; }, async run() { return sql.prepare(query).run(...args); } }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const results = statements.map(row => ({ results: sql.prepare(row.query).all(...row.args) })); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
  };
  return { sql, db, seed };
}
test('local field seed creates two real PIN credentials, separate assigned native routes and twelve fake properties', async () => {
  const f = fixture();
  assert.equal(f.seed.manifest.techs.length, 2); assert.equal(f.seed.manifest.stops.length, 12);
  assert.ok(f.seed.manifest.taskCount > 12);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM route_partner_route_plans WHERE id LIKE 'local-field-%'").get().n, 2);
  for (const technician of f.seed.manifest.techs) {
    const credential = f.sql.prepare('SELECT * FROM route_partner_field_credentials WHERE member_id=?').get(technician.id);
    assert.equal(credential.pin_hash, createHmac('sha256', LOCAL_PREVIEW_FIELD_SECRET).update(`${credential.pin_salt}:${technician.pin}`).digest('base64url'));
    const result = await getWorkday(f.db, { id: technician.id, organizationId: 'org-opwp', name: technician.name, email: technician.email });
    assert.equal(result.day.stops.length, 6); assert.equal(result.day.date, operatingDate());
    assert.equal(result.day.memberId, technician.id); assert.equal(result.day.paymentStatus, 'not_required');
    assert.ok(result.day.stops.every(stop => ['clear', 'unknown'].includes(stop.safety) && stop.hasGate && stop.dogCount >= 1));
    assert.equal(result.day.stops.filter(stop => stop.safety === 'unknown').length, technician.id === 'local-tech-1' ? 1 : 0);
    assert.ok(result.day.stops.every(stop => stop.instructions.includes('Dogs:') && stop.instructions.includes('Persistent:') && stop.instructions.includes('Today:')));
    assert.ok(result.day.stops.flatMap(stop => stop.tasks).every(task => task.source.provider === 'opwp'));
    const serialized = JSON.stringify(result.day);
    assert.doesNotMatch(serialized, /(?:billingZip|totalCents|bookRateCents|last4|profileId|@local-preview\.example\.test|\+1419555)/);
  }
  f.sql.exec(f.seed.sql);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM route_partner_tasks WHERE id LIKE 'local-field-%'").get().n, f.seed.manifest.taskCount);
});

test('scheduled food uses native inventory, fake settled order and required delivery proof without duplicate completion', async () => {
  const f = fixture(), tech = f.seed.manifest.techs[1], member = { id: tech.id, organizationId: 'org-opwp', name: tech.name, email: tech.email };
  await getWorkday(f.db, member); let clock = Date.now();
  const day = () => JSON.parse(f.sql.prepare('SELECT state_json FROM field_workdays WHERE shift_id=?').get(tech.shiftId).state_json);
  const action = async (type, body = {}) => { clock += 50; return saveWorkdayEvent(f.db, member, { id: crypto.randomUUID(), shiftId: tech.shiftId, expectedRevision: day().revision, type, body, recordedAt: new Date(clock).toISOString() }, clock, { notificationsEnabled: false }); };
  await action('clock_in', { mileage: 18000, vehicle: 'company' });
  for (const [key] of PRECHECKS) await action('check_item', { key, checked: true });
  await assert.rejects(action('confirm_load', { items: [] }), /Count every product/);
  await action('confirm_load', { items: [{ productId: 'local-food-blue-40', quantity: 1 }] }); await action('start_route');
  const stop = day().stops.find(row => row.tasks.some(task => task.serviceId === 'food')), task = stop.tasks.find(row => row.serviceId === 'food');
  assert.equal(task.quantity, 1); assert.deepEqual(task.deliveryItems, [{ productId: 'local-food-blue-40', quantity: 1 }]);
  await action('arrive', { stopId: stop.id }); await action('start_task', { taskId: task.id });
  await assert.rejects(action('complete_task', { taskId: task.id, secured: true, units: 1 }), /required service or delivery proof/);
  const proofId = crypto.randomUUID();
  f.sql.prepare('INSERT INTO field_workday_proofs(id,shift_id,task_id,member_id,purpose,captured_at,digest,byte_size,object_key,uploaded) VALUES (?,?,?,?,?,?,?,?,?,1)').run(proofId, tech.shiftId, task.id, tech.id, 'delivery', new Date(clock + 50).toISOString(), 'local-food-proof', 4, `local-preview/${proofId}.jpg`);
  f.sql.prepare('INSERT INTO route_partner_field_proofs(id,organization_id,task_id,object_key,content_type,byte_size,uploaded_by,storage_provider) VALUES (?,?,?,?,?,?,?,?)').run(proofId, 'org-opwp', task.id, `local-preview/${proofId}.jpg`, 'image/jpeg', 4, tech.id, 'r2');
  await action('add_photo', { taskId: task.id, photoId: proofId, purpose: 'delivery' });
  clock += 50;
  const event = { id: crypto.randomUUID(), shiftId: tech.shiftId, expectedRevision: day().revision, type: 'complete_task', body: { taskId: task.id, secured: true, units: 1 }, recordedAt: new Date(clock).toISOString() };
  await saveWorkdayEvent(f.db, member, event, clock, { notificationsEnabled: false });
  await saveWorkdayEvent(f.db, member, event, clock, { notificationsEnabled: false });
  assert.equal(day().inventory[0].delivered, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_deliveries WHERE status='delivered'").get().n, 1);
  assert.equal(f.sql.prepare("SELECT provider FROM dog_food_payments").get().provider, 'fake');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM field_workday_messages WHERE status='queued'").get().n, 0);
});

test('unsafe dog source cannot start yard work without office clearance', async () => {
  const f = fixture(), tech = f.seed.manifest.techs[0], member = { id: tech.id, organizationId: 'org-opwp', name: tech.name, email: tech.email };
  await getWorkday(f.db, member); let clock = Date.now();
  const day = () => JSON.parse(f.sql.prepare('SELECT state_json FROM field_workdays WHERE shift_id=?').get(tech.shiftId).state_json);
  const action = async (type, body = {}) => { clock += 50; return saveWorkdayEvent(f.db, member, { id: crypto.randomUUID(), shiftId: tech.shiftId, expectedRevision: day().revision, type, body, recordedAt: new Date(clock).toISOString() }, clock, { notificationsEnabled: false }); };
  await action('clock_in', { mileage: 12000, vehicle: 'company' });
  for (const [key] of PRECHECKS) await action('check_item', { key, checked: true });
  await action('confirm_load', { items: [] }); await action('start_route');
  const stop = day().stops.find(row => row.safety === 'unknown');
  assert.match(stop.instructions, /Unsafe dog reported/);
  await action('arrive', { stopId: stop.id });
  await assert.rejects(action('start_task', { taskId: stop.tasks[0].id, safe: true }), /Office clearance is missing or expired/);
});

test('seeded native route supports clock/load/departure, notes and proof completion, plus a reasoned skipped visit', async () => {
  const f = fixture(), tech = f.seed.manifest.techs[0], member = { id: tech.id, organizationId: 'org-opwp', name: tech.name, email: tech.email };
  await getWorkday(f.db, member); let clock = Date.now();
  const day = () => JSON.parse(f.sql.prepare('SELECT state_json FROM field_workdays WHERE shift_id=?').get(tech.shiftId).state_json);
  const action = async (type, body = {}) => { clock += 50; return saveWorkdayEvent(f.db, member, { id: crypto.randomUUID(), shiftId: tech.shiftId, expectedRevision: day().revision, type, body, recordedAt: new Date(clock).toISOString() }, clock, { notificationsEnabled: false }); };
  await action('clock_in', { mileage: 12000, vehicle: 'company', notes: 'Fake local preview odometer.' });
  for (const [key] of PRECHECKS) await action('check_item', { key, checked: true });
  await action('confirm_load', { items: [] }); await action('start_route');
  const stop = day().stops[0], task = stop.tasks[0];
  await action('arrive', { stopId: stop.id }); await action('save_note', { taskId: task.id, notes: 'Preview: checked side yard and latched gate.' });
  await action('start_task', { taskId: task.id, safe: true });
  const proofId = crypto.randomUUID(), capturedAt = new Date(clock + 50).toISOString();
  f.sql.prepare('INSERT INTO field_workday_proofs(id,shift_id,task_id,member_id,purpose,captured_at,digest,byte_size,object_key,uploaded) VALUES (?,?,?,?,?,?,?,?,?,1)').run(proofId, tech.shiftId, task.id, tech.id, 'gate', capturedAt, 'local-fixture-digest', 4, `local-preview/${proofId}.jpg`);
  await action('add_photo', { taskId: task.id, photoId: proofId, purpose: 'gate' });
  await action('complete_task', { taskId: task.id, secured: true, units: task.quantity });
  assert.equal(day().stops[0].tasks[0].status, 'completed'); assert.match(day().stops[0].tasks[0].notes, /latched gate/);
  const second = day().stops[1].tasks[0]; await action('skip_task', { taskId: second.id, reason: 'Locked gate', notes: 'Preview exception: gate locked; no customer contacted.', confirm: true });
  assert.equal(day().stops[1].tasks[0].status, 'skipped'); assert.equal(day().issues.at(-1).reason, 'Locked gate');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM field_workday_messages WHERE status='queued'").get().n, 0);
  assert.equal(f.sql.prepare('SELECT crm_completion_status FROM route_partner_tasks WHERE id=?').get(task.id).crm_completion_status, 'not_required');
});
