import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLE_ID = "tblhi8MGUOsWNmd37";
const API_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;

const requested = process.argv.slice(2).map((argument) => {
  const separator = argument.lastIndexOf("=");
  return { name: argument.slice(0, separator).trim(), status: argument.slice(separator + 1).trim() };
}).filter(({ name, status }) => name && ["Active", "Inactive"].includes(status));
if (!requested.length) throw new Error("Pass one or more Client Name=Active|Inactive arguments.");

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

const updates = [];
for (const item of requested) {
  const escaped = item.name.toLowerCase().replace(/'/g, "\\'");
  const params = new URLSearchParams({ maxRecords: "2", filterByFormula: `LOWER({Client Name})='${escaped}'` });
  const result = await request(`${API_URL}?${params}`);
  if (result.records?.length !== 1) {
    const tokens = item.name.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    const looseFormula = `OR(${tokens.map((token) => `FIND('${token.replace(/'/g, "\\'")}',LOWER({Client Name}))`).join(",")})`;
    const loose = await request(`${API_URL}?${new URLSearchParams({ maxRecords: "10", filterByFormula: looseFormula })}`);
    const suggestions = (loose.records ?? []).map((record) => record.fields?.["Client Name"]);
    throw new Error(`${item.name} matched ${result.records?.length ?? 0} Airtable records. Suggestions: ${suggestions.join(", ") || "none"}.`);
  }
  updates.push({ id: result.records[0].id, fields: { Status: item.status } });
}

await request(API_URL, { method: "PATCH", body: JSON.stringify({ records: updates, typecast: true }) });
console.log(JSON.stringify({ updated: requested }, null, 2));
