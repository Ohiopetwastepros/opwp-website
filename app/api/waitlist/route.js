import { markSubmissionSynced, saveSubmission } from "@/lib/db";
import { sngRequest } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || !/^\d{5}$/.test(String(body.zip ?? ""))) {
    return Response.json({ ok: false, error: "A valid ZIP code is required" }, { status: 400 });
  }

  const saved = await saveSubmission({ kind: "waitlist", source: "website", body });
  const upstream = await sngRequest("/api/v2/client_on_boarding/out_of_service_form", {
    method: "POST",
    body: {
      name: body.name || "Website visitor",
      address: body.address || "Not provided",
      email_address: body.email || "",
      zip_code: body.zip,
      comment: "Submitted through the Ohio Pet Waste Pros website.",
      phone: body.phone || "",
      marketing_allowed: body.consent ? 1 : 0,
      marketing_allowed_source: "open_api",
    },
  });

  await markSubmissionSynced(saved.id, upstream.data, upstream.ok);
  return Response.json({
    configured: upstream.configured,
    stored: saved.configured,
    ok: upstream.configured ? upstream.ok : true,
    status: upstream.status,
  });
}
