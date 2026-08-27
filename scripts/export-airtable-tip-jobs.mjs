import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_URL = "https://api.airtable.com/v0";
const BASE_ID = "appcAWPBQB8GmOrcT";
const JOB_TABLE_ID = "tbls15v5OYexAIULc";
const START = process.argv[3] || "2026-01-01";
const END = process.argv[4] || "2026-07-24";

function adjacentDate(value, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Dates must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid date.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DAY_BEFORE_START = adjacentDate(START, -1);
const DAY_AFTER_END = adjacentDate(END, 1);

async function tokenFromDevVars() {
  const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
  if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
  return match[1];
}

async function airtablePage(token, offset = "") {
  const params = new URLSearchParams({
    pageSize: "100",
    filterByFormula: `AND({Date},IS_AFTER({Date},'${DAY_BEFORE_START}'),IS_BEFORE({Date},'${DAY_AFTER_END}'))`,
  });
  for (const field of ["Job ID", "Date", "Customer Name", "Tech Name", "Service Type", "Status"]) {
    params.append("fields[]", field);
  }
  params.append("sort[0][field]", "Date");
  params.append("sort[0][direction]", "asc");
  if (offset) params.set("offset", offset);

  const response = await fetch(`${API_URL}/${BASE_ID}/${JOB_TABLE_ID}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error?.type || `Airtable request failed (${response.status})`);
  }
  return data;
}

const outputPath = resolve(process.argv[2] || "tmp/airtable-completed-jobs-2026-01-01-to-2026-07-24.json");
const token = await tokenFromDevVars();
const records = [];
let offset = "";
do {
  const page = await airtablePage(token, offset);
  records.push(...(page.records || []));
  offset = page.offset || "";
} while (offset);

const output = {
  meta: {
    source: "Airtable OPWP Operating System / Daily Job Log",
    access: "read-only",
    fetchedAt: new Date().toISOString(),
    start: START,
    end: END,
    count: records.length,
  },
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  count: records.length,
  firstDate: records[0]?.fields?.Date || null,
  lastDate: records.at(-1)?.fields?.Date || null,
}));
