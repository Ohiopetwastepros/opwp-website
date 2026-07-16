const SNG_BASE_URL = "https://openapi.sweepandgo.com";
const AIRTABLE_API_URL = "https://api.airtable.com/v0";
const AIRTABLE_BASE_ID = "appcAWPBQB8GmOrcT";
const AIRTABLE_CUSTOMER_TABLE = "tblhi8MGUOsWNmd37";

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
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!response.ok) throw new Error(`SNG ${path} returned ${response.status}.`);
    const data = await response.json();
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

export function airtableFrequency(value) {
  const frequency = normalized(value);
  if (["onceaweek", "weekly", "onceweekly"].includes(frequency)) return "Weekly";
  if (["twiceaweek", "twotimesaweek", "twiceweekly"].includes(frequency)) return "Twice Weekly";
  if (["biweekly", "everyotherweek", "onceeverytwoweeks"].includes(frequency)) return "Biweekly";
  if (["monthly", "onceamonth"].includes(frequency)) return "Monthly";
  return "";
}

export function serviceDays(value) {
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,/&]+|\band\b/i);
  const found = [];
  for (const item of source) {
    const text = String(item?.day ?? item?.name ?? item ?? "").trim().toLowerCase();
    const day = dayNames.find((candidate) => text === candidate.toLowerCase() || text.startsWith(candidate.slice(0, 3).toLowerCase()));
    if (day && !found.includes(day)) found.push(day);
  }
  return found.sort((a, b) => dayNames.indexOf(a) - dayNames.indexOf(b));
}

async function airtableActiveCustomers(apiKey) {
  const records = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100", filterByFormula: "LOWER({Status})='active'" });
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
  const customers = await airtableActiveCustomers(env.AIRTABLE_API_KEY);
  const byId = new Map(activeClients.map((client) => [normalized(clientId(client)), client]).filter(([id]) => id));
  const byName = new Map(activeClients.map((client) => [normalized(clientName(client)), client]).filter(([name]) => name));
  const updates = [];
  for (const record of customers) {
    const fields = record.fields ?? {};
    const client = byId.get(normalized(fields["SNG Client ID"])) || byName.get(normalized(fields["Client Name"]));
    if (!client) continue;
    const next = {};
    const frequency = airtableFrequency(client.cleanup_frequency);
    const days = serviceDays(client.service_days);
    const sngId = clientId(client);
    if (sngId && String(fields["SNG Client ID"] ?? "") !== sngId) next["SNG Client ID"] = sngId;
    if (frequency && fields.Frequency !== frequency) next.Frequency = frequency;
    if (days[0] && fields["Service Day"] !== days[0]) next["Service Day"] = days[0];
    if (days[1] && fields["Service Day 2"] !== days[1]) next["Service Day 2"] = days[1];
    if (client.assigned_to && fields["Assigned Tech"] !== client.assigned_to) next["Assigned Tech"] = client.assigned_to;
    if (Object.keys(next).length) updates.push({ id: record.id, fields: next });
  }
  for (let index = 0; index < updates.length; index += 10) {
    const response = await fetch(`${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_CUSTOMER_TABLE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ records: updates.slice(index, index + 10), typecast: true }),
    });
    if (!response.ok) throw new Error(`Airtable service-schedule update returned ${response.status}.`);
  }
  return { configured: true, scanned: customers.length, matched: customers.length - customers.filter((record) => !byId.has(normalized(record.fields?.["SNG Client ID"])) && !byName.has(normalized(record.fields?.["Client Name"]))).length, updated: updates.length };
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
  const scheduleSync = await syncAirtableServiceSchedules(env, activeClients);
  console.log(JSON.stringify({ event: "subscription_daily_refresh", snapshotDate, activeCoreCustomers: matchedActive.length + unmatchedLive.length, activeSubscriptionLines, totalMrr: coreMrr + addonMrr, churnedCustomers: churnedKeys.length, pendingStatusReviews: 0, unmatchedLiveClients: unmatchedLive.length, serviceSchedulesUpdated: scheduleSync.updated }));
  return { snapshotDate, activeCoreCustomers: matchedActive.length + unmatchedLive.length, activeSubscriptionLines, serviceSchedulesUpdated: scheduleSync.updated };
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
