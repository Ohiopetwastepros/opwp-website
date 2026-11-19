import {headers} from 'next/headers';
import {verifyAdminRequest} from './admin-auth';
import {getRuntimeEnv} from './cloudflare';
import {getDb} from './db';
import {protectJsonRequest} from './public-api-security';
import {checkRateLimit, rateLimitResponse} from './rate-limit';
import {PlaybookError, playbookEnabled} from './lead-playbook-links.mjs';

export const playbookPrivateHeaders = {'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
export const playbookJson = (body, status = 200) => Response.json(body, {status, headers: playbookPrivateHeaders});
export async function authorizePlaybookRequest(request, mutation = false) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return {response: playbookJson({error: 'Admin MFA sign-in required.'}, 401)};
  const env = getRuntimeEnv();
  if (!playbookEnabled(env)) return {response: playbookJson({enabled: false, error: 'The playbook is disabled.'}, 503)};
  if (mutation && (request.headers.get('origin') !== new URL(request.url).origin || !['same-origin', null].includes(request.headers.get('sec-fetch-site')))) return {response: playbookJson({error: 'Cross-site request blocked.'}, 403)};
  let body = {};
  if (mutation) {
    const protection = await protectJsonRequest(request, {scope: `admin_playbook:${auth.email}`, limit: 120, windowSeconds: 3600, maxBytes: 6000, turnstile: false, failClosed: true});
    if (protection.response) return {response: protection.response};
    body = protection.body;
  } else {
    const rate = await checkRateLimit(request, {scope: 'admin_playbook_read', identity: auth.email, limit: 120, windowSeconds: 3600, failClosed: true});
    if (!rate.allowed) return {response: rateLimitResponse(rate)};
  }
  const db = getDb();
  if (!db) return {response: playbookJson({error: 'Playbook storage unavailable.'}, 503)};
  return {auth, env, db, body};
}
export function playbookFailure(error) {
  return playbookJson({error: error instanceof PlaybookError ? error.message : 'The playbook request could not be completed.'}, error instanceof PlaybookError ? error.status : 500);
}
export function playbookId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null; }
