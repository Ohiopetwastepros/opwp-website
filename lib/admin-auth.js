import { getRuntimeEnv } from './cloudflare';
import { MFA_SESSION_COOKIE, readMfaCookie, verifyMfaSession } from './admin-mfa.mjs';

export const ADMIN_SESSION_COOKIE = MFA_SESSION_COOKIE;

export async function verifyAdminRequest(headers) {
  const env = getRuntimeEnv();
  // Password-only cookies and Basic authorization never establish backend access.
  return verifyMfaSession(env, readMfaCookie(headers, MFA_SESSION_COOKIE));
}
