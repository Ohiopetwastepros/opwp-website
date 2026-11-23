// Capacity is an operational warning, never a reason to scatter the route.
export function compareRouteDensity(left, right) {
  // Geography is filtered before ranking. Workload may offset at most four
  // added drive minutes; it cannot move an isolated customer to a distant day.
  const score = row => row.insertionMinutes + (Number.isFinite(row.projectedMinutes)
    ? Math.min(3, Math.max(0, row.projectedMinutes - 480) / 60) + Math.min(1, row.projectedMinutes / 480) : 0);
  return score(left) - score(right)
    || left.insertionMinutes - right.insertionMinutes
    || left.insertionMiles - right.insertionMiles
    || (left.nearest?.[0]?.roadMinutes ?? Infinity) - (right.nearest?.[0]?.roadMinutes ?? Infinity)
    || right.regionDensity - left.regionDensity
    || left.day.localeCompare(right.day);
}

export function resolvedStopRegion(stop, regionForAddress) {
  const match = String(stop.location?.formattedAddress || '').match(/,\s*([^,]+),\s*(?:OH|MI)(?:\s*,\s*|\s+)(\d{5})\b/i);
  return match ? regionForAddress(match[1], match[2]) : stop.region;
}

// Saved plans carry stop order but no individual edge distances. Estimate a
// conservative out-and-back spur to the nearest road match, preserving that
// order, rather than fetching a full matrix to subtract an unknown route edge.
export async function evaluateRouteInsertion(candidate, neighbors, calculateRoadMatches) {
  if (!Array.isArray(neighbors) || !neighbors.length || neighbors.length > 5) return null;
  const matches = await calculateRoadMatches(candidate, neighbors);
  const nearest = (matches || []).filter(row => Number.isInteger(row.index) && row.index >= 0 && row.index < neighbors.length
    && Number.isFinite(row.roadMinutes) && row.roadMinutes >= 0 && Number.isFinite(row.roadMiles) && row.roadMiles >= 0)
    .sort((a, b) => a.roadMinutes - b.roadMinutes || a.roadMiles - b.roadMiles);
  if (!nearest.length) return null;
  return { seconds: nearest[0].roadMinutes * 120, meters: nearest[0].roadMiles * 3218.688,
    nearest, method: 'nearest_neighbor_estimate' };
}
