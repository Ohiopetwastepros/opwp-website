import { getRuntimeEnv } from "./cloudflare";
import { canonicalChurnReason, churnReasonRequiresComment, churnReviewStatus } from "./churn";

const API_URL = "https://api.airtable.com/v0";
const META_URL = `${API_URL}/meta`;

export const AIRTABLE_BASES = {
  opwp: { id: "appcAWPBQB8GmOrcT", name: "OPWP Operating System" },
  dogFood: { id: "appc40e3mlfOt2HoA", name: "Extreme Dog Fuel Sales" },
};

const TABLES = {
  opwp: {
    customers: "tblhi8MGUOsWNmd37",
    jobs: "tbls15v5OYexAIULc",
    time: "tbl7mHSMWYsYc8f6S",
    targets: "tblWd5FNDgvOfQJW8",
    churn: "tblyhWKl99rwpiIRI",
    oneTime: "tblGLypXMPxEZQb6B",
    leads: "tblkUnipwqhepVMZX",
  },
  dogFood: {
    sales: "tblpEYQ3qpfcKLmdo",
    products: "tblR7qUUiVhQvZuHr",
    subscriptions: "tblAXBVAMlcwoWM8J",
    customers: "tbl9WHrBHdS2GBuQF",
    deliveries: "tblkphHkGNisP7UJ6",
  },
};

const SNG_EMPLOYEE_NAMES = new Map([[7630, "Craig Bridgman"], [9881, "Tony Bridgman"], [10080, "Bria Mahaney"]]);

function runtimeEnv() {
  return getRuntimeEnv();
}

export function airtableConfigured() {
  return Boolean(runtimeEnv().AIRTABLE_API_KEY);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationMinutes(value) {
  if (typeof value === "number") return number(value);
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const parts = text.split(":").map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
  return number(value);
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function median(values) {
  const sorted = values.map(number).filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function withinDays(value, days) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.now() - days * 86400000;
}

function withinDateRange(value, range) {
  if (!range?.from || !range?.to) return withinDays(value, 30);
  const date = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= range.from && date <= range.to;
}

function previousDays(value, recentDays, priorDays = recentDays) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= recentDays * 86400000 && age < (recentDays + priorDays) * 86400000;
}

function changePercent(current, previous) {
  if (!previous) return current ? 100 : 0;
  return round(((current - previous) / previous) * 100, 1);
}

function weeklySeries(records, dateField, valueField, weeks = 12) {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1));
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index * 7);
    return { label: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), value: 0 };
  });
  for (const record of records) {
    const timestamp = Date.parse(record.fields[dateField]);
    if (!Number.isFinite(timestamp) || timestamp < start.getTime()) continue;
    const index = Math.min(Math.floor((timestamp - start.getTime()) / (7 * 86400000)), weeks - 1);
    buckets[index].value += valueField ? number(record.fields[valueField]) : 1;
  }
  return buckets.map((bucket) => ({ ...bucket, value: round(bucket.value) }));
}

function isStatus(value, ...statuses) {
  return statuses.some((status) => String(value ?? "").toLowerCase() === status.toLowerCase());
}

async function airtableRequest(path, key, attempt = 0) {
  const response = await fetch(`${API_URL}/${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    next: { revalidate: 300 },
  });

  if (response.status === 429 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    return airtableRequest(path, key, attempt + 1);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error?.type || `Airtable request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function airtableUpsert(baseId, tableId, mergeField, fields) {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not configured.");
  const response = await fetch(`${API_URL}/${baseId}/${tableId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ performUpsert: { fieldsToMergeOn: [mergeField] }, records: [{ fields }] }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error?.type || `Airtable upsert failed (${response.status})`);
  return data.records?.[0]?.id ?? null;
}

async function airtableBatchUpsert(baseId, tableId, mergeField, records) {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not configured.");
  let upserted = 0;
  for (let index = 0; index < records.length; index += 10) {
    const response = await fetch(`${API_URL}/${baseId}/${tableId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: [mergeField] }, records: records.slice(index, index + 10) }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.error?.type || `Airtable batch upsert failed (${response.status})`);
    upserted += data.records?.length ?? 0;
  }
  return upserted;
}

function minutesBetween(start, end) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  return Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(Math.round((endTime - startTime) / 60000), 0) : 0;
}

function eventIsoTimestamp(value) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export async function upsertSngJobCompleted(body, context = {}) {
  const data = body?.data ?? body ?? {};
  const prior = context?.data ?? context ?? {};
  const jobId = data?.job_id;
  if (jobId === undefined || jobId === null) throw new Error("SNG completed job is missing job_id.");
  const completedAt = data.end_time || data.start_time || body.created;
  const fields = {
    "Job ID": String(jobId),
    Date: new Date(completedAt).toISOString().slice(0, 10),
    "Customer Name": data.client_name || data.full_name || prior.client_name || prior.full_name || prior.client || "",
    "Tech Name": data.employee_name || prior.employee_name || "",
    "Service Type": data.job_type || prior.type || "Other",
    "Revenue ($)": number(data.price),
    "Est. Minutes": durationMinutes(data.estimate_time || prior.estimate_time),
    "Actual Minutes": minutesBetween(data.start_time || prior.start_time, data.end_time),
    Status: "Completed",
  };
  return airtableUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.jobs, "Job ID", fields);
}

export async function upsertSngShift(body, context = {}) {
  const data = body?.data ?? body ?? {};
  const prior = context?.data ?? context ?? {};
  const shiftId = data?.shift_id;
  if (shiftId === undefined || shiftId === null) throw new Error("SNG shift is missing shift_id.");
  const startOdometer = number(data.start_odometer);
  const endOdometer = number(data.end_odometer);
  const odometerMiles = endOdometer >= startOdometer ? endOdometer - startOdometer : 0;
  const fields = {
    "Record ID": String(shiftId),
    Date: String(data.shift_date || data.start_time || "").slice(0, 10),
    "Tech Name": data.employee_name || prior.name || SNG_EMPLOYEE_NAMES.get(number(data.employee_id)) || "",
    "Minutes Clocked": number(data.duration_time) || minutesBetween(data.start_time, data.end_time),
    "Miles Driven": number(data.company_mileage) || odometerMiles,
    Notes: data.status ? `SNG shift status: ${data.status}` : "Synced from Sweep & Go",
  };
  return airtableUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.time, "Record ID", fields);
}

export function classifySngSubscriptionPlan(value) {
  const plan = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (/dogfood|extremedogfuel|greenbag|bluebag|pinkbag|redbag|26[-_/]?(14|18)|30[-_/]?20|22[-_/]?12/.test(plan)) return "dog_food";
  if (/regularplan/.test(plan) || /^\d+d-\d+x[wm]$/.test(plan) || /^\d+w-\d+d$/.test(plan)) return "scooping";
  return "addon";
}

function customerFrequency(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const key = text.replace(/[^a-z0-9]/g, "");
  if (/2xw/.test(key) || ["twiceaweek", "twotimesaweek", "twiceweekly"].includes(key)) return "Twice Weekly";
  if (/bw/.test(key) || ["biweekly", "everyotherweek", "onceeverytwoweeks"].includes(key)) return "Biweekly";
  if (/1xw/.test(key) || ["onceaweek", "weekly", "onceweekly"].includes(key)) return "Weekly";
  if (["monthly", "onceamonth"].includes(key)) return "Monthly";
  return "";
}

function customerServiceDays(value) {
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,/&]+|\band\b/i);
  return source.map((item) => String(item?.day ?? item?.name ?? item ?? "").trim().toLowerCase()).map((item) => weekdays.find((day) => item === day.toLowerCase() || item.startsWith(day.slice(0, 3).toLowerCase()))).filter((day, index, rows) => day && rows.indexOf(day) === index).sort((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b));
}

export async function updateSngCustomerLifecycle(body, { status = "", createIfMissing = false } = {}) {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not configured.");
  const data = body?.data ?? body ?? {};
  const clientName = String(data.client_name || data.full_name || `${data.first_name ?? ""} ${data.last_name ?? ""}`).trim();
  if (!clientName) return { matched: false, updated: false };
  const safeName = clientName.toLowerCase().replace(/'/g, "\\'");
  const records = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.customers, key, `LOWER({Client Name})='${safeName}'`, 2);
  const current = records[0]?.fields ?? {};
  const fields = {};
  const frequency = customerFrequency(data.cleanup_frequency || data.subscription_name);
  const days = customerServiceDays(data.service_days);
  const sngId = data.client || data.client_id;
  if (status && !isStatus(current.Status, status)) fields.Status = status;
  if (frequency && current.Frequency !== frequency) fields.Frequency = frequency;
  if (days[0] && current["Service Day"] !== days[0]) fields["Service Day"] = days[0];
  if (days[1] && current["Service Day 2"] !== days[1]) fields["Service Day 2"] = days[1];
  if (sngId && String(current["SNG Client ID"] ?? "") !== String(sngId)) fields["SNG Client ID"] = String(sngId);
  if (data.assigned_to && current["Assigned Tech"] !== data.assigned_to) fields["Assigned Tech"] = data.assigned_to;
  if (!records.length && createIfMissing) {
    fields["Client Name"] = clientName;
    fields.Status = status || "Active";
    if (data.address || data.client_address) fields.Address = data.address || data.client_address;
    if (data.zip_code || data.zip) fields.ZIP = String(data.zip_code || data.zip);
    await airtableUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.customers, "Client Name", fields);
    return { matched: false, updated: true, created: true };
  }
  if (!records.length) return { matched: false, updated: false };
  if (!Object.keys(fields).length) return { matched: true, updated: false };
  const response = await fetch(`${API_URL}/${AIRTABLE_BASES.opwp.id}/${TABLES.opwp.customers}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ id: records[0].id, fields }], typecast: true }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `Airtable customer lifecycle update failed (${response.status})`);
  return { matched: true, updated: true };
}

async function airtableCustomerMrr(clientName) {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key || !clientName) return 0;
  const safeName = String(clientName).toLowerCase().replace(/'/g, "\\'");
  const rows = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.customers, key, `LOWER({Client Name})='${safeName}'`, 2);
  return number(rows[0]?.fields?.["MRR ($)"]);
}

export async function upsertSngSubscriptionCanceled(body, options = {}) {
  const data = body?.data ?? body ?? {};
  const subscriptionId = data.subscription_id;
  if (subscriptionId === undefined || subscriptionId === null) throw new Error("SNG canceled subscription is missing subscription_id.");
  const clientName = data.client_name || data.full_name || data.client || "";
  const plan = data.subscription_name || "";
  const businessLine = options.businessLine || classifySngSubscriptionPlan(plan);
  if (businessLine === "addon") throw new Error("Add-on cancellations must not be written to the churn ledger.");
  const reason = String(data.termination_reason || "").trim() || "No reason provided";
  const reasonCategory = options.reasonCategory || canonicalChurnReason(reason);
  const replacementSubscriptionId = options.replacementSubscriptionId || "";
  const reviewStatus = options.reviewStatus || churnReviewStatus(reasonCategory, data.termination_comment, replacementSubscriptionId);
  const eligibilityStatus = options.eligibilityStatus || (options.isCustomerChurn ? "Confirmed" : "Needs Validation");
  const eligibilityEvidence = options.eligibilityEvidence || "";
  const isChurn = options.isCustomerChurn ?? reasonCategory !== "Modification of subscription type";
  const eventTimestamp = eventIsoTimestamp(data.canceled_at || data.terminated_at || body?.created);
  const eventDate = eventTimestamp.slice(0, 10);
  const lostMrr = businessLine === "scooping" && isChurn ? await airtableCustomerMrr(clientName) : 0;
  const fields = {
    "Event ID": `SNG-SUB-${subscriptionId}`,
    "Client Name": clientName,
    "Event Type": eligibilityStatus === "Plan Change" || reasonCategory === "Modification of subscription type" ? "Plan Change" : "Canceled",
    "Event Date": eventDate,
    "Lost MRR ($)": lostMrr,
    Reason: reason,
    "Reason Category": reasonCategory,
    Comment: data.termination_comment || "",
    Plan: plan,
    "Business Line": businessLine === "dog_food" ? "Dog Food" : "Scooping",
    "Review Status": reviewStatus,
    "Subscription ID": String(subscriptionId),
    "Is Churn": Boolean(isChurn),
    "Eligibility Status": eligibilityStatus,
    "Eligibility Evidence": eligibilityEvidence,
    Source: "Sweep & Go webhook",
    "Deactivated Date": eventDate,
  };
  if (replacementSubscriptionId) fields["Replacement Subscription ID"] = String(replacementSubscriptionId);
  if (data.start_date) fields["Start Date"] = new Date(data.start_date).toISOString().slice(0, 10);
  await airtableUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.churn, "Event ID", fields);
  return { subscriptionId: String(subscriptionId), isChurn: Boolean(isChurn), reason, reasonCategory, reviewStatus, lostMrr };
}

export async function getSngChurnServiceEvidence(body) {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { completedServiceBefore: false, completedServiceCount: 0 };
  const data = body?.data ?? body ?? {};
  const clientName = String(data.client_name || data.full_name || "").trim();
  if (!clientName) return { completedServiceBefore: false, completedServiceCount: 0 };
  const canceledAt = eventIsoTimestamp(data.canceled_at || data.terminated_at || body?.created).slice(0, 10);
  const safeName = clientName.toLowerCase().replace(/'/g, "\\'");
  const rows = await listRecords(
    AIRTABLE_BASES.opwp.id,
    TABLES.opwp.jobs,
    key,
    `AND(LOWER({Customer Name})='${safeName}',OR(LOWER({Status})='completed',LOWER({Status})='job:completed'),OR(IS_BEFORE({Date},'${canceledAt}'),IS_SAME({Date},'${canceledAt}','day')))`,
    2,
  );
  return { completedServiceBefore: rows.length > 0, completedServiceCount: rows.length };
}

export async function updateSngChurnLifecycle({ cancellationId, replacementId, isReplacement }) {
  if (!cancellationId) return;
  const fields = {
    "Event ID": `SNG-SUB-${cancellationId}`,
    "Replacement Subscription ID": String(replacementId || ""),
    "Review Status": isReplacement ? "Plan Replacement" : "Complete",
  };
  if (isReplacement) {
    fields["Event Type"] = "Plan Change";
    fields["Is Churn"] = false;
    fields["Lost MRR ($)"] = 0;
    fields["Eligibility Status"] = "Plan Change";
    fields["Eligibility Evidence"] = `Replacement subscription ${replacementId} detected.`;
  } else {
    fields["Reactivated Date"] = new Date().toISOString().slice(0, 10);
  }
  await airtableUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.churn, "Event ID", fields);
}

export async function upsertSngSubscriptionPauseEvent(body, { eventId, eventType, businessLine, reason = "Temporary", comment = "" } = {}) {
  const data = body?.data ?? body ?? {};
  const subscriptionId = data.subscription_id === undefined || data.subscription_id === null ? "" : String(data.subscription_id);
  const paused = eventType === "client:subscription_paused";
  const rawTimestamp = data.paused_at || data.unpaused_at || data.resumed_at || data.created_at || body?.created || Date.now();
  const numeric = Number(rawTimestamp);
  const parsed = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : new Date(rawTimestamp);
  const eventDate = (Number.isNaN(parsed.getTime()) ? new Date() : parsed).toISOString().slice(0, 10);
  const plannedRaw = data.planned_resume_date || data.resume_date || data.paused_until || data.pause_until || data.pause_end_date || data.unpause_date;
  const plannedParsed = plannedRaw ? new Date(plannedRaw) : null;
  const fields = {
    "Event ID": `SNG-${paused ? "PAUSE" : "UNPAUSE"}-${eventId || subscriptionId || eventDate}`,
    "Client Name": data.client_name || data.full_name || "",
    "Event Type": paused ? "Paused" : "Unpaused",
    "Event Date": eventDate,
    "Lost MRR ($)": 0,
    Reason: paused ? reason : "Service resumed",
    "Reason Category": paused ? reason : "Temporary",
    Comment: comment || data.pause_comment || data.comment || "",
    Plan: data.subscription_name || "",
    "Business Line": businessLine === "dog_food" ? "Dog Food" : "Scooping",
    "Review Status": "Complete",
    "Subscription ID": subscriptionId,
    "Is Churn": false,
    Source: "Sweep & Go webhook",
  };
  if (plannedParsed && !Number.isNaN(plannedParsed.getTime())) fields["Planned Resume Date"] = plannedParsed.toISOString().slice(0, 10);
  if (!paused) fields["Reactivated Date"] = eventDate;
  await airtableUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.churn, "Event ID", fields);
  return { subscriptionId, eventDate, plannedResumeDate: fields["Planned Resume Date"] || null };
}

export async function upsertSngDispatchJobs(rows, date) {
  const records = rows
    .filter((row) => Number(row.id) > 0 && (String(row.status_name).toLowerCase() === "completed" || Number(row.status_id) === 2))
    .map((row) => {
      const fields = {
        "Job ID": String(row.id),
        Date: date,
        "Customer Name": row.full_name || "",
        "Tech Name": row.assigned_to_name || "",
        "Service Type": row.type || "Other",
        "Est. Minutes": durationMinutes(row.estimate_time),
        Status: "Completed",
      };
      const actualMinutes = durationMinutes(row.duration);
      if (actualMinutes > 0) fields["Actual Minutes"] = actualMinutes;
      if (row.zip) fields.ZIP = String(row.zip);
      const revenue = number(row.price ?? row.revenue ?? row.amount);
      if (revenue > 0) fields["Revenue ($)"] = revenue;
      return { fields };
    });
  return { eligible: records.length, upserted: await airtableBatchUpsert(AIRTABLE_BASES.opwp.id, TABLES.opwp.jobs, "Job ID", records) };
}

async function listRecords(baseId, tableId, key, filterByFormula = "", maxPages = 25) {
  const records = [];
  let offset = "";
  let page = 0;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    const data = await airtableRequest(`${baseId}/${tableId}?${params}`, key);
    records.push(...(data.records ?? []));
    offset = data.offset ?? "";
    page += 1;
  } while (offset && page < maxPages);
  return records;
}

async function loadTables(baseId, tables, key, filters = {}) {
  const result = {};
  for (const [name, tableId] of Object.entries(tables)) {
    result[name] = await listRecords(baseId, tableId, key, filters[name]);
  }
  return result;
}

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function recordCompleteness(record) {
  return Object.values(record.fields ?? {}).reduce((score, value) => score + (value === undefined || value === null || value === "" ? 0 : 1), 0);
}

function uniqueRecords(records, field) {
  const keyed = new Map();
  const unkeyed = [];
  for (const record of records) {
    const key = String(record.fields?.[field] ?? "").trim();
    if (!key) { unkeyed.push(record); continue; }
    const current = keyed.get(key);
    if (!current || recordCompleteness(record) > recordCompleteness(current)) keyed.set(key, record);
  }
  return [...keyed.values(), ...unkeyed];
}

function customerVisitValue(record) {
  const mrr = number(record?.fields?.["MRR ($)"]);
  const weeklyStops = number(record?.fields?.["Weighted Stop"]);
  if (!mrr || !weeklyStops) return 0;
  return mrr / (weeklyStops * 52 / 12);
}

function summarizeMissing(records, checks) {
  const result = {};
  for (const [label, field] of Object.entries(checks)) {
    result[label] = records
      .filter((record) => record.fields[field] === undefined || record.fields[field] === null || record.fields[field] === "")
      .map((record) => record.fields["Client Name"] || record.id);
  }
  return result;
}

export async function getOperationalDataAudit(since = "2026-01-01", until = "") {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, error: "AIRTABLE_API_KEY is not configured." };
  const safeSince = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : "2026-01-01";
  const dayBeforeSince = new Date(`${safeSince}T00:00:00Z`);
  dayBeforeSince.setUTCDate(dayBeforeSince.getUTCDate() - 1);
  const afterDate = dayBeforeSince.toISOString().slice(0, 10);
  const safeUntil = /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : "";
  const jobFilter = safeUntil
    ? `AND(IS_AFTER({Date},'${afterDate}'),IS_BEFORE({Date},'${new Date(`${safeUntil}T00:00:00Z`).toISOString().slice(0, 10)}'))`
    : `IS_AFTER({Date},'${afterDate}')`;
  try {
    const [customers, jobs, targets] = await Promise.all([
      listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.customers, key),
      listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.jobs, key, jobFilter, 45),
      listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.targets, key),
    ]);
    const activeCustomers = customers.filter((record) => isStatus(record.fields.Status, "Active"));
    const completedJobs = jobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed"));
    const datedJobs = completedJobs.filter((record) => Number.isFinite(Date.parse(record.fields.Date)));
    const estimates = completedJobs.filter((record) => number(record.fields["Est. Minutes"]) > 0);
    const actuals = completedJobs.filter((record) => number(record.fields["Actual Minutes"]) > 0);
    const weekendJobs = datedJobs.filter((record) => [0, 6].includes(new Date(`${record.fields.Date}T12:00:00Z`).getUTCDay()));
    const dayCounts = Object.fromEntries(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => [day, 0]));
    for (const record of datedJobs) {
      const day = new Date(`${record.fields.Date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      dayCounts[day] += 1;
    }
    const jobIds = completedJobs.map((record) => String(record.fields["Job ID"] ?? "").trim()).filter(Boolean);
    const duplicateJobIds = [...new Set(jobIds.filter((id, index) => jobIds.indexOf(id) !== index))];
    const clientIds = activeCustomers.map((record) => String(record.fields["SNG Client ID"] ?? "").trim()).filter(Boolean);
    const duplicateClientIds = [...new Set(clientIds.filter((id, index) => clientIds.indexOf(id) !== index))];
    const clientNames = activeCustomers.map((record) => normalizedText(record.fields["Client Name"])).filter(Boolean);
    const duplicateClientNames = [...new Set(clientNames.filter((name, index) => clientNames.indexOf(name) !== index))];
    return {
      configured: true,
      ok: true,
      since: safeSince,
      until: safeUntil || null,
      customers: {
        total: customers.length,
        active: activeCustomers.length,
        missing: summarizeMissing(activeCustomers, {
          sngClientId: "SNG Client ID", frequency: "Frequency", serviceDay: "Service Day",
          mrr: "MRR ($)", estimatedServiceMinutes: "Est. Service Minutes", assignedTech: "Assigned Tech",
          address: "Address", zip: "ZIP", numberOfDogs: "Number of Dogs",
        }),
        duplicateClientIds,
        duplicateClientNames,
        rows: activeCustomers.map((record) => ({
          airtableId: record.id,
          name: record.fields["Client Name"] || "",
          sngClientId: String(record.fields["SNG Client ID"] ?? ""),
          frequency: record.fields.Frequency || "",
          serviceDay: record.fields["Service Day"] || "",
          serviceDay2: record.fields["Service Day 2"] || "",
          mrr: number(record.fields["MRR ($)"]),
          estimatedServiceMinutes: number(record.fields["Est. Service Minutes"]),
          assignedTech: record.fields["Assigned Tech"] || "",
        })),
      },
      jobs: {
        total: jobs.length,
        completed: completedJobs.length,
        earliest: datedJobs.map((record) => record.fields.Date).sort()[0] || null,
        latest: datedJobs.map((record) => record.fields.Date).sort().at(-1) || null,
        estimatedMinutesPresent: estimates.length,
        estimatedMinutesCoverage: completedJobs.length ? round((estimates.length / completedJobs.length) * 100, 1) : 0,
        actualMinutesPresent: actuals.length,
        actualMinutesCoverage: completedJobs.length ? round((actuals.length / completedJobs.length) * 100, 1) : 0,
        missingCustomerName: completedJobs.filter((record) => !record.fields["Customer Name"]).length,
        missingTechName: completedJobs.filter((record) => !record.fields["Tech Name"]).length,
        missingRevenue: completedJobs.filter((record) => number(record.fields["Revenue ($)"]) <= 0).length,
        duplicateJobIds,
        weekdayCounts: dayCounts,
        weekendJobs: weekendJobs.map((record) => ({ id: record.fields["Job ID"], date: record.fields.Date, customer: record.fields["Customer Name"], serviceType: record.fields["Service Type"] })),
      },
      targets: targets.map((record) => ({ id: record.id, ...record.fields })),
    };
  } catch (error) {
    return { configured: true, ok: false, error: String(error) };
  }
}

export async function getAirtableCustomerRows() {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, rows: [], error: "AIRTABLE_API_KEY is not configured." };
  try {
    const customers = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.customers, key);
    return {
      configured: true,
      ok: true,
      rows: customers.map((record) => ({
        airtableId: record.id,
        name: record.fields["Client Name"] || "",
        sngClientId: String(record.fields["SNG Client ID"] ?? ""),
        frequency: record.fields.Frequency || "",
        serviceDay: record.fields["Service Day"] || "",
        serviceDay2: record.fields["Service Day 2"] || "",
        status: record.fields.Status || "",
      })),
    };
  } catch (error) {
    return { configured: true, ok: false, rows: [], error: String(error) };
  }
}

export async function getAirtableRouteSource(requestedDate = "") {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, date: null, stops: [], candidates: [], error: "AIRTABLE_API_KEY is not configured." };
  const explicitDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : "";
  const today = new Date().toISOString().slice(0, 10);
  const earliest = new Date(`${today}T12:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 35);
  const jobFilter = explicitDate
    ? `IS_SAME({Date},'${explicitDate}','day')`
    : `IS_AFTER({Date},'${earliest.toISOString().slice(0, 10)}')`;

  try {
    const [jobs, customers] = await Promise.all([
      listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.jobs, key, jobFilter, 25),
      listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.customers, key),
    ]);
    const customerByName = new Map(customers.map((record) => [normalizedText(record.fields["Client Name"]), record]).filter(([name]) => name));
    const completedJobs = jobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed"));
    const byDate = new Map();
    for (const record of completedJobs) {
      const date = String(record.fields.Date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      byDate.set(date, [...(byDate.get(date) ?? []), record]);
    }

    const candidateRows = [...byDate.entries()].map(([date, rows]) => {
      const matched = rows.map((record) => customerByName.get(normalizedText(record.fields["Customer Name"]))).filter(Boolean);
      const technicianPresent = rows.filter((record) => record.fields["Tech Name"] || customerByName.get(normalizedText(record.fields["Customer Name"]))?.fields?.["Assigned Tech"]).length;
      const actualPresent = rows.filter((record) => number(record.fields["Actual Minutes"]) > 0).length;
      const addressPresent = matched.filter((record) => record.fields.Address).length;
      const ageDays = Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86400000));
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const techCoverage = rows.length ? technicianPresent / rows.length : 0;
      const actualCoverage = rows.length ? actualPresent / rows.length : 0;
      const addressCoverage = rows.length ? addressPresent / rows.length : 0;
      const score = addressCoverage * 40 + techCoverage * 25 + actualCoverage * 25 + Math.min(rows.length / 50, 1) * 10 - ageDays * 0.08;
      return {
        date,
        jobs: rows.length,
        technicianCoverage: round(techCoverage * 100, 1),
        actualTimeCoverage: round(actualCoverage * 100, 1),
        addressCoverage: round(addressCoverage * 100, 1),
        score: round(score, 2),
        eligible: date < today && ![0, 6].includes(weekday) && rows.length >= 10 && techCoverage >= 0.8 && addressCoverage >= 0.8,
      };
    }).sort((left, right) => right.score - left.score || right.date.localeCompare(left.date));

    const selectedDate = explicitDate || candidateRows.find((row) => row.eligible)?.date || candidateRows[0]?.date || null;
    const selectedJobs = selectedDate ? byDate.get(selectedDate) ?? [] : [];
    const stops = selectedJobs.map((record, index) => {
      const fields = record.fields ?? {};
      const customer = customerByName.get(normalizedText(fields["Customer Name"]));
      const customerFields = customer?.fields ?? {};
      const actualMinutes = number(fields["Actual Minutes"]);
      const estimatedMinutes = number(fields["Est. Minutes"]) || number(customerFields["Est. Service Minutes"]);
      const technicianName = String(fields["Tech Name"] || customerFields["Assigned Tech"] || "Unassigned").trim();
      const address = [customerFields.Address, customerFields.ZIP].map((value) => String(value ?? "").trim()).filter(Boolean).join(", ");
      return {
        id: String(fields["Job ID"] ?? record.id),
        job_id: String(fields["Job ID"] ?? record.id),
        assigned_to_name: technicianName,
        route_id: `airtable-${selectedDate}-${normalizedText(technicianName) || "unassigned"}`,
        sequence: index + 1,
        address,
        zip: String(customerFields.ZIP ?? fields.ZIP ?? ""),
        actual_minutes: actualMinutes,
        estimate_time: estimatedMinutes,
        source: "airtable",
      };
    });

    return {
      configured: true,
      ok: true,
      date: selectedDate,
      stops,
      candidates: candidateRows.slice(0, 10),
      sourceJobCount: selectedJobs.length,
      matchedAddressCount: stops.filter((stop) => stop.address).length,
      unmatchedAddressCount: stops.filter((stop) => !stop.address).length,
    };
  } catch (error) {
    return { configured: true, ok: false, date: null, stops: [], candidates: [], error: String(error) };
  }
}

export async function getTimeDataAudit(since = "2026-06-13") {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, error: "AIRTABLE_API_KEY is not configured." };
  const safeSince = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : "2026-06-13";
  const dayBeforeSince = new Date(`${safeSince}T00:00:00Z`);
  dayBeforeSince.setUTCDate(dayBeforeSince.getUTCDate() - 1);
  try {
    const rows = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.time, key, `IS_AFTER({Date},'${dayBeforeSince.toISOString().slice(0, 10)}')`);
    const ids = rows.map((record) => String(record.fields["Record ID"] ?? "").trim()).filter(Boolean);
    const duplicateRecordIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const byTech = new Map();
    for (const record of rows) {
      const tech = String(record.fields["Tech Name"] || "Unassigned").trim();
      const current = byTech.get(tech) || { tech, shifts: 0, minutes: 0, miles: 0, maxShiftMinutes: 0 };
      const minutes = number(record.fields["Minutes Clocked"]);
      current.shifts += 1;
      current.minutes += minutes;
      current.miles += number(record.fields["Miles Driven"]);
      current.maxShiftMinutes = Math.max(current.maxShiftMinutes, minutes);
      byTech.set(tech, current);
    }
    return {
      configured: true,
      ok: true,
      since: safeSince,
      records: rows.length,
      missingRecordId: rows.length - ids.length,
      duplicateRecordIds,
      technicians: [...byTech.values()].map((row) => ({ ...row, hours: round(row.minutes / 60, 1), miles: round(row.miles, 1), maxShiftHours: round(row.maxShiftMinutes / 60, 1) })).sort((a, b) => b.hours - a.hours),
    };
  } catch (error) {
    return { configured: true, ok: false, error: String(error) };
  }
}

function opwpMetrics(data, { briaRouteAllocation = null, sngInvoiceMetrics = null, subscriptionTruth = null, cancellationMetrics = null, churnRange = null } = {}) {
  const activeCustomers = data.customers.filter((record) => isStatus(record.fields.Status, "Active"));
  const pausedCustomers = data.customers.filter((record) => isStatus(record.fields.Status, "Paused"));
  const uniqueJobs = uniqueRecords(data.jobs, "Job ID");
  const uniqueTime = uniqueRecords(data.time, "Record ID");
  const recentJobs = uniqueJobs.filter((record) => withinDays(record.fields.Date, 30));
  const completedJobs = recentJobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed"));
  const skippedJobs = recentJobs.filter((record) => isStatus(record.fields.Status, "Skipped", "No Access"));
  const recentTime = uniqueTime.filter((record) => withinDays(record.fields.Date, 30));
  const isScoopingChurn = (record) => (!record.fields["Business Line"] || isStatus(record.fields["Business Line"], "Scooping")) && Boolean(record.fields["Is Churn"]);
  const recentChurn = data.churn.filter((record) => withinDateRange(record.fields["Event Date"], churnRange) && isScoopingChurn(record));
  const recentReactivations = data.churn.filter((record) => withinDateRange(record.fields["Reactivated Date"], churnRange) && isScoopingChurn(record));
  const churnReasonReviews = data.churn.filter((record) => {
    if (!withinDays(record.fields["Event Date"], 90) || !isScoopingChurn(record)) return false;
    const category = record.fields["Reason Category"] || canonicalChurnReason(record.fields.Reason);
    return isStatus(record.fields["Review Status"], "Needs Reason", "Needs Comment", "Needs Validation") || (churnReasonRequiresComment(category) && !String(record.fields.Comment || "").trim());
  });
  const churnEligibilityReviews = data.churn.filter((record) => (!record.fields["Business Line"] || isStatus(record.fields["Business Line"], "Scooping")) && isStatus(record.fields["Eligibility Status"], "Needs Validation"));
  const recentOneTime = data.oneTime.filter((record) => withinDays(record.fields["Last Invoice Date"] || record.fields["Onboarded Date"], 30));
  const priorJobs = uniqueJobs.filter((record) => previousDays(record.fields.Date, 30));
  const priorCompletedJobs = priorJobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed"));
  const priorOneTime = data.oneTime.filter((record) => previousDays(record.fields["Last Invoice Date"] || record.fields["Onboarded Date"], 30));
  const recentLeads = data.leads.filter((record) => withinDays(record.fields["Captured At"], 30));
  const openLeads = data.leads.filter((record) => isStatus(record.fields.Status, "New", "Contacted", "Quoted"));
  const convertedLeads = recentLeads.filter((record) => isStatus(record.fields.Status, "Converted"));
  const oneTimeTarget = data.targets.find((record) => normalizedText(record.fields.Metric) === "onetimerevenue");
  const invoiceFeedConnected = Boolean(sngInvoiceMetrics?.connected);
  const oneTimeDataAvailable = invoiceFeedConnected || !oneTimeTarget || !isStatus(oneTimeTarget.fields.Status, "No Data");

  const airtableMrr = activeCustomers.reduce((sum, record) => sum + number(record.fields["MRR ($)"]), 0);
  const subscriptionSnapshot = subscriptionTruth?.latest ?? null;
  const mrr = subscriptionSnapshot ? number(subscriptionSnapshot.total_mrr) : airtableMrr;
  const customerByName = new Map(activeCustomers.map((record) => [normalizedText(record.fields["Client Name"]), record]).filter(([name]) => name));
  const isRecurringJob = (record) => normalizedText(record.fields["Service Type"]) === "recurring";
  const routeValueForJob = (record) => isRecurringJob(record)
    ? customerVisitValue(customerByName.get(normalizedText(record.fields["Customer Name"]))) || number(record.fields["Revenue ($)"])
    : number(record.fields["Revenue ($)"]);
  const recurringRevenue = completedJobs.reduce((sum, record) => sum + routeValueForJob(record), 0);
  const oneTimeJobs = completedJobs.filter((record) => !isRecurringJob(record));
  const airtableOneTimeRevenue = recentOneTime.reduce((sum, record) => sum + number(record.fields["Revenue ($)"]), 0);
  const oneTimeRevenue = invoiceFeedConnected ? number(sngInvoiceMetrics.oneTimeRevenue) : airtableOneTimeRevenue;
  const priorOneTimeRevenue = invoiceFeedConnected
    ? number(sngInvoiceMetrics.priorOneTimeRevenue)
    : priorOneTime.reduce((sum, record) => sum + number(record.fields["Revenue ($)"]), 0);
  const priorRevenue = priorCompletedJobs.reduce((sum, record) => sum + routeValueForJob(record), 0) + priorOneTimeRevenue;
  const actualMinutes = completedJobs.reduce((sum, record) => sum + number(record.fields["Actual Minutes"]), 0);
  const clockedMinutes = recentTime.reduce((sum, record) => sum + number(record.fields["Minutes Clocked"]), 0);
  const airtableLostMrr = recentChurn.reduce((sum, record) => sum + number(record.fields["Lost MRR ($)"]), 0);
  const confirmedChurnReady = true;
  const churnCount = recentChurn.length;
  const lostMrr = airtableLostMrr;
  const reactivatedMrr = recentReactivations.reduce((sum, record) => sum + number(record.fields["Lost MRR ($)"]), 0);
  const reasonMap = new Map();
  for (const record of recentChurn) {
    const reason = record.fields["Reason Category"] || canonicalChurnReason(record.fields.Reason);
    const current = reasonMap.get(reason) || { reason, cancellations: 0, lostMrr: 0 };
    current.cancellations += 1;
    current.lostMrr += number(record.fields["Lost MRR ($)"]);
    reasonMap.set(reason, current);
  }
  const churnReasons30 = [...reasonMap.values()].map((row) => ({ ...row, share: recentChurn.length ? round((row.cancellations / recentChurn.length) * 100, 1) : 0 })).sort((a, b) => b.cancellations - a.cancellations || b.lostMrr - a.lostMrr);
  const seasonalFollowUps = data.churn.filter((record) => isScoopingChurn(record) && isStatus(record.fields["Reason Category"] || canonicalChurnReason(record.fields.Reason), "Seasonal") && !record.fields["Reactivated Date"]).map((record) => ({ id: record.id, customer: record.fields["Client Name"] || "Unknown", canceled: record.fields["Event Date"] || "", lostMrr: number(record.fields["Lost MRR ($)"]), comment: record.fields.Comment || "" }));
  const pauseByCustomer = new Map();
  for (const record of data.churn.filter((row) => isStatus(row.fields["Event Type"], "Paused")).sort((a, b) => String(b.fields["Event Date"] || "").localeCompare(String(a.fields["Event Date"] || "")))) {
    const key = normalizedText(record.fields["Client Name"]);
    if (key && !pauseByCustomer.has(key)) pauseByCustomer.set(key, record);
  }
  const pausedAccounts = pausedCustomers.map((customer) => {
    const event = pauseByCustomer.get(normalizedText(customer.fields["Client Name"]));
    return {
      id: customer.id,
      customer: customer.fields["Client Name"] || "Unknown",
      paused: event?.fields?.["Event Date"] || "",
      plannedResume: event?.fields?.["Planned Resume Date"] || "",
      reason: event?.fields?.["Reason Category"] || event?.fields?.Reason || "Needs reason",
      mrr: number(customer.fields["MRR ($)"]),
    };
  }).sort((a, b) => String(a.plannedResume || "9999").localeCompare(String(b.plannedResume || "9999")));
  const resolvedJobs = completedJobs.length + skippedJobs.length;
  const estimatedTimeCoverage30 = completedJobs.length ? round((completedJobs.filter((record) => number(record.fields["Est. Minutes"]) > 0).length / completedJobs.length) * 100, 1) : 0;
  const actualTimeCoverage30 = completedJobs.length ? round((completedJobs.filter((record) => number(record.fields["Actual Minutes"]) > 0).length / completedJobs.length) * 100, 1) : 0;
  const assignedTechCoverage30 = completedJobs.length ? round((completedJobs.filter((record) => normalizedText(record.fields["Tech Name"])).length / completedJobs.length) * 100, 1) : 0;
  const routeValueCoverage30 = completedJobs.length ? round((completedJobs.filter((record) => routeValueForJob(record) > 0).length / completedJobs.length) * 100, 1) : 0;
  const jobRevenueCoverage30 = Math.min(assignedTechCoverage30, routeValueCoverage30);
  const serviceTimeCoverage30 = Math.min(estimatedTimeCoverage30, actualTimeCoverage30);
  const technicianEconomicsReady = jobRevenueCoverage30 >= 90;
  const technicianMap = new Map();
  for (const record of completedJobs) {
    const name = record.fields["Tech Name"] || "Unassigned";
    const current = technicianMap.get(name) || { name, jobs: 0, revenue: 0, reportedRevenue: 0, minutes: 0, byDate: {} };
    const date = String(record.fields.Date ?? "").slice(0, 10);
    const daily = current.byDate[date] || { jobs: 0, revenue: 0, reportedRevenue: 0, minutes: 0 };
    current.jobs += 1;
    current.revenue += routeValueForJob(record);
    current.reportedRevenue += number(record.fields["Revenue ($)"]);
    current.minutes += number(record.fields["Actual Minutes"]);
    daily.jobs += 1;
    daily.revenue += routeValueForJob(record);
    daily.reportedRevenue += number(record.fields["Revenue ($)"]);
    daily.minutes += number(record.fields["Actual Minutes"]);
    current.byDate[date] = daily;
    technicianMap.set(name, current);
  }
  const clockedByTech = new Map();
  for (const record of recentTime) {
    const name = String(record.fields["Tech Name"] || "").trim();
    if (!name) continue;
    const key = normalizedText(name);
    clockedByTech.set(key, (clockedByTech.get(key) || 0) + number(record.fields["Minutes Clocked"]));
  }
  const routeEligibleTechnicians = [...technicianMap.values()].filter((tech) => normalizedText(tech.name) !== "briamahaney" && normalizedText(tech.name) !== "unassigned");
  const eligibleRouteRevenue = routeEligibleTechnicians.reduce((sum, tech) => sum + tech.revenue, 0);
  const eligibleClockedMinutes = routeEligibleTechnicians.reduce((sum, tech) => sum + (clockedByTech.get(normalizedText(tech.name)) || 0), 0);
  const routeRevenuePerHour30 = eligibleClockedMinutes ? round(eligibleRouteRevenue / (eligibleClockedMinutes / 60)) : null;
  const suspiciousMileageRecords = recentTime.filter((record) => number(record.fields["Miles Driven"]) > 500).length;
  const estimateObservations = new Map();
  for (const record of completedJobs) {
    const customer = String(record.fields["Customer Name"] || "").trim();
    const tech = String(record.fields["Tech Name"] || "Unassigned").trim();
    const estimated = number(record.fields["Est. Minutes"]);
    const actual = number(record.fields["Actual Minutes"]);
    if (!customer || estimated <= 0 || actual <= 0) continue;
    const fingerprint = [record.fields.Date, normalizedText(customer), normalizedText(tech), estimated, actual].join("|");
    if (!estimateObservations.has(fingerprint)) estimateObservations.set(fingerprint, { customer, tech, estimated, actual });
  }
  const estimateGroups = new Map();
  for (const observation of estimateObservations.values()) {
    const key = `${normalizedText(observation.customer)}|${normalizedText(observation.tech)}`;
    const current = estimateGroups.get(key) || { customer: observation.customer, tech: observation.tech, observations: [] };
    current.observations.push(observation);
    estimateGroups.set(key, current);
  }
  const estimateReviews = [...estimateGroups.values()].map((group) => {
    const jobs = group.observations.length;
    const estimated = median(group.observations.map((observation) => observation.estimated));
    const actual = median(group.observations.map((observation) => observation.actual));
    const overrunJobs = group.observations.filter((observation) => observation.actual > observation.estimated).length;
    const overrunRate = jobs ? (overrunJobs / jobs) * 100 : 0;
    return {
      customer: group.customer,
      tech: group.tech,
      jobs,
      estimated: round(estimated, 1),
      actual: round(actual, 1),
      varianceMinutes: round(actual - estimated, 1),
      variancePercent: estimated ? round(((actual - estimated) / estimated) * 100, 1) : 0,
      overrunRate: round(overrunRate, 1),
    };
  }).filter((row) => row.jobs >= 3 && row.overrunRate >= 66.7 && row.varianceMinutes >= 3 && row.variancePercent >= 20)
    .sort((a, b) => b.variancePercent - a.variancePercent);

  return {
    activeCustomers: activeCustomers.length,
    airtableActiveCustomers: activeCustomers.length,
    pausedCustomers: pausedCustomers.length,
    customerLedger: data.customers.map((record) => ({
      airtableId: record.id,
      name: record.fields["Client Name"] || "",
      sngClientId: String(record.fields["SNG Client ID"] ?? ""),
      status: record.fields.Status || "",
      frequency: record.fields.Frequency || "",
      serviceDay: record.fields["Service Day"] || "",
    })),
    mrr: round(mrr),
    airtableMrr: round(airtableMrr),
    subscriptionSnapshotDate: subscriptionSnapshot?.snapshot_date ?? null,
    subscriptionSnapshotDays: number(subscriptionTruth?.snapshotDays),
    activeSubscriptionCustomers: subscriptionSnapshot ? number(subscriptionSnapshot.active_core_customers) : null,
    activeSubscriptionLines: subscriptionSnapshot ? number(subscriptionSnapshot.active_subscription_lines) : null,
    coreSubscriptionMrr: subscriptionSnapshot ? number(subscriptionSnapshot.core_mrr) : null,
    addonSubscriptionMrr: subscriptionSnapshot ? number(subscriptionSnapshot.addon_mrr) : null,
    unmatchedLiveSubscriptionClients: subscriptionSnapshot ? number(subscriptionSnapshot.unmatched_live_clients) : null,
    arr: round(mrr * 12),
    weightedStops: round(activeCustomers.reduce((sum, record) => sum + number(record.fields["Weighted Stop"]), 0), 1),
    estimatedWeeklyHours: round(activeCustomers.reduce((sum, record) => sum + number(record.fields["Est. Service Minutes"]), 0) / 60, 1),
    jobRevenue30: round(recurringRevenue),
    oneTimeRevenue30: round(oneTimeRevenue),
    oneTimeJobs30: oneTimeJobs.length,
    oneTimeInvoices30: number(sngInvoiceMetrics?.oneTimeInvoices),
    oneTimeInvoiceFeedConnected: invoiceFeedConnected,
    oneTimeInvoiceFeedSince: sngInvoiceMetrics?.firstReceivedAt ?? null,
    oneTimeDataAvailable,
    totalRevenue30: round(recurringRevenue + oneTimeRevenue),
    revenueChange30: changePercent(recurringRevenue + oneTimeRevenue, priorRevenue),
    completedJobs30: completedJobs.length,
    skippedJobs30: skippedJobs.length,
    completionRate30: resolvedJobs ? round((completedJobs.length / resolvedJobs) * 100, 1) : 0,
    revenuePerJob30: completedJobs.length ? round(recurringRevenue / completedJobs.length) : 0,
    revenuePerJobHour30: actualMinutes ? round(recurringRevenue / (actualMinutes / 60)) : 0,
    revenuePerClockedHour30: clockedMinutes ? round(recurringRevenue / (clockedMinutes / 60)) : 0,
    jobRevenueCoverage30,
    technicianEconomicsReady,
    estimatedTimeCoverage30,
    actualTimeCoverage30,
    serviceTimeCoverage30,
    assignedTechCoverage30,
    routeValueCoverage30,
    routeRevenuePerHour30,
    routeRevenueTarget: 100,
    routeRevenueGap30: routeRevenuePerHour30 === null ? null : round(100 - routeRevenuePerHour30),
    clockedHours30: round(clockedMinutes / 60, 1),
    miles30: round(recentTime.reduce((sum, record) => sum + number(record.fields["Miles Driven"]), 0), 1),
    suspiciousMileageRecords,
    churnCount30: churnCount,
    grossChurnCount30: recentChurn.length,
    reactivations30: recentReactivations.length,
    netChurnCount30: Math.max(0, recentChurn.length - recentReactivations.length),
    lostMrr30: round(lostMrr),
    grossLostMrr30: round(airtableLostMrr),
    reactivatedMrr30: round(reactivatedMrr),
    netLostMrr30: round(Math.max(0, airtableLostMrr - reactivatedMrr)),
    churnReasons30,
    churnPeriodLabel: churnRange?.label || "Last 30 days",
    churnRange: churnRange || null,
    churnRows: recentChurn.map((record) => ({
      id: record.id,
      customer: record.fields["Client Name"] || "Unknown customer",
      date: record.fields["Event Date"] || "",
      plan: record.fields.Plan || "",
      reason: record.fields["Reason Category"] || record.fields.Reason || "No reason provided",
      lostMrr: number(record.fields["Lost MRR ($)"]),
      evidence: record.fields["Eligibility Evidence"] || "Confirmed by the validated churn ledger.",
    })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    seasonalFollowUps,
    pausedAccounts,
    pausedMrr: round(pausedAccounts.reduce((sum, row) => sum + row.mrr, 0)),
    churnRate30: (number(subscriptionSnapshot?.active_core_customers) || activeCustomers.length) + churnCount ? round((churnCount / ((number(subscriptionSnapshot?.active_core_customers) || activeCustomers.length) + churnCount)) * 100, 1) : 0,
    churnSource: confirmedChurnReady ? "Validated primary-scooping churn ledger" : "Airtable confirmed churn ledger",
    churnReasonReviewCount: churnReasonReviews.length,
    churnReasonReviews: churnReasonReviews.map((record) => ({
      id: record.id,
      customer: record.fields["Client Name"] || "Unknown customer",
      date: record.fields["Event Date"] || "",
      plan: record.fields.Plan || "",
      reason: record.fields["Reason Category"] || record.fields.Reason || "",
      comment: record.fields.Comment || "",
      lostMrr: number(record.fields["Lost MRR ($)"]),
    })),
    churnEligibilityReviewCount: churnEligibilityReviews.length,
    churnEligibilityReviews: churnEligibilityReviews.map((record) => ({
      id: record.id,
      customer: record.fields["Client Name"] || "Unknown customer",
      date: record.fields["Event Date"] || "",
      plan: record.fields.Plan || "",
      reason: record.fields["Reason Category"] || record.fields.Reason || "No reason provided",
      potentialMrr: number(record.fields["Lost MRR ($)"]),
      evidence: record.fields["Eligibility Evidence"] || "No completed-service or payment evidence found.",
    })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    openLeads: openLeads.length,
    leads30: recentLeads.length,
    convertedLeads30: convertedLeads.length,
    quotedPipeline: round(openLeads.reduce((sum, record) => sum + number(record.fields["Quoted Monthly ($)"]), 0)),
    revenueTrend: weeklySeries(uniqueJobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed")).map((record) => ({ ...record, fields: { ...record.fields, "Route Value ($)": routeValueForJob(record) } })), "Date", "Route Value ($)", 5),
    jobsTrend: weeklySeries(uniqueJobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed")), "Date", undefined, 5),
    churnTrend: weeklySeries(data.churn.filter(isScoopingChurn), "Event Date", "Lost MRR ($)"),
    technicians: [...technicianMap.values()].map((tech) => {
      const isBria = normalizedText(tech.name) === "briamahaney";
      const matchedDates = isBria ? new Set(briaRouteAllocation?.matchedDays ?? []) : null;
      const measuredDays = isBria ? Object.entries(tech.byDate).filter(([date]) => matchedDates.has(date)).map(([, values]) => values) : [];
      const measured = isBria && measuredDays.length > 0;
      const displayed = measured ? measuredDays.reduce((sum, day) => ({
        jobs: sum.jobs + day.jobs,
        revenue: sum.revenue + day.revenue,
        reportedRevenue: sum.reportedRevenue + day.reportedRevenue,
        minutes: sum.minutes + day.minutes,
      }), { jobs: 0, revenue: 0, reportedRevenue: 0, minutes: 0 }) : tech;
      const paidMinutes = measured ? number(briaRouteAllocation.routeMinutes) : (clockedByTech.get(normalizedText(tech.name)) || 0);
      const mixedDuty = isBria && !measured;
      return {
        ...tech,
        jobs: displayed.jobs,
        revenue: round(displayed.revenue),
        reportedRevenue: round(displayed.reportedRevenue),
        jobHours: round(displayed.minutes / 60, 1),
        clockedHours: round(paidMinutes / 60, 1),
        mixedDuty,
        temporarySplit: measured,
        measurementDays: measured ? matchedDates.size : null,
        officeHours: measured ? round(number(briaRouteAllocation.officeMinutes) / 60, 1) : null,
        utilization: paidMinutes && !mixedDuty ? round((displayed.minutes / paidMinutes) * 100, 1) : null,
        revenuePerJobHour: displayed.minutes ? round(displayed.revenue / (displayed.minutes / 60)) : null,
        revenuePerClockedHour: paidMinutes && !mixedDuty ? round(displayed.revenue / (paidMinutes / 60)) : null,
        target: 100,
      };
    }).sort((a, b) => (b.revenuePerClockedHour || 0) - (a.revenuePerClockedHour || 0)),
    estimateReviewCount: estimateReviews.length,
    estimateReviews: estimateReviews.slice(0, 20),
    targets: data.targets
      .map((record) => ({
        id: record.id,
        metric: record.fields.Metric,
        target: number(record.fields["Target Value"]),
        unit: record.fields.Unit || "",
        current: number(record.fields["Current Value"]),
        day1: number(record.fields["1-Day Value"]),
        day7: number(record.fields["7-Day Value"]),
        day30: number(record.fields["30-Day Value"]),
        day90: number(record.fields["90-Day Value"]),
        status: record.fields.Status || "No Data",
        order: number(record.fields["Display Order"]),
      }))
      .filter((row) => row.metric)
      .sort((a, b) => a.order - b.order),
  };
}

export async function cleanupDuplicateShiftRecords() {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not configured.");
  const records = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.time, key);
  const groups = new Map();
  for (const record of records) {
    const recordId = String(record.fields["Record ID"] ?? "").trim();
    if (!recordId) continue;
    groups.set(recordId, [...(groups.get(recordId) ?? []), record]);
  }
  const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const remove = duplicates.flatMap(([, rows]) => rows.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime))).slice(1));
  for (let index = 0; index < remove.length; index += 10) {
    const params = new URLSearchParams();
    for (const record of remove.slice(index, index + 10)) params.append("records[]", record.id);
    const response = await fetch(`${API_URL}/${AIRTABLE_BASES.opwp.id}/${TABLES.opwp.time}?${params}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Airtable duplicate cleanup failed (${response.status})`);
  }
  return { duplicateKeys: duplicates.length, deleted: remove.length };
}

export async function cleanupDuplicateJobRecords(since = "2026-01-01", until = "2026-12-31") {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not configured.");
  const safeSince = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : "2026-01-01";
  const safeUntil = /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : "2026-12-31";
  const dayBefore = new Date(`${safeSince}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const formula = `AND(IS_AFTER({Date},'${dayBefore.toISOString().slice(0, 10)}'),IS_BEFORE({Date},'${safeUntil}'))`;
  const records = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.jobs, key, formula, 15);
  const groups = new Map();
  for (const record of records) {
    const jobId = String(record.fields["Job ID"] ?? "").trim();
    if (!jobId) continue;
    groups.set(jobId, [...(groups.get(jobId) ?? []), record]);
  }
  const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const remove = duplicates.flatMap(([, rows]) => rows.sort((a, b) => {
    const score = (record) => recordCompleteness(record) + (number(record.fields["Revenue ($)"]) > 0 ? 3 : 0) + (number(record.fields["Actual Minutes"]) > 0 ? 2 : 0) + (number(record.fields["Est. Minutes"]) > 0 ? 2 : 0);
    return score(b) - score(a) || String(a.createdTime).localeCompare(String(b.createdTime));
  }).slice(1));
  for (let index = 0; index < remove.length; index += 10) {
    const params = new URLSearchParams();
    for (const record of remove.slice(index, index + 10)) params.append("records[]", record.id);
    const response = await fetch(`${API_URL}/${AIRTABLE_BASES.opwp.id}/${TABLES.opwp.jobs}?${params}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Airtable job duplicate cleanup failed (${response.status})`);
  }
  return { since: safeSince, until: safeUntil, scanned: records.length, duplicateKeys: duplicates.length, deleted: remove.length };
}

export async function cleanupSyntheticJobRecords(since, until) {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not configured.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("A bounded date range is required.");
  const dayBefore = new Date(`${since}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const formula = `AND(IS_AFTER({Date},'${dayBefore.toISOString().slice(0, 10)}'),IS_BEFORE({Date},'${until}'),OR(LEFT({Job ID},5)='HIST-',LEFT({Job ID},5)='LIVE-'))`;
  const records = await listRecords(AIRTABLE_BASES.opwp.id, TABLES.opwp.jobs, key, formula, 10);
  for (let index = 0; index < records.length; index += 10) {
    const params = new URLSearchParams();
    for (const record of records.slice(index, index + 10)) params.append("records[]", record.id);
    const response = await fetch(`${API_URL}/${AIRTABLE_BASES.opwp.id}/${TABLES.opwp.jobs}?${params}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Airtable synthetic-job cleanup failed (${response.status})`);
  }
  return { since, until, deleted: records.length };
}

function dogFoodMetrics(data) {
  const recentSales = data.sales.filter((record) => withinDays(record.fields["Sale Date"], 30));
  const paidSales = recentSales.filter((record) => isStatus(record.fields["Payment Status"], "Paid"));
  const priorPaidSales = data.sales.filter((record) => previousDays(record.fields["Sale Date"], 30) && isStatus(record.fields["Payment Status"], "Paid"));
  const activeSubscriptions = data.subscriptions.filter((record) => isStatus(record.fields["Subscription Status"], "Active"));
  const pastDueSubscriptions = activeSubscriptions.filter((record) => isStatus(record.fields["Payment Status"], "Past Due", "Failed"));
  const activeCustomers = data.customers.filter((record) => isStatus(record.fields["Customer Status"], "Active"));
  const recentDeliveries = data.deliveries.filter((record) => withinDays(record.fields["Scheduled Delivery Date"], 30));
  const delivered = recentDeliveries.filter((record) => isStatus(record.fields["Delivery Status"], "Delivered"));
  const activeProducts = data.products.filter((record) => record.fields["Active Status"]);
  const salesRevenue = paidSales.reduce((sum, record) => sum + number(record.fields["Amount Collected"]), 0);
  const priorSalesRevenue = priorPaidSales.reduce((sum, record) => sum + number(record.fields["Amount Collected"]), 0);
  const bagsSold = paidSales.reduce((sum, record) => sum + number(record.fields["Bag Quantity"]), 0);
  const inventoryUnits = activeProducts.reduce((sum, record) => sum + number(record.fields["On Hand"]), 0);
  const reorderProducts = activeProducts.filter((record) => String(record.fields["Reorder Status"] ?? "").toLowerCase().includes("reorder"));
  const inventoryDataValid = activeProducts.every((record) => number(record.fields["On Hand"]) >= 0);

  return {
    revenue30: round(salesRevenue),
    revenueChange30: changePercent(salesRevenue, priorSalesRevenue),
    orders30: paidSales.length,
    bagsSold30: round(bagsSold, 0),
    averageOrder30: paidSales.length ? round(salesRevenue / paidSales.length) : 0,
    revenuePerBag30: bagsSold ? round(salesRevenue / bagsSold) : 0,
    unpaidOrders30: recentSales.length - paidSales.length,
    activeCustomers: activeCustomers.length,
    activeSubscriptions: activeSubscriptions.length,
    pastDueSubscriptions: pastDueSubscriptions.length,
    monthlyBagDemand: round(activeSubscriptions.reduce((sum, record) => sum + number(record.fields["Monthly Bag Equivalent"]), 0), 0),
    deliveries30: recentDeliveries.length,
    deliveryDataAvailable: recentDeliveries.length > 0,
    delivered30: delivered.length,
    deliveryRate30: recentDeliveries.length ? round((delivered.length / recentDeliveries.length) * 100, 1) : 0,
    inventoryUnits: round(inventoryUnits, 0),
    inventoryDataValid,
    reorderProducts: reorderProducts.length,
    salesTrend: weeklySeries(data.sales.filter((record) => isStatus(record.fields["Payment Status"], "Paid")), "Sale Date", "Amount Collected"),
    bagsTrend: weeklySeries(data.sales.filter((record) => isStatus(record.fields["Payment Status"], "Paid")), "Sale Date", "Bag Quantity"),
    inventory: activeProducts.map((record) => ({
      id: record.id,
      product: record.fields["Product Name"] || record.fields["Formula Code"] || "Product",
      formula: record.fields["Formula Code"] || "—",
      onHand: number(record.fields["On Hand"]),
      reorderPoint: number(record.fields["Reorder Point"]),
      status: record.fields["Reorder Status"] || "Unknown",
    })),
  };
}

export async function getAirtableBusinessCockpit(options = {}) {
  const env = runtimeEnv();
  const key = env.AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, error: "AIRTABLE_API_KEY is not configured.", opwp: null, dogFood: null };

  try {
    if (env.DB) {
      const cached = await env.DB.prepare(`SELECT payload,status,error,captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'`).first();
      if (cached?.payload) {
        const data = JSON.parse(cached.payload);
        const ageHours = Math.max(0, (Date.now() - Date.parse(`${String(cached.captured_at).replace(" ", "T")}Z`)) / 3600000);
        return { configured: true, ok: true, error: cached.error || null, opwp: opwpMetrics(data.opwp, options), dogFood: dogFoodMetrics(data.dogFood), snapshot: { source: "D1", status: cached.status, capturedAt: cached.captured_at, ageHours: round(ageHours, 1), stale: ageHours > 6 } };
      }
    }
    const seeded = await refreshAirtableCockpitSnapshot(env);
    return { configured: true, ok: true, error: null, opwp: opwpMetrics(seeded.data.opwp, options), dogFood: dogFoodMetrics(seeded.data.dogFood), snapshot: { source: "Airtable seed", status: "success", capturedAt: seeded.capturedAt, ageHours: 0, stale: false, seeded: true } };
  } catch (error) {
    console.error(JSON.stringify({ event: "airtable_cockpit_error", message: String(error) }));
    return { configured: true, ok: false, error: String(error), opwp: null, dogFood: null };
  }
}

async function loadAirtableCockpitSource(key) {
  const recent = (field, days = 120) => `IS_AFTER({${field}},DATEADD(TODAY(),-${days},'days'))`;
  const [opwp, dogFood] = await Promise.all([
    loadTables(AIRTABLE_BASES.opwp.id, TABLES.opwp, key, {
      jobs: recent("Date", 31), time: recent("Date", 31), churn: `IS_AFTER({Event Date},'2025-12-31')`,
      oneTime: `OR(IS_AFTER({Last Invoice Date},DATEADD(TODAY(),-90,'days')),IS_AFTER({Onboarded Date},DATEADD(TODAY(),-90,'days')))`,
      leads: recent("Captured At", 90),
    }),
    loadTables(AIRTABLE_BASES.dogFood.id, TABLES.dogFood, key, {
      sales: recent("Sale Date", 90), deliveries: recent("Scheduled Delivery Date", 90),
    }),
  ]);
  return { opwp, dogFood };
}

export async function refreshAirtableCockpitSnapshot(env = runtimeEnv()) {
  if (!env?.AIRTABLE_API_KEY) throw new Error("AIRTABLE_API_KEY is not configured.");
  const data = await loadAirtableCockpitSource(env.AIRTABLE_API_KEY);
  const capturedAt = new Date().toISOString();
  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,error,captured_at,updated_at)
       VALUES ('business_cockpit',?,'success',NULL,?,CURRENT_TIMESTAMP)
       ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',error=NULL,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`
    ).bind(JSON.stringify(data), capturedAt).run();
  }
  return { data, capturedAt };
}

export async function ensureFreshAirtableCockpitSnapshot(env = runtimeEnv(), maxAgeMinutes = 15) {
  if (!env?.DB) throw new Error("Airtable snapshot storage is not configured.");
  const existing = await env.DB.prepare(
    `SELECT captured_at FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'`
  ).first();
  const capturedAt = existing?.captured_at || null;
  const capturedTime = capturedAt ? Date.parse(String(capturedAt).includes("T") ? String(capturedAt) : `${capturedAt}Z`) : Number.NaN;
  const ageMinutes = Number.isFinite(capturedTime) ? Math.max(0, (Date.now() - capturedTime) / 60000) : Number.POSITIVE_INFINITY;
  if (ageMinutes <= Math.max(1, Number(maxAgeMinutes) || 15)) {
    return { ok: true, refreshed: false, capturedAt, ageMinutes: round(ageMinutes, 1), warning: null };
  }
  try {
    const refreshed = await runScheduledAirtableCockpitRefresh(env);
    return { ok: true, refreshed: true, capturedAt: refreshed.capturedAt, ageMinutes: 0, warning: null };
  } catch (error) {
    if (!capturedAt) throw error;
    return {
      ok: false,
      refreshed: false,
      capturedAt,
      ageMinutes: Number.isFinite(ageMinutes) ? round(ageMinutes, 1) : null,
      warning: `Live Airtable refresh failed; analysis used the last valid snapshot. ${String(error).slice(0, 240)}`,
    };
  }
}

export async function runScheduledAirtableCockpitRefresh(env) {
  const id = crypto.randomUUID();
  try {
    const result = await refreshAirtableCockpitSnapshot(env);
    await env.DB.prepare(`INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,completed_at) VALUES (?,'airtable_cockpit','success',?,1,CURRENT_TIMESTAMP)`).bind(id, result.capturedAt.slice(0, 10)).run();
    console.log(JSON.stringify({ event: "airtable_cockpit_refresh", capturedAt: result.capturedAt }));
    return result;
  } catch (error) {
    if (env?.DB) {
      await env.DB.prepare(`UPDATE airtable_cockpit_snapshots SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key='business_cockpit'`).bind(String(error).slice(0, 500)).run();
      await env.DB.prepare(`INSERT INTO system_sync_runs (id,sync_name,status,error,completed_at) VALUES (?,'airtable_cockpit','failed',?,CURRENT_TIMESTAMP)`).bind(id, String(error).slice(0, 500)).run();
    }
    console.error(JSON.stringify({ event: "airtable_cockpit_refresh_failed", message: String(error) }));
    throw error;
  }
}

export async function getAirtableSchema() {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, bases: [], error: "AIRTABLE_API_KEY is not configured." };
  try {
    const bases = [];
    for (const base of Object.values(AIRTABLE_BASES)) {
      const response = await fetch(`${META_URL}/bases/${base.id}/tables`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        next: { revalidate: 3600 },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `Schema request failed (${response.status})`);
      bases.push({ ...base, tables: (data.tables ?? []).map((table) => ({
        id: table.id,
        name: table.name,
        fieldCount: table.fields?.length ?? 0,
        fields: (table.fields ?? []).map((field) => ({ id: field.id, name: field.name, type: field.type })),
      })) });
    }
    return { configured: true, ok: true, bases, error: null };
  } catch (error) {
    return { configured: true, ok: false, bases: [], error: String(error) };
  }
}
