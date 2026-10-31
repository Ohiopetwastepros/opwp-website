import { routeRecordId, validRouteDate } from "./route-profitability-calculations.mjs";

const key = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Join the original completed event, not a customer's current plan. A custom job
// can carry a perfectly explicit service label and historical subscription plan.
export function applyRouteSourceEvidence(records, sources) {
  const byId = new Map();
  for (const source of sources) {
    const id = routeRecordId(source.job_id);
    if (!byId.has(id)) byId.set(id, source); // query is newest first
  }
  return { ...records, jobs: (records.jobs || []).map(record => {
    const f = record.fields || {}, source = byId.get(routeRecordId(f["Job ID"] || record.id));
    if (!source || key(source.customer) !== key(f["Customer Name"]) || source.date !== String(f.Date || "").slice(0, 10)) return record;
    const price = source.price === null || source.price === "" ? null : Number(source.price);
    // Do not overwrite newer Airtable prices or infer zero from an absent field.
    const corroborated = price !== null && Number.isFinite(price) && price >= 0 && price <= 10000 && price === Number(f["Revenue ($)"]);
    return { ...record, fields: { ...f,
      "Source Service Type": String(source.type || "").slice(0, 80),
      "Source Service Label": String(source.label || "").slice(0, 200),
      "Source Service Plan": String(source.plan || "").slice(0, 100),
      "Source Client ID": String(source.client_id || ""),
      "Source Price Confirmed": corroborated,
      "Source Work": { startedAt: source.started_at ?? null, endedAt: source.ended_at ?? null, duration: source.duration ?? null },
    } };
  }) };
}

export async function enrichRouteSourceEvidence(db, records, from, through) {
  if (!validRouteDate(from) || !validRouteDate(through) || from > through) throw new Error("Invalid source evidence range.");
  const result = await db.prepare(`SELECT external_id job_id,
    COALESCE(json_extract(payload,'$.data.full_name'),json_extract(payload,'$.data.client_name'),customer_name) customer,
    substr(COALESCE(json_extract(payload,'$.data.end_time'),json_extract(payload,'$.data.start_time')),1,10) date,
    COALESCE(json_extract(payload,'$.data.job_type'),json_extract(payload,'$.data.type')) type,
    json_extract(payload,'$.data.service_label') label,
    json_extract(payload,'$.data.service_plan_name') plan,
    json_extract(payload,'$.data.client_id') client_id,
    json_extract(payload,'$.data.price') price,
    json_extract(payload,'$.data.start_time') started_at,
    json_extract(payload,'$.data.end_time') ended_at,
    json_extract(payload,'$.data.duration') duration
    FROM sng_events WHERE event_type='job:completed' AND json_valid(payload)
    AND substr(COALESCE(json_extract(payload,'$.data.end_time'),json_extract(payload,'$.data.start_time')),1,10) BETWEEN ? AND ?
    ORDER BY received_at DESC,id DESC LIMIT 20001`).bind(from, through).all();
  if ((result.results || []).length > 20000) throw new Error("Route source evidence exceeds its record limit; retaining the prior report.");
  return applyRouteSourceEvidence(records, result.results || []);
}
