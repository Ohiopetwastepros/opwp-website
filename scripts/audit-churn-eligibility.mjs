import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLES = {
  customers: "tblhi8MGUOsWNmd37",
  jobs: "tbls15v5OYexAIULc",
  churn: "tblyhWKl99rwpiIRI",
};

const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
const token = match[1];

async function request(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${await response.text()}`);
  return response.json();
}

async function records(table, fields, filterByFormula = "") {
  const rows = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    for (const field of fields) params.append("fields[]", field);
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (offset) params.set("offset", offset);
    const page = await request(`https://api.airtable.com/v0/${BASE_ID}/${table}?${params}`);
    rows.push(...(page.records ?? []));
    offset = page.offset || "";
  } while (offset);
  return rows;
}

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isCompleted = (value) => ["completed", "job completed"].includes(normalize(value));
const iso = (value) => String(value ?? "").slice(0, 10);

const [customers, jobs, churn] = await Promise.all([
  records(TABLES.customers, ["Client Name", "Status", "MRR ($)", "Subscription Name", "SNG Client ID"]),
  records(TABLES.jobs, ["Customer Name", "Date", "Status", "Service Type", "Revenue ($)"]),
  records(TABLES.churn, ["Client Name", "Event Date", "Event Type", "Business Line", "Is Churn", "Plan", "Lost MRR ($)", "Reason", "Reason Category", "Review Status", "Replacement Subscription ID", "Reactivated Date", "Event ID", "Source"], "IS_AFTER({Event Date},'2025-12-31')"),
]);

const customersByName = new Map();
for (const record of customers) customersByName.set(normalize(record.fields["Client Name"]), record);
const jobsByName = new Map();
for (const record of jobs) {
  const key = normalize(record.fields["Customer Name"]);
  if (!jobsByName.has(key)) jobsByName.set(key, []);
  jobsByName.get(key).push(record);
}

const rows = churn.map((record) => {
  const fields = record.fields;
  const name = fields["Client Name"] || "Unknown";
  const key = normalize(name);
  const eventDate = iso(fields["Event Date"]);
  const customer = customersByName.get(key)?.fields ?? {};
  const completedJobs = (jobsByName.get(key) ?? []).filter((job) => isCompleted(job.fields.Status));
  const before = completedJobs.filter((job) => iso(job.fields.Date) <= eventDate);
  const after = completedJobs.filter((job) => iso(job.fields.Date) > eventDate);
  const activeNow = normalize(customer.Status) === "active";
  const modification = normalize(fields["Reason Category"] || fields.Reason).includes("modification of subscription type");
  const hasReplacement = Boolean(fields["Replacement Subscription ID"]);
  const candidate = !fields["Is Churn"] ? "excluded"
    : (modification || hasReplacement || (activeNow && after.length)) ? "plan_change_or_reactivated"
      : before.length === 0 ? "never_serviced_needs_payment_check"
        : "service_evidence_true_churn_candidate";
  return {
    id: record.id,
    customer: name,
    eventDate,
    eventType: fields["Event Type"] || "",
    isChurn: Boolean(fields["Is Churn"]),
    reason: fields["Reason Category"] || fields.Reason || "",
    lostMrr: Number(fields["Lost MRR ($)"] || 0),
    currentStatus: customer.Status || "not_in_customer_table",
    currentPlan: customer["Subscription Name"] || "",
    completedBefore: before.length,
    completedAfter: after.length,
    firstCompleted: completedJobs.map((job) => iso(job.fields.Date)).sort()[0] || "",
    lastCompleted: completedJobs.map((job) => iso(job.fields.Date)).sort().at(-1) || "",
    replacementSubscriptionId: fields["Replacement Subscription ID"] || "",
    candidate,
    eventId: fields["Event ID"] || "",
  };
}).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.customer.localeCompare(b.customer));

const candidates = rows.filter((row) => row.isChurn && row.candidate !== "service_evidence_true_churn_candidate");
console.log(JSON.stringify({
  totals: {
    churnRows2026: rows.length,
    currentlyCountedAsChurn: rows.filter((row) => row.isChurn).length,
    serviceEvidenceCandidates: rows.filter((row) => row.candidate === "service_evidence_true_churn_candidate").length,
    neverServicedNeedsPaymentCheck: rows.filter((row) => row.candidate === "never_serviced_needs_payment_check").length,
    planChangeOrReactivated: rows.filter((row) => row.candidate === "plan_change_or_reactivated").length,
  },
  candidates,
  allRows: process.argv.includes("--all") ? rows : undefined,
}, null, 2));
