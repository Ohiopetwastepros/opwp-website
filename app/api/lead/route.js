import { getDb, queuePartialQuoteFollowUp, saveSubmission, upsertPartialQuoteSubmission } from "@/lib/db";
import { queueSubmissionNotificationSafe } from "@/lib/submission-notifications";
import { protectJsonRequest, verifyTurnstile } from "@/lib/public-api-security";
import { validateLeadInput } from "@/lib/public-input";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { runInitialQuoteSms } from "@/lib/quote-initial-sms.mjs";
import {createFunnelRouteToken} from '@/lib/lead-funnel-signup.mjs';

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
  const saved = isPartial && (validation.value.funnel_id || getRuntimeEnv().LEAD_FUNNEL_ENABLED === 'true')
    ? await upsertPartialQuoteSubmission({ body: validation.value, funnelId: validation.value.funnel_id, lifecycleStage: validation.value.lifecycle_stage })
    : await saveSubmission({
        kind: isPartial ? "partial_quote" : "question",
        source: "website",
        status: isPartial ? "follow_up_pending" : "new",
        body: validation.value,
        funnelId: validation.value.funnel_id,
        lifecycleStage: isPartial ? validation.value.lifecycle_stage : "details_started",
      });
  const smsFollowup = isPartial
    ? await queuePartialQuoteFollowUp({ submissionId: saved.id, phone: validation.value.phone, consentAt: validation.value.follow_up_consent_at })
    : null;
  if (smsFollowup?.configured) {
    const task = runInitialQuoteSms(getRuntimeEnv(), { submissionId: saved.id });
    try { getCloudflareContext().ctx.waitUntil(task); }
    catch { await task; }
  }
  const notification = isPartial && getRuntimeEnv().LEAD_FUNNEL_ENABLED === 'true' ? {status:'decision_monitor'} : await queueSubmissionNotificationSafe({
    submissionId: saved.id,
    type: isPartial ? "partial_quote" : "question",
    body: validation.value,
  });
  const routeToken=isPartial && saved.configured && getRuntimeEnv().LEAD_FUNNEL_ENABLED==='true' ? await createFunnelRouteToken(getDb(),saved.id) : undefined;
  return Response.json({ ok: true, stored: saved.configured, id: saved.id, routeToken, notification: notification.status, smsFollowup: smsFollowup?.status || null },{headers:{'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'}});
}
