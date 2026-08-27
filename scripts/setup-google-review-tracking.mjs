import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLE_ID = "tblzRg9DZKdIRQDrn";
const FIELD_NAME = "Google Review Aliases";

for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const key = process.env.AIRTABLE_API_KEY;
if (!key) throw new Error("AIRTABLE_API_KEY is not configured in .dev.vars.");
const headers = { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error?.type || `Airtable request failed (${response.status})`);
  return data;
}

const schema = await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`);
const table = schema.tables?.find((item) => item.id === TABLE_ID);
if (!table) throw new Error("Google Review Tracking table was not found.");
const aliasField = table.fields?.find((field) => field.name === FIELD_NAME);

const records = await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodeURIComponent("LOWER({Client Name})='allen williams'")}&pageSize=10`);
const allen = records.records?.find((record) => String(record.fields?.["Client Name"] || "").toLowerCase() === "allen williams");
if (!allen) throw new Error("Allen Williams was not found in Google Review Tracking.");
const aliases = String(allen.fields?.[FIELD_NAME] || "").split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
if (!aliases.some((value) => value.toLowerCase() === "mitch medici")) aliases.push("Mitch Medici");

const plan = { fieldExists: Boolean(aliasField), fieldToCreate: aliasField ? null : FIELD_NAME, recordId: allen.id, client: allen.fields["Client Name"], aliases };
if (!APPLY) {
  console.log(JSON.stringify({ apply: false, plan }, null, 2));
  process.exit(0);
}

if (!aliasField) {
  await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${TABLE_ID}/fields`, {
    method: "POST",
    body: JSON.stringify({ name: FIELD_NAME, type: "multilineText", description: "Alternate Google reviewer display names that should match this customer. Separate names with a new line." }),
  });
}
await request(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
  method: "PATCH",
  body: JSON.stringify({ records: [{ id: allen.id, fields: { [FIELD_NAME]: aliases.join("\n") } }], typecast: false }),
});

console.log(JSON.stringify({ apply: true, fieldCreated: !aliasField, client: allen.fields["Client Name"], aliases }, null, 2));
