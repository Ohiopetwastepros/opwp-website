import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";
import { applyFieldAction, getFieldToday } from "@/lib/field-operations";
import { executeFieldCommand } from "@/lib/field-command.mjs";
import { FieldError } from "@/lib/field-policy.mjs";
import { readBoundedProviderJson } from "@/lib/bounded-body.mjs";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fieldQuota } from "@/lib/field-quota.mjs";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers, db);
  if (!auth.authorized) return Response.json({ ok: false, code: "FIELD_SESSION_REQUIRED", error: "Your field session has expired." }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ ok: false, error: 'Cross-site request blocked.' }, { status: 403 });
  const rate = await checkRateLimit(request, { scope: `field_action:${auth.member.id}`, limit: 60, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  try { if (!await fieldQuota(db,auth.member.id,'field_commands_account',90)) return Response.json({ok:false,error:'Please wait a minute before recording more actions.'},{status:429}); }
  catch { return Response.json({ok:false,error:'Field protection unavailable. Please retry.'},{status:503}); }
  let body;
  try { body = await readBoundedProviderJson(request, 16 * 1024); } catch (error) { return Response.json({ ok: false, error: "A bounded JSON field action is required." }, { status: error instanceof RangeError ? 413 : 400 }); }
  try {
    const result = await executeFieldCommand(db, auth, body, applyFieldAction);
    const date = String(body?.date || "");
    // The command is already committed. A refresh failure must not claim it failed.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await getFieldToday(db, auth, date, body.shiftId).catch(() => null) : null;
    console.log(JSON.stringify({ message: "field action completed", action: body.action, memberId: auth.member.id, shiftId: body.shiftId || null }));
    return Response.json({ ok: true, ...result, day }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The field action could not be completed.";
    console.error(JSON.stringify({ message: "field action failed", action: body?.action, memberId: auth.member.id, error: message }));
    return Response.json({ ok: false, error: error instanceof FieldError ? message : "The action could not be saved. Retry the same action." }, { status: error instanceof FieldError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
