import { markSubmissionSynced, saveSubmission } from "@/lib/db";
import { sngRequest } from "@/lib/sweepandgo";
import { protectJsonRequest } from "@/lib/public-api-security";
import { validateWaitlistInput } from "@/lib/public-input";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const protectedRequest = await protectJsonRequest(request, { scope: "public_waitlist", limit: 5, windowSeconds: 3600, maxBytes: 16 * 1024, turnstile: true, action: "waitlist" });
  if (protectedRequest.response) return protectedRequest.response;
  const validation = validateWaitlistInput(protectedRequest.body);
  if (!validation.ok) return Response.json({ ok: false, error: validation.error }, { status: 400 });
  const body = validation.value;

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
