import { queuePartialQuoteFollowUp, saveSubmission, upsertPartialQuoteSubmission } from "@/lib/db";
import { queueSubmissionNotificationSafe } from "@/lib/submission-notifications";
import { protectJsonRequest, verifyTurnstile } from "@/lib/public-api-security";
import { validateLeadInput } from "@/lib/public-input";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { runScheduledQuoteFollowUps } from "@/lib/quote-follow-up-delivery";

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
  if (isPartial) validation.value.follow_up_consent_at = new Date().toISOString();
  let saved;
  try {
    saved = isPartial && validation.value.funnel_id
      ? await upsertPartialQuoteSubmission({ body: validation.value, funnelId: validation.value.funnel_id, lifecycleStage: validation.value.lifecycle_stage })
      : await saveSubmission({
        kind: isPartial ? "partial_quote" : "question",
        source: "website",
        status: isPartial ? "follow_up_pending" : "new",
        body: validation.value,
        funnelId: validation.value.funnel_id,
        lifecycleStage: isPartial ? validation.value.lifecycle_stage : "details_started",
        });
  } catch (error) {
    if (error?.code === "website_question_identity_conflict" && error.status === 409) return Response.json({ ok: false, error: error.message }, { status: 409 });
    throw error;
  }
  const smsFollowup = isPartial
    ? await queuePartialQuoteFollowUp({ submissionId: saved.id, phone: validation.value.phone, consentAt: validation.value.follow_up_consent_at, delayMinutes: 0 })
    : null;
  if (smsFollowup?.configured && ["queued", "failed"].includes(smsFollowup.status)) {
    try {
      const { env, ctx } = getCloudflareContext();
      // The same atomic delivery claims serve this request and the cron fallback.
      ctx.waitUntil(runScheduledQuoteFollowUps(env, 3, { submissionId: saved.id }).catch(() => {
        console.error(JSON.stringify({ event: "immediate_quote_follow_up_failed", submissionId: saved.id }));
      }));
    } catch {
      // Persisted due rows remain available to cron if request context is absent.
      console.error(JSON.stringify({ event: "immediate_quote_follow_up_unavailable", submissionId: saved.id }));
    }
  }
  const notification = await queueSubmissionNotificationSafe({
    submissionId: saved.id,
    type: isPartial ? "partial_quote" : "question",
    body: validation.value,
  });
  return Response.json({ ok: true, stored: saved.configured, id: saved.id, notification: notification.status, smsFollowup: smsFollowup?.status || null });
}
