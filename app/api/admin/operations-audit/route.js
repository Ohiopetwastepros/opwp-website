import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAirtableCustomerRows, getOperationalDataAudit, getTimeDataAudit } from "@/lib/airtable";
import { sngPaginatedRequest, sngRequest, sngRows } from "@/lib/sweepandgo";

export const dynamic = "force-dynamic";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function GET(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const since = url.searchParams.get("since") || "2026-01-01";
  const until = url.searchParams.get("until") || "";
  const scope = url.searchParams.get("scope") || "airtable";
  if (scope === "time") {
    const audit = await getTimeDataAudit(since);
    return Response.json({ ok: audit.ok, time: audit }, { headers: { "Cache-Control": "no-store" } });
  }
  if (scope === "dispatch") {
    const date = url.searchParams.get("date") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ ok: false, error: "A valid date is required." }, { status: 400 });
    const result = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
    const rows = sngRows(result);
    return Response.json({
      ok: result.ok,
      date,
      count: rows.length,
      completed: rows.filter((row) => String(row.status_name).toLowerCase() === "completed" || Number(row.status_id) === 2).length,
      estimatePresent: rows.filter((row) => row.estimate_time !== undefined && row.estimate_time !== null && row.estimate_time !== "").length,
      types: rows.reduce((counts, row) => ({ ...counts, [row.type || "unknown"]: (counts[row.type || "unknown"] || 0) + 1 }), {}),
      sample: rows.slice(0, 5).map((row) => ({ id: row.id, clientId: row.client_id, name: row.full_name, status: row.status_name, type: row.type, estimateTime: row.estimate_time, duration: row.duration })),
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (scope !== "sng") {
    const airtable = await getOperationalDataAudit(since, until);
    return Response.json({ ok: airtable.ok, airtable }, { headers: { "Cache-Control": "no-store" } });
  }
  const [airtableCustomers, sngResult, noSubscriptionResult] = await Promise.all([
    getAirtableCustomerRows(),
    sngPaginatedRequest("/api/v1/clients/active"),
    sngPaginatedRequest("/api/v1/clients/active_no_subscription"),
  ]);
  const sngClients = sngResult.rows?.length ? sngResult.rows : sngRows(sngResult);
  const noSubscriptionClients = noSubscriptionResult.rows?.length ? noSubscriptionResult.rows : sngRows(noSubscriptionResult);
  const noSubscriptionIds = new Set(noSubscriptionClients.map((client) => normalized(client.client ?? client.client_id ?? client.id)).filter(Boolean));
  const recurringSngClients = sngClients.filter((client) => {
    const id = normalized(client.client ?? client.client_id ?? client.id);
    return !client.one_time_client && client.cleanup_frequency && !noSubscriptionIds.has(id) && normalized(`${client.first_name ?? ""} ${client.last_name ?? ""}`) !== "testtest";
  });
  const airtableById = new Map(airtableCustomers.rows.map((row) => [normalized(row.sngClientId), row]).filter(([id]) => id));
  const airtableByName = new Map(airtableCustomers.rows.map((row) => [normalized(row.name), row]).filter(([name]) => name));
  const matchedRow = (client) => airtableById.get(normalized(client.client ?? client.client_id ?? client.id)) || airtableByName.get(normalized(`${client.first_name ?? ""} ${client.last_name ?? ""}`));
  const missingFromAirtable = recurringSngClients.filter((client) => {
    const id = normalized(client.client ?? client.client_id ?? client.id);
    const name = normalized(`${client.first_name ?? ""} ${client.last_name ?? ""}`);
    return !(id && airtableById.has(id)) && !(name && airtableByName.has(name));
  }).map((client) => ({
    sngClientId: client.client ?? client.client_id ?? client.id ?? "",
    name: `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim(),
    frequency: client.cleanup_frequency ?? "",
    serviceDays: client.service_days ?? "",
    assignedTo: client.assigned_to ?? "",
    subscriptionNames: client.subscription_names ?? "",
  }));
  const statusMismatches = recurringSngClients.filter((client) => {
    const row = matchedRow(client);
    return row && normalized(row.status) !== "active";
  }).map((client) => ({
    sngClientId: client.client ?? client.client_id ?? client.id ?? "",
    name: `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim(),
    airtableStatus: matchedRow(client)?.status || "",
    frequency: client.cleanup_frequency ?? "",
    serviceDays: client.service_days ?? "",
  }));
  const recurringSngIds = new Set(recurringSngClients.map((client) => normalized(client.client ?? client.client_id ?? client.id)).filter(Boolean));
  const recurringSngNames = new Set(recurringSngClients.map((client) => normalized(`${client.first_name ?? ""} ${client.last_name ?? ""}`)).filter(Boolean));
  const missingFromSng = airtableCustomers.rows.filter((row) => normalized(row.status) === "active").filter((row) => {
    const id = normalized(row.sngClientId);
    const name = normalized(row.name);
    return !(id && recurringSngIds.has(id)) && !(name && recurringSngNames.has(name));
  }).map((row) => ({ name: row.name, sngClientId: row.sngClientId, airtableStatus: row.status, frequency: row.frequency, serviceDay: row.serviceDay }));
  return Response.json({
    ok: airtableCustomers.ok && sngResult.ok,
    airtable: { ok: airtableCustomers.ok, totalClients: airtableCustomers.rows.length, activeClients: airtableCustomers.rows.filter((row) => normalized(row.status) === "active").length },
    sng: {
      ok: sngResult.ok,
      activeClients: sngClients.length,
      recurringClients: recurringSngClients.length,
      activeWithoutSubscription: noSubscriptionClients.length,
      excludedFromRecurring: sngClients.length - recurringSngClients.length,
      missingFromAirtable,
      missingFromSng,
      statusMismatches,
      sampleFields: Object.keys(sngClients[0] ?? {}),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
