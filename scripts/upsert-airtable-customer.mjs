import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLE_ID = "tblhi8MGUOsWNmd37";
const API_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
const NUMBER_FIELDS = new Set(["MRR ($)", "Est. Service Minutes", "Number of Dogs"]);

const fields = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  const name = argument.slice(0, separator).trim();
  const raw = argument.slice(separator + 1).trim();
  return [name, NUMBER_FIELDS.has(name) ? Number(raw) : raw];
}).filter(([name]) => name));
if (!fields["Client Name"]) throw new Error("Client Name is required.");

const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");

const response = await fetch(API_URL, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${match[1]}`, "Content-Type": "application/json" },
  body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["Client Name"] }, records: [{ fields }], typecast: true }),
});
if (!response.ok) throw new Error(`Airtable ${response.status}: ${await response.text()}`);
const result = await response.json();
console.log(JSON.stringify({ id: result.records?.[0]?.id, client: fields["Client Name"], fieldsUpdated: Object.keys(fields).length }, null, 2));
