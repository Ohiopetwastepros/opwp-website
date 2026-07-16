import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { upsertSngDispatchJobs } from "@/lib/airtable";
import { sngRequest, sngRows } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ ok: false, error: "A valid date is required." }, { status: 400 });
  const result = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
  if (!result.ok) return Response.json({ ok: false, date, error: "Sweep & Go dispatch history could not be loaded.", status: result.status }, { status: 502 });
  try {
    const backfill = await upsertSngDispatchJobs(sngRows(result), date);
    return Response.json({ ok: true, date, ...backfill });
  } catch (error) {
    return Response.json({ ok: false, date, error: String(error) }, { status: 502 });
  }
}
