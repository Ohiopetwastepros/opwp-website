import { readFile } from "node:fs/promises";

const BASE_ID = "appcAWPBQB8GmOrcT";
const TABLE_ID = "tblyhWKl99rwpiIRI";
const API_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;

const REASONS = [
  "Too expensive",
  "Moved",
  "Dog died/gone",
  "Don't need service anymore",
  "Dissatisfied",
  "Billing Cycle not suitable",
  "Seasonal",
  "Temporary",
  "Gift Certificate used up",
  "Non-Payment",
  "No reason provided",
  "Modification of subscription type",
  "Reducing expenses",
  "Can not service",
  "Free service ended",
  "Paused no response/Unresponsive",
  "Signed with competitor",
  "Other",
];

const COMMENT_REQUIRED = new Set([
  "Don't need service anymore",
  "Dissatisfied",
  "Other",
]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const REASON_BY_NORMALIZED = new Map(REASONS.map((reason) => [normalize(reason), reason]));
REASON_BY_NORMALIZED.set(normalize("Don’t need service any more"), "Don't need service anymore");

function canonicalReason(value) {
  const normalized = normalize(value);
  if (!normalized || normalized === "needs review") return "No reason provided";
  return REASON_BY_NORMALIZED.get(normalized) ?? "Other";
}

function businessLine(plan) {
  const value = normalize(plan);
  if (/dog food|dogfood|extreme dog fuel|edf/.test(value)) return "Dog Food";
  if (!value || /regular plan|\b\d+d\s+\d+xw\b|\b\d+d\s+bw\b|scoop|cleanup|clean up|pet waste|weekly|biweekly|twice weekly|every other week/.test(value)) {
    return "Scooping";
  }
  return "Add-on";
}

function subscriptionId(fields) {
  if (fields["Subscription ID"]) return String(fields["Subscription ID"]);
  const match = String(fields["Event ID"] ?? "").match(/^SNG-SUB-(.+)$/i);
  return match?.[1] ?? undefined;
}

function repairedFields(record) {
  const current = record.fields ?? {};
  const category = canonicalReason(current.Reason || current["Reason Category"]);
  const line = businessLine(current.Plan);
  const replacement = current["Replacement Subscription ID"];
  const eventType = String(current["Event Type"] ?? "");
  const isModification = category === "Modification of subscription type";
  const isCanceledEvent = normalize(eventType) === "canceled";
  const isChurn = line !== "Add-on" && !isModification && (isCanceledEvent || current["Is Churn"] === true);

  let reviewStatus = "Complete";
  if (isModification) reviewStatus = replacement ? "Plan Replacement" : "Needs Validation";
  else if (COMMENT_REQUIRED.has(category) && !String(current.Comment ?? "").trim()) reviewStatus = "Needs Comment";

  const repaired = {
    "Business Line": line,
    "Reason Category": category,
    "Review Status": reviewStatus,
    "Is Churn": isChurn,
  };
  const id = subscriptionId(current);
  if (id) repaired["Subscription ID"] = id;
  if (isModification) {
    repaired["Event Type"] = "Plan Change";
    repaired["Lost MRR ($)"] = 0;
  }
  return repaired;
}

async function tokenFromDevVars() {
  const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  const match = source.match(/^AIRTABLE_API_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
  if (!match) throw new Error("AIRTABLE_API_KEY was not found in .dev.vars");
  return match[1];
}

async function airtable(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${await response.text()}`);
  return response.json();
}

async function allRecords(token) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const page = await airtable(token, `${API_URL}?${params}`);
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

function counts(records, projected) {
  const countBy = (key) => Object.fromEntries(
    [...records.reduce((map, record) => {
      const value = projected.get(record.id)?.[key] ?? record.fields?.[key] ?? "(blank)";
      map.set(String(value), (map.get(String(value)) ?? 0) + 1);
      return map;
    }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    records: records.length,
    sourcePlans: Object.fromEntries([...records.reduce((map, record) => {
      const value = String(record.fields?.Plan ?? "(blank)");
      map.set(value, (map.get(value) ?? 0) + 1);
      return map;
    }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))),
    sourceEventTypes: Object.fromEntries([...records.reduce((map, record) => {
      const value = String(record.fields?.["Event Type"] ?? "(blank)");
      map.set(value, (map.get(value) ?? 0) + 1);
      return map;
    }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))),
    sourceReasons: Object.fromEntries([...records.reduce((map, record) => {
      const value = String(record.fields?.Reason ?? "(blank)");
      map.set(value, (map.get(value) ?? 0) + 1);
      return map;
    }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))),
    businessLines: countBy("Business Line"),
    reasons: countBy("Reason Category"),
    reviewStatuses: countBy("Review Status"),
    churn: countBy("Is Churn"),
  };
}

const apply = process.argv.includes("--apply");
const token = await tokenFromDevVars();
const records = await allRecords(token);
const projected = new Map(records.map((record) => [record.id, repairedFields(record)]));

if (apply) {
  for (let index = 0; index < records.length; index += 10) {
    const batch = records.slice(index, index + 10).map((record) => ({
      id: record.id,
      fields: projected.get(record.id),
    }));
    await airtable(token, API_URL, {
      method: "PATCH",
      body: JSON.stringify({ records: batch, typecast: true }),
    });
  }
}

const tracy = records.find((record) => String(record.fields?.["Event ID"] ?? "") === "SNG-SUB-262728");
const pat = records.find((record) => String(record.fields?.["Event ID"] ?? "") === "SNG-SUB-420514");
console.log(JSON.stringify({
  mode: apply ? "applied" : "dry-run",
  summary: counts(records, projected),
  tracy: tracy ? { ...projected.get(tracy.id), "Lost MRR ($)": tracy.fields?.["Lost MRR ($)"] ?? 0 } : null,
  pat: pat ? { ...projected.get(pat.id), "Lost MRR ($)": pat.fields?.["Lost MRR ($)"] ?? 0 } : null,
}, null, 2));
