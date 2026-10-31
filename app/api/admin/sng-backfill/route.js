import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { listUnprocessedSngEvents } from "@/lib/db";
import { processSngEvent } from "@/lib/sng-event-processor";
import { runSngDispatchBackfillBatch } from "@/lib/sng-operational-recovery";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

export async function POST(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Cross-site request blocked." }, { status: 403, headers: responseHeaders });
  const rate = await checkRateLimit(request, { scope: `sng_backfill:${auth.email}`, limit: 2, windowSeconds: 600, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const events = await listUnprocessedSngEvents(500);
  const results = [];
  for (const event of events) {
    let body = {};
    try { body = JSON.parse(event.payload); } catch { /* processor records the failure */ }
    results.push(await processSngEvent({ id: event.id, eventType: event.event_type, externalId: event.external_id, body }));
  }
  try {
    const backfill = await runSngDispatchBackfillBatch(getRuntimeEnv());
    return Response.json({ ok: results.every((result) => result.processed), attempted: results.length, processed: results.filter((result) => result.processed).length, failed: results.filter((result) => !result.processed).length, backfill }, { headers: responseHeaders });
  } catch (error) {
    console.error(JSON.stringify({ event: "sng_dispatch_backfill_failed", message: String(error?.message || "Backfill failed").slice(0, 300) }));
    return Response.json({ ok: false, error: "Sweep & Go backfill could not complete. Existing data was retained." }, { status: 503, headers: responseHeaders });
  }
}
