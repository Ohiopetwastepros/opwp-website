import { scrypt, timingSafeEqual } from 'node:crypto';
import {foodOptionalIntakeEnabled} from './food-customer-intake.mjs';
import { foodPasswordValid } from './dog-food-password.mjs';

export const FOOD_SESSION_COOKIE = '__Host-opwp-food';
export class FoodAccountError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const enc = new TextEncoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export async function foodTokenHash(value) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(value))).toString('hex');
}
export function foodEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FoodAccountError('Enter a valid email address.');
  return email;
}
function passwordValid(password) {
  if (!foodPasswordValid(password)) throw new FoodAccountError('Use at least 8 characters, including one capital letter and one special character (up to 256 bytes).');
}
function derive(password, salt) {
  // OWASP scrypt minimum: 16 MiB, N=2^14, r=8, p=5. Supported natively by workerd.
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 24 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashFoodPassword(password) {
  passwordValid(password);
  const salt = token();
  return `scrypt:16384:8:5:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyFoodPassword(password, hash) {
  if (typeof password !== 'string' || enc.encode(password).length > 256) return false;
  const parts = String(hash || '').split(':');
  if (parts.length !== 6 || parts.slice(0, 4).join(':') !== 'scrypt:16384:8:5' || !/^[a-f0-9]{64}$/.test(parts[5]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[4])) return false;
  return timingSafeEqual(await derive(password, parts[4]), Buffer.from(parts[5], 'hex'));
}
export function foodCookie(value, maxAge = 7 * 86400) {
  return `${FOOD_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function readFoodCookie(headers) {
  const raw = (headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${FOOD_SESSION_COOKIE}=`))?.slice(FOOD_SESSION_COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
}
export async function foodAccountSession(db, headers, now = nowSeconds()) {
  if (!db) return null;
  const raw = readFoodCookie(headers);
  if (!raw) return null;
  const row = await db.prepare(`SELECT a.id,a.customer_id,a.email,a.auth_version FROM dog_food_account_sessions s
    JOIN dog_food_accounts a ON a.id=s.account_id AND a.auth_version=s.auth_version
    JOIN dog_food_customers c ON c.id=a.customer_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.created_at<=? AND s.expires_at>?
      AND s.expires_at-s.created_at<=604800 AND c.deleted_at IS NULL AND c.status='active'`).bind(await foodTokenHash(raw), now, now).first();
  return row || null;
}
async function issueSession(db, account, now) {
  const raw = token();
  const issued=await db.prepare(`INSERT INTO dog_food_account_sessions(token_hash,account_id,auth_version,created_at,expires_at)
    SELECT ?,a.id,a.auth_version,?,? FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id
    WHERE a.id=? AND a.auth_version=? AND c.status='active' AND c.deleted_at IS NULL RETURNING account_id`).bind(await foodTokenHash(raw), now, now + 604800, account.id, account.auth_version).first();
  if(!issued)throw new FoodAccountError('Please sign in again or contact the office about your account.',401);
  return { sessionToken: raw };
}
export async function beginFoodEmail(db, { email: input, kind, origin, send, customerId=null }, now = nowSeconds()) {
  const email = foodEmail(input);
  if (!['verify', 'reset'].includes(kind) || new URL(origin).protocol !== 'https:') throw new FoodAccountError('Account service is unavailable.', 503);
  const account = await db.prepare('SELECT id,customer_id,auth_version FROM dog_food_accounts WHERE email=?').bind(email).first();
  if(customerId){
    if(!await foodOptionalIntakeEnabled(db))throw new FoodAccountError('The invitation update awaits its approved migration.',503);
    const matches=(await db.prepare('SELECT id,status,deleted_at FROM dog_food_customers WHERE lower(email)=? LIMIT 3').bind(email).all()).results||[];
    if(matches.length!==1||matches[0].id!==customerId||matches[0].status!=='active'||matches[0].deleted_at||account&&account.customer_id!==customerId)throw new FoodAccountError('The customer identity changed. Ask the office to review this invitation.',409);
  }
  const eligible = kind === 'reset' ? Boolean(account) : !account;
  const raw = token(), hash = await foodTokenHash(raw), temporaryPassword = 'Df!' + token().slice(0,20);
  const temporaryHash = kind === 'verify' ? await hashFoodPassword(temporaryPassword) : null;
  if (eligible) await db.batch([
    db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE email=? AND kind=? AND used_at IS NULL').bind(now, email, kind),
    customerId?db.prepare('INSERT INTO dog_food_account_tokens(token_hash,email,kind,temporary_password_hash,auth_version,expires_at,customer_id) VALUES (?,?,?,?,?,?,?)').bind(hash,email,kind,temporaryHash,account?.auth_version??null,now+1800,customerId):db.prepare('INSERT INTO dog_food_account_tokens(token_hash,email,kind,temporary_password_hash,auth_version,expires_at) VALUES (?,?,?,?,?,?)').bind(hash, email, kind, temporaryHash, account?.auth_version ?? null, now + 1800),
  ]);
  try {
    // Every email request has the same provider path and generic API response.
    const text = !eligible ? `An account-access request was received for this email. Visit ${origin}/dog-food/account/ to sign in, create an account or request a password reset. No account or password was changed.`
      : kind === 'verify' ? `Welcome to Extreme Dog Fuel!\n\nSign in at ${origin}/dog-food/account/\nEmail: ${email}\nTemporary password: ${temporaryPassword}\n\nThis password expires in 30 minutes and can be used once. You must choose your own password before accessing orders or making changes. If it expires, request another signup email. Your Sweep & Go login remains separate.`
      : `Reset your password within 30 minutes:\n\n${origin}/dog-food/account/#reset=${raw}\n\nThis link can be used once. Resetting your password signs out your existing sessions.`;
    await send({ to: email, subject: kind === 'verify' ? 'Your Extreme Dog Fuel account access' : 'Your Extreme Dog Fuel password request',
      text: `${text}\n\nIf you did not request this, ignore this email. Ohio Pet Waste Pros will never ask for your password by text.`, idempotencyKey: `food-account-${hash}` });
  } catch {
    await db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE token_hash=?').bind(now, hash).run();
    throw new FoodAccountError('Account emails are temporarily unavailable. Please try again later or contact the office.', 503);
  }
  return { message: 'If eligible, an email will arrive shortly. Already registered? Sign in or reset your password.' };
}
export async function redeemFoodEmail(db, { token: raw, password, passwordConfirm }, now = nowSeconds()) {
  passwordValid(password);
  if (typeof passwordConfirm!=='string'||passwordConfirm!==password) throw new FoodAccountError('Both passwords must match.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(raw || ''))) throw new FoodAccountError('This link is invalid or expired. Request a new one.');
  const hash = await foodTokenHash(raw);
  const challenge = await db.prepare('SELECT * FROM dog_food_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(hash, now).first();
  if (!challenge) throw new FoodAccountError('This link is invalid or expired. Request a new one.');
  const passwordHash = await hashFoodPassword(password);
  let account = await db.prepare('SELECT id,customer_id,auth_version FROM dog_food_accounts WHERE email=?').bind(challenge.email).first();
  if (challenge.kind === 'reset') {
    if (!account || account.auth_version !== challenge.auth_version) throw new FoodAccountError('This link is invalid or expired. Request a new one.');
    const result = await db.batch([
      db.prepare(`UPDATE dog_food_accounts SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND auth_version=?
        AND EXISTS(SELECT 1 FROM dog_food_customers c WHERE c.id=dog_food_accounts.customer_id AND c.status='active' AND c.deleted_at IS NULL)
        AND EXISTS(SELECT 1 FROM dog_food_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?) RETURNING id`).bind(passwordHash, account.id, challenge.auth_version, hash, now),
      db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash),
      db.prepare('UPDATE dog_food_account_sessions SET revoked_at=? WHERE account_id=? AND auth_version<=? AND revoked_at IS NULL').bind(now, account.id, challenge.auth_version),
    ]);
    if (!result[0].results?.length) throw new FoodAccountError('This link has already been used.');
    account.auth_version += 1;
  } else {
    if (account) throw new FoodAccountError('This email already has an account. Sign in or reset your password.');
    const matches = (await db.prepare('SELECT id,deleted_at,status FROM dog_food_customers WHERE lower(email)=? LIMIT 3').bind(challenge.email).all()).results || [];
    if (matches.length > 1 || matches.some(c => c.deleted_at || c.status !== 'active')) throw new FoodAccountError('Please contact the office to link this email to your delivery profile.', 409);
    if(challenge.customer_id&&(matches.length!==1||matches[0].id!==challenge.customer_id))throw new FoodAccountError('This invitation no longer matches the customer profile. Contact the office.',409);
    const customerId = challenge.customer_id || matches[0]?.id || crypto.randomUUID(), accountId = crypto.randomUUID();
    const statements = [];
    if (!matches.length) statements.push(db.prepare(`INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,customer_type)
      SELECT ?,'','',?,'','on_demand' WHERE EXISTS(SELECT 1 FROM dog_food_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?)`).bind(customerId, challenge.email, hash, now));
    statements.push(db.prepare(`INSERT INTO dog_food_accounts(id,email,customer_id,password_hash)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM dog_food_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?)
      AND EXISTS(SELECT 1 FROM dog_food_customers WHERE id=? AND lower(email)=? AND status='active' AND deleted_at IS NULL)`).bind(accountId, challenge.email, customerId, passwordHash, hash, now,customerId,challenge.email));
    statements.push(db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash));
    await db.batch(statements);
    account = await db.prepare('SELECT id,customer_id,auth_version FROM dog_food_accounts WHERE id=?').bind(accountId).first();
    if (!account) throw new FoodAccountError('This link has already been used.');
  }
  return issueSession(db, account, now);
}
export async function loginFoodAccount(db, { email: input, password }, now = nowSeconds()) {
  const email = foodEmail(input);
  const account = await db.prepare(`SELECT a.* FROM dog_food_accounts a JOIN dog_food_customers c ON c.id=a.customer_id
    WHERE a.email=? AND c.deleted_at IS NULL AND c.status='active'`).bind(email).first();
  // A fixed, valid dummy hash equalizes expensive work for unknown email addresses.
  const dummy = `scrypt:16384:8:5:${'A'.repeat(43)}:${'0'.repeat(64)}`;
  const temporary = !account ? await db.prepare(`SELECT * FROM dog_food_account_tokens WHERE email=? AND kind='verify'
    AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1`).bind(email, now).first() : null;
  const ok = await verifyFoodPassword(password, account?.password_hash || temporary?.temporary_password_hash || dummy);
  if (ok && temporary && !account) {
    const activationToken = token();
    const results = await db.batch([
      temporary.customer_id?db.prepare(`INSERT INTO dog_food_account_tokens(token_hash,email,kind,expires_at,customer_id)
        SELECT ?,email,'activate',?,customer_id FROM dog_food_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING token_hash`).bind(await foodTokenHash(activationToken),now+600,temporary.token_hash,now):db.prepare(`INSERT INTO dog_food_account_tokens(token_hash,email,kind,expires_at)
        SELECT ?,email,'activate',? FROM dog_food_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING token_hash`).bind(await foodTokenHash(activationToken), now + 600, temporary.token_hash, now),
      db.prepare('UPDATE dog_food_account_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, temporary.token_hash),
    ]);
    if (!results[0].results?.length) throw new FoodAccountError('The temporary password has expired or already been used. Request another signup email.', 401);
    return { passwordChangeRequired: true, setupToken: activationToken, message: 'Email verified. Choose your own password to finish signing in.' };
  }
  if (!ok || !account) throw new FoodAccountError('Email or password is incorrect.', 401);
  return issueSession(db, account, now);
}
export async function logoutFoodAccount(db, headers, now = nowSeconds()) {
  const raw = readFoodCookie(headers);
  if (raw) await db.prepare('UPDATE dog_food_account_sessions SET revoked_at=? WHERE token_hash=?').bind(now, await foodTokenHash(raw)).run();
  return { loggedOut: true };
}
