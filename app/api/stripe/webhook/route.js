import { getDb } from "@/lib/db";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { readVerifiedStripeEvent } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const db = getDb();
  if (!db) return Response.json({ received: false }, { status: 503 });
  let event;
  try {
    event = await readVerifiedStripeEvent(request);
  } catch (error) {
    console.warn(JSON.stringify({ event: "stripe_webhook_rejected", reason: error instanceof Error ? error.message : "invalid" }));
    return Response.json({ received: false }, { status: 400 });
  }
  try {
    const result = await processStripeEvent({ db, env: getRuntimeEnv(), event });
    console.log(JSON.stringify({ event: "stripe_webhook_processed", stripeEventId: event.id, stripeEventType: event.type, duplicate: Boolean(result?.duplicate) }));
    return Response.json({ received: true });
  } catch (error) {
    console.error(JSON.stringify({ event: "stripe_webhook_failed", stripeEventId: event.id, stripeEventType: event.type, message: error instanceof Error ? error.message : "failed" }));
    return Response.json({ received: false }, { status: 500 });
  }
}
