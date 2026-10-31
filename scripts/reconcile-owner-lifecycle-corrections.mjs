import operationalPrivate from '../lib/operational-private.json' with {type:'json'};
import {validateBuildInputs} from './prepare-build-inputs.mjs';
import { readFile } from "node:fs/promises";

const APPLY = process.argv.includes("--apply");
validateBuildInputs({production:APPLY});
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

const customerChanges = operationalPrivate.lifecycle.customerChanges;

const churnRows = operationalPrivate.lifecycle.churnRows;

const plannedFieldCreated = await ensurePlannedResumeField();
const customerRecords = await Promise.all(customerChanges.map(async (change) => ({ id: (await findCustomer(change.name)).id, fields: change.fields })));
if (APPLY) {
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.customers}`, { method: "PATCH", body: JSON.stringify({ records: customerRecords, typecast: true }) });
  const jobRecords = operationalPrivate.lifecycle.jobRecordIds.map((id) => ({ id, fields: { "Service Type": "one_time" } }));
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.jobs}`, { method: "PATCH", body: JSON.stringify({ records: jobRecords, typecast: true }) });
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.oneTime}`, { method: "PATCH", body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["Client Name"] }, records: operationalPrivate.lifecycle.oneTimeRecords, typecast: true }) });
  await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLES.churn}`, { method: "PATCH", body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["Event ID"] }, records: churnRows.map((fields) => ({ fields })), typecast: true }) });
}

console.log(JSON.stringify({ apply: APPLY, plannedResumeFieldCreated: plannedFieldCreated, customers: customerChanges.map(({ name, fields }) => ({ name, status: fields.Status })), jobsReclassified: operationalPrivate.lifecycle.jobRecordIds.length, oneTimeClientsUpserted: operationalPrivate.lifecycle.oneTimeRecords.length, lifecycleRowsUpserted: churnRows.length }, null, 2));
