import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { verifyOfficeRequest } from "@/lib/field-auth";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getSeasonalPauseReport } from "@/lib/seasonal-pause-report.mjs";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Vary": "Cookie" };

export async function GET() {
  const requestHeaders = await headers();
  const db = getDb();
  const office = await verifyOfficeRequest(requestHeaders, db);
  const officeAuthorized = office.authorized && office.member?.organizationId === "org-opwp";
  const auth = officeAuthorized ? office : await verifyAdminRequest(requestHeaders);
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!db) return Response.json({ ok: false, error: "Seasonal pause storage is not configured." }, { status: 503, headers: PRIVATE_HEADERS });
  try {
    return Response.json({ ok: true, report: await getSeasonalPauseReport(db) }, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ ok: false, error: "The seasonal pause report is unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
