import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLE_ID = "tblyhWKl99rwpiIRI";
const API_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
const APPLY = process.argv.includes("--apply");

const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
const headers = { Authorization: `Bearer ${match[1]}`, "Content-Type": "application/json" };

async function airtable(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function allRecords() {
  const records = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    for (const field of ["Client Name", "Event Date", "Reason", "Reason Category", "Comment", "Review Status", "Eligibility Status", "Replacement Subscription ID"]) {
      params.append("fields[]", field);
    }
    if (offset) params.set("offset", offset);
    const page = await airtable(`${API_URL}?${params}`);
    records.push(...(page.records ?? []));
    offset = page.offset ?? "";
  } while (offset);
  return records;
}

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[\u2018\u2019']/g, "").replace(/[^a-z0-9]/g, "");
const requiresComment = new Set(["dontneedserviceanymore", "dissatisfied", "other"]);

function expectedReviewStatus(fields) {
  const reason = fields["Reason Category"] || fields.Reason || "";
  if (normalize(reason) === "modificationofsubscriptiontype") {
    return fields["Replacement Subscription ID"] ? "Plan Replacement" : "Needs Validation";
  }
  if (requiresComment.has(normalize(reason)) && !String(fields.Comment ?? "").trim()) return "Needs Comment";
  return "Complete";
}

const records = await allRecords();
const audited = records.map((record) => {
  const fields = record.fields ?? {};
  const expected = expectedReviewStatus(fields);
  return {
    id: record.id,
    customer: fields["Client Name"] || "Unknown",
    eventDate: fields["Event Date"] || "",
    reason: fields["Reason Category"] || fields.Reason || "",
    comment: String(fields.Comment ?? "").trim(),
    current: fields["Review Status"] || "(blank)",
    expected,
    eligibility: fields["Eligibility Status"] || "",
  };
});

// Only auto-fix the stale state this audit is designed to catch. Eligibility
// workflows intentionally use Needs Validation and Plan Replacement in this
// same field, so a broad recomputation could erase unrelated review work.
const statusFixes = audited.filter((row) => row.current === "Needs Comment" && row.comment);
if (APPLY && statusFixes.length) {
  for (let index = 0; index < statusFixes.length; index += 10) {
    await airtable(API_URL, {
      method: "PATCH",
      body: JSON.stringify({
        records: statusFixes.slice(index, index + 10).map((row) => ({ id: row.id, fields: { "Review Status": "Complete" } })),
        typecast: true,
      }),
    });
  }
}

console.log(JSON.stringify({
  mode: APPLY ? "applied" : "dry-run",
  recordsReviewed: audited.length,
  statusFixes: statusFixes.map(({ id, ...row }) => row),
  carrieHargrove: audited.filter((row) => normalize(row.customer) === "carriehargrove").map(({ id, ...row }) => row),
  stillNeedsComment: audited.filter((row) => row.current === "Needs Comment" && !row.comment).map(({ id, comment, ...row }) => row),
}, null, 2));
