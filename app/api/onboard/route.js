// Server-side proxy to the Pipedream "create client" workflow.
// Pipedream calls SNG PUT /api/v1/residential/onboarding, writes property/
// access notes to Airtable, and sends Craig a notification.
//
// Required Vercel env var to go live:
//   PIPEDREAM_ONBOARD_URL = HTTP trigger URL of your Pipedream onboarding workflow
//
// Until that var is set, returns { configured: false } and the form shows
// a manual-followup confirmation instead of redirecting to SNG payment.

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  const endpoint = process.env.PIPEDREAM_ONBOARD_URL;
  if (!endpoint) {
    return Response.json({ configured: false, reason: "no_endpoint" });
  }

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return Response.json({ configured: true, ok: r.ok, status: r.status, data });
  } catch (err) {
    return Response.json({ configured: true, ok: false, error: String(err) });
  }
}
