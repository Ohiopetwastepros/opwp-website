import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255) {
    return Response.json({ ok: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const db = getDb();
  if (!db) return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const order = await db.prepare(
    `SELECT order_number,status,total_cents,order_type FROM dog_food_orders WHERE stripe_checkout_session_id=? LIMIT 1`
  ).bind(sessionId).first();
  if (!order) {
    const setup = await db.prepare(
      `SELECT s.status,c.stripe_payment_method_id FROM dog_food_payment_setup_sessions s
       JOIN dog_food_customers c ON c.id=s.customer_id WHERE s.id=? LIMIT 1`
    ).bind(sessionId).first();
    const saved = setup?.status === "succeeded" && Boolean(setup?.stripe_payment_method_id);
    return Response.json({ ok: true, status: saved ? "payment_method_saved" : "processing", setup: Boolean(setup) }, { headers: { "Cache-Control": "no-store" } });
  }
  const paid = ["paid", "scheduled", "fulfilled"].includes(order.status);
  return Response.json({
    ok: true,
    status: paid ? "paid" : order.status === "payment_failed" ? "failed" : "processing",
    orderNumber: order.order_number,
    totalCents: paid ? Number(order.total_cents) : null,
    monthly: order.order_type === "subscription",
  }, { headers: { "Cache-Control": "no-store" } });
}
