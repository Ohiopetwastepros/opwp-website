import { normalizeFrequency, normalizeLastCleaned, sngRequest } from "@/lib/sweepandgo";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const rate = await checkRateLimit(request, { scope: "public_quote", limit: 60, windowSeconds: 300, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get("zip");
  const dogs = searchParams.get("dogs");
  const frequency = searchParams.get("frequency");
  const lastCleaned = searchParams.get("last_cleaned") || "one_month";

  const dogCount = Number(dogs);
  if (!/^\d{5}$/.test(zip ?? "") || !Number.isInteger(dogCount) || dogCount < 1 || dogCount > 20 || !["twice_a_week", "once_a_week", "bi_weekly", "monthly", "one_time"].includes(String(frequency))) {
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
    return Response.json({ configured: true, ok: false, status: upstream.status, error: "Pricing is temporarily unavailable." });
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
