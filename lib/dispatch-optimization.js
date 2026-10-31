import staffPrivate from './staff-private.json' with {type:'json'};
import { resolveRouteStops, TONY_ROUTE_DEPOT_ADDRESS } from "./route-intelligence";
import { calculateDispatchMatrix } from "./geoapify";
import { DAILY_ROUTE_ALGORITHM, MAX_DAILY_ROUTE_STOPS, optimizeDailyRoute, validRoadPoint, validateRoadMatrix } from "./daily-route-optimizer.mjs";

async function reserveProviderBudget(db, units) {
  // Shared across all users/IPs. Cells conservatively overcount matrix credits;
  // geocoding is reserved before any provider call, including failed calls.
  const start = Math.floor(Date.now() / 86400000) * 86400;
  const row = await db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at)
    VALUES ('dispatch_road_budget','global',?,?,datetime(?,'unixepoch'))
    ON CONFLICT(scope,client_key,window_start) DO UPDATE SET request_count=request_count+excluded.request_count RETURNING request_count`)
    .bind(start, units, start + 172800).first();
  if (!row || Number(row.request_count) > 6000) throw new Error("Daily routing allowance reached. The previous route is retained; retry tomorrow.");
}

export async function optimizeDispatchLocations(db, locations, group, date) {
  const fallback = reason => ({ locations, optimization: { status: "needs_review", reason, algorithm: DAILY_ROUTE_ALGORITHM } });
  if (locations.length > MAX_DAILY_ROUTE_STOPS) return fallback(`Route exceeds the ${MAX_DAILY_ROUTE_STOPS}-stop optimization limit. No stops were removed.`);
  if (group.technicianId !== staffPrivate.providerIds.primary) return fallback("Confirm this technician's start and finish address before road optimization.");
  if (group.jobs.some(job => job.timeWindow)) return fallback("This route has appointment constraints. Preserve SNG order until those constraints are reviewed.");
  const candidates = [{ address: TONY_ROUTE_DEPOT_ADDRESS }, ...locations.map(l => ({ address: l.address, location: validRoadPoint(l) ? { latitude: l.latitude, longitude: l.longitude } : null }))];
  // Resolve only missing coordinates. Existing street matches are reused by the
  // shared geocoder; SNG coordinates avoid inaccurate source ZIP assumptions.
  const missing = candidates.filter(p => !validRoadPoint(p.location));
  if (missing.length) {
    await reserveProviderBudget(db, missing.length);
    const resolved = await resolveRouteStops(db, missing, Math.min(missing.length, 61));
    for (let i = 0; i < missing.length; i++) missing[i].location = resolved[i].location;
  }
  if (candidates.some(p => !validRoadPoint(p.location))) return fallback("A complete street location is needed for every stop and the depot. SNG order is retained.");
  const points = candidates.map(p => p.location);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(points.map(p => [p.latitude, p.longitude]))));
  const key = `dispatch_matrix_v1:${date}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const stored = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(key).first();
  let cached;
  try { cached = JSON.parse(stored?.payload || "null"); } catch { cached = null; }
  let matrix = cached?.matrix;
  if (!validateRoadMatrix(matrix, points.length) || !Number.isFinite(Date.parse(cached?.capturedAt)) || Date.now() - Date.parse(cached?.capturedAt) > 86400000) {
    await reserveProviderBudget(db, points.length ** 2);
    const result = await calculateDispatchMatrix(points);
    if (!result.ok) return fallback("Road-time provider could not validate every leg. SNG order is retained; refresh before release.");
    matrix = result.data.matrix;
    cached = { matrix, capturedAt: new Date().toISOString() };
    await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
      ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(key, JSON.stringify(cached), cached.capturedAt).run();
  }
  const result = optimizeDailyRoute(matrix);
  const ordered = result.order.slice(1, -1).map((index, position) => ({
    ...locations[index - 1], latitude: points[index].latitude, longitude: points[index].longitude,
    sourceSequence: index, sequence: position + 1,
    estimatedDriveMinutes: matrix[result.order[position]][index].time / 60,
  }));
  const serviceMinutes = ordered.reduce((sum, l) => sum + l.estimatedMinutes, 0);
  const missingEstimates = ordered.flatMap(l => l.tasks).filter(t => t.estimatedMinutes <= 0).length;
  return { locations: ordered, optimization: {
    status: missingEstimates ? "needs_review" : "optimized", reason: missingEstimates ? `${missingEstimates} service estimates are missing. Check SNG before release.` : null,
    algorithm: result.algorithm, candidates: result.candidates, depotAddress: TONY_ROUTE_DEPOT_ADDRESS,
    baselineDriveMinutes: result.baseline.timeSeconds / 60, driveMinutes: result.timeSeconds / 60,
    baselineMiles: result.baseline.distanceMeters / 1609.344, miles: result.distanceMeters / 1609.344,
    savedMinutes: (result.baseline.timeSeconds - result.timeSeconds) / 60,
    savedMiles: (result.baseline.distanceMeters - result.distanceMeters) / 1609.344,
    serviceMinutes, plannedMinutes: serviceMinutes + result.timeSeconds / 60,
    returnMinutes: matrix[result.order.at(-2)][0].time / 60,
    calculatedAt: cached.capturedAt, sourceOrder: locations.map(l => l.locationKey),
    explanation: "Fastest route found using road-time estimates, multiple starting orders, reversals, relocations and swaps. Both depot legs included. Service days and technician assignments preserved. Traffic, breaks and customer access can change actual time.",
  } };
}
