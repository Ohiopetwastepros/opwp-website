import { getRuntimeEnv } from "./cloudflare";

export const ADMIN_SESSION_COOKIE = "opwp_admin_session";
const SESSION_AUDIENCE = "opwp-admin";
const SESSION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function toBase64Url(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function sessionSecret(env) {
  return env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "";
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function cookieValue(headers, name) {
  const cookies = headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return "";
}

function basicCredentials(headers) {
  const authorization = headers.get("authorization") ?? "";
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export async function verifyAdminCredentials(username, password) {
  const env = getRuntimeEnv();
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return { authorized: false };
  const [actualUser, expectedUser, actualPassword, expectedPassword] = await Promise.all([
    digest(username), digest(env.ADMIN_USERNAME), digest(password), digest(env.ADMIN_PASSWORD),
  ]);
  const authorized = constantTimeEqual(actualUser, expectedUser) && constantTimeEqual(actualPassword, expectedPassword);
  return authorized ? { authorized: true, email: String(username), method: "credentials" } : { authorized: false };
}

export async function createAdminSession(email) {
  const env = getRuntimeEnv();
  const secret = sessionSecret(env);
  if (!secret) throw new Error("Admin session security is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const payload = toBase64Url(encoder.encode(JSON.stringify({ aud: SESSION_AUDIENCE, sub: String(email), iat: now, exp: now + SESSION_SECONDS })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

async function verifySession(token) {
  const env = getRuntimeEnv();
  const secret = sessionSecret(env);
  if (!token || !secret) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return null;
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), encoder.encode(payload));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (claims.aud !== SESSION_AUDIENCE || !claims.sub || Number(claims.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { authorized: true, email: String(claims.sub), method: "session" };
  } catch {
    return null;
  }
}

export function adminSessionCookie(token, requestUrl) {
  const secure = new URL(requestUrl).protocol === "https:";
  return { name: ADMIN_SESSION_COOKIE, value: token, httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS };
}

export function expiredAdminSessionCookie(requestUrl) {
  return { ...adminSessionCookie("", requestUrl), maxAge: 0 };
}

export async function loginFingerprint(value) {
  const env = getRuntimeEnv();
  const bytes = await digest(`${sessionSecret(env)}:${String(value || "unknown")}`);
  return toBase64Url(bytes);
}

export async function verifyAdminRequest(headers) {
  const env = getRuntimeEnv();
  const host = headers.get("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (isLocal && env.ADMIN_DEV_BYPASS === "true") return { authorized: true, email: "local-admin@opwp", method: "development" };

  const session = await verifySession(cookieValue(headers, ADMIN_SESSION_COOKIE));
  if (session) return session;

  const credentials = basicCredentials(headers);
  return credentials ? verifyAdminCredentials(credentials.username, credentials.password) : { authorized: false };
}
