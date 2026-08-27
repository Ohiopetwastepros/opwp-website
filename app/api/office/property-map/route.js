import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { verifyOfficeRequest } from "@/lib/field-auth";
import { resolvePropertyLocation } from "@/lib/route-intelligence";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const db = getDb();
  const auth = await verifyOfficeRequest(await headers(), db);
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!db) return Response.json({ ok: false, error: "Property mapping is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const address = String(body?.address || "").trim().slice(0, 300);
  if (!address) return Response.json({ ok: false, error: "Enter the complete service address." }, { status: 400 });
  try {
    const location = await resolvePropertyLocation(db, address);
    return Response.json({ ok: true, location }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "The property could not be mapped." }, { status: 502 });
  }
}
