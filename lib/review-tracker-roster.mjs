import { normalizeReviewIdentity } from "./google-review-matching.mjs";

function completed(status) {
  return ["completed", "job:completed"].includes(String(status ?? "").toLowerCase());
}

function serviceType(value) {
  return normalizeReviewIdentity(value);
}

function later(left, right) {
  return String(left || "") > String(right || "") ? left : right;
}

function priority(fields, now = Date.now()) {
  if (fields["Google Review"] === "Reviewed") return "Do not contact - reviewed";
  const completedJobs = Number(fields["Completed Jobs"]) || 0;
  if (!completedJobs && !fields["Last Completed Job"]) return "No completed job";
  if (fields["Client Type"] === "Recurring") return "Future automation";
  const completedAt = Date.parse(`${fields["Last Completed Job"] || ""}T12:00:00Z`);
  return Number.isFinite(completedAt) && completedAt >= now - 30 * 86400000
    ? "Highlight - recent one-time"
    : "Do not contact - past one-time";
}

export function buildReviewTrackerRoster({ customers = [], jobs = [], oneTime = [], tracker = [], now = Date.now() }) {
  const people = new Map();
  const person = (name) => {
    const key = normalizeReviewIdentity(name);
    if (!key) return null;
    if (!people.has(key)) people.set(key, { name: String(name).trim().slice(0, 150), status: "", sngClientId: "", firstCompleted: "", lastCompleted: "", completedJobs: 0, recurring: false, oneTime: false, sources: new Set() });
    return people.get(key);
  };

  for (const record of customers) {
    const row = person(record?.fields?.["Client Name"]);
    if (!row) continue;
    row.status = String(record.fields.Status || "").slice(0, 100);
    row.sngClientId = String(record.fields["SNG Client ID"] ?? "").slice(0, 100);
    row.recurring = Boolean(record.fields.Frequency || record.fields["Subscription Name"] || Number(record.fields["MRR ($)"]) > 0);
    row.sources.add("Customers");
  }
  for (const record of oneTime) {
    const row = person(record?.fields?.["Client Name"]);
    if (!row) continue;
    row.oneTime = true;
    row.lastCompleted = later(row.lastCompleted, record.fields["Last Invoice Date"] || record.fields["Onboarded Date"] || "");
    row.sources.add("One-Time Clients");
  }
  for (const record of jobs) {
    const row = person(record?.fields?.["Customer Name"]);
    if (!row) continue;
    const type = serviceType(record.fields["Service Type"]);
    if (type === "recurring") row.recurring = true;
    if (type === "onetime" || type === "initial") row.oneTime = true;
    if (completed(record.fields.Status)) {
      const date = String(record.fields.Date || "").slice(0, 10);
      row.completedJobs += 1;
      row.firstCompleted = !row.firstCompleted || date < row.firstCompleted ? date : row.firstCompleted;
      row.lastCompleted = later(row.lastCompleted, date);
    }
    row.sources.add("Daily Job Log");
  }

  const existing = new Map(tracker.filter((record) => String(record?.fields?.["Client Type"] || "").toLowerCase() !== "unmatched review").map((record) => [normalizeReviewIdentity(record.fields["Client Name"]), record]));
  const updates = [];
  const creates = [];
  for (const [key, row] of people) {
    const record = existing.get(key);
    const baseFields = {
      "Client Name": row.name,
      "Client Type": row.recurring ? "Recurring" : "One-time",
      "Customer Status": row.status || (row.completedJobs ? "Past" : "Unknown"),
      "First Completed Job": row.firstCompleted || null,
      "Last Completed Job": row.lastCompleted || null,
      "Completed Jobs": row.completedJobs,
      "SNG Client ID": row.sngClientId,
      "Source Records": [...row.sources].join(", "),
    };
    if (!record) {
      const fields = { ...baseFields, "Google Review": "Not reviewed", "Review URL": "https://g.page/r/CXzwhf5RzsotEAE/review" };
      fields["Follow-up Priority"] = priority(fields, now);
      creates.push({ fields });
      continue;
    }
    const fields = {};
    for (const [name, value] of Object.entries(baseFields)) {
      const current = record.fields[name] ?? null;
      if (String(current ?? "") !== String(value ?? "")) fields[name] = value;
    }
    const nextPriority = priority({ ...record.fields, ...baseFields }, now);
    if (record.fields["Follow-up Priority"] !== nextPriority) fields["Follow-up Priority"] = nextPriority;
    if (Object.keys(fields).length) updates.push({ id: record.id, fields });
  }
  return { updates, creates, sourceClients: people.size, trackedClients: existing.size };
}
