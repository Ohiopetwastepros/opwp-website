import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { validateAutomationSettings } from "@/lib/lead-assistant.mjs";
import { protectJsonRequest } from "@/lib/public-api-security";
import { OPWP_ORGANIZATION_ID } from "@/lib/route-partner";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin && (!request.headers.get("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin"));
}

export async function PATCH(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "Cross-site request blocked." }, { status: 403, headers: responseHeaders });
  const protectedRequest = await protectJsonRequest(request, { scope: `admin_yardops_settings:${auth.email}`, limit: 30, windowSeconds: 3600, maxBytes: 8 * 1024, turnstile: false, failClosed: true });
  if (protectedRequest.response) return protectedRequest.response;
  const validation = validateAutomationSettings(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400, headers: responseHeaders });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "YardOps storage is not configured." }, { status: 503, headers: responseHeaders });
  const value = validation.value;
  await db.prepare(`INSERT INTO lead_automation_settings
    (organization_id,assistant_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,time_zone,max_follow_up_touches,human_review_required,updated_by)
    VALUES (?,?,?,?,?,'America/New_York',?,?,?)
    ON CONFLICT(organization_id) DO UPDATE SET assistant_enabled=excluded.assistant_enabled,
      quiet_hours_enabled=excluded.quiet_hours_enabled,quiet_hours_start=excluded.quiet_hours_start,
      quiet_hours_end=excluded.quiet_hours_end,max_follow_up_touches=excluded.max_follow_up_touches,
      human_review_required=excluded.human_review_required,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`
  ).bind(OPWP_ORGANIZATION_ID, value.assistantEnabled ? 1 : 0, value.quietHoursEnabled ? 1 : 0, value.quietHoursStart, value.quietHoursEnd, value.maxFollowUpTouches, value.humanReviewRequired ? 1 : 0, auth.email).run();
  console.log(JSON.stringify({ event: "yardops_settings_updated", actor: auth.email, assistantEnabled: value.assistantEnabled }));
  return Response.json({ ok: true, settings: value }, { headers: responseHeaders });
}
