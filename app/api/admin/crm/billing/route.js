import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { BillingError } from '@/lib/crm-billing.mjs';
import { PaymentsProviderError } from '@/lib/payments-provider.mjs';
import { assertNoPaymentSecrets, crmBillingEnabled } from '@/lib/crm-billing-security.mjs';
import { billingPaymentsProvider } from '@/lib/crm-billing-providers.mjs';
import { localPreviewPaymentOrigin } from '@/lib/local-preview-payments.mjs';
import { createFakeQboGateway } from '@/lib/crm-billing-qbo.mjs';
import { BillingStoreError, readBillingWorkspace, generateMonthlyBillingDrafts, createNewClientBillingInvoice, runBillingCommand, saveBillingSettings, chargeBillingInvoice, reconcileBillingInvoice, scheduleBillingChargeNow, refundBillingInvoice, reconcileBillingAdjustment, setDefaultBillingMethod, queueBillingAccounting, syncBillingQbo } from '@/lib/crm-billing-store.mjs';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
let fixtureQboGateway;
async function chargeContinuationId(requestId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${requestId}:charge`));
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function failure(error) {
  const expected = error instanceof BillingError || error instanceof BillingStoreError || error instanceof PaymentsProviderError;
  return reply({ ok: false, error: expected ? error.message : 'Billing is unavailable. Review the recorded invoice state before retrying an action.' }, expected ? error.status : 503);
}
export async function GET(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return reply({ ok: false, error: 'Administrator sign-in is required.' }, 401);
  const env = getRuntimeEnv();
  if (!crmBillingEnabled(env)) return reply({ ok: true, enabled: false, message: 'UAT billing setup is awaiting approval.', invoices: [], methods: [], customers: [], settings: null, summary: null, syncIssues: [], tokenizerConfig: null, tokenizerConfigs: null });
  try {
    const db = getDb(); if (!db) return reply({ ok: false, error: 'Billing storage is unavailable.' }, 503);
    const params = new URL(request.url).searchParams, state = await readBillingWorkspace(db, { period: params.get('period') || '', filter: params.get('filter') || 'all' });
    let tokenizerConfigs = null;
    if (localPreviewPaymentOrigin(env, request.url) || env.CARDPOINTE_UAT_BASE_URL && env.CRM_PAYMENTS_PROVIDER !== 'fake') {
      try {
        const provider = billingPaymentsProvider(env);
        tokenizerConfigs = { card: provider.hostedTokenizerConfig({ methodType: 'card' }), ach: provider.hostedTokenizerConfig({ methodType: 'ach' }) };
      } catch { /* Invoice review remains available before UAT credentials are configured. */ }
    }
    return reply({ ok: true, enabled: true, ...state, tokenizerConfig: tokenizerConfigs?.card || null, tokenizerConfigs });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return reply({ ok: false, error: 'Administrator sign-in is required.' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ ok: false, error: 'Cross-site requests are not allowed.' }, 403);
  const env = getRuntimeEnv();
  if (!crmBillingEnabled(env)) return reply({ ok: false, error: 'UAT billing changes are awaiting approval.' }, 503);
  const rate = await checkRateLimit(request, { scope: 'crm_billing_admin', identity: auth.email, limit: 40, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  let body;
  try {
    body = await readBoundedProviderJson(request, 64 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ ok: false, error: 'Provide a billing change object.' }, 400);
    assertNoPaymentSecrets(body);
  } catch (error) { return reply({ ok: false, error: 'Provide a bounded billing change without raw payment details.' }, error instanceof RangeError ? 413 : 400); }
  if (!/^[a-f0-9-]{36}$/i.test(body.requestId || '') || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) return reply({ ok: false, error: 'A stable request ID and reason are required.' }, 400);
  try {
    const db = getDb(); if (!db) return reply({ ok: false, error: 'Billing storage is unavailable.' }, 503);
    const ctx = { actor: auth.email, at: new Date().toISOString() };
    if (body.action === 'generate_monthly') return reply({ ok: true, ...(await generateMonthlyBillingDrafts(db, body, ctx)) });
    if (body.action === 'create_new_client') return reply({ ok: true, ...(await createNewClientBillingInvoice(db, body, ctx)) });
    if (body.action === 'save_settings') return reply({ ok: true, ...(await saveBillingSettings(db, body, ctx)) });
    if (body.action === 'charge_now') {
      const scheduled = await scheduleBillingChargeNow(db, body, ctx);
      return reply({ ok: true, ...(await chargeBillingInvoice(db, body.invoiceId, { ...body, expectedRevision: scheduled.invoice.revision, requestId: await chargeContinuationId(body.requestId), chargeNow: true }, ctx, { provider: billingPaymentsProvider(env) })) });
    }
    if (body.action === 'reconcile') return reply({ ok: true, ...(await reconcileBillingInvoice(db, body.invoiceId, body, ctx, { provider: billingPaymentsProvider(env) })) });
    if (['refund', 'void_payment'].includes(body.action)) return reply({ ok: true, ...(await refundBillingInvoice(db, body.invoiceId, body, ctx, { provider: billingPaymentsProvider(env) })) });
    if (body.action === 'reconcile_adjustment') return reply({ ok: true, ...(await reconcileBillingAdjustment(db, body, ctx, { provider: billingPaymentsProvider(env) })) });
    if (body.action === 'queue_accounting') return reply({ ok: true, ...(await queueBillingAccounting(db, body, ctx)) });
    if (['default_method', 'link_method_default'].includes(body.action)) return reply({ ok: true, ...(await setDefaultBillingMethod(db, body, ctx)) });
    if (body.action === 'sync_retry') {
      if (env.CRM_QBO_FIXTURES_ENABLED !== 'true') return reply({ ok: false, error: 'Fixture accounting sync has not been enabled.' }, 503);
      fixtureQboGateway ||= createFakeQboGateway();
      return reply({ ok: true, ...(await syncBillingQbo(db, { ...body, force: true }, ctx, { gateway: fixtureQboGateway })) });
    }
    if (['approve', 'approve_batch', 'retry', 'edit', 'hold', 'void', 'credit', 'write_off', 'refresh'].includes(body.action)) {
      const applied = await runBillingCommand(db, body, ctx);
      if (body.chargeNow === true && ['approve', 'retry'].includes(body.action)) return reply({ ok: true, ...(await chargeBillingInvoice(db, body.invoiceId, { ...body, expectedRevision: applied.invoice.revision, requestId: await chargeContinuationId(body.requestId), chargeNow: true }, ctx, { provider: billingPaymentsProvider(env) })) });
      return reply({ ok: true, ...applied });
    }
    return reply({ ok: false, error: 'Choose a supported billing action.' }, 400);
  } catch (error) { return failure(error); }
}
