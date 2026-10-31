import { reconcileSubscriptionContinuity } from "./subscription-continuity-worker.mjs";
import { controlledSngFetch } from "./sng-request-control.mjs";
import { airtableFrequency, serviceDays, sngScheduleValues } from "./sng-service-schedule.mjs";
import { fetchSngBillingCollection, reconcileMissingRevenueBaselines } from "./subscription-reconciliation.mjs";

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

async function fetchSngPage(url, apiKey, path, env) {
  let lastError = null;
  for (let attempt = 1; attempt <= SNG_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await controlledSngFetch(env, url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
      if (response.ok) return response.json();
      lastError = new Error(`SNG ${path} returned ${response.status}.`);
      if (response.status === 429) throw lastError;
      if (!SNG_RETRYABLE_STATUSES.has(response.status) || attempt === SNG_MAX_ATTEMPTS) throw lastError;
      await wait(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (error?.status === 429 || attempt === SNG_MAX_ATTEMPTS || (error instanceof Error && /^SNG .* returned \d+\.$/.test(error.message))) throw error;
      await wait(300 * (2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new Error(`SNG ${path} request failed.`);
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clientId(client) {
  const nested = client?.client && typeof client.client === "object" ? client.client : {};
  const value = typeof client?.client === "string" || typeof client?.client === "number"
    ? client.client
    : client?.client_id ?? client?.id ?? client?.user_id ?? nested?.client_id ?? nested?.id ?? nested?.user_id;
  return String(value ?? "");
}

function clientName(client) {
  const nested = client?.client && typeof client.client === "object" ? client.client : {};
  return String(firstValue(
    client?.client_name,
    client?.full_name,
    nested?.client_name,
    nested?.full_name,
    `${client?.first_name ?? nested?.first_name ?? ""} ${client?.last_name ?? nested?.last_name ?? ""}`,
  ) ?? "").trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function text(value) {
  return String(value ?? "").trim();
}

function currentSubscription(row, today) {
  return normalized(row?.status) === "active"
    && (!row?.start_date || String(row.start_date).slice(0, 10) <= today)
    && (!row?.end_date || String(row.end_date).slice(0, 10) > today);
}

function compactServicePlan(row) {
  return text(row?.service_plan ?? row?.subscription_name ?? row?.name).replace(/^Regular Plan\s*-\s*/i, "");
}

function coreServicePlan(row) {
  const plan = compactServicePlan(row);
  return /^\d+d-(?:\d+x[WM]|bW)$/i.test(plan) ? plan : "";
}

const MONTHLY_FACTORS = {
  monthly: 1,
  annually: 1 / 12,
  "semi-annually": 1 / 6,
  every_four_months: 1 / 4,
  quarterly: 1 / 3,
  every_two_months: 1 / 2,
  "4_weeks": 13 / 12,
  "bi-weekly": 26 / 12,
  weekly: 52 / 12,
};

function subscriptionIdentity(row) {
  const id = normalized(clientId(row));
  return id ? `id:${id}` : `name:${normalized(clientName(row))}`;
}

function subscriptionSummary(rows) {
  const core = rows.filter(coreServicePlan);
  if (core.length !== 1) return {};
  const plan = coreServicePlan(core[0]);
  const dogMatch = plan.match(/^(\d+)d-/i);
  const monthlyAmounts = rows.map((row) => {
    const factor = MONTHLY_FACTORS[text(row.billing_interval).toLowerCase()];
    const price = Number(row.price ?? row.revenue ?? row.amount);
    return factor && Number.isFinite(price) && price >= 0 ? price * factor : null;
  });
  return {
    dogs: dogMatch ? Number(dogMatch[1]) : null,
    plan: `Regular Plan - ${plan}`,
    mrr: monthlyAmounts.every((amount) => amount !== null)
      ? Math.round(monthlyAmounts.reduce((sum, amount) => sum + amount, 0) * 100) / 100
      : null,
  };
}

function clientLocation(client) {
  const nested = [
    client?.location,
    client?.service_location,
    client?.client_location,
    client?.customer_location,
    typeof client?.address === "object" ? client.address : null,
    typeof client?.client === "object" ? client.client : null,
  ]
    .find((value) => value && typeof value === "object") ?? {};
  let address = text(firstValue(
    client?.service_address,
    client?.client_address,
    client?.home_address,
    typeof client?.address === "string" ? client.address : "",
    nested?.street_address,
    nested?.address_1,
    nested?.address,
  ));
  let city = text(firstValue(client?.city, client?.service_city, client?.client_city, nested?.city));
  let zip = text(firstValue(client?.zip, client?.zip_code, client?.postal_code, client?.service_zip, nested?.zip, nested?.zip_code, nested?.postal_code));
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const tail = parts.at(-1) ?? "";
  const zipMatch = tail.match(/\b\d{5}(?:-\d{4})?\b/);
  if (!zip && zipMatch) zip = zipMatch[0];
  if (!city && parts.length >= 3 && zipMatch) city = parts.at(-2) ?? "";
  if (parts.length >= 3 && zipMatch) address = parts.slice(0, -2).join(", ");
  return { address, city, zip };
}

function activeSubscriptionCustomers(activeClients, subscriptionRows, today = easternDate()) {
  if (!subscriptionRows.length) return activeClients.map((client) => ({ client, subscriptionRows: [], scheduleClient: client }));
  const activeRows = subscriptionRows.filter((row) => currentSubscription(row, today));
  const groups = new Map();
  for (const row of activeRows) {
    const key = subscriptionIdentity(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const activeById = new Map(activeClients.map((client) => [normalized(clientId(client)), client]).filter(([key]) => key));
  const activeByName = new Map(activeClients.map((client) => [normalized(clientName(client)), client]).filter(([key]) => key));
  return [...groups.values()]
    .filter((rows) => rows.filter(coreServicePlan).length === 1)
    .map((rows) => {
      const source = rows.find(coreServicePlan);
      const scheduleClient = activeById.get(normalized(clientId(source))) || activeByName.get(normalized(clientName(source))) || null;
      return { client: { ...source, ...(scheduleClient ?? {}) }, subscriptionRows: rows, scheduleClient };
    });
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
  const value = data?.paginate?.total_pages ?? data?.pagination?.total_pages ?? data?.meta?.last_page ?? data?.last_page;
  return value == null ? null : Number(value);
}

async function fetchSngPages(path, apiKey, env) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const url = new URL(path, SNG_BASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("length", "50");
    const data = await fetchSngPage(url, apiKey, path, env);
    if (![data, data?.data, data?.results, data?.items].some(Array.isArray)) throw new Error('SNG client collection is malformed.');
    const pageRows = rowsFrom(data);
    rows.push(...pageRows);
    const total = totalPages(data);
    if (total !== null) {
      if (!Number.isInteger(total) || total < page || total > 50 || (!pageRows.length && page < total)) throw new Error('SNG client pagination is incomplete.');
      if (page === total) return rows;
    } else if (pageRows.length < 50) return rows;
  }
  throw new Error('SNG client pagination exceeded its limit.');
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

export async function syncAirtableServiceSchedules(env, activeClients, subscriptionRows = []) {
  if (!env?.AIRTABLE_API_KEY) return { configured: false, updated: 0 };
  const customers = await airtableCustomers(env.AIRTABLE_API_KEY);
  const currentCustomers = activeSubscriptionCustomers(activeClients, subscriptionRows);
  const byId = new Map(currentCustomers.map((entry) => [normalized(clientId(entry.client)), entry]).filter(([id]) => id));
  const byName = new Map(currentCustomers.map((entry) => [normalized(clientName(entry.client)), entry]).filter(([name]) => name));
  const updates = [];
  const matchedClientKeys = new Set();
  for (const record of customers) {
    const fields = record.fields ?? {};
    const entry = byId.get(normalized(fields["SNG Client ID"])) || byName.get(normalized(fields["Client Name"]));
    if (!entry) continue;
    const { client, scheduleClient } = entry;
    matchedClientKeys.add(normalized(clientId(client)) || normalized(clientName(client)));
    const next = {};
    const sngId = clientId(client);
    if (normalized(fields.Status) !== "active") next.Status = "Active";
    if (fields.Type !== "Residential") next.Type = "Residential";
    if (sngId && String(fields["SNG Client ID"] ?? "") !== sngId) next["SNG Client ID"] = sngId;
    const location = clientLocation(client);
    if (location.address && text(fields.Address) !== location.address) next.Address = location.address;
    if (location.city && text(fields.City) !== location.city) next.City = location.city;
    if (location.zip && text(fields.ZIP) !== location.zip) next.ZIP = location.zip;
    const billing = subscriptionSummary(entry.subscriptionRows);
    if (billing.dogs && Number(fields["Number of Dogs"] || 0) !== billing.dogs) next["Number of Dogs"] = billing.dogs;
    if (billing.plan && text(fields["Subscription Name"]) !== billing.plan) next["Subscription Name"] = billing.plan;
    if (billing.mrr !== null && billing.mrr !== undefined && Math.abs(Number(fields["MRR ($)"] || 0) - billing.mrr) > 0.005) next["MRR ($)"] = billing.mrr;
    if (scheduleClient) {
      const schedule = sngScheduleValues(scheduleClient);
      if (schedule.frequency && fields.Frequency !== schedule.frequency) next.Frequency = schedule.frequency;
      if (String(fields["Service Day"] ?? "") !== String(schedule.days[0] ?? "")) next["Service Day"] = schedule.days[0] || null;
      if (String(fields["Service Day 2"] ?? "") !== String(schedule.days[1] ?? "")) next["Service Day 2"] = schedule.days[1] || null;
      if (String(fields["Assigned Tech"] ?? "") !== schedule.assignedTech) next["Assigned Tech"] = schedule.assignedTech || null;
      if (String(fields["Assigned Tech 2"] ?? "") !== schedule.assignedTech2) next["Assigned Tech 2"] = schedule.assignedTech2 || null;
    }
    if (Object.keys(next).length) updates.push({ id: record.id, fields: next });
  }
  const uniqueActiveClients = [...new Map(currentCustomers.map((entry) => [normalized(clientId(entry.client)) || normalized(clientName(entry.client)), entry]).filter(([key]) => key)).entries()];
  const creates = uniqueActiveClients
    .filter(([key]) => !matchedClientKeys.has(key))
    .map(([, entry]) => {
      const { client, scheduleClient } = entry;
      const fields = { "Client Name": clientName(client), Status: "Active", Type: "Residential" };
      const sngId = clientId(client);
      if (sngId) fields["SNG Client ID"] = sngId;
      if (scheduleClient) {
        const schedule = sngScheduleValues(scheduleClient);
        if (schedule.frequency) fields.Frequency = schedule.frequency;
        if (schedule.days[0]) fields["Service Day"] = schedule.days[0];
        if (schedule.days[1]) fields["Service Day 2"] = schedule.days[1];
        if (schedule.assignedTech) fields["Assigned Tech"] = schedule.assignedTech;
        if (schedule.assignedTech2) fields["Assigned Tech 2"] = schedule.assignedTech2;
      }
      const location = clientLocation(client);
      if (location.address) fields.Address = location.address;
      if (location.city) fields.City = location.city;
      if (location.zip) fields.ZIP = location.zip;
      const billing = subscriptionSummary(entry.subscriptionRows);
      if (billing.dogs) fields["Number of Dogs"] = billing.dogs;
      if (billing.plan) fields["Subscription Name"] = billing.plan;
      if (billing.mrr !== null && billing.mrr !== undefined) fields["MRR ($)"] = billing.mrr;
      return { fields };
    });
  if (subscriptionRows.length) {
    const currentlyActive = customers.filter((record) => normalized(record.fields?.Status) === "active");
    if (currentCustomers.length < currentlyActive.length * 0.8) {
      throw new Error(`Airtable reconciliation found only ${currentCustomers.length} active Sweep & Go subscriptions for ${currentlyActive.length} active Airtable customers; existing statuses were preserved.`);
    }
    for (const record of currentlyActive) {
      const fields = record.fields ?? {};
      const matched = byId.get(normalized(fields["SNG Client ID"])) || byName.get(normalized(fields["Client Name"]));
      if (!matched) updates.push({ id: record.id, fields: { Status: "Inactive" } });
    }
  }
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

export async function liveCoreClients(env) {
  if (!env?.SNG_API_KEY) throw new Error("Sweep & Go subscription refresh is missing SNG_API_KEY.");
  const [activeClients, withoutSubscription] = await Promise.all([
    fetchSngPages("/api/v1/clients/active", env.SNG_API_KEY, env),
    fetchSngPages("/api/v1/clients/active_no_subscription", env.SNG_API_KEY, env),
  ]);
  if (!activeClients.length) throw new Error("Sweep & Go returned no active clients; existing data was preserved.");
  const noSubscriptionIds = new Set(withoutSubscription.map((client) => normalized(clientId(client))).filter(Boolean));
  return activeClients.filter((client) => {
    const id = normalized(clientId(client));
    return client.cleanup_frequency && !noSubscriptionIds.has(id) && normalized(clientName(client)) !== "testtest";
  });
}

export async function refreshSubscriptionSnapshot(env) {
  if (!env?.DB || !env?.SNG_API_KEY) throw new Error("Daily subscription refresh is missing DB or SNG_API_KEY.");
  const activeClients = await liveCoreClients(env);
  await reconcileSubscriptionContinuity(env, activeClients);
  await reconcileMissingRevenueBaselines(env, activeClients);
  const baselineResult = await env.DB.prepare(
    `SELECT client_key, client_name, address, core_subscription_count, addon_subscription_count,core_mrr,addon_mrr,total_mrr FROM subscription_client_baseline`
  ).all();
  const baseline = baselineResult.results ?? [];
  const baselineByKey = new Map(baseline.map((row) => [row.client_key, row]));
  const baselineByName = new Map(baseline.map((row) => [normalized(row.client_name), row.client_key]).filter(([name]) => name));
  const liveByKey = new Map();
  for (const client of activeClients) {
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
  console.log(JSON.stringify({ event: "subscription_daily_refresh", snapshotDate, activeCoreCustomers: matchedActive.length + unmatchedLive.length, activeSubscriptionLines, totalMrr: coreMrr + addonMrr, churnedCustomers: churnedKeys.length, pendingStatusReviews: 0, unmatchedLiveClients: unmatchedLive.length }));
  return { snapshotDate, activeCoreCustomers: matchedActive.length + unmatchedLive.length, activeSubscriptionLines };
}

export async function reconcileActiveSubscriptions(env) {
  const [activeClients, subscriptions] = await Promise.all([
    liveCoreClients(env),
    fetchSngBillingCollection(env, "subscriptions"),
  ]);
  const customerSync = await syncAirtableServiceSchedules(env, activeClients, subscriptions);
  const continuity = await reconcileSubscriptionContinuity(env, activeClients);
  console.log(JSON.stringify({
    event: "subscription_airtable_reconciliation",
    activeClients: activeClients.length,
    scanned: customerSync.scanned ?? 0,
    matched: customerSync.matched ?? 0,
    updated: customerSync.updated ?? 0,
    created: customerSync.created ?? 0,
  }));
  return { activeClients: activeClients.length, customerSync, continuity };
}

export async function runScheduledSubscriptionReconciliation(env) {
  const id = crypto.randomUUID();
  try {
    const result = await reconcileActiveSubscriptions(env);
    await env.DB.prepare(
      `INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at)
       VALUES (?,'subscriptions_airtable','success',date('now'),?,CURRENT_TIMESTAMP)`
    ).bind(id, result.activeClients).run();
    return result;
  } catch (error) {
    if (env?.DB) {
      await env.DB.prepare(
        `INSERT INTO system_sync_runs (id,sync_name,status,error,completed_at)
         VALUES (?,'subscriptions_airtable','failed',?,CURRENT_TIMESTAMP)`
      ).bind(id, String(error).slice(0, 500)).run();
    }
    console.error(JSON.stringify({ event: "subscription_airtable_reconciliation_failed", message: String(error) }));
    throw error;
  }
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
  const [current, airtableRun] = await Promise.all([
    env.DB.prepare(
      `SELECT snapshot_date,captured_at FROM subscription_daily_snapshots WHERE snapshot_date=? LIMIT 1`
    ).bind(snapshotDate).first(),
    env.DB.prepare(
      `SELECT id FROM system_sync_runs
       WHERE sync_name='subscriptions_airtable' AND status='success' AND snapshot_date=?
       ORDER BY completed_at DESC LIMIT 1`
    ).bind(snapshotDate).first(),
  ]);
  const capturedAt = current?.captured_at ? Date.parse(String(current.captured_at).includes("T") ? current.captured_at : `${current.captured_at}Z`) : 0;
  const snapshotCurrent = current && Date.now() - capturedAt < 55 * 60000;
  if (!snapshotCurrent) await runScheduledSubscriptionRefresh(env);
  if (!airtableRun) return runScheduledSubscriptionReconciliation(env);
  if (snapshotCurrent) {
    await reconcileSubscriptionContinuity(env, await liveCoreClients(env));
    return { skipped: true, reason: "snapshot_current", snapshotDate };
  }
  return { recovered: true, snapshotDate };
}
