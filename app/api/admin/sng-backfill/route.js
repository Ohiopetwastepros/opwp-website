import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { listUnprocessedSngEvents } from "@/lib/db";
import { processSngEvent } from "@/lib/sng-event-processor";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const events = await listUnprocessedSngEvents(500);
  const results = [];
  for (const event of events) {
    let body = {};
    try { body = JSON.parse(event.payload); } catch { /* processor records the failure */ }
    results.push(await processSngEvent({ id: event.id, eventType: event.event_type, externalId: event.external_id, body }));
  }
  return Response.json({ ok: results.every((result) => result.processed), attempted: results.length, processed: results.filter((result) => result.processed).length, failed: results.filter((result) => !result.processed).length });
}
