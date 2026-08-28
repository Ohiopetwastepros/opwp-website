import { saveSubmission, upsertPartialQuoteSubmission } from "@/lib/db";
import { queueSubmissionNotificationSafe } from "@/lib/submission-notifications";
import { protectJsonRequest, verifyTurnstile } from "@/lib/public-api-security";
import { validateLeadInput } from "@/lib/public-input";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const protectedRequest = await protectJsonRequest(request, { scope: "public_lead", limit: 10, windowSeconds: 3600, maxBytes: 32 * 1024, turnstile: false });
  if (protectedRequest.response) return protectedRequest.response;
  const validation = validateLeadInput(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400 });
  if (validation.value.source === "question") {
    const verification = await verifyTurnstile(request, protectedRequest.body.turnstileToken, "quote_question");
    if (!verification.ok) return Response.json({ ok: false, error: verification.unavailable ? "Verification is temporarily unavailable. Please try again." : "Please complete the verification and try again." }, { status: verification.unavailable ? 503 : 403 });
  }

  const isPartial = validation.value.source === "partial_quote";
  const saved = isPartial && validation.value.funnel_id
    ? await upsertPartialQuoteSubmission({ body: validation.value, funnelId: validation.value.funnel_id, lifecycleStage: validation.value.lifecycle_stage })
    : await saveSubmission({
        kind: isPartial ? "partial_quote" : "question",
        source: "website",
        status: isPartial ? "follow_up_pending" : "new",
        body: validation.value,
        funnelId: validation.value.funnel_id,
        lifecycleStage: isPartial ? validation.value.lifecycle_stage : "details_started",
      });
  const notification = await queueSubmissionNotificationSafe({ submissionId: saved.id, type: isPartial ? "partial_quote" : "question", body: validation.value });
  return Response.json({ ok: true, stored: saved.configured, id: saved.id, notification: notification.status });
}
