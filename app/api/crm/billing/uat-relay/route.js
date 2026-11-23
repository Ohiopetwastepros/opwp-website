import { getRuntimeEnv } from '@/lib/cloudflare';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { assertNoPaymentSecrets, crmBillingEnabled, verifyBillingUatRelayRequest } from '@/lib/crm-billing-security.mjs';
import { billingPaymentsProvider } from '@/lib/crm-billing-providers.mjs';
import { recordBillingWebhookHint } from '@/lib/crm-billing-store.mjs';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
export async function POST(request) {
  const env = getRuntimeEnv();
  if (!crmBillingEnabled(env)) return reply({ ok: false, error: 'UAT billing relay is disabled.' }, 503);
  if (!await verifyBillingUatRelayRequest(request, env)) return reply({ ok: false, error: 'UAT relay authentication is required.' }, 401);
  const rate = await checkRateLimit(request, { scope: 'crm_billing_uat_relay', identity: 'billing-uat-relay', limit: 40, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  let hint;
  try {
    hint = await readBoundedProviderJson(request, 8 * 1024);
    if (!hint || typeof hint !== 'object' || Array.isArray(hint) || !Object.keys(hint).every(key => ['eventId', 'invoiceId', 'transactionId', 'orderId'].includes(key))) return reply({ ok: false, error: 'Only UAT event and transaction identifiers are accepted.' }, 400);
    assertNoPaymentSecrets(hint);
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
    if (!id(hint.eventId) || !id(hint.invoiceId) || !(hint.transactionId || hint.orderId) || hint.transactionId && !/^[A-Za-z0-9_-]{1,50}$/.test(hint.transactionId) || hint.orderId && !/^[A-Za-z0-9_-]{1,50}$/.test(hint.orderId)) return reply({ ok: false, error: 'A UAT event, invoice, and transaction or order ID are required.' }, 400);
  } catch (error) { return reply({ ok: false, error: 'Provide a bounded UAT identifier hint.' }, error instanceof RangeError ? 413 : 400); }
  try {
    const db = getDb(); if (!db) return reply({ ok: false, error: 'Billing storage is unavailable.' }, 503);
    // This is our authenticated relay, not a claimed native CardPointe signature.
    // The store deduplicates the hint and asks the provider for authoritative status.
    await recordBillingWebhookHint(db, hint, { actor: 'system:billing-uat-relay', at: new Date().toISOString() }, { provider: billingPaymentsProvider(env) });
    return reply({ ok: true, accepted: true }, 202);
  } catch { return reply({ ok: false, error: 'The UAT hint could not be reconciled. Retry the same event ID.' }, 503); }
}
