import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const CUSTOMER_TABLE = "tblhi8MGUOsWNmd37";
const JOB_TABLE = "tbls15v5OYexAIULc";
const API_URL = "https://api.airtable.com/v0";

async function tokenFromDevVars() {
  const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
  if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
  return match[1];
}

async function request(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${await response.text()}`);
  return response.json();
}

async function listRecords(token, table, filterByFormula = "") {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (offset) params.set("offset", offset);
    const page = await request(token, `${API_URL}/${BASE_ID}/${table}?${params}`);
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(value); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...data] = rows;
  return data.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function frequencyFromPlan(plan) {
  const value = String(plan ?? "");
  if (/2xW/i.test(value)) return "Twice Weekly";
  if (/-bW\b/i.test(value) || /bi.?weekly/i.test(value)) return "Biweekly";
  if (/1xW/i.test(value) || /weekly/i.test(value)) return "Weekly";
  if (/1xM/i.test(value) || /monthly/i.test(value)) return "Monthly";
  return "";
}

function weekday(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function inferredDays(jobRows, frequency) {
  const counts = new Map();
  for (const job of jobRows) {
    const day = weekday(job.fields?.Date);
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const ranked = [...counts].filter(([day]) => !["Saturday", "Sunday"].includes(day)).sort((a, b) => b[1] - a[1]);
  const expected = /twice|2x|two times/i.test(String(frequency ?? "")) ? 2 : 1;
  const dayOrder = new Map(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day, index) => [day, index]));
  return {
    days: ranked.slice(0, expected).map(([day]) => day).sort((a, b) => dayOrder.get(a) - dayOrder.get(b)),
    counts: Object.fromEntries(ranked),
    observations: jobRows.length,
  };
}

const token = await tokenFromDevVars();
const apply = process.argv.includes("--apply");
const subscriptionsArg = process.argv.find((argument) => argument.startsWith("--subscriptions="));
const subscriptionRows = subscriptionsArg ? parseCsv(await readFile(subscriptionsArg.slice("--subscriptions=".length), "utf8")) : [];
const subscriptionFrequency = new Map();
for (const row of subscriptionRows) {
  if (normalized(row.Status) !== "active") continue;
  const frequency = frequencyFromPlan(row["Subs. Name"]);
  if (frequency) subscriptionFrequency.set(normalized(row["Client Name"]), frequency);
}
const [schema, customers, jobs] = await Promise.all([
  request(token, `${API_URL}/meta/bases/${BASE_ID}/tables`),
  listRecords(token, CUSTOMER_TABLE),
  listRecords(token, JOB_TABLE, "AND({Status}='Completed',IS_AFTER({Date},'2026-03-31'))"),
]);

const active = customers.filter((record) => normalized(record.fields?.Status) === "active");
const jobsByCustomer = new Map();
for (const job of jobs) {
  const key = normalized(job.fields?.["Customer Name"]);
  if (!key) continue;
  const rows = jobsByCustomer.get(key) ?? [];
  rows.push(job);
  jobsByCustomer.set(key, rows);
}

const auditRows = active.map((record) => {
  const fields = record.fields ?? {};
  const jobRows = jobsByCustomer.get(normalized(fields["Client Name"])) ?? [];
  const inference = inferredDays(jobRows, fields.Frequency);
  return {
    id: record.id,
    name: fields["Client Name"] ?? "",
    sngClientId: fields["SNG Client ID"] ?? "",
    frequency: fields.Frequency ?? "",
    serviceDay: fields["Service Day"] ?? "",
    serviceDay2: fields["Service Day 2"] ?? "",
    mrr: fields["MRR ($)"] ?? 0,
    inferredDays: inference.days,
    weekdayCounts: inference.counts,
    observations: inference.observations,
    recentJobs: jobRows.map((job) => ({ date: job.fields?.Date, serviceType: job.fields?.["Service Type"] ?? "" })).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8),
  };
});

const customerSchema = schema.tables.find((table) => table.id === CUSTOMER_TABLE);
const routingFields = customerSchema?.fields.filter((field) => ["Frequency", "Service Day", "Service Day 2", "Assigned Tech"].includes(field.name)).map((field) => ({ name: field.name, type: field.type, choices: field.options?.choices?.map((choice) => choice.name) ?? [] })) ?? [];
const terri = auditRows.find((row) => normalized(row.name) === "terrimoore");
const missingFrequency = auditRows.filter((row) => !row.frequency);
const missingServiceDay = auditRows.filter((row) => !row.serviceDay);
const twiceWeeklyMissingSecondDay = auditRows.filter((row) => /twice|2x|two times/i.test(row.frequency) && !row.serviceDay2);
const activeByName = new Map(auditRows.map((row) => [normalized(row.name), row]));
const airtableActiveNotExport = auditRows.filter((row) => !subscriptionFrequency.has(normalized(row.name)));
const exportNotAirtableActive = [...subscriptionFrequency.keys()].filter((name) => !activeByName.has(name));
const scheduleConflicts = auditRows.filter((row) => {
  const twice = /twice|2x|two times/i.test(row.frequency);
  const current = [row.serviceDay, ...(twice ? [row.serviceDay2] : [])].filter((day) => day && day !== "N/A").sort();
  const inferred = [...row.inferredDays].sort();
  const enoughEvidence = row.observations >= (twice ? 8 : 4);
  return current.length > 0 && enoughEvidence && JSON.stringify(current) !== JSON.stringify(inferred);
});

const updates = auditRows.map((row) => {
  const fields = {};
  const frequency = row.frequency || subscriptionFrequency.get(normalized(row.name)) || "";
  if (!row.frequency && frequency) fields.Frequency = frequency;
  if (!row.serviceDay && row.inferredDays[0]) fields["Service Day"] = row.inferredDays[0];
  if (/twice|2x|two times/i.test(frequency) && !row.serviceDay2 && row.inferredDays[1]) fields["Service Day 2"] = row.inferredDays[1];
  return { id: row.id, fields };
}).filter((record) => Object.keys(record.fields).length);

if (apply) {
  for (let index = 0; index < updates.length; index += 10) {
    await request(token, `${API_URL}/${BASE_ID}/${CUSTOMER_TABLE}`, {
      method: "PATCH",
      body: JSON.stringify({ records: updates.slice(index, index + 10), typecast: true }),
    });
  }
}

console.log(JSON.stringify({
  activeCustomers: active.length,
  completedJobsSinceApril: jobs.length,
  mode: apply ? "applied" : "dry-run",
  proposedUpdates: updates.length,
  routingFields,
  terri,
  subscriptionComparison: {
    exportCoreCustomers: subscriptionFrequency.size,
    airtableActiveNotExport: airtableActiveNotExport.map(({ name, frequency, serviceDay, serviceDay2, mrr, recentJobs }) => ({ name, frequency, serviceDay, serviceDay2, mrr, recentJobs })),
    exportNotAirtableActive,
  },
  gaps: {
    counts: {
      missingFrequency: missingFrequency.length,
      missingServiceDay: missingServiceDay.length,
      twiceWeeklyMissingSecondDay: twiceWeeklyMissingSecondDay.length,
      scheduleConflicts: scheduleConflicts.length,
    },
    missingFrequency: missingFrequency.map(({ name, mrr, inferredDays, observations, recentJobs }) => ({ name, mrr, inferredDays, observations, recentJobs })),
    missingServiceDay: missingServiceDay.map(({ name, frequency, inferredDays, observations }) => ({ name, frequency, inferredDays, observations })),
    twiceWeeklyMissingSecondDay: twiceWeeklyMissingSecondDay.map(({ name, frequency, serviceDay, inferredDays, observations }) => ({ name, frequency, serviceDay, inferredDays, observations })),
    scheduleConflicts: scheduleConflicts.map(({ name, frequency, serviceDay, serviceDay2, inferredDays, observations, weekdayCounts }) => ({ name, frequency, serviceDay, serviceDay2, inferredDays, observations, weekdayCounts })),
  },
}, null, 2));
