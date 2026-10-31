import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { validateAnswerEntry } from "@/lib/lead-assistant.mjs";
import { protectJsonRequest } from "@/lib/public-api-security";
import { OPWP_ORGANIZATION_ID } from "@/lib/route-partner";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin && (!request.headers.get("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin"));
}

export async function PUT(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "Cross-site request blocked." }, { status: 403, headers: responseHeaders });
  const protectedRequest = await protectJsonRequest(request, { scope: `admin_yardops_answers:${auth.email}`, limit: 60, windowSeconds: 3600, maxBytes: 12 * 1024, turnstile: false, failClosed: true });
  if (protectedRequest.response) return protectedRequest.response;
  const validation = validateAnswerEntry(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400, headers: responseHeaders });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "YardOps storage is not configured." }, { status: 503, headers: responseHeaders });
  const value = validation.value;
  await db.prepare(`INSERT INTO lead_answer_library
    (answer_key,organization_id,category,question,answer_template,keywords,response_mode,approval_status,auto_send_allowed,updated_by)
    VALUES (?,?,?,?,?,? ,?,'approved',?,?)
    ON CONFLICT(answer_key) DO UPDATE SET category=excluded.category,question=excluded.question,
      answer_template=excluded.answer_template,keywords=excluded.keywords,response_mode=excluded.response_mode,
      auto_send_allowed=excluded.auto_send_allowed,approval_status='approved',version=lead_answer_library.version+1,
      updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
    WHERE lead_answer_library.organization_id=excluded.organization_id`
  ).bind(value.answerKey, OPWP_ORGANIZATION_ID, value.category, value.question, value.answer, JSON.stringify(value.keywords), value.responseMode, value.autoSendAllowed ? 1 : 0, auth.email).run();
  const entry = await db.prepare(`SELECT answer_key,category,question,answer_template,keywords,response_mode,approval_status,auto_send_allowed,version,updated_at
    FROM lead_answer_library WHERE organization_id=? AND answer_key=?`).bind(OPWP_ORGANIZATION_ID, value.answerKey).first();
  return Response.json({ ok: true, entry }, { headers: responseHeaders });
}
