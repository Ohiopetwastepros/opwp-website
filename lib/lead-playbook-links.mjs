// A review capability identifies a draft. It never substitutes for the admin MFA session.
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export const playbookHash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value)))));
export const playbookEnabled = env => env?.LEAD_PLAYBOOK_ENABLED === 'true';
export class PlaybookError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
function secret(env) {
  if (typeof env.LEAD_PLAYBOOK_LINK_SECRET !== 'string' || env.LEAD_PLAYBOOK_LINK_SECRET.length < 32) throw new PlaybookError('Playbook review links are not configured.', 503);
  return env.LEAD_PLAYBOOK_LINK_SECRET;
}
async function signature(env, row) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret(env)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([row.jti, row.draft_id, row.body_hash, Number(row.expires_at)]))));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function equal(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function createPlaybookLink(db, env, draft, now = Date.now()) {
  if (!playbookEnabled(env)) throw new PlaybookError('The playbook is disabled.', 503);
  secret(env);
  const raw = String(draft.expires_at || '').replace(' ', 'T');
  const expires = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : raw + 'Z');
  if (draft.status !== 'pending' || !Number.isFinite(expires) || expires <= now) throw new PlaybookError('This draft is no longer available.');
  const row = {jti: hex(crypto.getRandomValues(new Uint8Array(24))), draft_id: draft.id, body_hash: await playbookHash(draft.body), expires_at: Math.min(Math.floor(expires / 1000), Math.floor(now / 1000) + 1800)};
  await db.prepare('INSERT INTO lead_playbook_links(jti,draft_id,body_hash,expires_at) VALUES (?,?,?,?)').bind(row.jti, row.draft_id, row.body_hash, row.expires_at).run();
  return `${row.jti}.${await signature(env, row)}`;
}
export async function readPlaybookLink(db, env, token, now = Date.now()) {
  if (!playbookEnabled(env)) throw new PlaybookError('The playbook is disabled.', 503);
  if (typeof token !== 'string' || !/^[a-f0-9]{48}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new PlaybookError('This review link is invalid or expired.', 410);
  const [jti, supplied] = token.split('.');
  const row = await db.prepare('SELECT * FROM lead_playbook_links WHERE jti=?').bind(jti).first();
  if (!row || row.used_at != null || Number(row.expires_at) <= Math.floor(now / 1000) || !equal(supplied, await signature(env, row))) throw new PlaybookError('This review link is invalid or expired.', 410);
  return row;
}
