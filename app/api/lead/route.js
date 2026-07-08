// Server-side proxy to the Pipedream "partial lead / abandoned quote" workflow.
// Fires as soon as a visitor enters a valid phone + email on step 1, BEFORE they
// finish signup — so Craig can follow up on quotes that never complete, the same
// way Sweep & Go emails abandoned online quotes.
//
// Pipedream should write the lead to Airtable and/or email Craig a follow-up alert.
//
// Required Vercel env var to go live:
//   PIPEDREAM_LEAD_URL = HTTP trigger URL of your Pipedream partial-lead workflow
//
// Until that var is set, returns { configured: false } — the form ignores the
// response either way (fire-and-forget), so nothing breaks while it's unwired.

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  const endpoint = process.env.PIPEDREAM_LEAD_URL;
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
