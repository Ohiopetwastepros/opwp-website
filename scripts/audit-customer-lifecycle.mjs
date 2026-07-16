import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLES = {
  customers: "tblhi8MGUOsWNmd37",
  jobs: "tbls15v5OYexAIULc",
  churn: "tblyhWKl99rwpiIRI",
  oneTime: "tblGLypXMPxEZQb6B",
};
const names = process.argv.slice(2);
if (!names.length) throw new Error("Pass one or more customer names.");

const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
const token = match[1];

async function request(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${await response.text()}`);
  return response.json();
}

async function records(table, field) {
  const formula = `OR(${names.map((name) => `LOWER({${field}})='${name.toLowerCase().replace(/'/g, "\\'")}'`).join(",")})`;
  const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
  return (await request(`https://api.airtable.com/v0/${BASE_ID}/${table}?${params}`)).records ?? [];
}

const [schema, customers, jobs, churn, oneTime] = await Promise.all([
  request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`),
  records(TABLES.customers, "Client Name"),
  records(TABLES.jobs, "Customer Name"),
  records(TABLES.churn, "Client Name"),
  records(TABLES.oneTime, "Client Name"),
]);

const relevantFields = (tableId) => schema.tables.find((table) => table.id === tableId)?.fields
  .filter((field) => /status|pause|resume|type|reason|comment|mrr|invoice|revenue|date|subscription/i.test(field.name))
  .map((field) => ({ name: field.name, type: field.type, choices: field.options?.choices?.map((choice) => choice.name) ?? [] })) ?? [];

console.log(JSON.stringify({
  schema: Object.fromEntries(Object.entries(TABLES).map(([name, id]) => [name, relevantFields(id)])),
  customers: customers.map((record) => ({ id: record.id, fields: record.fields })),
  jobs: jobs.map((record) => ({ id: record.id, fields: record.fields })),
  churn: churn.map((record) => ({ id: record.id, fields: record.fields })),
  oneTime: oneTime.map((record) => ({ id: record.id, fields: record.fields })),
}, null, 2));
