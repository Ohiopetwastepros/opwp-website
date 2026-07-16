import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { ensureFreshAirtableCockpitSnapshot } from "@/lib/airtable";
import { verifyOfficeRequest } from "@/lib/field-auth";
import { getOnboardingRouteAssignments, recommendOnboardingRoute } from "@/lib/route-intelligence";

export const dynamic = "force-dynamic";

async function current() {
  const db = getDb();
  const auth = await verifyOfficeRequest(await headers(), db);
  return { db, auth };
}

export async function GET() {
  const { db, auth } = await current();
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!db) return Response.json({ ok: false, error: "Route storage is not configured." }, { status: 503 });
  return Response.json({ ok: true, assignments: await getOnboardingRouteAssignments(db) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const { db, auth } = await current();
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.address) return Response.json({ ok: false, error: "Enter the full service address." }, { status: 400 });
  if (!db) return Response.json({ ok: false, error: "Route storage is not configured." }, { status: 503 });
  try {
    const freshness = await ensureFreshAirtableCockpitSnapshot(getRuntimeEnv(), 15);
    const recommendation = await recommendOnboardingRoute(db, { ...body, home_address: body.address });
    console.log(JSON.stringify({ event: "office_route_assignment_analyzed", memberId: auth.member.id, frequency: recommendation.frequency, decision: recommendation.decision }));
    return Response.json({ ok: true, recommendation: { ...recommendation, airtableFreshness: freshness } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "office_route_assignment_failed", memberId: auth.member.id, message: error instanceof Error ? error.message : String(error) }));
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Route assignment could not be calculated." }, { status: 502 });
  }
}
