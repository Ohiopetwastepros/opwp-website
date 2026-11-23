import { TOTP, Secret } from 'otpauth';
import { localPreviewPaymentOrigin } from './local-preview-payments.mjs';

export const LOCAL_PREVIEW_ADMIN_EMAIL = 'preview.admin@example.test';
export function localPreviewAdminCode(env, now = Date.now()) {
  if (!localPreviewPaymentOrigin(env) || env.ADMIN_USERNAME !== LOCAL_PREVIEW_ADMIN_EMAIL || !/^[A-Z2-7]{16,64}$/.test(env.LOCAL_PREVIEW_ADMIN_TOTP_SECRET || '')) throw new Error('Local preview MFA is not configured.');
  return new TOTP({ issuer: 'Ohio Pet Waste Pros', label: LOCAL_PREVIEW_ADMIN_EMAIL, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(env.LOCAL_PREVIEW_ADMIN_TOTP_SECRET) }).generate({ timestamp: now });
}
export const localPreviewMfaCode = localPreviewAdminCode;

export async function localPreviewAdminSeed(env, now = Date.now()) {
  localPreviewAdminCode(env, now);
  if (typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 8 || typeof env.ADMIN_SESSION_SECRET !== 'string' || env.ADMIN_SESSION_SECRET.length < 32) throw new Error('Use preview-only sign-in credentials.');
  let bytes;
  try { bytes = Uint8Array.from(atob(env.ADMIN_MFA_ENCRYPTION_KEY), char => char.charCodeAt(0)); } catch { throw new Error('Use a local MFA encryption key.'); }
  if (bytes.length !== 32) throw new Error('Use a local MFA encryption key.');
  const encoder = new TextEncoder(), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(LOCAL_PREVIEW_ADMIN_EMAIL) }, key, encoder.encode(env.LOCAL_PREVIEW_ADMIN_TOTP_SECRET)));
  const cipher = `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...encrypted))}`;
  const quote = text => `'${text.replaceAll("'", "''")}'`;
  return { username: LOCAL_PREVIEW_ADMIN_EMAIL, sql: `INSERT INTO admin_mfa_accounts(email,secret_cipher,version,last_counter,enabled_at) VALUES (${quote(LOCAL_PREVIEW_ADMIN_EMAIL)},${quote(cipher)},1,-1,${Math.floor(now / 1000)}) ON CONFLICT(email) DO NOTHING;` };
}
