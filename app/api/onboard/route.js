import { convertAbandonedQuote, getDb, markSubmissionSynced, saveSubmission } from "@/lib/db";
import { recommendOnboardingRoute, saveOnboardingRouteAssignment } from "@/lib/route-intelligence";
import { ensureFreshAirtableCockpitSnapshot } from "@/lib/airtable";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { sngRequest, toOnboardingPayload } from "@/lib/sweepandgo";
import { protectJsonRequest } from "@/lib/public-api-security";
import { validateOnboardingInput } from "@/lib/public-input";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const protectedRequest = await protectJsonRequest(request, { scope: "public_onboard", limit: 5, windowSeconds: 3600, maxBytes: 64 * 1024, turnstile: true, action: "onboarding" });
  if (protectedRequest.response) return protectedRequest.response;
  const validation = validateOnboardingInput(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400 });
  const body = validation.value;

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
  if (upstream.ok || !upstream.configured) await convertAbandonedQuote({ email: body.email, phone: body.cell_phone_number });
  return Response.json({
    configured: upstream.configured,
    stored: saved.configured,
    ok: upstream.ok,
    status: upstream.status,
  });
}
