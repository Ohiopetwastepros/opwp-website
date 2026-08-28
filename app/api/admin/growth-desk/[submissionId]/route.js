import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { addGrowthNote, getGrowthSubmission, saveGrowthState } from "@/lib/growth-desk";
import { normalizeGrowthSubmissionId, validateGrowthMutation } from "@/lib/growth-desk.mjs";
import { protectJsonRequest } from "@/lib/public-api-security";

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
  const validation = validateGrowthMutation(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400, headers: responseHeaders });

  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "YardOps Pipeline storage is not configured." }, { status: 503, headers: responseHeaders });
  const submission = await getGrowthSubmission(db, submissionId);
  if (!submission) return Response.json({ ok: false, error: "Lead record not found." }, { status: 404, headers: responseHeaders });

  try {
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
    const safeConflict = internalMessage === "A converted customer remains in the Won stage.";
    console.error(JSON.stringify({ event: "growth_desk_update_failed", submissionId, actor: auth.email, error: internalMessage }));
    return Response.json(
      { ok: false, error: safeConflict ? internalMessage : "The YardOps Pipeline record could not be updated." },
      { status: safeConflict ? 409 : 500, headers: responseHeaders },
    );
  }
}
