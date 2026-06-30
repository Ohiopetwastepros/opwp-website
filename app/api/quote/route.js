// Server-side proxy to Sweep & Go's price endpoint.
// Keeps the SNG Bearer key OFF the client (read from Vercel env vars).
// When SNG_API_KEY + SNG_ORG_SLUG are not set, returns { configured: false }
// so the quote form falls back to the local pricing table.
//
// Required Vercel env vars to go live:
//   SNG_API_KEY   = Bearer token generated in Sweep & Go (Settings -> Open API)
//   SNG_ORG_SLUG  = organization slug (e.g. ohio-pet-waste-pros-qkr3c)

export const dynamic = "force-dynamic";

const SNG_PRICE_URL =
  "https://openapi.sweepandgo.com/api/v2/client_on_boarding/price_registration_form";

const VALID_FREQ = new Set([
  "twice_a_week",
  "once_a_week",
  "every_other_week",
  "once_a_month",
]);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get("zip");
  const dogs = searchParams.get("dogs");
  const frequency = searchParams.get("frequency");

  if (!zip || !dogs || !frequency) {
    return Response.json(
      { configured: false, error: "Need zip, dogs, frequency" },
      { status: 400 }
    );
  }

  const key = process.env.SNG_API_KEY;
  const org = process.env.SNG_ORG_SLUG;

  // Not provisioned yet -> tell the client to use local pricing.
  if (!key || !org) {
    return Response.json({ configured: false, reason: "no_credentials" });
  }

  // SNG's price endpoint only handles recurring frequencies.
  if (!VALID_FREQ.has(frequency)) {
    return Response.json({ configured: true, supported: false });
  }

  const url =
    `${SNG_PRICE_URL}?organization=${encodeURIComponent(org)}` +
    `&clean_up_frequency=${encodeURIComponent(frequency)}` +
    `&number_of_dogs=${encodeURIComponent(dogs)}` +
    `&zip_code=${encodeURIComponent(zip)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return Response.json(
        { configured: true, ok: false, status: res.status, raw: data },
        { status: 200 }
      );
    }

    // Best-effort normalization (exact SNG field names confirmed with SNG support).
    const monthly =
      data.price ?? data.total ?? data.monthly_price ?? data.amount ?? null;
    const tax = data.tax ?? data.tax_amount ?? null;
    const crossSells = data.cross_sells ?? data.crossSells ?? null;

    return Response.json({
      configured: true,
      ok: true,
      monthly,
      tax,
      crossSells,
      raw: data,
    });
  } catch (err) {
    return Response.json({ configured: true, ok: false, error: String(err) });
  }
}
