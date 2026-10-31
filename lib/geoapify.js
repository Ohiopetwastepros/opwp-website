import { getRuntimeEnv } from "./cloudflare";
import { readBoundedProviderJson } from "./bounded-body.mjs";
import { validateRoadMatrix, validRoadPoint, MAX_DAILY_ROUTE_STOPS } from "./daily-route-optimizer.mjs";
import { controlledRoutingRequest, routingRequestKey } from "./routing-provider-control.mjs";
import { censusGeocode } from "./census-geocode.mjs";

const API_BASE_URL = "https://api.geoapify.com";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ROUTE_WAYPOINTS = 25;
const MAX_MATRIX_BLOCK_POINTS = 31; // 31 x 31 = 961, below the 1,000-cell provider limit.

function apiKey() {
  return getRuntimeEnv().GEOAPIFY_API_KEY;
}

export function geoapifyConfigured() {
  return Boolean(apiKey());
}

async function geoapifyRequest(path, searchParams, options = {}) {
  const { body } = options;
  const env = getRuntimeEnv();
  const cost = body?.sources && body?.targets ? Math.max(body.sources.length, body.targets.length) * Math.min(body.sources.length, body.targets.length, 10)
    : path === '/v1/routing' ? Math.max(1, String(searchParams?.waypoints || '').split('|').length - 1) : 1;
  return controlledRoutingRequest({ db: env.DB, key: await routingRequestKey(path, searchParams, body), cost, ttl: 30 * 86400,
    request: () => rawGeoapifyRequest(path, searchParams, options) });
}

async function rawGeoapifyRequest(path, searchParams, { method = "GET", body, maxResponseBytes } = {}) {
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
    const data = await (maxResponseBytes ? readBoundedProviderJson(response,maxResponseBytes) : response.json()).catch(() => ({}));
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'route_provider_rejected', operation: path, status: response.status }));
      const quota = response.status === 429 && /quota/i.test(String(data?.message || ''));
      return { configured: true, ok: false, status: response.status, data: null, error: quota ? 'Live road-time quota is exhausted; current route geography is still available.' : 'The road-time provider is temporarily unavailable.', errorCode: quota ? 'quota_exceeded' : response.status === 429 ? 'rate_limited' : 'provider_unavailable' };
    }
    const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const usable = path === '/v1/geocode/search' ? data?.results?.some(match => typeof match.lat === 'number' && typeof match.lon === 'number' && Number.isFinite(match.lat) && Number.isFinite(match.lon))
      : path === '/v1/routematrix' ? Array.isArray(data?.sources_to_targets) && data.sources_to_targets.length === body?.sources?.length && data.sources_to_targets.every(row => Array.isArray(row) && row.length === body.targets.length)
      : path === '/v1/routing' ? validNumber(data?.results?.[0]?.time) && validNumber(data?.results?.[0]?.distance) : false;
    if (!usable) return { configured: true, ok: false, status: response.status, data: null, error: 'The mapping provider returned no usable result.', errorCode: 'unusable_result' };
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

export async function geocodeAddress(address, { censusFallback = true } = {}) {
  const result = await geoapifyRequest("/v1/geocode/search", {
    text: address,
    format: "json",
    filter: "countrycode:us",
    bias: "proximity:-83.5552,41.6528",
    lang: "en",
    limit: 1,
  }, { maxResponseBytes: 65536 });
  if (!result.ok) {
    const fallback = censusFallback ? await censusGeocode(address) : null;
    return fallback ? { ok: true, configured: true, status: 200, data: fallback } : result;
  }

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
  if (!Array.isArray(points)) return { ok: false, data: null, error: "Route matrix points are required." };
  if (points.length < 2) {
    return { configured: geoapifyConfigured(), ok: true, status: 200, data: { matrix: [], requests: 0 } };
  }
  // Subscription routes share dispatch's bounded matrix assembly. Include the
  // depot in the limit; never truncate stops or lose cross-block road legs.
  return boundedRouteMatrix(points, 201);
}

// Only candidate-to-neighbor road legs, not a matrix of the whole route book.
// Five neighbors cost at most ten credits per day checked (both directions).
export async function calculateCandidateRoadMatches(candidate, targets) {
  if (!validRoadPoint(candidate) || !Array.isArray(targets) || !targets.length || targets.length > 5 || !targets.every(validRoadPoint)) return null;
  const location = point => ({ location: [point.longitude, point.latitude] });
  const outgoing = await geoapifyRequest('/v1/routematrix', {}, { method: 'POST', maxResponseBytes: 65536,
    body: { mode: 'drive', traffic: 'approximated', sources: [location(candidate)], targets: targets.map(location) } });
  if (!outgoing.ok) return null;
  const incoming = await geoapifyRequest('/v1/routematrix', {}, { method: 'POST', maxResponseBytes: 65536,
    body: { mode: 'drive', traffic: 'approximated', sources: targets.map(location), targets: [location(candidate)] } });
  if (!incoming.ok) return null;
  const rows = targets.map((_, index) => {
    const out = outgoing.data?.sources_to_targets?.[0]?.[index], back = incoming.data?.sources_to_targets?.[index]?.[0];
    if (![out?.time, out?.distance, back?.time, back?.distance].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null;
    return { index, roadMinutes: (out.time + back.time) / 120, roadMiles: (out.distance + back.distance) / 3218.688 };
  });
  const usable = rows.filter(Boolean).sort((a, b) => a.roadMinutes - b.roadMinutes || a.roadMiles - b.roadMiles);
  return usable.length ? usable : null;
}

// Daily dispatch can exceed one provider request's 1,000-cell limit. Split the
// matrix, never the customer route, so cross-block moves remain possible.
export async function calculateDispatchMatrix(points) {
  return boundedRouteMatrix(points, MAX_DAILY_ROUTE_STOPS + 1);
}

async function boundedRouteMatrix(points, maxPoints) {
  if (!Array.isArray(points) || points.length < 2 || points.length > maxPoints || !points.every(validRoadPoint)) return { ok: false, data: null, error: "Route matrix exceeds the analysis limit or has invalid coordinates." };
  const matrix = Array.from({ length: points.length }, () => Array(points.length));
  const location = point => ({ location: [point.longitude, point.latitude] });
  let requests = 0;
  for (let from = 0; from < points.length; from += MAX_MATRIX_BLOCK_POINTS) {
    for (let to = 0; to < points.length; to += MAX_MATRIX_BLOCK_POINTS) {
      const sources = points.slice(from, from + MAX_MATRIX_BLOCK_POINTS), targets = points.slice(to, to + MAX_MATRIX_BLOCK_POINTS);
      const result = await geoapifyRequest("/v1/routematrix", {}, {
        method: "POST", maxResponseBytes: 512 * 1024,
        body: { mode: "drive", traffic: "approximated", sources: sources.map(location), targets: targets.map(location) },
      });
      requests++;
      const rows = result.data?.sources_to_targets;
      if (!result.ok) return { ...result, data: null };
      if (!Array.isArray(rows) || rows.length !== sources.length || rows.some(row => !Array.isArray(row) || row.length !== targets.length)) return { ok: false, data: null, error: "Geoapify returned an incomplete route matrix." };
      for (let i = 0; i < sources.length; i++) for (let j = 0; j < targets.length; j++) {
        const cell = rows[i][j];
        matrix[from + i][to + j] = { time: cell?.time, distance: cell?.distance };
      }
    }
  }
  return validateRoadMatrix(matrix, points.length) ? { configured: true, ok: true, status: 200, data: { matrix, requests } } : { ok: false, data: null, error: "Geoapify returned unavailable road legs." };
}

// Bounded, ordered legs for observed stop transitions. No route optimization.
export async function calculateTravelLegs(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_ROUTE_WAYPOINTS || points.some(p => !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180)) return { ok: false, data: null };
  const result = await geoapifyRequest("/v1/routing", {
    waypoints: points.map(p => `${p.latitude},${p.longitude}`).join("|"),
    mode: "drive", traffic: "approximated", intermediate_waypoint_mode: "stopover", units: "imperial", format: "json",
  }, { maxResponseBytes: 2 * 1024 * 1024 });
  const legs = result.data?.results?.[0]?.legs;
  if (!result.ok || !Array.isArray(legs) || legs.length !== points.length - 1 || legs.some(leg => typeof leg.time !== "number" || typeof leg.distance !== "number" || !Number.isFinite(leg.time) || !Number.isFinite(leg.distance) || leg.time < 0 || leg.time > 86400 || leg.distance < 0 || leg.distance > 1000)) return { ok: false, data: null };
  return { ok: true, data: legs.map(leg => ({ minutes: leg.time / 60, miles: leg.distance })) };
}
