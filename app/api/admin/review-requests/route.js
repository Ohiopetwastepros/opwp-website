import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { protectJsonRequest } from "@/lib/public-api-security";
import { getReviewRequestAdminData, setReviewDoNotContact } from "@/lib/review-requests.js";

export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Keep contact details and provider payloads out of the browser response.
async function displayData(env) {
  const data = await getReviewRequestAdminData(env);
  return {
    ok: true, enabled: data.enabled === true, enabledAt: data.enabledAt || null,
    rows: (data.rows || []).map(row => ({
      id: row.id, customer_key: row.customer_key, customer_name: row.customer_name,
      job_date: row.job_date, tech: row.tech, channel: row.channel, status: row.status,
      reason: row.reason, created_at: row.created_at, sent_at: row.sent_at,
      phone_last4: /^\d{4}$/.test(String(row.phone_last4 || "")) ? row.phone_last4 : null,
    })),
    contacts: (data.contacts || []).map(contact => ({
      customer_key: contact.customer_key, customer_name: contact.customer_name,
      do_not_contact: Number(contact.do_not_contact) === 1 || contact.do_not_contact === true,
    })),
  };
}

export async function GET() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return json({ ok: false, error: "Unauthorized" }, 401);
  const env = getRuntimeEnv();
  if (!env.DB) return json({ ok: false, error: "Review-request storage is unavailable." }, 503);
  try { return json(await displayData(env)); }
  catch { return json({ ok: false, error: "Review-request history could not be loaded." }, 503); }
}

export async function PATCH(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return json({ ok: false, error: "Unauthorized" }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ ok: false, error: "Cross-site request blocked." }, 403);
  }
  const guarded = await protectJsonRequest(request, { scope: `review_request_preferences:${auth.email}`, limit: 30, windowSeconds: 600, maxBytes: 1024, turnstile: false, failClosed: true });
  if (guarded.response) return guarded.response;
  const body = guarded.body;
  const customerKey = typeof body.customerKey === "string" ? body.customerKey : "";
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(customerKey) || typeof body.blocked !== "boolean" || Object.keys(body).some(key => !["customerKey", "blocked"].includes(key))) {
    return json({ ok: false, error: "A valid customer key and do-not-contact selection are required." }, 400);
  }
  const env = getRuntimeEnv();
  if (!env.DB) return json({ ok: false, error: "Review-request storage is unavailable." }, 503);
  try {
    await setReviewDoNotContact(env, { customerKey, blocked: body.blocked, actor: auth.email });
    return json(await displayData(env));
  } catch { return json({ ok: false, error: "The preference could not be saved. Refresh before trying again." }, 503); }
}
