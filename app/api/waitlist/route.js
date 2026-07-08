// Server-side proxy to the Pipedream "out-of-area waitlist" workflow.
// Pipedream writes a lead to SNG's out-of-service lead endpoint and/or Airtable.
//
// Required Vercel env var to go live:
//   PIPEDREAM_WAITLIST_URL = HTTP trigger URL of your Pipedream waitlist workflow
//
// Until that var is set, returns { configured: false } — the form still shows
// the OOA confirmation (lead is not yet stored anywhere).

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  const endpoint = process.env.PIPEDREAM_WAITLIST_URL;
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
    return Response.json({ configured: true, ok: r.ok, data });
  } catch (err) {
    return Response.json({ configured: true, ok: false, error: String(err) });
  }
}
