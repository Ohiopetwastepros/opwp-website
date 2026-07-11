import { getRuntimeEnv } from "./cloudflare";

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

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function withinDays(value, days) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.now() - days * 86400000;
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

async function listRecords(baseId, tableId, key) {
  const records = [];
  let offset = "";
  let page = 0;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const data = await airtableRequest(`${baseId}/${tableId}?${params}`, key);
    records.push(...(data.records ?? []));
    offset = data.offset ?? "";
    page += 1;
  } while (offset && page < 25);
  return records;
}

async function loadTables(baseId, tables, key) {
  const result = {};
  for (const [name, tableId] of Object.entries(tables)) {
    result[name] = await listRecords(baseId, tableId, key);
  }
  return result;
}

function opwpMetrics(data) {
  const activeCustomers = data.customers.filter((record) => isStatus(record.fields.Status, "Active"));
  const pausedCustomers = data.customers.filter((record) => isStatus(record.fields.Status, "Paused"));
  const recentJobs = data.jobs.filter((record) => withinDays(record.fields.Date, 30));
  const completedJobs = recentJobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed"));
  const skippedJobs = recentJobs.filter((record) => isStatus(record.fields.Status, "Skipped", "No Access"));
  const recentTime = data.time.filter((record) => withinDays(record.fields.Date, 30));
  const recentChurn = data.churn.filter((record) =>
    withinDays(record.fields["Event Date"], 30) && (record.fields["Is Churn"] || isStatus(record.fields["Event Type"], "Canceled"))
  );
  const recentOneTime = data.oneTime.filter((record) => withinDays(record.fields["Last Invoice Date"] || record.fields["Onboarded Date"], 30));
  const priorJobs = data.jobs.filter((record) => previousDays(record.fields.Date, 30));
  const priorCompletedJobs = priorJobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed"));
  const priorOneTime = data.oneTime.filter((record) => previousDays(record.fields["Last Invoice Date"] || record.fields["Onboarded Date"], 30));
  const recentLeads = data.leads.filter((record) => withinDays(record.fields["Captured At"], 30));
  const openLeads = data.leads.filter((record) => isStatus(record.fields.Status, "New", "Contacted", "Quoted"));
  const convertedLeads = recentLeads.filter((record) => isStatus(record.fields.Status, "Converted"));

  const mrr = activeCustomers.reduce((sum, record) => sum + number(record.fields["MRR ($)"]), 0);
  const recurringRevenue = completedJobs.reduce((sum, record) => sum + number(record.fields["Revenue ($)"]), 0);
  const oneTimeRevenue = recentOneTime.reduce((sum, record) => sum + number(record.fields["Revenue ($)"]), 0);
  const priorRevenue = priorCompletedJobs.reduce((sum, record) => sum + number(record.fields["Revenue ($)"]), 0) + priorOneTime.reduce((sum, record) => sum + number(record.fields["Revenue ($)"]), 0);
  const actualMinutes = completedJobs.reduce((sum, record) => sum + number(record.fields["Actual Minutes"]), 0);
  const clockedMinutes = recentTime.reduce((sum, record) => sum + number(record.fields["Minutes Clocked"]), 0);
  const lostMrr = recentChurn.reduce((sum, record) => sum + number(record.fields["Lost MRR ($)"]), 0);
  const resolvedJobs = completedJobs.length + skippedJobs.length;

  return {
    activeCustomers: activeCustomers.length,
    pausedCustomers: pausedCustomers.length,
    mrr: round(mrr),
    arr: round(mrr * 12),
    weightedStops: round(activeCustomers.reduce((sum, record) => sum + number(record.fields["Weighted Stop"]), 0), 1),
    estimatedWeeklyHours: round(activeCustomers.reduce((sum, record) => sum + number(record.fields["Est. Service Minutes"]), 0) / 60, 1),
    jobRevenue30: round(recurringRevenue),
    oneTimeRevenue30: round(oneTimeRevenue),
    totalRevenue30: round(recurringRevenue + oneTimeRevenue),
    revenueChange30: changePercent(recurringRevenue + oneTimeRevenue, priorRevenue),
    completedJobs30: completedJobs.length,
    skippedJobs30: skippedJobs.length,
    completionRate30: resolvedJobs ? round((completedJobs.length / resolvedJobs) * 100, 1) : 0,
    revenuePerJob30: completedJobs.length ? round(recurringRevenue / completedJobs.length) : 0,
    revenuePerJobHour30: actualMinutes ? round(recurringRevenue / (actualMinutes / 60)) : 0,
    clockedHours30: round(clockedMinutes / 60, 1),
    miles30: round(recentTime.reduce((sum, record) => sum + number(record.fields["Miles Driven"]), 0), 1),
    churnCount30: recentChurn.length,
    lostMrr30: round(lostMrr),
    churnRate30: activeCustomers.length + recentChurn.length ? round((recentChurn.length / (activeCustomers.length + recentChurn.length)) * 100, 1) : 0,
    openLeads: openLeads.length,
    leads30: recentLeads.length,
    convertedLeads30: convertedLeads.length,
    quotedPipeline: round(openLeads.reduce((sum, record) => sum + number(record.fields["Quoted Monthly ($)"]), 0)),
    revenueTrend: weeklySeries(data.jobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed")), "Date", "Revenue ($)"),
    jobsTrend: weeklySeries(data.jobs.filter((record) => isStatus(record.fields.Status, "Completed", "job:completed")), "Date"),
    churnTrend: weeklySeries(data.churn.filter((record) => record.fields["Is Churn"] || isStatus(record.fields["Event Type"], "Canceled")), "Event Date", "Lost MRR ($)"),
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
    delivered30: delivered.length,
    deliveryRate30: recentDeliveries.length ? round((delivered.length / recentDeliveries.length) * 100, 1) : 0,
    inventoryUnits: round(inventoryUnits, 0),
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

export async function getAirtableBusinessCockpit() {
  const key = runtimeEnv().AIRTABLE_API_KEY;
  if (!key) return { configured: false, ok: false, error: "AIRTABLE_API_KEY is not configured.", opwp: null, dogFood: null };

  try {
    const [opwp, dogFood] = await Promise.all([
      loadTables(AIRTABLE_BASES.opwp.id, TABLES.opwp, key),
      loadTables(AIRTABLE_BASES.dogFood.id, TABLES.dogFood, key),
    ]);
    return { configured: true, ok: true, error: null, opwp: opwpMetrics(opwp), dogFood: dogFoodMetrics(dogFood) };
  } catch (error) {
    console.error(JSON.stringify({ event: "airtable_cockpit_error", message: String(error) }));
    return { configured: true, ok: false, error: String(error), opwp: null, dogFood: null };
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
      bases.push({ ...base, tables: (data.tables ?? []).map((table) => ({ id: table.id, name: table.name, fieldCount: table.fields?.length ?? 0 })) });
    }
    return { configured: true, ok: true, bases, error: null };
  } catch (error) {
    return { configured: true, ok: false, bases: [], error: String(error) };
  }
}
