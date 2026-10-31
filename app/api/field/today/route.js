import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";
import { getFieldToday } from "@/lib/field-operations";
import { validDispatchDate } from "@/lib/daily-route-optimizer.mjs";

export const dynamic = "force-dynamic";

function validDate(value) { return validDispatchDate(value); }

export async function GET(request) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers, db);
  if (!auth.authorized) return Response.json({ ok: false, code: "FIELD_SESSION_REQUIRED", error: "Your field session has expired." }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!validDate(date)) return Response.json({ ok: false, error: "A valid service date is required." }, { status: 400 });
  const shiftId = String(new URL(request.url).searchParams.get('shiftId') || '').slice(0,100);
  try { return Response.json({ ok: true, day: await getFieldToday(db, auth, date, shiftId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "The field route could not be loaded.";
    console.error(JSON.stringify({ message: "field day load failed", memberId: auth.member.id, date, error: message }));
    return Response.json({ ok: false, error: "Your route could not be loaded. Please retry or contact the office." }, { status: 500 });
  }
}
