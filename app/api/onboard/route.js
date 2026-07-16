import { getDb, markSubmissionSynced, saveSubmission } from "@/lib/db";
import { recommendOnboardingRoute, saveOnboardingRouteAssignment } from "@/lib/route-intelligence";
import { ensureFreshAirtableCockpitSnapshot } from "@/lib/airtable";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { sngRequest, toOnboardingPayload } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.email || !body.zip_code || !body.first_name || !body.last_name) {
    return Response.json({ ok: false, error: "Required customer fields are missing" }, { status: 400 });
  }

  const saved = await saveSubmission({ kind: "onboarding", source: "website", body });
  let routeAssignment = null;
  try {
    const db = getDb();
    if (db && body.clean_up_frequency !== "one_time") {
      const freshness = await ensureFreshAirtableCockpitSnapshot(getRuntimeEnv(), 15);
      routeAssignment = await recommendOnboardingRoute(db, body);
      routeAssignment = { ...routeAssignment, airtableFreshness: freshness };
      await saveOnboardingRouteAssignment(db, saved.id, routeAssignment);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "automatic_onboarding_route_assignment_failed", submissionId: saved.id, message: error instanceof Error ? error.message : String(error) }));
  }
  const routeNote = routeAssignment?.eligible ? `Route recommendation (review before scheduling): ${routeAssignment.decision}. ${routeAssignment.confidence} confidence; based on live road-time insertion.` : "";
  const upstreamBody = routeNote ? { ...body, account_note: [body.account_note, routeNote].filter(Boolean).join(" ") } : body;
  const upstream = await sngRequest("/api/v1/residential/onboarding", {
    method: "PUT",
    body: toOnboardingPayload(upstreamBody),
  });

  await markSubmissionSynced(saved.id, upstream.data, upstream.ok);
  return Response.json({
    configured: upstream.configured,
    stored: saved.configured,
    ok: upstream.ok,
    status: upstream.status,
    data: upstream.data,
    route_assignment: routeAssignment,
  });
}
