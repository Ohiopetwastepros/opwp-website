import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { finalizeRoutePartnerPlan, getRoutePartnerDay, importRoutePartnerDay } from "@/lib/route-partner";
import { sngRequest, sngRows } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

async function context() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return { response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const db = getDb();
  if (!db) return { response: Response.json({ ok: false, error: "Route Partner storage is not configured." }, { status: 503 }) };
  return { auth, db };
}

export async function GET(request) {
  const current = await context();
  if (current.response) return current.response;
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!validDate(date)) return Response.json({ ok: false, error: "A valid service date is required." }, { status: 400 });
  try {
    return Response.json({ ok: true, day: await getRoutePartnerDay(current.db, date) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The route day could not be loaded.";
    console.error(JSON.stringify({ message: "route partner day load failed", date, error: message }));
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(request) {
  const current = await context();
  if (current.response) return current.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "A valid JSON request is required." }, { status: 400 });
  }

  const action = String(body?.action ?? "");
  try {
    if (action === "import") {
      const date = String(body?.date ?? "");
      if (!validDate(date)) return Response.json({ ok: false, error: "A valid service date is required." }, { status: 400 });
      const dispatch = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
      if (!dispatch.configured) return Response.json({ ok: false, error: "Sweep & Go is not configured." }, { status: 503 });
      if (!dispatch.ok) return Response.json({ ok: false, error: `Sweep & Go returned status ${dispatch.status}.` }, { status: 502 });
      const imported = await importRoutePartnerDay({ db: current.db, date, sourceRows: sngRows(dispatch), actor: current.auth.email });
      const day = await getRoutePartnerDay(current.db, date);
      console.log(JSON.stringify({ message: "route partner day imported", date, actor: current.auth.email, ...imported }));
      return Response.json({ ok: true, imported, day }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "finalize") {
      const planId = String(body?.planId ?? "");
      const date = String(body?.date ?? "");
      if (!planId || !validDate(date)) return Response.json({ ok: false, error: "A route plan and service date are required." }, { status: 400 });
      const finalized = await finalizeRoutePartnerPlan({ db: current.db, planId, actor: current.auth.email });
      const day = await getRoutePartnerDay(current.db, date);
      console.log(JSON.stringify({ message: "route partner plan finalized", planId, date, actor: current.auth.email, unchanged: finalized.unchanged }));
      return Response.json({ ok: true, finalized, day }, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ ok: false, error: "The requested action is not supported." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The route operation failed.";
    console.error(JSON.stringify({ message: "route partner operation failed", action, actor: current.auth.email, error: message }));
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
