import { getDb } from '@/lib/db';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { foodAccountSession } from '@/lib/dog-food-account.mjs';
import { SubscriptionError } from '@/lib/crm-subscriptions.mjs';
import { CrmSubscriptionStoreError, crmSubscriptionsEnabled, readCrmPortal } from '@/lib/crm-subscription-store.mjs';

export const dynamic = 'force-dynamic';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
export async function GET(request) {
  try {
    const db = getDb(), account = await foodAccountSession(db, request.headers);
    if (!account) return reply({ ok: false, error: 'Sign in to view your subscription history.' }, 401);
    if (!crmSubscriptionsEnabled(getRuntimeEnv())) return reply({ ok: false, error: 'Your service subscription history is not available here yet. Please contact the office.' }, 503);
    // Identity comes from the verified session and reviewed account link only.
    // customerId, status/view and accountId supplied by the browser are ignored.
    const result = await readCrmPortal(db, account.id, { cursor: new URL(request.url).searchParams.get('cursor') || '' });
    return reply({ ok: true, ...result });
  } catch (error) {
    const expected = error instanceof SubscriptionError || error instanceof CrmSubscriptionStoreError;
    return reply({ ok: false, error: expected ? error.message : 'Your subscription history could not be loaded. Please try again.' }, expected ? error.status : 503);
  }
}
