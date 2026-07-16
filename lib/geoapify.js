import { getRuntimeEnv } from "./cloudflare";

const API_BASE_URL = "https://api.geoapify.com";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ROUTE_WAYPOINTS = 25;

function apiKey() {
  return getRuntimeEnv().GEOAPIFY_API_KEY;
}

export function geoapifyConfigured() {
  return Boolean(apiKey());
}

async function geoapifyRequest(path, searchParams, { method = "GET", body } = {}) {
  const key = apiKey();
  if (!key) return { configured: false, ok: false, status: 0, data: null, error: "Geoapify is not configured." };

  const url = new URL(path, API_BASE_URL);
  for (const [name, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  url.searchParams.set("apiKey", key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { configured: true, ok: false, status: response.status, data: null, error: "Geoapify request failed." };
    return { configured: true, ok: true, status: response.status, data, error: null };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error && error.name === "AbortError" ? "Geoapify request timed out." : "Geoapify could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function geocodeAddress(address) {
  const result = await geoapifyRequest("/v1/geocode/search", {
    text: address,
    format: "json",
    filter: "countrycode:us",
    bias: "proximity:-83.5552,41.6528",
    lang: "en",
    limit: 1,
  });
  if (!result.ok) return result;

  const match = result.data?.results?.[0];
  const latitude = Number(match?.lat);
  const longitude = Number(match?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ...result, ok: false, data: null, error: "No usable address match was found." };
  }
  return {
    ...result,
    data: {
      latitude,
      longitude,
      formattedAddress: match.formatted || "",
      confidence: Number.isFinite(Number(match.rank?.confidence)) ? Number(match.rank.confidence) : null,
      matchType: match.rank?.match_type || "",
      placeId: match.place_id || "",
      city: match.city || match.town || match.village || match.county || "",
      postcode: match.postcode || "",
      stateCode: match.state_code || "",
    },
  };
}

async function routeChunk(points) {
  const result = await geoapifyRequest("/v1/routing", {
    waypoints: points.map((point) => `${point.latitude},${point.longitude}`).join("|"),
    mode: "drive",
    traffic: "approximated",
    intermediate_waypoint_mode: "stopover",
    units: "imperial",
    format: "json",
  });
  if (!result.ok) return result;
  const route = result.data?.results?.[0];
  const timeSeconds = Number(route?.time);
  const distance = Number(route?.distance);
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(distance)) {
    return { ...result, ok: false, data: null, error: "Geoapify returned an incomplete route." };
  }
  return { ...result, data: { timeSeconds, distanceMiles: distance } };
}

export async function calculateOrderedRoute(points) {
  if (points.length < 2) {
    return { configured: geoapifyConfigured(), ok: true, status: 200, data: { timeSeconds: 0, distanceMiles: 0, requests: 0 } };
  }

  let timeSeconds = 0;
  let distanceMiles = 0;
  let requests = 0;
  for (let start = 0; start < points.length - 1; start += MAX_ROUTE_WAYPOINTS - 1) {
    const chunk = points.slice(start, start + MAX_ROUTE_WAYPOINTS);
    if (chunk.length < 2) break;
    const result = await routeChunk(chunk);
    requests += 1;
    if (!result.ok) return { ...result, data: { timeSeconds, distanceMiles, requests } };
    timeSeconds += result.data.timeSeconds;
    distanceMiles += result.data.distanceMiles;
  }
  return { configured: true, ok: true, status: 200, data: { timeSeconds, distanceMiles, requests } };
}

export async function calculateRouteMatrix(points) {
  if (points.length < 2) {
    return { configured: geoapifyConfigured(), ok: true, status: 200, data: { matrix: [], requests: 0 } };
  }
  const locations = points.map((point) => ({ location: [point.longitude, point.latitude] }));
  const result = await geoapifyRequest("/v1/routematrix", {}, {
    method: "POST",
    body: { mode: "drive", traffic: "approximated", sources: locations, targets: locations },
  });
  if (!result.ok) return result;
  const matrix = result.data?.sources_to_targets;
  if (!Array.isArray(matrix) || matrix.length !== points.length) {
    return { ...result, ok: false, data: null, error: "Geoapify returned an incomplete route matrix." };
  }
  return { ...result, data: { matrix, requests: 1 } };
}
