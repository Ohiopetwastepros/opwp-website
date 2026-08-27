function matrixValue(matrix, from, to, field) {
  const value = Number(matrix[from]?.[to]?.[field]);
  return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

function orderCost(order, matrix, field = "time") {
  let total = 0;
  for (let index = 1; index < order.length; index += 1) {
    const value = matrixValue(matrix, order[index - 1], order[index], field);
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
    total += value;
  }
  return total;
}

function nearestNeighborOrder(matrix, start) {
  const order = [start];
  const unvisited = new Set(matrix.map((_, index) => index).filter((index) => index !== start));
  while (unvisited.size) {
    const current = order.at(-1);
    let next = null;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of unvisited) {
      const value = matrixValue(matrix, current, candidate, "time");
      if (value < best) {
        best = value;
        next = candidate;
      }
    }
    if (next === null) return null;
    order.push(next);
    unvisited.delete(next);
  }
  return order;
}

export function optimizeClosedRoute(matrix, depotIndex = 0) {
  if (!Array.isArray(matrix) || !matrix.length) return { order: [], timeSeconds: 0, distanceMeters: 0 };
  const initial = nearestNeighborOrder(matrix, depotIndex);
  if (!initial) return null;
  let order = [...initial, depotIndex];
  let bestCost = orderCost(order, matrix);

  for (let pass = 0; pass < 6; pass += 1) {
    let improved = false;
    for (let from = 1; from < order.length - 2; from += 1) {
      for (let to = from + 1; to < order.length - 1; to += 1) {
        const candidate = [...order.slice(0, from), ...order.slice(from, to + 1).reverse(), ...order.slice(to + 1)];
        const cost = orderCost(candidate, matrix);
        if (cost + 0.5 < bestCost) {
          order = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { order, timeSeconds: bestCost, distanceMeters: orderCost(order, matrix, "distance") };
}

export function closedRouteInsertion(matrix, depotIndex = 1, candidateIndex = 0) {
  if (!Array.isArray(matrix) || matrix.length < 3) return null;
  const orderedStops = matrix.map((_, index) => index).filter((index) => index !== candidateIndex && index !== depotIndex);
  const route = [depotIndex, ...orderedStops, depotIndex];
  const options = [];
  for (let index = 0; index < route.length - 1; index += 1) {
    const from = route[index];
    const to = route[index + 1];
    options.push({
      position: index === 0 ? "start" : index === route.length - 2 ? "end" : `after:${index - 1}`,
      seconds: matrixValue(matrix, from, candidateIndex, "time") + matrixValue(matrix, candidateIndex, to, "time") - matrixValue(matrix, from, to, "time"),
      meters: matrixValue(matrix, from, candidateIndex, "distance") + matrixValue(matrix, candidateIndex, to, "distance") - matrixValue(matrix, from, to, "distance"),
    });
  }
  return options.filter((item) => Number.isFinite(item.seconds) && Number.isFinite(item.meters)).sort((left, right) => left.seconds - right.seconds)[0] ?? null;
}
