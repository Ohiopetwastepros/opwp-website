import { markSubmissionSynced, saveSubmission } from "@/lib/db";
import { sngRequest, toOnboardingPayload } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.email || !body.zip_code || !body.first_name || !body.last_name) {
    return Response.json({ ok: false, error: "Required customer fields are missing" }, { status: 400 });
  }

  const saved = await saveSubmission({ kind: "onboarding", source: "website", body });
  const upstream = await sngRequest("/api/v1/residential/onboarding", {
    method: "PUT",
    body: toOnboardingPayload(body),
  });

  await markSubmissionSynced(saved.id, upstream.data, upstream.ok);
  return Response.json({
    configured: upstream.configured,
    stored: saved.configured,
    ok: upstream.ok,
    status: upstream.status,
    data: upstream.data,
  });
}
