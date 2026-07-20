import { getRuntimeEnv } from "./cloudflare";

export const FIELD_SESSION_COOKIE = "opwp_field_session";
export const OFFICE_SESSION_COOKIE = "opwp_office_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

function secret() {
  const env = getRuntimeEnv();
  return String(env.FIELD_AUTH_SECRET || env.ADMIN_PASSWORD || "");
}

function base64Url(bytes) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function cookieValue(headers, name) {
  for (const part of String(headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

async function sha256(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value)))));
}

async function pinKey(usages) {
  return crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function pinDigest(pin, salt) {
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", await pinKey(["sign"]), encoder.encode(`${salt}:${pin}`))));
}

async function verifyPin(pin, salt, storedHash) {
  try { return crypto.subtle.verify("HMAC", await pinKey(["verify"]), fromBase64Url(storedHash), encoder.encode(`${salt}:${pin}`)); }
  catch { return false; }
}

export async function createFieldCredential(db, memberId, pin) {
  if (!/^\d{6}$/.test(String(pin))) throw new Error("Technician PINs must contain exactly six digits.");
  if (!secret()) throw new Error("Field authentication security is not configured.");
  const saltBytes = new Uint8Array(18);
  crypto.getRandomValues(saltBytes);
  const salt = base64Url(saltBytes);
  const hash = await pinDigest(pin, salt);
  await db.prepare(
    `INSERT INTO route_partner_field_credentials (member_id,pin_salt,pin_hash)
     VALUES (?,?,?) ON CONFLICT(member_id) DO UPDATE SET pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,
       failed_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP`
  ).bind(memberId, salt, hash).run();
}

export async function authenticateFieldMember(db, email, pin) {
  const member = await db.prepare(
    `SELECT m.id,m.organization_id,m.email,m.display_name,m.external_employee_id,m.status,
      c.pin_salt,c.pin_hash,c.failed_attempts,c.locked_until
     FROM route_partner_members m JOIN route_partner_field_credentials c ON c.member_id=m.id
     WHERE m.email=? COLLATE NOCASE AND m.role='technician' LIMIT 1`
  ).bind(String(email).trim()).first();
  if (!member || member.status !== "active") return { authorized: false };
  if (member.locked_until && Date.parse(`${String(member.locked_until).replace(" ", "T")}Z`) > Date.now()) return { authorized: false, locked: true };
  const valid = await verifyPin(String(pin), member.pin_salt, member.pin_hash);
  if (!valid) {
    const attempts = Number(member.failed_attempts || 0) + 1;
    await db.prepare(
      `UPDATE route_partner_field_credentials SET failed_attempts=?,locked_until=CASE WHEN ?>=5 THEN datetime('now','+15 minutes') ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE member_id=?`
    ).bind(attempts, attempts, member.id).run();
    return { authorized: false, locked: attempts >= 5 };
  }
  await db.prepare("UPDATE route_partner_field_credentials SET failed_attempts=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE member_id=?").bind(member.id).run();
  return { authorized: true, member: { id: member.id, organizationId: member.organization_id, email: member.email, name: member.display_name || member.email, externalEmployeeId: member.external_employee_id || "" } };
}

export async function authenticateOfficeMember(db, email, pin) {
  const member = await db.prepare(
    `SELECT m.id,m.organization_id,m.email,m.display_name,m.role,m.status,
      c.pin_salt,c.pin_hash,c.failed_attempts,c.locked_until
     FROM route_partner_members m JOIN route_partner_field_credentials c ON c.member_id=m.id
     WHERE m.email=? COLLATE NOCASE AND m.role IN ('manager','dispatcher') LIMIT 1`
  ).bind(String(email).trim()).first();
  if (!member || member.status !== "active") return { authorized: false };
  if (member.locked_until && Date.parse(`${String(member.locked_until).replace(" ", "T")}Z`) > Date.now()) return { authorized: false, locked: true };
  const valid = await verifyPin(String(pin), member.pin_salt, member.pin_hash);
  if (!valid) {
    const attempts = Number(member.failed_attempts || 0) + 1;
    await db.prepare(
      `UPDATE route_partner_field_credentials SET failed_attempts=?,locked_until=CASE WHEN ?>=5 THEN datetime('now','+15 minutes') ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE member_id=?`
    ).bind(attempts, attempts, member.id).run();
    return { authorized: false, locked: attempts >= 5 };
  }
  await db.prepare("UPDATE route_partner_field_credentials SET failed_attempts=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE member_id=?").bind(member.id).run();
  return { authorized: true, member: { id: member.id, organizationId: member.organization_id, email: member.email, name: member.display_name || member.email, role: member.role } };
}

export async function createFieldSession(db, memberId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO route_partner_field_sessions (id,member_id,token_hash,expires_at) VALUES (?,?,?,datetime('now','+7 days'))"
  ).bind(id, memberId, await sha256(token)).run();
  return token;
}

export async function verifyFieldRequest(headers, db) {
  if (!db) return { authorized: false };
  const token = cookieValue(headers, FIELD_SESSION_COOKIE);
  if (!token) return { authorized: false };
  const row = await db.prepare(
    `SELECT s.id AS session_id,m.id,m.organization_id,m.email,m.display_name,m.external_employee_id
     FROM route_partner_field_sessions s JOIN route_partner_members m ON m.id=s.member_id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
       AND m.status='active' AND m.role='technician' LIMIT 1`
  ).bind(await sha256(token)).first();
  if (!row) return { authorized: false };
  return { authorized: true, sessionId: row.session_id, member: { id: row.id, organizationId: row.organization_id, email: row.email, name: row.display_name || row.email, externalEmployeeId: row.external_employee_id || "" } };
}

export async function verifyOfficeRequest(headers, db) {
  if (!db) return { authorized: false };
  const token = cookieValue(headers, OFFICE_SESSION_COOKIE);
  if (!token) return { authorized: false };
  const row = await db.prepare(
    `SELECT s.id AS session_id,m.id,m.organization_id,m.email,m.display_name,m.role
     FROM route_partner_field_sessions s JOIN route_partner_members m ON m.id=s.member_id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
       AND m.status='active' AND m.role IN ('manager','dispatcher') LIMIT 1`
  ).bind(await sha256(token)).first();
  if (!row) return { authorized: false };
  return { authorized: true, sessionId: row.session_id, member: { id: row.id, organizationId: row.organization_id, email: row.email, name: row.display_name || row.email, role: row.role } };
}

export async function revokeFieldSession(headers, db) {
  const token = cookieValue(headers, FIELD_SESSION_COOKIE);
  if (db && token) await db.prepare("UPDATE route_partner_field_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(await sha256(token)).run();
}

export async function revokeOfficeSession(headers, db) {
  const token = cookieValue(headers, OFFICE_SESSION_COOKIE);
  if (db && token) await db.prepare("UPDATE route_partner_field_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(await sha256(token)).run();
}

export function fieldSessionCookie(token, requestUrl) {
  return { name: FIELD_SESSION_COOKIE, value: token, httpOnly: true, secure: new URL(requestUrl).protocol === "https:", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS };
}

export function expiredFieldSessionCookie(requestUrl) {
  return { ...fieldSessionCookie("", requestUrl), maxAge: 0 };
}

export function officeSessionCookie(token, requestUrl) {
  return { name: OFFICE_SESSION_COOKIE, value: token, httpOnly: true, secure: new URL(requestUrl).protocol === "https:", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS };
}

export function expiredOfficeSessionCookie(requestUrl) {
  return { ...officeSessionCookie("", requestUrl), maxAge: 0 };
}
