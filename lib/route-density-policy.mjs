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
  const match = String(stop.location?.formattedAddress || '').match(/,\s*([^,]+),\s*(?:OH|MI)\s+(\d{5})\b/i);
  return match ? regionForAddress(match[1], match[2]) : stop.region;
}

// Preserve every real route edge, including the depot, without an unbounded
// matrix. Adjacent chunks overlap at one stop; no artificial shortcut edges.
export async function evaluateRouteInsertion(candidate, stops, depot, calculateMatrix) {
  const route = depot ? [depot, ...stops, depot] : stops;
  let best = null;
  const nearest = [];
  for (let start = 0; start < route.length - 1; start += 27) {
    const chunk = route.slice(start, start + 28);
    const result = await calculateMatrix([candidate, ...chunk]);
    if (!result.ok) return null;
    const matrix = result.data.matrix;
    const value = (from, to, field) => {
      const v = matrix[from]?.[to]?.[field];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : Infinity;
    };
    for (let i = 1; i < chunk.length; i += 1) {
      const seconds = value(i, 0, 'time') + value(0, i + 1, 'time') - value(i, i + 1, 'time');
      const meters = value(i, 0, 'distance') + value(0, i + 1, 'distance') - value(i, i + 1, 'distance');
      if (!Number.isFinite(seconds) || !Number.isFinite(meters)) return null;
      if (!best || seconds < best.seconds) best = { seconds: Math.max(0, seconds), meters: Math.max(0, meters) };
    }
    chunk.forEach((point, i) => {
      const index = stops.indexOf(point);
      if (index >= 0 && !nearest.some(row => row.index === index)) nearest.push({ index, roadMinutes: value(0, i + 1, 'time') / 60, roadMiles: value(0, i + 1, 'distance') / 1609.344 });
    });
  }
  return best ? { ...best, nearest: nearest.filter(row => Number.isFinite(row.roadMinutes)).sort((a,b) => a.roadMinutes - b.roadMinutes).slice(0,3) } : null;
}
