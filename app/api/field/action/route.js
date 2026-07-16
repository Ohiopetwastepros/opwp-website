import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";
import { applyFieldAction, getFieldToday } from "@/lib/field-operations";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers, db);
  if (!auth.authorized) return Response.json({ ok: false, code: "FIELD_SESSION_REQUIRED", error: "Your field session has expired." }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "A valid field action is required." }, { status: 400 }); }
  try {
    const result = await applyFieldAction(db, auth, body);
    const date = String(body?.date || "");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await getFieldToday(db, auth, date) : null;
    console.log(JSON.stringify({ message: "field action completed", action: body.action, memberId: auth.member.id, shiftId: body.shiftId || null }));
    return Response.json({ ok: true, ...result, day }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The field action could not be completed.";
    console.error(JSON.stringify({ message: "field action failed", action: body?.action, memberId: auth.member.id, error: message }));
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
