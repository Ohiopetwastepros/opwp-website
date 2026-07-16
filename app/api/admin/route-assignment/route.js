import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { ensureFreshAirtableCockpitSnapshot } from "@/lib/airtable";
import { getOnboardingRouteAssignments, recommendOnboardingRoute } from "@/lib/route-intelligence";

export const dynamic = "force-dynamic";

async function authorized() { return verifyAdminRequest(await headers()); }

export async function GET() {
  const auth = await authorized();
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Route storage is not configured." }, { status: 503 });
  return Response.json({ ok: true, assignments: await getOnboardingRouteAssignments(db) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const auth = await authorized();
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.address) return Response.json({ ok: false, error: "Enter the full service address." }, { status: 400 });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Route storage is not configured." }, { status: 503 });
  try {
    const freshness = await ensureFreshAirtableCockpitSnapshot(getRuntimeEnv(), 15);
    const recommendation = await recommendOnboardingRoute(db, { ...body, home_address: body.address, zip_code: body.zip });
    return Response.json({ ok: true, recommendation: { ...recommendation, airtableFreshness: freshness } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "onboarding_route_analysis_failed", message: error instanceof Error ? error.message : String(error) }));
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Route assignment could not be calculated." }, { status: 502 });
  }
}
