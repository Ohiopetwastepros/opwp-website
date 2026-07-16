import { readFile } from "node:fs/promises";

const APPLY = process.argv.includes("--apply");
const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLES = {
  customers: "tblhi8MGUOsWNmd37",
  jobs: "tbls15v5OYexAIULc",
  churn: "tblyhWKl99rwpiIRI",
  oneTime: "tblGLypXMPxEZQb6B",
};
const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
const token = match[1];

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${await response.text()}`);
  return response.json();
}

async function ensurePlannedResumeField() {
  const schema = await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`);
  const table = schema.tables.find((item) => item.id === TABLES.churn);
  if (table?.fields?.some((field) => field.name === "Planned Resume Date")) return false;
  if (!APPLY) return true;
  await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${TABLES.churn}/fields`, {
    method: "POST",
    body: JSON.stringify({ name: "Planned Resume Date", type: "date", options: { dateFormat: { name: "iso" } } }),
  });
  return true;
}

async function findCustomer(name) {
  const params = new URLSearchParams({ maxRecords: "2", filterByFormula: `LOWER({Client Name})='${name.toLowerCase().replace(/'/g, "\\'")}'` });
  const result = await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.customers}?${params}`);
  if (result.records?.length !== 1) throw new Error(`${name} matched ${result.records?.length ?? 0} customer records.`);
  return result.records[0];
}

const customerChanges = [
  { name: "Michelle Bostater", fields: { Status: "Inactive", "MRR ($)": 0, "Subscription Name": "", "Date Churned": null, "Churn MRR ($)": 0, "Churn Reason": "" } },
  { name: "Lee Warren", fields: { Status: "Paused", "Date Churned": null, "Churn MRR ($)": 0, "Churn Reason": "" } },
  { name: "Cortia French", fields: { Status: "Inactive", "Date Churned": "2026-07-14", "Churn MRR ($)": 90, "Churn Reason": "Paused no response/Unresponsive" } },
  { name: "Karl & Nikole Landrum", fields: { Status: "Paused", "Date Churned": null, "Churn MRR ($)": 0, "Churn Reason": "" } },
  { name: "Joe Wichman", fields: { Status: "Inactive", "Date Churned": "2026-07-14", "Churn MRR ($)": 146, "Churn Reason": "Don't need service anymore" } },
];

const churnRows = [
  { "Event ID": "OFFICE-PAUSE-195331-20260714", "Client Name": "Lee Warren", "Event Type": "Paused", "Event Date": "2026-07-14", "Lost MRR ($)": 0, Reason: "Reducing expenses", "Reason Category": "Reducing expenses", Comment: "Paused due to financial reasons.", Plan: "Regular Plan - 1d-1xW", "Business Line": "Scooping", "Review Status": "Complete", "Subscription ID": "OFFICE-LEE-195331", "Is Churn": false, Source: "Owner validated 2026-07-14" },
  { "Event ID": "OFFICE-CHURN-188289-20260714", "Client Name": "Cortia French", "Event Type": "Canceled", "Event Date": "2026-07-14", "Deactivated Date": "2026-07-14", "Lost MRR ($)": 90, Reason: "Paused no response/Unresponsive", "Reason Category": "Paused no response/Unresponsive", Comment: "Customer stopped responding to text messages; account deactivated after no response.", Plan: "Regular Plan - 1d-1xW", "Business Line": "Scooping", "Review Status": "Complete", "Subscription ID": "OFFICE-CORTIA-188289", "Is Churn": true, Source: "Owner validated 2026-07-14" },
  { "Event ID": "OFFICE-PAUSE-167540-20260714", "Client Name": "Karl & Nikole Landrum", "Event Type": "Paused", "Event Date": "2026-07-14", "Planned Resume Date": "2026-08-01", "Lost MRR ($)": 0, Reason: "Temporary", "Reason Category": "Temporary", Comment: "Service is planned to restart August 1, 2026.", Plan: "Regular Plan - 1d-bW", "Business Line": "Scooping", "Review Status": "Complete", "Subscription ID": "OFFICE-LANDRUM-167540", "Is Churn": false, Source: "Owner validated 2026-07-14" },
  { "Event ID": "OFFICE-CHURN-175542-20260714", "Client Name": "Joe Wichman", "Event Type": "Canceled", "Event Date": "2026-07-14", "Deactivated Date": "2026-07-14", "Lost MRR ($)": 146, Reason: "Don't need service anymore", "Reason Category": "Don't need service anymore", Comment: "Customer no longer needs service and will perform the work themselves.", Plan: "Regular Plan - 2d-1xW", "Business Line": "Scooping", "Review Status": "Complete", "Subscription ID": "OFFICE-JOE-175542", "Is Churn": true, Source: "Owner validated 2026-07-14" },
];

const plannedFieldCreated = await ensurePlannedResumeField();
const customerRecords = await Promise.all(customerChanges.map(async (change) => ({ id: (await findCustomer(change.name)).id, fields: change.fields })));
if (APPLY) {
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.customers}`, { method: "PATCH", body: JSON.stringify({ records: customerRecords, typecast: true }) });
  const jobRecords = ["recfS7sOpAtiszgaV", "recr0IJOP4s952Ee0"].map((id) => ({ id, fields: { "Service Type": "one_time" } }));
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.jobs}`, { method: "PATCH", body: JSON.stringify({ records: jobRecords, typecast: true }) });
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.oneTime}`, { method: "PATCH", body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["Client Name"] }, records: [{ fields: { "Client Name": "Michelle Bostater", "Onboarded Date": "2026-06-29", "Last Invoice Date": "2026-07-03" } }], typecast: true }) });
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.churn}`, { method: "PATCH", body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["Event ID"] }, records: churnRows.map((fields) => ({ fields })), typecast: true }) });
}

console.log(JSON.stringify({ apply: APPLY, plannedResumeFieldCreated: plannedFieldCreated, customers: customerChanges.map(({ name, fields }) => ({ name, status: fields.Status })), jobsReclassified: 2, oneTimeClientsUpserted: 1, lifecycleRowsUpserted: churnRows.length }, null, 2));
