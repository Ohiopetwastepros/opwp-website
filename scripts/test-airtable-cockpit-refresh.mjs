import { loadAirtableTableSet } from "../lib/airtable-refresh-policy.mjs";

const tables = { customers: "customer-table", leads: "lead-table" };
const fallbackLead = { id: "prior-lead", fields: { Source: "prior snapshot" } };

const partial = await loadAirtableTableSet(
  tables,
  async (name) => {
    if (name === "leads") throw new Error("Optional table unavailable.");
    return [];
  },
  { optional: ["leads"], fallback: { leads: [fallbackLead] } },
);
if (partial.data.leads[0]?.id !== fallbackLead.id) throw new Error("Optional Airtable fallback was not preserved.");
if (!partial.warnings.some((warning) => warning.startsWith("leads "))) throw new Error("Optional Airtable warning was not recorded.");

let coreFailedClosed = false;
try {
  await loadAirtableTableSet(tables, async () => { throw new Error("Core table unavailable."); }, { optional: ["leads"] });
} catch {
  coreFailedClosed = true;
}
if (!coreFailedClosed) throw new Error("Core Airtable customer failure did not fail closed.");

console.log("Airtable cockpit refresh safeguards passed.");
