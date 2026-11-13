import { getDb } from '@/lib/db';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { applicationConfig } from '@/lib/app-config';
import { readBoundedJson, verifyTurnstile } from '@/lib/public-api-security';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { transactionalEmailConfig, sendTransactionalEmail } from '@/lib/submission-notifications';
import { FoodAccountError, foodCookie, foodAccountSession, foodEmail, foodTokenHash, beginFoodEmail, redeemFoodEmail, loginFoodAccount, logoutFoodAccount } from '@/lib/dog-food-account.mjs';
import { readFoodPortal } from '@/lib/dog-food-portal';
import { stripeConfigured } from '@/lib/stripe';
import {linkStaffFoodPortalProfile} from '@/lib/food-customer-hub.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body, status = 200, cookie = null) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
export async function GET(request) {
  const rate = await checkRateLimit(request, { scope: 'food_portal_read', limit: 60, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  try {
    const db = getDb(), env = getRuntimeEnv();
    if (!db) return reply({ error: 'Account service is unavailable.' }, 503);
    return reply({ ok: true, ...await readFoodPortal(db, await foodAccountSession(db, request.headers),env), paymentConfigured: stripeConfigured(env), emailConfigured: transactionalEmailConfig(env).configured });
  } catch { return reply({ error: 'Account service is temporarily unavailable.' }, 503); }
}
export async function POST(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'Cross-site requests are not allowed.' }, 403);
  const ipRate = await checkRateLimit(request, { scope: 'food_account_auth', limit: 12, windowSeconds: 900, failClosed: true });
  if (!ipRate.allowed) return rateLimitResponse(ipRate);
  const secured = await readBoundedJson(request, 4096);
  if (secured.response) return secured.response;
  try {
    const db = getDb(), env = getRuntimeEnv(), body = secured.body;
    if (!db) throw new FoodAccountError('Account service is unavailable.', 503);
    if (body.action === 'logout') { await logoutFoodAccount(db, request.headers); return reply({ ok: true }, 200, foodCookie('', 0)); }
    if (!['signup','forgot','login','redeem'].includes(body.action)) throw new FoodAccountError('Choose a valid account action.');
    const verification = await verifyTurnstile(request, body.turnstileToken, 'dog_food_account');
    if (!verification.ok) throw new FoodAccountError(verification.unavailable ? 'Verification is unavailable. Please try again.' : 'Complete the verification before continuing.', verification.unavailable ? 503 : 403);
    // Hashing and outbound email have a global budget in addition to IP and email budgets.
    const rate = await db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at)
      VALUES ('food_account_budget','global',?,1,datetime(?,'unixepoch')) ON CONFLICT(scope,client_key,window_start)
      DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(Math.floor(Date.now() / 60000) * 60, Math.floor(Date.now() / 1000) + 120).first();
    if (!Number.isSafeInteger(rate?.request_count) || rate.request_count < 1) throw new FoodAccountError('Account service is temporarily unavailable.', 503);
    if (rate.request_count > 30) throw new FoodAccountError('Account service is busy. Please try again shortly.', 429);
    if (body.email) {
      const key = await foodTokenHash(foodEmail(body.email)), window = Math.floor(Date.now() / 900000) * 900;
      const emailRate = await db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at)
        VALUES ('food_account_email',?, ?,1,datetime(?,'unixepoch')) ON CONFLICT(scope,client_key,window_start)
        DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(key, window, window + 1800).first();
      if (!Number.isSafeInteger(emailRate?.request_count) || emailRate.request_count < 1) throw new FoodAccountError('Account service is temporarily unavailable.', 503);
      if (emailRate.request_count > 6) throw new FoodAccountError('Please wait before trying this email again.', 429);
    }
    let result;
    if (['signup','forgot'].includes(body.action)) {
      if (!transactionalEmailConfig(env).configured) throw new FoodAccountError('Account emails are temporarily unavailable. Contact the office.', 503);
      result = await beginFoodEmail(db, { email: body.email, kind: body.action === 'signup' ? 'verify' : 'reset', origin: applicationConfig(env).siteOrigin, send: message => sendTransactionalEmail(env, message) });
    } else if (body.action === 'redeem') result = await redeemFoodEmail(db, body);
    else result = await loginFoodAccount(db, body);
    if(result.sessionToken)await linkStaffFoodPortalProfile(db,result.sessionToken);
    return reply({ ok: true, message: result.message || 'Signed in.', ...(result.passwordChangeRequired ? { passwordChangeRequired: true, setupToken: result.setupToken } : {}) }, 200, result.sessionToken ? foodCookie(result.sessionToken) : null);
  } catch (error) { return reply({ ok: false, error: error instanceof FoodAccountError ? error.message : 'Account service is temporarily unavailable.' }, error instanceof FoodAccountError ? error.status : 503); }
}
