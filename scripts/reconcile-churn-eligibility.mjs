import { readFile } from "node:fs/promises";

const APPLY = process.argv.includes("--apply");
const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLES = { customers: "tblhi8MGUOsWNmd37", jobs: "tbls15v5OYexAIULc", churn: "tblyhWKl99rwpiIRI" };
const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
const token = match[1];
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function records(table, fields, formula = "") {
  const rows = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    fields.forEach((field) => params.append("fields[]", field));
    if (formula) params.set("filterByFormula", formula);
    if (offset) params.set("offset", offset);
    const page = await request(`https://api.airtable.com/v0/${BASE_ID}/${table}?${params}`);
    rows.push(...(page.records || []));
    offset = page.offset || "";
  } while (offset);
  return rows;
}

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const completed = (value) => ["completed", "job completed"].includes(normalize(value));
const date = (value) => String(value ?? "").slice(0, 10);
const knownNeverStarted = new Set(["allie leatherman", "claude jones"]);
const knownPlanChanges = new Set(["amanda freyer"]);

async function ensureFields() {
  const schema = await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`);
  const table = schema.tables.find((item) => item.id === TABLES.churn);
  const definitions = [
    { name: "Eligibility Status", type: "singleSelect", options: { choices: ["Confirmed", "Never Started", "Plan Change", "Needs Validation", "Excluded"].map((name) => ({ name })) } },
    { name: "Eligibility Evidence", type: "multilineText" },
  ];
  const missing = definitions.filter((definition) => !table.fields.some((field) => field.name === definition.name));
  if (APPLY) for (const definition of missing) await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${TABLES.churn}/fields`, { method: "POST", body: JSON.stringify(definition) });
  return missing.map((field) => field.name);
}

const [customers, jobs, churn] = await Promise.all([
  records(TABLES.customers, ["Client Name", "Status", "Subscription Name"]),
  records(TABLES.jobs, ["Customer Name", "Date", "Status"]),
  records(TABLES.churn, ["Client Name", "Event Date", "Event Type", "Is Churn", "Reason", "Reason Category", "Review Status", "Replacement Subscription ID", "Lost MRR ($)"], "IS_AFTER({Event Date},'2025-12-31')"),
]);

const customerByName = new Map(customers.map((row) => [normalize(row.fields["Client Name"]), row.fields]));
const jobsByName = new Map();
for (const row of jobs) {
  const key = normalize(row.fields["Customer Name"]);
  if (!jobsByName.has(key)) jobsByName.set(key, []);
  if (completed(row.fields.Status)) jobsByName.get(key).push(date(row.fields.Date));
}

const changes = [];
const counts = { confirmed: 0, planChange: 0, neverStarted: 0, needsValidation: 0, alreadyExcluded: 0 };
for (const row of churn) {
  const current = row.fields;
  const name = String(current["Client Name"] || "Unknown");
  const key = normalize(name);
  const eventDate = date(current["Event Date"]);
  const serviceDates = (jobsByName.get(key) || []).sort();
  const before = serviceDates.filter((jobDate) => jobDate <= eventDate);
  const after = serviceDates.filter((jobDate) => jobDate > eventDate);
  const customer = customerByName.get(key) || {};
  let status;
  let fields = {};

  if (!current["Is Churn"]) {
    status = normalize(current["Event Type"]) === "plan change" ? "Plan Change" : "Excluded";
    counts.alreadyExcluded += 1;
    fields = { "Eligibility Status": status, "Eligibility Evidence": status === "Plan Change" ? "Previously classified as a plan change." : "Previously excluded from customer churn." };
  } else if (knownNeverStarted.has(key)) {
    status = "Never Started";
    counts.neverStarted += 1;
    fields = { "Is Churn": false, "Lost MRR ($)": 0, "Eligibility Status": status, "Eligibility Evidence": "Owner confirmed the account never received service and was never paid.", "Review Status": "Complete", "Reviewed Date": "2026-07-14" };
  } else if (knownPlanChanges.has(key) || (normalize(customer.Status) === "active" && after.length > 0)) {
    status = "Plan Change";
    counts.planChange += 1;
    fields = { "Is Churn": false, "Lost MRR ($)": 0, "Event Type": "Plan Change", "Eligibility Status": status, "Eligibility Evidence": `Customer is active and completed service continued after cancellation${after[0] ? ` (next visit ${after[0]})` : ""}.`, "Review Status": "Plan Replacement", "Reviewed Date": "2026-07-14" };
    if (knownPlanChanges.has(key)) {
      fields.Reason = "Modification of subscription type";
      fields["Reason Category"] = "Modification of subscription type";
    }
  } else if (before.length === 0) {
    status = "Needs Validation";
    counts.needsValidation += 1;
    fields = { "Is Churn": false, "Eligibility Status": status, "Eligibility Evidence": "No completed service was found before cancellation. Historical paid-invoice evidence is unavailable; excluded until office validation.", "Review Status": "Needs Validation" };
  } else {
    status = "Confirmed";
    counts.confirmed += 1;
    fields = { "Eligibility Status": status, "Eligibility Evidence": `${before.length} completed visit(s) found before cancellation; latest ${before.at(-1)}.` };
  }
  changes.push({ id: row.id, customer: name, eventDate, status, fields });
}

const missingFields = await ensureFields();
if (APPLY) {
  for (let index = 0; index < changes.length; index += 10) {
    await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.churn}`, { method: "PATCH", body: JSON.stringify({ records: changes.slice(index, index + 10).map(({ id, fields }) => ({ id, fields })), typecast: true }) });
  }
}

console.log(JSON.stringify({ apply: APPLY, missingFields, recordsReviewed: changes.length, counts, namedCorrections: changes.filter((row) => knownNeverStarted.has(normalize(row.customer)) || knownPlanChanges.has(normalize(row.customer))).map(({ customer, eventDate, status }) => ({ customer, eventDate, status })) }, null, 2));
