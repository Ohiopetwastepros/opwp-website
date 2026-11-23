// Display positions only. Source coordinates and assigned route order stay intact.
export const ROUTE_MARKER_SPACING = 80;

export function layoutRouteMarkers(stops, mapHeight = 410) {
  const located = stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => stop.latitude != null && stop.longitude != null && Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)));
  if (!located.length) return [];
  const bounds = located.reduce((b, { stop }) => ({ minLat: Math.min(b.minLat, Number(stop.latitude)), maxLat: Math.max(b.maxLat, Number(stop.latitude)), minLng: Math.min(b.minLng, Number(stop.longitude)), maxLng: Math.max(b.maxLng, Number(stop.longitude)) }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
  const placed = [];
  const clearance = (x, y) => placed.reduce((distance, marker) => Math.min(distance, Math.hypot(marker.x - x, marker.y - y)), Infinity);
  for (const entry of located) {
    const projectedX = 48 + ((Number(entry.stop.longitude) - bounds.minLng) / Math.max(.025, bounds.maxLng - bounds.minLng)) * 464;
    const projectedY = mapHeight - 45 - ((Number(entry.stop.latitude) - bounds.minLat) / Math.max(.025, bounds.maxLat - bounds.minLat)) * (mapHeight - 90);
    let x = projectedX, y = projectedY;
    if (clearance(x, y) < ROUTE_MARKER_SPACING) {
      let nearest = Infinity, widest = -1, fallback = [x, y];
      // A small fixed grid finds the nearest free position, including at edges.
      // Stable route order and scan order make coincident stops deterministic.
      for (let candidateY = 45; candidateY <= mapHeight - 45; candidateY += 8) {
        for (let candidateX = 48; candidateX <= 512; candidateX += 8) {
          const free = clearance(candidateX, candidateY);
          if (free > widest) { widest = free; fallback = [candidateX, candidateY]; }
          const distance = (candidateX - projectedX) ** 2 + (candidateY - projectedY) ** 2;
          if (free >= ROUTE_MARKER_SPACING && distance < nearest) { nearest = distance; x = candidateX; y = candidateY; }
        }
      }
      if (!Number.isFinite(nearest)) [x, y] = fallback;
    }
    placed.push({ ...entry, x, y });
  }
  return placed;
}
