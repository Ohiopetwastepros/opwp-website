import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAirtableRouteSource } from "@/lib/airtable";
import { getDb } from "@/lib/db";
import { geoapifyConfigured } from "@/lib/geoapify";
import { calculateActiveSubscriptionPlan, calculateRouteMetrics, geocodeActiveSubscriptionRouteBook, getActiveSubscriptionRouteSummary, normalizeSngDispatchJobs, publicRouteMetric, resolveRouteStops } from "@/lib/route-intelligence";
import { sngConfigured, sngRequest, sngRows } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

async function authorized() {
  return verifyAdminRequest(await headers());
}

export async function GET(request) {
  const auth = await authorized();
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Route storage is not configured." }, { status: 503 });

  if (new URL(request.url).searchParams.get("mode") === "active") {
    try {
      return Response.json({ ok: true, summary: await getActiveSubscriptionRouteSummary(db) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "The active route book could not be loaded." }, { status: 502 });
    }
  }

  const date = new URL(request.url).searchParams.get("date") || "";
  const result = date && validDate(date)
    ? await db.prepare(
      `SELECT service_date, technician_id, technician_name, route_id, stop_count, geocoded_stop_count,
        service_minutes, drive_minutes, distance_miles, planned_minutes, remaining_to_target_minutes,
        planning_target_minutes, service_time_coverage, route_status, calculated_at
       FROM route_day_metrics WHERE service_date = ? ORDER BY technician_name, route_id`
    ).bind(date).all()
    : { results: [] };

  return Response.json({
    ok: true,
    providers: { sweepAndGo: sngConfigured(), geoapify: geoapifyConfigured(), database: true },
    date: date || null,
    routes: result.results ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const auth = await authorized();
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Route storage is not configured." }, { status: 503 });

  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "active") {
    try {
      const geocode = await geocodeActiveSubscriptionRouteBook(db, 40);
      const plan = geocode.remaining === 0 ? await calculateActiveSubscriptionPlan(db) : null;
      const summary = await getActiveSubscriptionRouteSummary(db);
      return Response.json({ ok: true, geocode, plan, summary }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The active route book could not be calculated.";
      console.error(JSON.stringify({ message: "active subscription route analysis failed", error: message }));
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  }
  const requestedDate = url.searchParams.get("date") || "";
  const source = url.searchParams.get("source") === "sweep_and_go" ? "sweep_and_go" : "airtable";
  const force = url.searchParams.get("force") === "true";
  if (requestedDate && !validDate(requestedDate)) return Response.json({ ok: false, error: "A valid service date is required." }, { status: 400 });
  const requestedLimit = Number(url.searchParams.get("maxGeocodes") || (source === "airtable" ? 75 : 20));
  const maxGeocodes = Math.max(0, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  const airtable = source === "airtable" ? await getAirtableRouteSource(requestedDate) : null;
  if (airtable && !airtable.ok) return Response.json({ ok: false, error: "Airtable route history could not be loaded." }, { status: 502 });
  const date = airtable?.date || requestedDate;
  if (!date || !validDate(date)) return Response.json({ ok: false, error: "No eligible completed route date was found." }, { status: 400 });

  if (!force) {
    const existingRun = await db.prepare(
      `SELECT id, status, completed_at FROM route_analysis_runs
       WHERE service_date=? AND provider=? AND status='complete'
       ORDER BY completed_at DESC LIMIT 1`
    ).bind(date, source).first();
    if (existingRun) {
      const existingMetrics = await db.prepare(
        `SELECT technician_id, technician_name, route_id, stop_count, geocoded_stop_count, service_minutes,
          drive_minutes, distance_miles, planned_minutes, remaining_to_target_minutes, planning_target_minutes,
          service_time_coverage, route_status, calculated_at
         FROM route_day_metrics WHERE analysis_run_id=? ORDER BY technician_name, route_id`
      ).bind(existingRun.id).all();
      return Response.json({ ok: true, cached: true, runId: existingRun.id, date, source, status: existingRun.status, routes: existingMetrics.results ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }
  }
  const runId = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO route_analysis_runs (id, service_date, provider, status) VALUES (?, ?, ?, 'running')`
  ).bind(runId, date, source).run();

  try {
    let sourceRows;
    if (source === "airtable") sourceRows = airtable.stops;
    else {
      const dispatch = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
      if (!dispatch.ok) throw new Error(`Sweep & Go dispatch load failed with status ${dispatch.status}.`);
      sourceRows = sngRows(dispatch);
    }
    const normalized = normalizeSngDispatchJobs(sourceRows).filter((stop) => stop.jobId);
    const stops = await resolveRouteStops(db, normalized, maxGeocodes);
    const metrics = await calculateRouteMetrics(stops, { optimize: source === "airtable" });

    const snapshotStatements = metrics.map((metric) => db.prepare(
      `INSERT INTO dog_food_route_snapshots (id, service_date, provider, technician_id, route_id, source_payload)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), date, source, metric.technicianId || null, metric.routeId || null, JSON.stringify(metric.stops.map((stop, index) => ({
      jobId: stop.jobId,
      sequence: index + 1,
      address: stop.address,
      serviceMinutes: stop.serviceMinutes,
      latitude: stop.location?.latitude ?? null,
      longitude: stop.location?.longitude ?? null,
    })))));
    if (snapshotStatements.length) await db.batch(snapshotStatements);

    const metricStatements = metrics.map((metric) => db.prepare(
      `INSERT INTO route_day_metrics
        (id, analysis_run_id, service_date, technician_id, technician_name, route_id, stop_count, geocoded_stop_count,
         service_minutes, drive_minutes, distance_miles, planned_minutes, remaining_to_target_minutes,
         planning_target_minutes, service_time_coverage, route_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), runId, date, metric.technicianId, metric.technicianName, metric.routeId, metric.stopCount,
      metric.geocodedStopCount, metric.serviceMinutes, metric.driveMinutes, metric.distanceMiles, metric.plannedMinutes,
      metric.remainingToTargetMinutes, metric.planningTargetMinutes, metric.serviceTimeCoverage, metric.routeStatus));
    if (metricStatements.length) await db.batch(metricStatements);

    const geocodedCount = stops.filter((stop) => stop.location).length;
    const status = metrics.length && metrics.every((metric) => metric.routeStatus === "complete") ? "complete" : "partial";
    await db.prepare(
      `UPDATE route_analysis_runs SET status=?, source_job_count=?, normalized_stop_count=?, geocoded_stop_count=?,
       route_count=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(status, sourceRows.length, normalized.length, geocodedCount, metrics.length, runId).run();

    console.log(JSON.stringify({ message: "route intelligence analysis complete", runId, date, source, sourceJobs: sourceRows.length, routes: metrics.length, geocodedStops: geocodedCount, status }));
    return Response.json({
      ok: true,
      runId,
      date,
      source,
      status,
      sourceJobCount: sourceRows.length,
      normalizedStopCount: normalized.length,
      geocodedStopCount: geocodedCount,
      geocodeAttempts: stops.filter((stop) => stop.geocodeAttempted).length,
      candidateDates: airtable?.candidates ?? [],
      unmatchedAddressCount: airtable?.unmatchedAddressCount ?? normalized.filter((stop) => !stop.address).length,
      routes: metrics.map(publicRouteMetric),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route analysis failed.";
    await db.prepare(
      `UPDATE route_analysis_runs SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(message.slice(0, 500), runId).run();
    console.error(JSON.stringify({ message: "route intelligence analysis failed", runId, date, source, error: message }));
    return Response.json({ ok: false, runId, date, error: "Route analysis could not be completed." }, { status: 502 });
  }
}
