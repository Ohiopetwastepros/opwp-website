import { getDb } from '@/lib/db';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { applicationConfig } from '@/lib/app-config';
import { protectJsonRequest } from '@/lib/public-api-security';
import { FoodAccountError, foodAccountSession } from '@/lib/dog-food-account.mjs';
import { saveFoodProfile, createFoodPortalOrder, requireFoodProfile } from '@/lib/dog-food-portal';
import { requestFoodPlanChange } from '@/lib/dog-food-experience.mjs';
import { readFoodDeliveryChoices } from '@/lib/dog-food-routing';
import { createDogFoodCheckout, createDogFoodPaymentSetup, stripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'Cross-site requests are not allowed.' }, 403);
  const secured = await protectJsonRequest(request, { scope: 'food_portal_write', limit: 20, windowSeconds: 900, maxBytes: 8192, turnstile: false });
  if (secured.response) return secured.response;
  try {
    const db = getDb(), account = await foodAccountSession(db, request.headers), body = secured.body;
    if (!account) return reply({ error: 'Sign in to your dog-food account first.' }, 401);
    if (body.action === 'profile') return reply({ ok: true, ...await saveFoodProfile(db, account, body) });
    const address=await requireFoodProfile(db,account);
    if(body.action==='delivery_choices')return reply({ok:true,deliveryChoices:await readFoodDeliveryChoices(db,address)});
    if (['subscription','plan_request'].includes(body.action)) return reply({ ok: true, ...await requestFoodPlanChange(db, account, body) });
    if (!stripeConfigured()) return reply({ error: 'Secure Stripe checkout is temporarily unavailable. No payment has been taken.' }, 503);
    if (['order','checkout'].includes(body.action)) {
      const env=getRuntimeEnv(),key=String(env.STRIPE_SECRET_KEY||'');
      const settings=await db.prepare("SELECT posting_enabled,scheduling_enabled FROM dog_food_workflow_settings WHERE id='org-opwp'").first();
      const testSandbox=env.DOG_FOOD_TEST_CHECKOUT==='true'&&key.startsWith('sk_test_')&&!['www.ohiopetwastepros.com','ohiopetwastepros.com'].includes(new URL(request.url).hostname);
      if(!settings?.posting_enabled||!settings?.scheduling_enabled||!key.startsWith('sk_live_')&&!testSandbox)return reply({error:'Online ordering is awaiting verified payment and delivery setup. Please call 419-262-2371. No payment has been taken.'},503);
    }
    let orderId;
    if (body.action === 'order') orderId = (await createFoodPortalOrder(db, account, body)).orderId;
    else if (body.action === 'checkout') orderId = typeof body.orderId === 'string' ? body.orderId.slice(0, 80) : '';
    else if (body.action === 'payment_method') return reply({ ok: true, ...await createDogFoodPaymentSetup({ db, customerId: account.customer_id, origin: applicationConfig().siteOrigin }) });
    else throw new FoodAccountError('Choose a valid account action.');
    const order = await db.prepare('SELECT id,status FROM dog_food_orders WHERE id=? AND customer_id=? AND deleted_at IS NULL').bind(orderId, account.customer_id).first();
    if (!order) throw new FoodAccountError('The order was not found.', 404);
    const paid = await db.prepare("SELECT id FROM dog_food_payments WHERE order_id=? AND status='captured' LIMIT 1").bind(order.id).first();
    if (paid) throw new FoodAccountError('This order has already been paid. Refresh your order history.', 409);
    const checkout = await createDogFoodCheckout({ db, orderId: order.id, origin: applicationConfig().siteOrigin });
    return reply({ ok: true, ...checkout });
  } catch (error) { return reply({ ok: false, error: error instanceof FoodAccountError ? error.message : 'We could not complete this request. No new payment has been confirmed. Refresh your orders before retrying.' }, error instanceof FoodAccountError ? error.status : 503); }
}
