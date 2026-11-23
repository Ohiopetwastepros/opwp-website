import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { SubscriptionError } from '@/lib/crm-subscriptions.mjs';
import { crmBillingEnabled } from '@/lib/crm-billing-security.mjs';
import {
  CrmSubscriptionStoreError, crmSubscriptionsEnabled, readCrmAdmin,
  prepareCrmSubscriptionChange, applyCrmSubscriptionPreview,
  saveCrmSubscriptionCustomer, linkCrmSubscriptionPortal,
} from '@/lib/crm-subscription-store.mjs';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
function failure(error) {
  const expected = error instanceof SubscriptionError || error instanceof CrmSubscriptionStoreError;
  return reply({ ok: false, error: expected ? error.message : 'The subscription workspace is unavailable. No external payment or message was made.' }, expected ? error.status : 503);
}
export async function GET(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return reply({ ok: false, error: 'Administrator sign-in is required.' }, 401);
  if (!crmSubscriptionsEnabled(getRuntimeEnv())) return reply({ ok: true, enabled: false, message: 'Subscription setup is awaiting approval.', customers: [], subscriptions: [], priceBook: null, report: null });
  try {
    const db = getDb(); if (!db) return reply({ ok: false, error: 'Subscription storage is unavailable.' }, 503);
    const params = new URL(request.url).searchParams;
    const state = await readCrmAdmin(db, { customerId: params.get('customerId') || '', view: params.get('view') || 'active', ...(params.get('date') ? { date: params.get('date') } : {}) });
    return reply({ ok: true, enabled: true, ...state });
  } catch (error) { return failure(error); }
}
export async function POST(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return reply({ ok: false, error: 'Administrator sign-in is required.' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ ok: false, error: 'Cross-site requests are not allowed.' }, 403);
  if (!crmSubscriptionsEnabled(getRuntimeEnv())) return reply({ ok: false, error: 'Subscription changes are awaiting approval.' }, 503);
  const rate = await checkRateLimit(request, { scope: 'crm_subscription_admin', limit: 40, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  let body;
  try { body = await readBoundedProviderJson(request, 64 * 1024); if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ ok: false, error: 'Provide a subscription change object.' }, 400); }
  catch (error) { return reply({ ok: false, error: 'Provide a bounded subscription change.' }, error instanceof RangeError ? 413 : 400); }
  try {
    const db = getDb(); if (!db) return reply({ ok: false, error: 'Subscription storage is unavailable.' }, 503);
    if (body.operation === 'invoice' && crmBillingEnabled(getRuntimeEnv())) return reply({ ok: false, error: 'Prepare invoices in the billing review workspace.' }, 409);
    if (body.action === 'preview' || body.action === 'preview_bulk_reprice') return reply({ ok: true, preview: await prepareCrmSubscriptionChange(db, auth.email, { ...body, operation: body.action === 'preview_bulk_reprice' ? 'bulk_reprice' : body.operation }) });
    if (body.action === 'apply' || body.action === 'apply_bulk_reprice') return reply({ ok: true, ...(await applyCrmSubscriptionPreview(db, auth.email, body.previewToken, body.requestId, { allowLegacyInvoice: !crmBillingEnabled(getRuntimeEnv()) })) });
    if (['save_customer', 'link_portal'].includes(body.action) && !/^[a-f0-9-]{36}$/i.test(body.requestId || '')) return reply({ ok: false, error: 'A request ID is required for this change.' }, 400);
    if (body.action === 'save_customer') return reply({ ok: true, customer: await saveCrmSubscriptionCustomer(db, auth.email, { ...body, id: body.id || body.requestId }) });
    if (body.action === 'link_portal') return reply({ ok: true, ...(await linkCrmSubscriptionPortal(db, auth.email, body)) });
    return reply({ ok: false, error: 'Choose a supported subscription action.' }, 400);
  } catch (error) { return failure(error); }
}
