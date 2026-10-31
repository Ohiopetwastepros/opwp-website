export const DAILY_ROUTE_ALGORITHM = "road-time-multistart-v1";
export const MAX_DAILY_ROUTE_STOPS = 60;

export function validDispatchDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function dispatchSelection(jobs) {
  const active = [], excluded = [], seen = new Set();
  for (const job of jobs) {
    if (!job.jobId || seen.has(job.jobId)) throw new Error("Dispatch contains missing or duplicate job identifiers.");
    seen.add(job.jobId);
    if (["missed", "skipped", "cancelled", "canceled", "completed"].includes(job.sourceStatus)) {
      excluded.push({ jobId: job.jobId, customerName: job.customerName, status: job.sourceStatus });
      continue;
    }
    if (!["pending", "dispatched"].includes(job.sourceStatus)) throw new Error("Dispatch has an unknown or started job status. Review SNG before rebuilding this route.");
    if (!job.address || !job.technicianId) throw new Error("Every dispatch job needs an address and assigned technician.");
    if (job.address.length > 500 || job.customerName.length > 200 || job.serviceName.length > 200) throw new Error("Dispatch contains oversized service details.");
    active.push({ ...job, serviceMinutes: job.estimatedServiceMinutes });
  }
  return { active, excluded };
}

export function validRoadPoint(point) {
  // OPWP's operating territory; reject null/zero/remote coordinates rather than
  // optimizing a route through an incorrectly located address.
  return point && typeof point.latitude === "number" && typeof point.longitude === "number"
    && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && point.latitude >= 38 && point.latitude <= 44 && point.longitude >= -86 && point.longitude <= -80;
}

export function validateRoadMatrix(matrix, size) {
  return Array.isArray(matrix) && matrix.length === size && matrix.every(row => Array.isArray(row) && row.length === size
    && row.every(cell => cell && typeof cell.time === "number" && Number.isFinite(cell.time) && cell.time >= 0
      && typeof cell.distance === "number" && Number.isFinite(cell.distance) && cell.distance >= 0));
}

export function routeCost(order, matrix) {
  let timeSeconds = 0, distanceMeters = 0;
  for (let i = 1; i < order.length; i++) {
    timeSeconds += matrix[order[i - 1]][order[i]].time;
    distanceMeters += matrix[order[i - 1]][order[i]].distance;
  }
  return { timeSeconds, distanceMeters };
}

function better(a, b) {
  return a.timeSeconds < b.timeSeconds - 0.001
    || (Math.abs(a.timeSeconds - b.timeSeconds) < 0.001 && a.distanceMeters < b.distanceMeters - 0.001);
}

function improve(initial, matrix) {
  let order = initial, cost = routeCost(order, matrix);
  // Deterministic bounded search over reversals, relocations and swaps. Every
  // candidate is scored in full because road times can be asymmetric.
  for (let pass = 0; pass < 16; pass++) {
    let next = order, nextCost = cost;
    const consider = candidate => {
      const value = routeCost(candidate, matrix);
      if (better(value, nextCost)) { next = candidate; nextCost = value; }
    };
    for (let a = 1; a < order.length - 1; a++) {
      for (let b = a + 1; b < order.length - 1; b++) {
        consider([...order.slice(0, a), ...order.slice(a, b + 1).reverse(), ...order.slice(b + 1)]);
        const swapped = [...order]; [swapped[a], swapped[b]] = [swapped[b], swapped[a]]; consider(swapped);
      }
      for (let b = 1; b < order.length - 1; b++) {
        if (a === b) continue;
        const moved = [...order]; moved.splice(b, 0, moved.splice(a, 1)[0]); consider(moved);
      }
    }
    if (next === order) break;
    order = next; cost = nextCost;
  }
  return { order, ...cost };
}

export function optimizeDailyRoute(matrix) {
  const size = matrix?.length;
  if (size < 2 || size > MAX_DAILY_ROUTE_STOPS + 1 || !validateRoadMatrix(matrix, size)) throw new Error("A complete bounded road matrix is required.");
  const sourceOrder = [0, ...Array.from({ length: size - 1 }, (_, i) => i + 1), 0];
  const baseline = { order: sourceOrder, ...routeCost(sourceOrder, matrix) };
  const seeds = [sourceOrder, [...sourceOrder].reverse()];
  for (let first = 1; first < size; first++) {
    const order = [0, first], remaining = new Set(sourceOrder.slice(1, -1).filter(i => i !== first));
    while (remaining.size) {
      const next = [...remaining].sort((a, b) => matrix[order.at(-1)][a].time - matrix[order.at(-1)][b].time || a - b)[0];
      order.push(next); remaining.delete(next);
    }
    seeds.push([...order, 0]);
  }
  const ranked = seeds.map(order => ({ order, ...routeCost(order, matrix) }))
    .sort((a, b) => a.timeSeconds - b.timeSeconds || a.distanceMeters - b.distanceMeters);
  const unique = new Map([sourceOrder, ...ranked.slice(0, 7).map(x => x.order)].map(order => [order.join(","), order]));
  let best = baseline;
  for (const order of unique.values()) {
    const candidate = improve(order, matrix);
    if (better(candidate, best)) best = candidate;
  }
  return { ...best, baseline, algorithm: DAILY_ROUTE_ALGORITHM, candidates: unique.size };
}
