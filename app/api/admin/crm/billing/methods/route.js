import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { PaymentsProviderError } from '@/lib/payments-provider.mjs';
import { assertNoPaymentSecrets, crmBillingEnabled } from '@/lib/crm-billing-security.mjs';
import { billingPaymentsProvider } from '@/lib/crm-billing-providers.mjs';
import { BillingStoreError, createHostedBillingMethod } from '@/lib/crm-billing-store.mjs';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
export async function POST(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return reply({ ok: false, error: 'Administrator sign-in is required.' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ ok: false, error: 'Cross-site requests are not allowed.' }, 403);
  const env = getRuntimeEnv();
  if (!crmBillingEnabled(env)) return reply({ ok: false, error: 'UAT payment method setup is awaiting approval.' }, 503);
  const rate = await checkRateLimit(request, { scope: 'crm_billing_hosted_profile', identity: auth.email, limit: 10, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  let body;
  try {
    body = await readBoundedProviderJson(request, 8 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).every(key => ['customerId', 'token', 'methodType', 'expiry', 'billingZip', 'consent', 'isDefault'].includes(key))) return reply({ ok: false, error: 'Provide hosted payment metadata only.' }, 400);
    assertNoPaymentSecrets(body, { allowToken: true });
    if (body.consent !== true || !['card', 'ach'].includes(body.methodType) || typeof body.token !== 'string' || !/^9\d{15,18}$/.test(body.token)) return reply({ ok: false, error: 'A hosted token and stored-payment authorization are required.' }, 400);
  } catch (error) { return reply({ ok: false, error: 'Provide bounded hosted payment metadata without raw account details.' }, error instanceof RangeError ? 413 : 400); }
  try {
    const db = getDb(); if (!db) return reply({ ok: false, error: 'Billing storage is unavailable.' }, 503);
    // Token is intentionally excluded from logs, command receipts and request hashes.
    return reply({ ok: true, ...(await createHostedBillingMethod(db, body, { actor: auth.email, at: new Date().toISOString() }, { provider: billingPaymentsProvider(env) })) });
  } catch (error) {
    const expected = error instanceof BillingStoreError || error instanceof PaymentsProviderError;
    return reply({ ok: false, error: expected ? error.message : 'Payment method setup is unconfirmed. Reconcile the UAT profile before saving again.' }, expected ? error.status : 503);
  }
}
