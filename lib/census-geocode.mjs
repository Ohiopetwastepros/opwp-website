import { readBoundedProviderJson } from './bounded-body.mjs';

// Census address-range matches are interpolated street locations, not rooftops.
// They are suitable for territory checks, never for property measurement.
export async function censusGeocode(address, fetcher = fetch) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.search = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = await readBoundedProviderJson(response, 65536);
    const matches = data.result?.addressMatches;
    if (!Array.isArray(matches) || matches.length !== 1) return null;
    const match = matches[0], parts = match.addressComponents;
    const latitude = match.coordinates?.y, longitude = match.coordinates?.x;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 38 || latitude > 44 || longitude < -86 || longitude > -80 || !['OH', 'MI'].includes(parts?.state)) return null;
    const zip = address.match(/\b\d{5}(?:-\d{4})?\s*$/)?.[0]?.slice(0, 5);
    if (zip && zip !== parts.zip) return null;
    return { latitude, longitude, formattedAddress: match.matchedAddress, confidence: null, matchType: 'census_interpolated', placeId: '', city: parts.city || '', postcode: parts.zip || '', stateCode: parts.state };
  } catch { return null; }
}
