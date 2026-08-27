import { airtableFrequency, serviceDays, sngScheduleValues } from "./sng-service-schedule.mjs";

export { airtableFrequency, serviceDays } from "./sng-service-schedule.mjs";

const SNG_BASE_URL = "https://openapi.sweepandgo.com";
const AIRTABLE_API_URL = "https://api.airtable.com/v0";
const AIRTABLE_BASE_ID = "appcAWPBQB8GmOrcT";
const AIRTABLE_CUSTOMER_TABLE = "tblhi8MGUOsWNmd37";
const SNG_MAX_ATTEMPTS = 3;
const SNG_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 5000);
  return 300 * (2 ** (attempt - 1));
}

async function fetchSngPage(url, apiKey, path) {
  let lastError = null;
  for (let attempt = 1; attempt <= SNG_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
      if (response.ok) return response.json();
      lastError = new Error(`SNG ${path} returned ${response.status}.`);
      if (!SNG_RETRYABLE_STATUSES.has(response.status) || attempt === SNG_MAX_ATTEMPTS) throw lastError;
      await wait(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === SNG_MAX_ATTEMPTS || (error instanceof Error && /^SNG .* returned \d+\.$/.test(error.message))) throw error;
      await wait(300 * (2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new Error(`SNG ${path} request failed.`);
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clientId(client) {
  return String(client?.client ?? client?.client_id ?? client?.id ?? client?.user_id ?? "");
}

function clientName(client) {
  return String(client?.client_name ?? client?.full_name ?? `${client?.first_name ?? ""} ${client?.last_name ?? ""}`).trim();
}

function clientKey(client) {
  return `${normalized(clientName(client))}|${normalized(client?.address ?? client?.client_address)}`;
}

function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function totalPages(data) {
  return Number(data?.paginate?.total_pages ?? data?.pagination?.total_pages ?? data?.meta?.last_page ?? data?.last_page ?? 1);
}

async function fetchSngPages(path, apiKey) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const url = new URL(path, SNG_BASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    const data = await fetchSngPage(url, apiKey, path);
    const pageRows = rowsFrom(data);
    rows.push(...pageRows);
    if (page >= totalPages(data) || pageRows.length === 0) break;
  }
  return rows;
}

function easternDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function writeInBatches(db, statements, size = 50) {
  for (let index = 0; index < statements.length; index += size) await db.batch(statements.slice(index, index + size));
}

async function airtableCustomers(apiKey) {
  const records = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const response = await fetch(`${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_CUSTOMER_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Airtable active-customer sync returned ${response.status}.`);
    const page = await response.json();
    records.push(...(page.records ?? []));
    offset = page.offset ?? "";
  } while (offset);
  return records;
}

export async function syncAirtableServiceSchedules(env, activeClients) {
  if (!env?.AIRTABLE_API_KEY) return { configured: false, updated: 0 };
  const customers = await airtableCustomers(env.AIRTABLE_API_KEY);
  const byId = new Map(activeClients.map((client) => [normalized(clientId(client)), client]).filter(([id]) => id));
  const byName = new Map(activeClients.map((client) => [normalized(clientName(client)), client]).filter(([name]) => name));
  const updates = [];
  const matchedClientKeys = new Set();
  for (const record of customers) {
    const fields = record.fields ?? {};
    const client = byId.get(normalized(fields["SNG Client ID"])) || byName.get(normalized(fields["Client Name"]));
    if (!client) continue;
    matchedClientKeys.add(normalized(clientId(client)) || normalized(clientName(client)));
    const next = {};
    const schedule = sngScheduleValues(client);
    const sngId = clientId(client);
    if (normalized(fields.Status) !== "active") next.Status = "Active";
    if (sngId && String(fields["SNG Client ID"] ?? "") !== sngId) next["SNG Client ID"] = sngId;
    if (schedule.frequency && fields.Frequency !== schedule.frequency) next.Frequency = schedule.frequency;
    if (String(fields["Service Day"] ?? "") !== String(schedule.days[0] ?? "")) next["Service Day"] = schedule.days[0] || null;
    if (String(fields["Service Day 2"] ?? "") !== String(schedule.days[1] ?? "")) next["Service Day 2"] = schedule.days[1] || null;
    if (String(fields["Assigned Tech"] ?? "") !== schedule.assignedTech) next["Assigned Tech"] = schedule.assignedTech || null;
    if (String(fields["Assigned Tech 2"] ?? "") !== schedule.assignedTech2) next["Assigned Tech 2"] = schedule.assignedTech2 || null;
    if (Object.keys(next).length) updates.push({ id: record.id, fields: next });
  }
  const uniqueActiveClients = [...new Map(activeClients.map((client) => [normalized(clientId(client)) || normalized(clientName(client)), client]).filter(([key]) => key)).entries()];
  const creates = uniqueActiveClients
    .filter(([key]) => !matchedClientKeys.has(key))
    .map(([, client]) => {
      const schedule = sngScheduleValues(client);
      const fields = { "Client Name": clientName(client), Status: "Active" };
      const sngId = clientId(client);
      if (sngId) fields["SNG Client ID"] = sngId;
      if (schedule.frequency) fields.Frequency = schedule.frequency;
      if (schedule.days[0]) fields["Service Day"] = schedule.days[0];
      if (schedule.days[1]) fields["Service Day 2"] = schedule.days[1];
      if (schedule.assignedTech) fields["Assigned Tech"] = schedule.assignedTech;
      if (schedule.assignedTech2) fields["Assigned Tech 2"] = schedule.assignedTech2;
      if (client.address || client.service_address) fields.Address = client.address || client.service_address;
      if (client.city || client.service_city) fields.City = client.city || client.service_city;
      if (client.zip_code || client.zip) fields.ZIP = String(client.zip_code || client.zip);
      return { fields };
    });
  for (let index = 0; index < updates.length; index += 10) {
    const response = await fetch(`${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_CUSTOMER_TABLE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ records: updates.slice(index, index + 10), typecast: true }),
    });
    if (!response.ok) throw new Error(`Airtable service-schedule update returned ${response.status}.`);
  }
  for (let index = 0; index < creates.length; index += 10) {
    const response = await fetch(`${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_CUSTOMER_TABLE}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ records: creates.slice(index, index + 10), typecast: true }),
    });
    if (!response.ok) throw new Error(`Airtable active-customer create returned ${response.status}.`);
  }
  return { configured: true, scanned: customers.length, matched: matchedClientKeys.size, updated: updates.length, created: creates.length };
}

async function refreshWebsiteBackendSnapshot(env) {
  if (!env?.DB || !env?.AIRTABLE_API_KEY) return { refreshed: false, capturedAt: null };
  const { refreshAirtableCockpitSnapshot } = await import("./airtable.js");
  const snapshot = await refreshAirtableCockpitSnapshot(env);
  return { refreshed: true, capturedAt: snapshot.capturedAt, status: snapshot.status, warning: snapshot.warning };
}

export async function refreshSubscriptionSnapshot(env) {
  if (!env?.DB || !env?.SNG_API_KEY) throw new Error("Daily subscription refresh is missing DB or SNG_API_KEY.");
  const [activeClients, withoutSubscription] = await Promise.all([
    fetchSngPages("/api/v1/clients/active", env.SNG_API_KEY),
    fetchSngPages("/api/v1/clients/active_no_subscription", env.SNG_API_KEY),
  ]);
  if (!activeClients.length) throw new Error("Daily subscription refresh returned no active SNG clients; the prior snapshot was preserved.");

  const noSubscriptionIds = new Set(withoutSubscription.map((client) => normalized(clientId(client))).filter(Boolean));
  const liveCoreClients = activeClients.filter((client) => {
    const id = normalized(clientId(client));
    return client.cleanup_frequency && !noSubscriptionIds.has(id) && normalized(clientName(client)) !== "testtest";
  });
  const baselineResult = await env.DB.prepare(
    `SELECT client_key, client_name, address, core_subscription_count, addon_subscription_count,core_mrr,addon_mrr,total_mrr FROM subscription_client_baseline`
  ).all();
  const baseline = baselineResult.results ?? [];
  const baselineByKey = new Map(baseline.map((row) => [row.client_key, row]));
  const baselineByName = new Map(baseline.map((row) => [normalized(row.client_name), row.client_key]).filter(([name]) => name));
  const liveByKey = new Map();
  for (const client of liveCoreClients) {
    const exactKey = clientKey(client);
    const resolvedKey = baselineByKey.has(exactKey) ? exactKey : baselineByName.get(normalized(clientName(client))) ?? exactKey;
    if (resolvedKey !== "|") liveByKey.set(resolvedKey, client);
  }
  const snapshotDate = easternDate();
  const previousDateRow = await env.DB.prepare(
    `SELECT MAX(snapshot_date) snapshot_date FROM subscription_daily_snapshots WHERE snapshot_date < ?`
  ).bind(snapshotDate).first();
  const previousRows = previousDateRow?.snapshot_date
    ? (await env.DB.prepare(`SELECT client_key, active FROM subscription_client_daily WHERE snapshot_date = ?`).bind(previousDateRow.snapshot_date).all()).results ?? []
    : [];
  const previousActive = new Set(previousRows.filter((row) => Number(row.active) === 1).map((row) => row.client_key));

  const liveActive = new Set(liveByKey.keys());
  const cancellationResult = await env.DB.prepare(
    `SELECT client_name,canceled_at FROM subscription_cancellations
     WHERE business_line='scooping' AND is_customer_churn=1 AND reactivated_at IS NULL`
  ).all();
  const cancellations = cancellationResult.results ?? [];
  const canceledNames = new Set(cancellations.map((row) => normalized(row.client_name)).filter(Boolean));
  const currentlyCanceledKeys = baseline.filter((row) => canceledNames.has(normalized(row.client_name))).map((row) => row.client_key);
  const currentlyCanceledSet = new Set(currentlyCanceledKeys);
  const churnedKeys = currentlyCanceledKeys.filter((key) => previousActive.size
    ? previousActive.has(key)
    : cancellations.some((row) => normalized(row.client_name) === normalized(baselineByKey.get(key)?.client_name) && String(row.canceled_at).slice(0, 10) >= snapshotDate));
  const currentActive = new Set(baseline.filter((row) => !currentlyCanceledSet.has(row.client_key)).map((row) => row.client_key));
  const matchedActive = baseline.filter((row) => currentActive.has(row.client_key));
  const unmatchedLive = [...liveByKey.keys()].filter((key) => !baselineByKey.has(key) && !canceledNames.has(normalized(clientName(liveByKey.get(key)))));
  if (baseline.length && matchedActive.length / baseline.length < 0.8) {
    throw new Error(`Daily subscription refresh matched only ${matchedActive.length} of ${baseline.length} baseline customers; the prior snapshot was preserved.`);
  }
  const reactivatedKeys = [...liveActive].filter((key) => previousRows.some((row) => row.client_key === key && Number(row.active) === 0));
  const coreMrr = matchedActive.reduce((sum, row) => sum + Number(row.core_mrr || 0), 0);
  const addonMrr = matchedActive.reduce((sum, row) => sum + Number(row.addon_mrr || 0), 0);
  const activeSubscriptionLines = matchedActive.reduce((sum, row) => sum + Number(row.core_subscription_count || 0) + Number(row.addon_subscription_count || 0), 0) + unmatchedLive.length;
  const lostMrr = churnedKeys.reduce((sum, key) => sum + Number(baselineByKey.get(key)?.core_mrr || 0), 0);

  await env.DB.prepare(
    `UPDATE subscription_status_reviews
     SET review_status='resolved',resolution='Closed: active-feed absence is not a subscription status event',resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE review_status='open'`
  ).run();

  const clientStatements = baseline.map((row) => env.DB.prepare(
    `INSERT INTO subscription_client_daily (snapshot_date,client_key,sng_client_ref,active,core_mrr,total_mrr)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(snapshot_date,client_key) DO UPDATE SET sng_client_ref=excluded.sng_client_ref,active=excluded.active,core_mrr=excluded.core_mrr,total_mrr=excluded.total_mrr`
  ).bind(snapshotDate, row.client_key, clientId(liveByKey.get(row.client_key)), currentActive.has(row.client_key) ? 1 : 0, Number(row.core_mrr || 0), Number(row.total_mrr || 0)));
  const unmatchedStatements = unmatchedLive.map((key) => env.DB.prepare(
    `INSERT INTO subscription_client_daily (snapshot_date,client_key,sng_client_ref,active,core_mrr,total_mrr)
     VALUES (?,?,?,1,0,0)
     ON CONFLICT(snapshot_date,client_key) DO UPDATE SET sng_client_ref=excluded.sng_client_ref,active=1`
  ).bind(snapshotDate, key, clientId(liveByKey.get(key))));
  await writeInBatches(env.DB, [...clientStatements, ...unmatchedStatements]);
  await env.DB.prepare(
    `INSERT INTO subscription_daily_snapshots
      (snapshot_date,active_core_customers,active_subscription_lines,core_mrr,addon_mrr,total_mrr,churned_customers,lost_mrr,reactivated_customers,unmatched_live_clients,pending_status_reviews,captured_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(snapshot_date) DO UPDATE SET
       active_core_customers=excluded.active_core_customers,active_subscription_lines=excluded.active_subscription_lines,
       core_mrr=excluded.core_mrr,addon_mrr=excluded.addon_mrr,total_mrr=excluded.total_mrr,
       churned_customers=excluded.churned_customers,lost_mrr=excluded.lost_mrr,
       reactivated_customers=excluded.reactivated_customers,unmatched_live_clients=excluded.unmatched_live_clients,
       pending_status_reviews=excluded.pending_status_reviews,captured_at=CURRENT_TIMESTAMP`
  ).bind(snapshotDate, matchedActive.length + unmatchedLive.length, activeSubscriptionLines, coreMrr, addonMrr, coreMrr + addonMrr, churnedKeys.length, lostMrr, reactivatedKeys.length, unmatchedLive.length, 0).run();
  const scheduleSync = await syncAirtableServiceSchedules(env, liveCoreClients);
  const backendSnapshot = scheduleSync.updated || scheduleSync.created
    ? await refreshWebsiteBackendSnapshot(env)
    : { refreshed: false, capturedAt: null };
  console.log(JSON.stringify({ event: "subscription_daily_refresh", snapshotDate, activeCoreCustomers: matchedActive.length + unmatchedLive.length, activeSubscriptionLines, totalMrr: coreMrr + addonMrr, churnedCustomers: churnedKeys.length, pendingStatusReviews: 0, unmatchedLiveClients: unmatchedLive.length, serviceSchedulesUpdated: scheduleSync.updated, activeCustomersCreated: scheduleSync.created, backendSnapshotAt: backendSnapshot.capturedAt }));
  return { snapshotDate, activeCoreCustomers: matchedActive.length + unmatchedLive.length, activeSubscriptionLines, serviceSchedulesUpdated: scheduleSync.updated, activeCustomersCreated: scheduleSync.created, backendSnapshot };
}

export async function runScheduledSubscriptionRefresh(env) {
  const id = crypto.randomUUID();
  try {
    const result = await refreshSubscriptionSnapshot(env);
    await env.DB.prepare(
      `INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at)
       VALUES (?,'subscriptions_daily','success',?,?,CURRENT_TIMESTAMP)`
    ).bind(id, result.snapshotDate, result.activeCoreCustomers).run();
    return result;
  } catch (error) {
    if (env?.DB) {
      await env.DB.prepare(
        `INSERT INTO system_sync_runs (id,sync_name,status,error,completed_at)
         VALUES (?,'subscriptions_daily','failed',?,CURRENT_TIMESTAMP)`
      ).bind(id, String(error).slice(0, 500)).run();
    }
    console.error(JSON.stringify({ event: "subscription_daily_refresh_failed", message: String(error) }));
    throw error;
  }
}

export async function runScheduledSubscriptionRecovery(env) {
  if (!env?.DB || !env?.SNG_API_KEY) return { skipped: true, reason: "not_configured" };
  const snapshotDate = easternDate();
  const current = await env.DB.prepare(
    `SELECT snapshot_date FROM subscription_daily_snapshots WHERE snapshot_date=? LIMIT 1`
  ).bind(snapshotDate).first();
  if (current) {
    const [activeClients, withoutSubscription] = await Promise.all([
      fetchSngPages("/api/v1/clients/active", env.SNG_API_KEY),
      fetchSngPages("/api/v1/clients/active_no_subscription", env.SNG_API_KEY),
    ]);
    const noSubscriptionIds = new Set(withoutSubscription.map((client) => normalized(clientId(client))).filter(Boolean));
    const liveCoreClients = activeClients.filter((client) => {
      const id = normalized(clientId(client));
      return client.cleanup_frequency && !noSubscriptionIds.has(id) && normalized(clientName(client)) !== "testtest";
    });
    const customerSync = await syncAirtableServiceSchedules(env, liveCoreClients);
    const backendSnapshot = customerSync.updated || customerSync.created
      ? await refreshWebsiteBackendSnapshot(env)
      : { refreshed: false, capturedAt: null };
    return { skipped: true, reason: "snapshot_current", snapshotDate, customerSync, backendSnapshot };
  }
  return runScheduledSubscriptionRefresh(env);
}
