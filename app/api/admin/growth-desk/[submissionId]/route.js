import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { addGrowthNote, getGrowthSubmission, saveGrowthState } from "@/lib/growth-desk";
import { normalizeGrowthSubmissionId, validateGrowthMutation } from "@/lib/growth-desk.mjs";
import { validateLeadAssistantMutation } from "@/lib/lead-assistant.mjs";
import { cancelLeadFollowUps, deleteLead, getLeadRecord, scheduleLeadFollowUp, sendLeadMessage, setLeadAutomation, startLeadNurture, queueLeadSync } from "@/lib/lead-assistant";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { protectJsonRequest } from "@/lib/public-api-security";
import { auditMetaRoute, refreshMetaRouteGuidance } from "@/lib/meta-route-guidance.mjs";
import { ensureFreshAirtableCockpitSnapshot } from "@/lib/airtable";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || origin !== new URL(request.url).origin) return false;
  return !fetchSite || fetchSite === "same-origin";
}

export async function PATCH(request, { params }) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "Cross-site request blocked." }, { status: 403, headers: responseHeaders });
  const submissionId = normalizeGrowthSubmissionId((await params)?.submissionId);
  if (!submissionId) return Response.json({ ok: false, error: "That lead record is not valid." }, { status: 400, headers: responseHeaders });

  const protectedRequest = await protectJsonRequest(request, {
    scope: `admin_growth_desk:${auth.email}`,
    limit: 120,
    windowSeconds: 3600,
    maxBytes: 8 * 1024,
    turnstile: false,
    failClosed: true,
  });
  if (protectedRequest.response) return protectedRequest.response;
  const assistantActions = new Set(["send_message", "set_automation", "schedule_follow_up", "cancel_follow_ups", "start_nurture", "delete_lead", "refresh_meta_route", "audit_meta_route"]);
  const validation = assistantActions.has(protectedRequest.body?.action)
    ? validateLeadAssistantMutation(protectedRequest.body)
    : validateGrowthMutation(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400, headers: responseHeaders });

  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "YardOps Pipeline storage is not configured." }, { status: 503, headers: responseHeaders });
  const submission = await getGrowthSubmission(db, submissionId);
  if (!submission) return Response.json({ ok: false, error: "Lead record not found." }, { status: 404, headers: responseHeaders });

  try {
    if (assistantActions.has(validation.value.action)) {
      const lead = await getLeadRecord(db, submissionId);
      if (!lead) return Response.json({ ok: false, error: "Lead conversation not found." }, { status: 404, headers: responseHeaders });
      if (["refresh_meta_route", "audit_meta_route"].includes(validation.value.action)) {
        if (lead.source !== "facebook") return Response.json({ ok: false, error: "Meta lead required." }, { status: 409, headers: responseHeaders });
        const auditor = String(getRuntimeEnv().OWNER_NOTIFICATION_EMAIL || "").trim().toLowerCase();
        if (validation.value.action === "audit_meta_route" && (!auditor || auth.email.toLowerCase() !== auditor)) return Response.json({ ok: false, error: "Craig must approve the service-day audit." }, { status: 403, headers: responseHeaders });
        await ensureFreshAirtableCockpitSnapshot(getRuntimeEnv(), 15);
        const guidance = validation.value.action === "audit_meta_route"
          ? await auditMetaRoute(db, lead, validation.value, auth.email)
          : await refreshMetaRouteGuidance(db, lead.id);
        await queueLeadSync(db, lead.id, "facebook_lead");
        return Response.json({ ok: true, guidance }, { headers: responseHeaders });
      }
      if (validation.value.action === "send_message") {
        const message = await sendLeadMessage(db, getRuntimeEnv(), lead, validation.value.message, auth.email);
        console.log(JSON.stringify({ event: "yardops_message_sent", submissionId, actor: auth.email }));
        return Response.json({ ok: true, message }, { headers: responseHeaders });
      }
      if (validation.value.action === "set_automation") {
        const mode = await setLeadAutomation(db, lead, validation.value.mode, auth.email);
        return Response.json({ ok: true, mode }, { headers: responseHeaders });
      }
      if (validation.value.action === "schedule_follow_up") {
        const job = await scheduleLeadFollowUp(db, lead, validation.value, auth.email);
        return Response.json({ ok: true, job }, { headers: responseHeaders });
      }
      if (validation.value.action === "cancel_follow_ups") {
        await cancelLeadFollowUps(db, lead, auth.email);
        return Response.json({ ok: true }, { headers: responseHeaders });
      }
      if (validation.value.action === "start_nurture") {
        const jobs = await startLeadNurture(db, lead, auth.email);
        return Response.json({ ok: true, jobs }, { headers: responseHeaders });
      }
      await deleteLead(db, lead, validation.value.reason, auth.email);
      return Response.json({ ok: true, deleted: true }, { headers: responseHeaders });
    }
    if (validation.value.action === "add_note") {
      const event = await addGrowthNote(db, submissionId, validation.value.note, auth.email);
      console.log(JSON.stringify({ event: "growth_desk_note_added", submissionId, actor: auth.email }));
      return Response.json({ ok: true, event }, { headers: responseHeaders });
    }
    const state = await saveGrowthState(db, submission, validation.value, auth.email);
    console.log(JSON.stringify({ event: "growth_desk_state_updated", submissionId, stage: state.stage, actor: auth.email }));
    return Response.json({ ok: true, state }, { headers: responseHeaders });
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : "YardOps Pipeline update failed";
    const safeMessages = new Set([
      "A converted customer remains in the Won stage.",
      "This lead was deleted.",
      "SMS consent or an inbound customer message is required before sending from YardOps.",
      "Quo messaging is not configured.",
      "This phone number is suppressed from YardOps messaging.",
      "SMS consent or an inbound customer message is required before starting follow-up.",
      "Facebook follow-ups use the separately approved Meta cadence.",
      "Meta route is not awaiting audit.",
      "Refresh current routing guidance before approving this day.",
      "Choose verified route day options for this frequency.",
      "Choose an approved twice-weekly route pair.",
    ]);
    const safeConflict = safeMessages.has(internalMessage);
    console.error(JSON.stringify({ event: "growth_desk_update_failed", submissionId, actor: auth.email, error: internalMessage }));
    return Response.json(
      { ok: false, error: safeConflict ? internalMessage : "The YardOps Pipeline record could not be updated." },
      { status: safeConflict ? 409 : 500, headers: responseHeaders },
    );
  }
}
