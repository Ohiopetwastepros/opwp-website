import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { cleanupDuplicateJobRecords, cleanupDuplicateShiftRecords, cleanupSyntheticJobRecords } from "@/lib/airtable";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") || "shifts";
  try {
    const result = scope === "jobs"
      ? await cleanupDuplicateJobRecords(url.searchParams.get("since") || undefined, url.searchParams.get("until") || undefined)
      : scope === "synthetic-jobs"
        ? await cleanupSyntheticJobRecords(url.searchParams.get("since") || "", url.searchParams.get("until") || "")
        : await cleanupDuplicateShiftRecords();
    return Response.json({ ok: true, scope, ...result });
  }
  catch (error) { return Response.json({ ok: false, error: String(error) }, { status: 502 }); }
}
