import { calculateOrderedRoute, calculateRouteMatrix, geocodeAddress } from "./geoapify";

const PLANNING_TARGET_MINUTES = 480;

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function text(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function durationMinutes(value) {
  if (typeof value === "number") return value > 0 ? value : 0;
  const raw = text(value);
  if (!raw) return 0;
  const parts = raw.split(":").map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1] + parts[2] / 60;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizedAddress(row) {
  const nested = row.client ?? row.customer ?? row.location ?? {};
  const complete = firstValue(row.service_address, row.full_address, row.client_address, row.home_address, nested.full_address, nested.address);
  if (complete && typeof complete !== "object") return text(complete).replace(/\s+/g, " ");
  const street = firstValue(row.address, row.street_address, row.address_1, row.address1, nested.street_address, nested.address_1);
  const city = firstValue(row.city, row.service_city, nested.city);
  const state = firstValue(row.state, row.service_state, nested.state, "OH");
  const zip = firstValue(row.zip, row.zip_code, row.postal_code, nested.zip, nested.zip_code);
  return [street, city, state, zip].map(text).filter(Boolean).join(", ").replace(/\s+/g, " ");
}

function technician(row) {
  const nested = row.assigned_to ?? row.technician ?? row.employee ?? {};
  const id = firstValue(row.assigned_to_id, row.technician_id, row.employee_id, typeof nested === "object" ? nested.id : "", typeof row.assigned_to === "number" ? row.assigned_to : "");
  const name = firstValue(row.assigned_to_name, row.technician_name, row.employee_name, typeof nested === "object" ? nested.name : "", typeof row.assigned_to === "string" ? row.assigned_to : "", "Unassigned");
  return { id: text(id), name: text(name) || "Unassigned" };
}

export function normalizeSngDispatchJobs(rows = []) {
  return rows.map((row, sourceIndex) => {
    const assigned = technician(row);
    const sequence = numeric(firstValue(row.route_sequence, row.sequence, row.route_order, row.position, row.sort_order, sourceIndex + 1));
    const address = normalizedAddress(row);
    const serviceMinutes = durationMinutes(firstValue(row.actual_minutes, row.duration, row.estimate_time, row.estimated_time, row.estimated_duration));
    return {
      jobId: text(firstValue(row.id, row.job_id, row.uuid, `row-${sourceIndex + 1}`)),
      technicianId: assigned.id,
      technicianName: assigned.name,
      routeId: text(firstValue(row.route_id, row.route, row.route_name, row.dispatch_route_id, assigned.id)),
      sequence: sequence ?? sourceIndex + 1,
      scheduledTime: text(firstValue(row.scheduled_time, row.start_time, row.appointment_time, row.time)),
      address,
      serviceMinutes,
      hasServiceEstimate: serviceMinutes > 0,
      sourceIndex,
    };
  });
}

export async function addressHash(address) {
  const normalized = text(address).toLowerCase().replace(/[^a-z0-9]/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cachedGeocode(db, address) {
  if (!address) return null;
  const hash = await addressHash(address);
  const row = await db.prepare(
    `SELECT latitude, longitude, confidence, formatted_address, match_type
     FROM route_geocode_cache WHERE address_hash = ?`
  ).bind(hash).first();
  return row ? { hash, latitude: Number(row.latitude), longitude: Number(row.longitude), confidence: row.confidence, formattedAddress: row.formatted_address, matchType: row.match_type, cached: true } : { hash };
}

async function resolveStop(db, stop, budget) {
  const cached = await cachedGeocode(db, stop.address);
  if (!cached || cached.latitude !== undefined) return { ...stop, location: cached?.latitude !== undefined ? cached : null, geocodeAttempted: false };
  if (budget.remaining <= 0) return { ...stop, location: null, geocodeAttempted: false };
  budget.remaining -= 1;

  const result = await geocodeAddress(stop.address);
  if (!result.ok) return { ...stop, location: null, geocodeAttempted: true, geocodeError: result.error };
  await db.prepare(
    `INSERT INTO route_geocode_cache
      (address_hash, normalized_address, formatted_address, latitude, longitude, confidence, match_type, provider_place_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(address_hash) DO UPDATE SET formatted_address=excluded.formatted_address, latitude=excluded.latitude,
       longitude=excluded.longitude, confidence=excluded.confidence, match_type=excluded.match_type,
       provider_place_id=excluded.provider_place_id, updated_at=CURRENT_TIMESTAMP`
  ).bind(cached.hash, stop.address, result.data.formattedAddress, result.data.latitude, result.data.longitude, result.data.confidence, result.data.matchType, result.data.placeId).run();
  return { ...stop, location: { hash: cached.hash, ...result.data, cached: false }, geocodeAttempted: true };
}

export async function resolveRouteStops(db, stops, maxProviderCalls = 20) {
  const budget = { remaining: Math.max(0, Math.min(100, Number(maxProviderCalls) || 0)) };
  const resolved = [];
  for (let index = 0; index < stops.length; index += 4) {
    const chunk = stops.slice(index, index + 4);
    const rows = await Promise.all(chunk.map((stop) => resolveStop(db, stop, budget)));
    resolved.push(...rows);
  }
  return resolved;
}

function groupKey(stop) {
  return `${stop.technicianId || stop.technicianName}|${stop.routeId}`;
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

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

function optimizeOpenRoute(matrix) {
  if (matrix.length < 2) return { order: matrix.length ? [0] : [], timeSeconds: 0, distanceMeters: 0 };
  let order = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let start = 0; start < matrix.length; start += 1) {
    const candidate = nearestNeighborOrder(matrix, start);
    const cost = candidate ? orderCost(candidate, matrix) : Number.POSITIVE_INFINITY;
    if (cost < bestCost) {
      order = candidate;
      bestCost = cost;
    }
  }
  if (!order) return null;

  for (let pass = 0; pass < 6; pass += 1) {
    let improved = false;
    for (let from = 0; from < order.length - 1; from += 1) {
      for (let to = from + 1; to < order.length; to += 1) {
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

export async function calculateRouteMetrics(stops, { optimize = false } = {}) {
  const groups = new Map();
  for (const stop of stops) {
    const key = groupKey(stop);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stop);
  }

  const metrics = [];
  for (const routeStops of groups.values()) {
    routeStops.sort((left, right) => left.sequence - right.sequence || left.scheduledTime.localeCompare(right.scheduledTime) || left.sourceIndex - right.sourceIndex);
    let pointStops = routeStops.filter((stop) => stop.location);
    const points = pointStops.map((stop) => stop.location);
    let route;
    let optimizationMode = "source_order";
    if (optimize && points.length >= 2) {
      const matrixResult = await calculateRouteMatrix(points);
      const optimized = matrixResult.ok ? optimizeOpenRoute(matrixResult.data.matrix) : null;
      if (optimized) {
        pointStops = optimized.order.map((index) => pointStops[index]);
        const missingStops = routeStops.filter((stop) => !stop.location);
        routeStops.splice(0, routeStops.length, ...pointStops, ...missingStops);
        routeStops.forEach((stop, index) => { stop.sequence = index + 1; });
        route = {
          ok: true,
          data: { timeSeconds: optimized.timeSeconds, distanceMiles: optimized.distanceMeters / 1609.344, requests: matrixResult.data.requests },
          error: null,
        };
        optimizationMode = "geoapify_matrix_open_route";
      } else route = matrixResult;
    } else route = await calculateOrderedRoute(points);
    const serviceMinutes = routeStops.reduce((sum, stop) => sum + stop.serviceMinutes, 0);
    const driveMinutes = route.ok ? route.data.timeSeconds / 60 : null;
    const plannedMinutes = driveMinutes === null ? null : serviceMinutes + driveMinutes;
    const first = routeStops[0];
    metrics.push({
      technicianId: first.technicianId,
      technicianName: first.technicianName,
      routeId: first.routeId,
      stopCount: routeStops.length,
      geocodedStopCount: points.length,
      serviceMinutes: round(serviceMinutes),
      driveMinutes: driveMinutes === null ? null : round(driveMinutes),
      distanceMiles: route.ok ? round(route.data.distanceMiles) : null,
      plannedMinutes: plannedMinutes === null ? null : round(plannedMinutes),
      remainingToTargetMinutes: plannedMinutes === null ? null : round(PLANNING_TARGET_MINUTES - plannedMinutes),
      planningTargetMinutes: PLANNING_TARGET_MINUTES,
      serviceTimeCoverage: round(routeStops.filter((stop) => stop.hasServiceEstimate).length / routeStops.length, 3),
      routeStatus: points.length === routeStops.length && route.ok ? "complete" : points.length >= 2 ? "partial" : "incomplete",
      routingError: route.ok ? null : route.error,
      routeRequests: route.data?.requests ?? 0,
      optimizationMode,
      stops: routeStops,
    });
  }
  return metrics;
}

export function publicRouteMetric(metric) {
  const { stops, ...safe } = metric;
  return safe;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function activeCustomerRegion(city, zip) {
  const cityKey = text(city).toLowerCase();
  const postal = text(zip);
  if (postal.startsWith("48") || ["lambertville", "temperance", "monroe", "erie"].includes(cityKey)) return "Michigan";
  if (["perrysburg", "rossford"].includes(cityKey) || ["43551", "43460"].includes(postal)) return "Perrysburg / Rossford";
  if (["sylvania", "berkey"].includes(cityKey) || ["43560", "43504"].includes(postal)) return "Sylvania / Northwest";
  if (["maumee", "waterville", "whitehouse", "monclova", "holland", "swanton"].includes(cityKey) || ["43537", "43566", "43571", "43542", "43528", "43558"].includes(postal)) return "Southwest suburbs";
  if (["bowling green", "haskins"].includes(cityKey) || ["43402", "43525"].includes(postal)) return "Bowling Green";
  if (["oregon", "northwood", "curtice"].includes(cityKey) || ["43605", "43616", "43619", "43412"].includes(postal)) return "East Toledo / Oregon";
  if (["43614", "43609"].includes(postal)) return "South Toledo";
  if (["43615", "43606", "43607", "43617", "43623"].includes(postal)) return "West Toledo";
  if (["43611", "43612", "43613", "43608"].includes(postal)) return "North Toledo";
  return city ? text(city) : postal ? `ZIP ${postal}` : "Unclassified";
}

function activeCustomerAddress(fields) {
  const state = text(fields.State) || (text(fields.ZIP).startsWith("48") ? "MI" : "OH");
  return [fields.Address, fields.City, state, fields.ZIP].map(text).filter(Boolean).join(", ").replace(/\s+/g, " ");
}

function visitsPerServiceDay(frequency) {
  if (frequency === "Biweekly") return 0.5;
  if (frequency === "Monthly") return 0.25;
  return 1;
}

function revenuePerVisit(mrr, frequency) {
  const monthlyVisits = frequency === "Twice Weekly" ? 52 * 2 / 12 : frequency === "Weekly" ? 52 / 12 : frequency === "Biweekly" ? 26 / 12 : frequency === "Monthly" ? 1 : 0;
  return monthlyVisits > 0 ? mrr / monthlyVisits : 0;
}

export function activeSubscriptionsFromSnapshot(payload) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  const records = Array.isArray(data?.opwp?.customers) ? data.opwp.customers : [];
  const latestServiceByCustomer = new Map();
  for (const job of Array.isArray(data?.opwp?.jobs) ? data.opwp.jobs : []) {
    const fields = job?.fields ?? {};
    const name = text(fields["Customer Name"]).toLowerCase();
    const date = text(fields.Date).slice(0, 10);
    const status = text(fields.Status).toLowerCase();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (status && !status.includes("complete"))) continue;
    if (!latestServiceByCustomer.has(name) || date > latestServiceByCustomer.get(name)) latestServiceByCustomer.set(name, date);
  }
  return records.filter((record) => text(record?.fields?.Status).toLowerCase() === "active").map((record) => {
    const fields = record.fields ?? {};
    const frequency = text(fields.Frequency);
    const serviceDays = [fields["Service Day"], fields["Service Day 2"]].map(text).filter((day, index, rows) => WEEKDAYS.includes(day) && rows.indexOf(day) === index);
    return {
      customerId: text(fields["SNG Client ID"] || record.id),
      customerName: text(fields["Client Name"] || "Unknown customer"),
      address: activeCustomerAddress(fields),
      city: text(fields.City),
      zip: text(fields.ZIP),
      region: activeCustomerRegion(fields.City, fields.ZIP),
      frequency,
      serviceDays,
      fixedDays: serviceDays.length > 1,
      technicianName: text(fields["Assigned Tech"] || "Unassigned"),
      serviceMinutes: Math.max(Number(fields["Est. Service Minutes"]) || 0, 0),
      mrr: Math.max(Number(fields["MRR ($)"]) || 0, 0),
      weeklyWeight: visitsPerServiceDay(frequency),
      revenuePerVisit: revenuePerVisit(Math.max(Number(fields["MRR ($)"]) || 0, 0), frequency),
      latestServiceDate: latestServiceByCustomer.get(text(fields["Client Name"]).toLowerCase()) || null,
    };
  });
}

function mondayStart(value = new Date()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date;
}

function weekBucket(value) {
  const epoch = Date.UTC(2024, 0, 1);
  return Math.floor((mondayStart(value).getTime() - epoch) / 604800000);
}

function cadenceDueThisWeek(customer, planningWeek) {
  if (!["Biweekly", "Monthly"].includes(customer.frequency)) return true;
  if (!customer.latestServiceDate) return true;
  const modulus = customer.frequency === "Biweekly" ? 2 : 4;
  return ((weekBucket(customer.latestServiceDate) % modulus) + modulus) % modulus === ((weekBucket(planningWeek) % modulus) + modulus) % modulus;
}

async function activeRouteSnapshot(db) {
  const row = await db.prepare(`SELECT payload,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'`).first();
  if (!row?.payload) throw new Error("The Airtable cockpit snapshot is not available.");
  return { capturedAt: row.captured_at, customers: activeSubscriptionsFromSnapshot(row.payload) };
}

async function geocodeMap(db) {
  const result = await db.prepare(`SELECT address_hash,latitude,longitude,confidence,formatted_address,match_type FROM route_geocode_cache`).all();
  return new Map((result.results ?? []).map((row) => [row.address_hash, {
    hash: row.address_hash,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    confidence: row.confidence,
    formattedAddress: row.formatted_address,
    matchType: row.match_type,
    cached: true,
  }]));
}

async function activeStopsWithCoordinates(db, customers) {
  const locations = await geocodeMap(db);
  return Promise.all(customers.map(async (customer, sourceIndex) => {
    const hash = await addressHash(customer.address);
    return { ...customer, sourceIndex, addressHash: hash, location: locations.get(hash) ?? null };
  }));
}

function activeBookSummary(customers, stops, sourceSnapshotAt, plan = null) {
  const dayMap = new Map(WEEKDAYS.map((day) => [day, { day, customers: 0, equivalentVisits: 0, fixedVisits: 0, mrr: 0, serviceMinutes: 0 }]));
  for (const customer of customers) for (const day of customer.serviceDays) {
    const row = dayMap.get(day);
    row.customers += 1;
    row.equivalentVisits += customer.weeklyWeight;
    row.fixedVisits += customer.fixedDays ? 1 : 0;
    row.mrr += customer.serviceDays.length ? customer.mrr / customer.serviceDays.length : 0;
    row.serviceMinutes += customer.serviceMinutes;
  }
  const regionMap = new Map();
  for (const customer of customers) {
    const row = regionMap.get(customer.region) || { region: customer.region, customers: 0, fixedCustomers: 0, byDay: Object.fromEntries(WEEKDAYS.map((day) => [day, 0])) };
    row.customers += 1;
    row.fixedCustomers += customer.fixedDays ? 1 : 0;
    for (const day of customer.serviceDays) row.byDay[day] += 1;
    regionMap.set(customer.region, row);
  }
  return {
    sourceSnapshotAt,
    activeCustomers: customers.length,
    scheduledVisits: customers.reduce((sum, customer) => sum + customer.serviceDays.length, 0),
    fixedTwiceWeekly: customers.filter((customer) => customer.fixedDays).length,
    geocodedCustomers: stops.filter((stop) => stop.location).length,
    missingCoordinates: stops.filter((stop) => !stop.location).map((stop) => ({ customer: stop.customerName, address: stop.address })),
    serviceDayAnomalies: customers.filter((customer) => customer.serviceDays.length > 1 && customer.frequency !== "Twice Weekly").map((customer) => ({ customer: customer.customerName, frequency: customer.frequency, serviceDays: customer.serviceDays })),
    weeklyEquivalentVisits: round(customers.reduce((sum, customer) => sum + customer.serviceDays.length * customer.weeklyWeight, 0), 2),
    days: [...dayMap.values()].map((row) => ({ ...row, equivalentVisits: round(row.equivalentVisits, 2), mrr: round(row.mrr), serviceMinutes: round(row.serviceMinutes) })),
    regions: [...regionMap.values()].sort((a, b) => b.customers - a.customers || a.region.localeCompare(b.region)),
    plan,
  };
}

export async function getActiveSubscriptionRouteSummary(db) {
  const snapshot = await activeRouteSnapshot(db);
  const stops = await activeStopsWithCoordinates(db, snapshot.customers);
  const planRow = await db.prepare(`SELECT payload,created_at,status FROM route_subscription_plans ORDER BY created_at DESC LIMIT 1`).first();
  let plan = null;
  try { plan = planRow?.payload ? { ...JSON.parse(planRow.payload), createdAt: planRow.created_at, status: planRow.status } : null; } catch { plan = null; }
  return activeBookSummary(snapshot.customers, stops, snapshot.capturedAt, plan);
}

export async function geocodeActiveSubscriptionRouteBook(db, maxProviderCalls = 40) {
  const snapshot = await activeRouteSnapshot(db);
  const normalized = snapshot.customers.map((customer, sourceIndex) => ({
    ...customer,
    jobId: `SUB-${customer.customerId}`,
    technicianId: customer.technicianName,
    routeId: customer.serviceDays.join("-") || "unscheduled",
    sequence: sourceIndex + 1,
    scheduledTime: "",
    hasServiceEstimate: customer.serviceMinutes > 0,
    visitRevenue: customer.revenuePerVisit,
    sourceIndex,
  }));
  const resolved = await resolveRouteStops(db, normalized, maxProviderCalls);
  return {
    activeCustomers: resolved.length,
    geocodedCustomers: resolved.filter((stop) => stop.location).length,
    attempted: resolved.filter((stop) => stop.geocodeAttempted).length,
    remaining: resolved.filter((stop) => !stop.location).length,
    sourceSnapshotAt: snapshot.capturedAt,
  };
}

function distanceMiles(left, right) {
  const radius = 3958.8;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(right.latitude - left.latitude);
  const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function flexibleMoveCandidates(stops) {
  const candidates = [];
  for (const stop of stops.filter((row) => !row.fixedDays && row.location && row.serviceDays[0])) {
    const currentDay = stop.serviceDays[0];
    const regional = stops.filter((row) => row.customerId !== stop.customerId && row.region === stop.region && row.location);
    const nearestByDay = WEEKDAYS.map((day) => {
      const neighbors = regional.filter((row) => row.serviceDays.includes(day)).map((row) => ({ row, miles: distanceMiles(stop.location, row.location) })).sort((a, b) => a.miles - b.miles);
      return { day, customers: regional.filter((row) => row.serviceDays.includes(day)).length, nearest: neighbors[0] ?? null };
    }).filter((row) => row.nearest && row.customers >= 3);
    const current = nearestByDay.find((row) => row.day === currentDay);
    const best = nearestByDay.sort((a, b) => a.nearest.miles - b.nearest.miles || b.customers - a.customers)[0];
    if (!current || !best || best.day === currentDay || best.nearest.miles + 0.75 >= current.nearest.miles) continue;
    candidates.push({
      customerId: stop.customerId,
      customer: stop.customerName,
      region: stop.region,
      currentDay,
      suggestedDay: best.day,
      currentNearestCustomer: current.nearest.row.customerName,
      currentNearestMiles: round(current.nearest.miles, 2),
      suggestedNearestCustomer: best.nearest.row.customerName,
      suggestedNearestMiles: round(best.nearest.miles, 2),
      proximityMilesSaved: round(current.nearest.miles - best.nearest.miles, 2),
      fixed: false,
      confidence: best.customers >= 8 ? "high" : "review",
    });
  }
  return candidates.sort((a, b) => b.proximityMilesSaved - a.proximityMilesSaved).slice(0, 30);
}

function matrixSafeVisits(visits, maximumStops = 30) {
  const groups = new Map();
  for (const visit of visits) {
    const key = `${visit.technicianId}|${visit.routeId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(visit);
  }
  const safe = [];
  for (const rows of groups.values()) {
    if (rows.length <= maximumStops) {
      safe.push(...rows);
      continue;
    }
    const ordered = [...rows].sort((left, right) =>
      Number(left.location?.longitude || 0) - Number(right.location?.longitude || 0)
      || Number(left.location?.latitude || 0) - Number(right.location?.latitude || 0));
    const clusterCount = Math.ceil(ordered.length / maximumStops);
    const clusterSize = Math.ceil(ordered.length / clusterCount);
    ordered.forEach((row, index) => safe.push({ ...row, routeId: `${row.routeId} - sector ${Math.floor(index / clusterSize) + 1}` }));
  }
  return safe;
}

export async function calculateActiveSubscriptionPlan(db) {
  const snapshot = await activeRouteSnapshot(db);
  const stops = await activeStopsWithCoordinates(db, snapshot.customers);
  const planningWeek = mondayStart(new Date());
  const cadenceCustomers = stops.filter((customer) => ["Biweekly", "Monthly"].includes(customer.frequency));
  const anchoredCadenceCustomers = cadenceCustomers.filter((customer) => customer.latestServiceDate);
  const visits = [];
  for (const customer of stops.filter((row) => cadenceDueThisWeek(row, planningWeek))) customer.serviceDays.forEach((day, dayIndex) => visits.push({
    ...customer,
    jobId: `SUB-${customer.customerId}-${day}`,
    technicianId: customer.technicianName,
    routeId: day,
    technicianName: customer.technicianName,
    sequence: dayIndex + 1,
    scheduledTime: "",
    hasServiceEstimate: customer.serviceMinutes > 0,
    visitRevenue: customer.revenuePerVisit,
  }));
  const metrics = await calculateRouteMetrics(matrixSafeVisits(visits), { optimize: true });
  const recommendations = flexibleMoveCandidates(stops);
  const payload = {
    sourceSnapshotAt: snapshot.capturedAt,
    planningWeekStart: planningWeek.toISOString().slice(0, 10),
    cadenceAnchoredCustomers: anchoredCadenceCustomers.length,
    cadenceCustomerCount: cadenceCustomers.length,
    unanchoredCadenceCustomers: cadenceCustomers.filter((customer) => !customer.latestServiceDate).map((customer) => customer.customerName),
    routes: metrics.map((metric) => {
      const routeRevenue = metric.stops.reduce((sum, stop) => sum + Number(stop.visitRevenue || 0), 0);
      return {
      ...publicRouteMetric(metric),
      routeRevenue: round(routeRevenue),
      revenuePerPlannedHour: metric.plannedMinutes ? round(routeRevenue / (metric.plannedMinutes / 60)) : null,
      stopSequence: metric.stops.map((stop, index) => ({
        sequence: index + 1,
        customer: stop.customerName,
        address: stop.address,
        region: stop.region,
        serviceMinutes: stop.serviceMinutes,
        fixedDays: stop.fixedDays,
      })),
    }; }),
    recommendations,
    interpretation: "Route sequences use Geoapify road-time matrices for the current operating week. Biweekly A/B and monthly cohorts are anchored from each customer's latest completed Airtable service date; unanchored cadence records remain included and disclosed. Move candidates require owner approval.",
  };
  const status = stops.every((stop) => stop.location) && metrics.every((metric) => metric.routeStatus === "complete") ? "complete" : "partial";
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO route_subscription_plans (id,source_snapshot_at,status,active_customers,scheduled_visits,geocoded_customers,fixed_twice_weekly,route_count,recommendation_count,payload)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, snapshot.capturedAt, status, snapshot.customers.length, visits.length, stops.filter((stop) => stop.location).length, snapshot.customers.filter((customer) => customer.fixedDays).length, metrics.length, recommendations.length, JSON.stringify(payload)).run();
  return { id, status, ...payload };
}

export async function runScheduledRouteBookRefresh(env) {
  const id = crypto.randomUUID();
  try {
    const geocode = await geocodeActiveSubscriptionRouteBook(env.DB, 40);
    let plan = null;
    if (geocode.remaining === 0 && geocode.attempted === 0) {
      const latest = await env.DB.prepare(`SELECT source_snapshot_at,payload FROM route_subscription_plans WHERE status='complete' ORDER BY created_at DESC LIMIT 1`).first();
      let latestWeek = "";
      try { latestWeek = latest?.payload ? String(JSON.parse(latest.payload).planningWeekStart || "") : ""; } catch { latestWeek = ""; }
      const currentWeek = mondayStart(new Date()).toISOString().slice(0, 10);
      if (String(latest?.source_snapshot_at || "") !== String(geocode.sourceSnapshotAt) || latestWeek !== currentWeek) plan = await calculateActiveSubscriptionPlan(env.DB);
    }
    await env.DB.prepare(`INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at) VALUES (?,'active_route_book','success',?,?,CURRENT_TIMESTAMP)`).bind(id, String(geocode.sourceSnapshotAt).slice(0, 10), geocode.geocodedCustomers).run();
    console.log(JSON.stringify({ event: "active_route_book_refresh", ...geocode, planId: plan?.id || null }));
    return { geocode, plan };
  } catch (error) {
    await env.DB.prepare(`INSERT INTO system_sync_runs (id,sync_name,status,error,completed_at) VALUES (?,'active_route_book','failed',?,CURRENT_TIMESTAMP)`).bind(id, String(error).slice(0, 500)).run();
    console.error(JSON.stringify({ event: "active_route_book_refresh_failed", message: String(error) }));
    throw error;
  }
}
