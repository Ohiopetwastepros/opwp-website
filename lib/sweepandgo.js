import { getRuntimeEnv } from "./cloudflare";

const BASE_URL = "https://openapi.sweepandgo.com";

const FREQUENCY_MAP = {
  twice_a_week: "two_times_a_week",
  every_other_week: "bi_weekly",
};

const LAST_CLEANED_MAP = {
  "3_4_months": "3-4_months",
  "5_6_months": "5-6_months",
  "7_9_months": "7-9_months",
  "10_plus": "10+_months",
};

function token() {
  return getRuntimeEnv().SNG_API_KEY;
}

export function sngConfigured() {
  return Boolean(token());
}

export async function sngRequest(path, { method = "GET", body, searchParams } = {}) {
  const key = token();
  if (!key) return { configured: false, ok: false, status: 0, data: null };

  const url = new URL(path, BASE_URL);
  for (const [name, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return { configured: true, ok: response.ok, status: response.status, data };
  } catch (error) {
    return { configured: true, ok: false, status: 0, data: { error: String(error) } };
  }
}

export function sngRows(result) {
  if (!result?.ok) return [];
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.data?.data)) return result.data.data;
  if (Array.isArray(result.data?.results)) return result.data.results;
  if (Array.isArray(result.data?.items)) return result.data.items;
  return [];
}

function lastPageFrom(data) {
  return (
    data?.last_page ??
    data?.meta?.last_page ??
    data?.pagination?.last_page ??
    data?.pagination?.total_pages ??
    data?.paginate?.total_pages ??
    data?.paginate?.last_page ??
    data?.paginate?.totalPages ??
    data?.total_pages ??
    null
  );
}

export async function sngPaginatedRequest(path, { searchParams = {}, maxPages = 25, perPage = 100 } = {}) {
  const rows = [];
  let configured = false;
  let ok = true;
  let status = 200;
  let data = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await sngRequest(path, {
      searchParams: {
        per_page: perPage,
        ...searchParams,
        page,
      },
    });

    configured = result.configured;
    ok = ok && result.ok;
    status = result.status;
    data = result.data;

    if (!result.ok) return { ...result, rows };

    const pageRows = sngRows(result);
    rows.push(...pageRows);

    const finalPage = Number(lastPageFrom(result.data));
    if (Number.isFinite(finalPage)) {
      if (page >= finalPage) break;
    } else if (!pageRows.length || pageRows.length < perPage) break;
  }

  return { configured, ok, status, data, rows };
}

export function normalizeFrequency(value) {
  return FREQUENCY_MAP[value] ?? value;
}

export function normalizeLastCleaned(value) {
  return LAST_CLEANED_MAP[value] ?? value;
}

function normalizedClientValue(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sngClientId(client) {
  return client?.client ?? client?.client_id ?? client?.id ?? client?.user_id ?? "";
}

function sngClientName(client) {
  return String(client?.client_name ?? client?.full_name ?? `${client?.first_name ?? ""} ${client?.last_name ?? ""}`).trim();
}

export function recurringSngClients(clients = [], clientsWithoutSubscription = []) {
  const withoutSubscription = new Set(clientsWithoutSubscription.map((client) => normalizedClientValue(sngClientId(client))).filter(Boolean));
  return clients.filter((client) => {
    const id = normalizedClientValue(sngClientId(client));
    return client.cleanup_frequency && !withoutSubscription.has(id) && normalizedClientValue(sngClientName(client)) !== "testtest";
  });
}

export function buildSubscriptionReconciliation(airtableCustomers = [], activeSngClients = [], clientsWithoutSubscription = []) {
  const recurring = recurringSngClients(activeSngClients, clientsWithoutSubscription);
  const airtableById = new Map();
  const airtableByName = new Map();
  for (const row of airtableCustomers) {
    const id = normalizedClientValue(row.sngClientId);
    const name = normalizedClientValue(row.name);
    if (id && !airtableById.has(id)) airtableById.set(id, row);
    if (name && !airtableByName.has(name)) airtableByName.set(name, row);
  }
  const matchedRow = (client) => airtableById.get(normalizedClientValue(sngClientId(client))) || airtableByName.get(normalizedClientValue(sngClientName(client)));
  const missingFromAirtable = recurring.filter((client) => !matchedRow(client)).map((client) => ({
    name: sngClientName(client),
    sngClientId: String(sngClientId(client)),
    issue: "Missing from Airtable",
    action: "Create and complete customer record",
  }));
  // The active-client API enriches schedule data, but absence from that feed is not a lifecycle event.
  // Status changes are driven only by subscription/status webhooks.
  const statusMismatches = [];
  const staleAirtable = [];
  const idMissing = airtableCustomers.filter((row) => normalizedClientValue(row.status) === "active" && !normalizedClientValue(row.sngClientId)).map((row) => ({
    name: row.name,
    sngClientId: "",
    issue: "Missing SNG Client ID",
    action: "Match and add SNG Client ID",
  }));
  const issueRows = [...missingFromAirtable, ...idMissing].filter((row, index, rows) => rows.findIndex((candidate) => `${candidate.name}|${candidate.issue}` === `${row.name}|${row.issue}`) === index);
  return {
    recurringCount: recurring.length,
    airtableActiveCount: airtableCustomers.filter((row) => normalizedClientValue(row.status) === "active").length,
    missingFromAirtable,
    statusMismatches,
    staleAirtable,
    missingSngId: idMissing,
    issueRows,
    reconciled: issueRows.length === 0,
  };
}

export function toOnboardingPayload(input) {
  return {
    zip_code: input.zip_code,
    number_of_dogs: Number(input.number_of_dogs),
    last_time_yard_was_thoroughly_cleaned: normalizeLastCleaned(input.last_time_yard_was_thoroughly_cleaned),
    clean_up_frequency: normalizeFrequency(input.clean_up_frequency),
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email,
    city: input.city,
    home_address: input.home_address,
    state: input.state,
    cell_phone_number: input.cell_phone_number,
    initial_cleanup_required: input.initial_cleanup_required,
    cleanup_notification_type: "completed",
    cleanup_notification_channel: "sms",
    how_heard_about_us: input.tracking_field,
    additional_comment: input.account_note,
    dog_name: input["dog_name[]"] ?? input.dog_name ?? [""],
    safe_dog: input["safe_dog[]"] ?? input.safe_dog ?? [""],
    dog_comment: input["dog_comment[]"] ?? input.dog_comment ?? [""],
    coupon_code: input.coupon_code ?? input.coupon,
    marketing_allowed: input.marketing_allowed,
    marketing_allowed_source: "open_api",
    areas_to_clean: Array.isArray(input.areas_to_clean) ? input.areas_to_clean.join(", ") : input.areas_to_clean,
    gate_location: input.gate_location,
    gate_code: input.gate_code,
    tracking_field: input.tracking_field,
    terms_open_api: input.terms_open_api,
  };
}

export async function getSngAdminSnapshot(date) {
  const [clients, clientsWithoutSubscription, leads, jobs] = await Promise.all([
    sngPaginatedRequest("/api/v1/clients/active"),
    sngPaginatedRequest("/api/v1/clients/active_no_subscription"),
    sngRequest("/api/v1/leads/list", { searchParams: { page: 1 } }),
    sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } }),
  ]);
  const recurringClients = recurringSngClients(clients.rows ?? [], clientsWithoutSubscription.rows ?? []);
  return { clients, clientsWithoutSubscription, recurringClients, leads, jobs };
}
