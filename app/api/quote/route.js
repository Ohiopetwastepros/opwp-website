import { normalizeFrequency, normalizeLastCleaned, sngRequest } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get("zip");
  const dogs = searchParams.get("dogs");
  const frequency = searchParams.get("frequency");
  const lastCleaned = searchParams.get("last_cleaned") || "one_month";

  if (!/^\d{5}$/.test(zip ?? "") || !dogs || !frequency) {
    return Response.json({ configured: false, error: "Need valid zip, dogs, and frequency" }, { status: 400 });
  }

  const upstream = await sngRequest("/api/v2/client_on_boarding/price_registration_form", {
    searchParams: {
      last_time_yard_was_thoroughly_cleaned: normalizeLastCleaned(lastCleaned),
      clean_up_frequency: normalizeFrequency(frequency),
      number_of_dogs: dogs,
      zip_code: zip,
    },
  });

  if (!upstream.configured) {
    return Response.json({ configured: false, reason: "no_credentials" });
  }
  if (!upstream.ok) {
    return Response.json({ configured: true, ok: false, status: upstream.status, raw: upstream.data });
  }

  const value = upstream.data?.price?.value ?? upstream.data?.price ?? null;
  const monthly = value == null || Number.isNaN(Number(value)) ? null : Number(value);
  return Response.json({
    configured: true,
    ok: true,
    monthly,
    tax: upstream.data?.tax_percent ?? null,
    crossSells: upstream.data?.cross_sells ?? null,
  });
}
