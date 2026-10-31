import { FieldError, operatingDate } from './field-policy.mjs';

export async function executeFieldCommand(db, auth, body, apply) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !/^[a-f0-9-]{36}$/i.test(body.requestId || '') || typeof body.shiftId !== 'string' || body.shiftId.length > 100) throw new FieldError('Refresh the app and submit a valid field action.');
  const shift = await db.prepare('SELECT * FROM route_partner_field_shifts WHERE id=? AND technician_member_id=? AND organization_id=?').bind(body.shiftId,auth.member.id,auth.member.organizationId).first();
  if (!shift) throw new FieldError('This shift is not assigned to your account.',403);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)));
  const hash = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  async function replay() {
    const row = await db.prepare('SELECT * FROM route_partner_field_commands WHERE id=?').bind(body.requestId).first();
    if (!row) return null;
    if (row.member_id !== auth.member.id || row.shift_id !== body.shiftId || row.body_hash !== hash) throw new FieldError('This action identifier has already been used.',409);
    return JSON.parse(row.result);
  }
  const prior = await replay();
  if (prior) return prior;
  if (shift.service_date !== operatingDate() && !(shift.service_date < operatingDate() && shift.status === 'in_progress' && ['end_break','complete_route'].includes(body.action))) throw new FieldError('Work can only be recorded on the scheduled service day. Ask the office to reschedule.');
  const statements = [];
  const buffered = { prepare: sql => db.prepare(sql), batch: async rows => { statements.push(...rows); return []; } };
  const result = await apply(buffered,auth,body);
  if (!statements.length) throw new Error('Field action did not produce a transaction');
  try {
    await db.batch([
      db.prepare('INSERT INTO route_partner_field_commands(id,shift_id,member_id,expected_revision,body_hash,result) VALUES (?,?,?,?,?,?)').bind(body.requestId,shift.id,auth.member.id,shift.revision,hash,JSON.stringify(result)),
      ...statements,
    ]);
  } catch (error) {
    const saved = await replay();
    if (saved) return saved;
    if (/FIELD_REVISION_CONFLICT/.test(error.message)) throw new FieldError('This shift changed on another device. Refresh before trying again.',409);
    throw error;
  }
  return result;
}
