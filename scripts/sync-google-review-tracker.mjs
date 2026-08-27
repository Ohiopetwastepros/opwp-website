import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE_ID = "appcAWPBQB8GmOrcT";
const SOURCE_TABLES = {
  customers: "tblhi8MGUOsWNmd37",
  jobs: "tbls15v5OYexAIULc",
  oneTime: "tblGLypXMPxEZQb6B",
  tracker: "tblzRg9DZKdIRQDrn",
};
const TRACKER_NAME = "Google Review Tracking";
const REVIEW_URL = "https://g.page/r/CXzwhf5RzsotEAE/review";
const RECENT_DAYS = 30;

for (const line of fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const key = process.env.AIRTABLE_API_KEY;
if (!key) throw new Error("AIRTABLE_API_KEY is not configured in .dev.vars.");
const headers = { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" };

const reviews = [
  ["Ryan Park"], ["Pat Freeman"], ["Jennifer Widman"], ["Nick Caputo", "", "Nicholas Caputo"],
  ["Christine Bautista"], ["Crystal Hauser"], ["Maria Ratushinskaya"], ["Kim Kaiser", "", "Kim Keiser"],
  ["Kyle Anderson"], ["Lisa Johnston"], ["Jason Fairchild"], ["Irene Blue"], ["Ryan Leisure"],
  ["Robin Decries", "", "Robyn Rohrbacher"], ["Tanya Schermbeck"], ["Tom Nunley", "", "Thomas Nunley"],
  ["Jenna Blair"], ["Maya Deramus"], ["Cynthia Vandersnick", "", "Cindy Vandersnick"], ["Kathleen Macke"],
  ["Tyler Fry"], ["Monica Sullivan", "2025-11-20"], ["Burnadette", "", "Burnadette Rinker"],
  ["Taffy Herbert (Kathy)", "", "Kathy Herbert"], ["Christopher Brown"], ["Debbie Popovich"],
  ["Brooklyn Green"], ["Cynthia Crawford"], ["Makayla Taylor"], ["Cecilia Richardson", "2025-12-16"],
  ["Alan Bialy"], ["Brandi Bennington"], ["Gail Eckhart", "2025-12-23"], ["Robin Abele", "2025-12-23"],
  ["Rachel Adler"], ["Jordan Gregory"], ["Maxwell Sweeb"], ["Carrie Lynne (St Jean?)", "", "Carrie St Jean"],
  ["Sondra Pigeon"], ["Dennis Kotevski"], ["Missy/Heath Garlick", "", "Mary Garlick"], ["Kristen Doyle"],
  ["Jeremy Smith"], ["Joe Perkins"], ["Mz Dallas"], ["Kylee Orlando"],
  ["Michelle Koehn (Grundy)", "", "Michelle Grundy"], ["Barbie Sterling"], ["Lori Bridleman"],
  ["Nikole Landrum", "", "Karl Nikole Landrum"], ["Joyce Millimen"], ["Tina Allen"], ["Terri Moore"],
  ["Rick Montgomery"], ["Melanie Burns (Mel)", "", "Melanie Burns"], ["Charylann Leducnoller"],
  ["Moch", "", "Moch Mora"], ["Charlene Bettencourt", "2026-01-01"], ["Barbara Tipping"],
  ["Peggy Jones"], ["Patty Pope"], ["Greg Gladieux", "2026-02-01"], ["Danyelle Pierce"],
  ["Greg Straus"], ["Walter Krueger"], ["Shannon Cousino"], ["Raven Bechtold"],
  ["Marjorie Kowalewski"], ["Theressie Tillman", "", "Theressie Tilman"], ["Heather Folk"],
  ["Katie Hertzfeld"], ["Glenda Wiseman"], ["Bill Spindler", "", "", 4], ["Dorina Dickerson"],
  ["Diana Campbell"], ["Matt Kulwicki"], ["Austin Tyler"], ["Casey Rummel"], ["Allison Berry"],
  ["Katie Bierwiler"], ["Mark Hargrove"], ["Rebecca Miller"], ["Rachel Johnson"], ["Christina Estrada"],
  ["Robin Hall"], ["Natasha Wise"], ["Eric Pizza", "2027-03-01"], ["Steve Fahl", "", "Steve Fahle"],
  ["Alexa Perry"], ["Dan Acheson"], ["Brittany Allen"], ["Jenna Vargyas"], ["Barb Baker", "", "Barbara Richard Baker"],
  ["Andre Baker"], ["William Neil"], ["Ryan Fry"], ["Charlie Lover"], ["Brian Fowler"],
  ["Jennifer Gottwald"], ["Medium Rarity...?"], ["Gabrielle Mattimore"], ["Jeff Kasza"], ["Karen Franks"],
  ["Amanda Hensley", "", "Mandy Hensley"], ["Kendra Louy"], ["Dan Sommers"], ["Pedro Vasquez", "2026-03-15"],
  ["Trenton Smith", "", "Trent Smith"], ["Bree Reinhart"], ["Geri Buckley"], ["Karena Butcher"],
  ["Keith Kurtz"], ["Teresa Zielinski"], ["Victor Monroe"], ["Anita DeVaul"],
  ["Randy Zickenfoose", "", "Randall Zickefoose"], ["Mari Ness"], ["Michael Friess"],
  ["Stacey Pacholek", "", "Stacy Pacholek"], ["Cindy Smithers"], ["Matthew Collins"], ["Lee Warren"],
  ["Jessica King"], ["Angela Worley"], ["Bria Bostic"], ["Tatum Grace"], ["Shatara Brown"],
  ["Ishaney Simmons"], ["Lu Ann", "", "Lu Ann Fouts"], ["Megan Peterson"], ["Melissa Meehan"],
  ["Danielle Wright"], ["Amanda Wyman"], ["Barbara Seguine"], ["Tori Finch"],
  ["Jennifer/Jim Hansen", "", "Jim Hansen"], ["Camryn Camposano"], ["Todd Bortz"], ["Claire Whitlatch"],
  ["Kim McNerny", "", "Kim McNerney"], ["Teresa Scott"],
  ["Ryan Rothenbuler (reviewed by Amanda Myers)", "", "Ryan Rothenbuhler"],
].map(([reviewName, reviewDate = "", matchName = "", rating = null]) => ({ reviewName, reviewDate, matchName: matchName || reviewName, rating }));

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "");
}

function isCompleted(status) {
  return ["completed", "job:completed"].includes(String(status ?? "").toLowerCase());
}

function latest(a, b) {
  return String(a || "") > String(b || "") ? a : b;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error?.type || `Airtable request failed (${response.status})`);
  return data;
}

async function allRecords(tableId) {
  const records = [];
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const data = await request(url);
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return records;
}

const [schema, customers, jobs, oneTime, currentTracker] = await Promise.all([
  request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`),
  allRecords(SOURCE_TABLES.customers),
  allRecords(SOURCE_TABLES.jobs),
  allRecords(SOURCE_TABLES.oneTime),
  allRecords(SOURCE_TABLES.tracker),
]);

const people = new Map();
function person(name) {
  const normalized = normalize(name);
  if (!normalized) return null;
  if (!people.has(normalized)) people.set(normalized, { name: String(name).trim(), status: "", sngClientId: "", firstCompleted: "", lastCompleted: "", completedJobs: 0, recurring: false, oneTime: false, sources: new Set() });
  return people.get(normalized);
}

for (const record of customers) {
  const row = person(record.fields["Client Name"]);
  if (!row) continue;
  row.status = record.fields.Status || "";
  row.sngClientId = String(record.fields["SNG Client ID"] ?? "");
  row.recurring = Boolean(record.fields.Frequency || record.fields["Subscription Name"] || Number(record.fields["MRR ($)"]) > 0);
  row.sources.add("Customers");
}
for (const record of oneTime) {
  const row = person(record.fields["Client Name"]);
  if (!row) continue;
  row.oneTime = true;
  row.lastCompleted = latest(row.lastCompleted, record.fields["Last Invoice Date"] || record.fields["Onboarded Date"] || "");
  row.sources.add("One-Time Clients");
}
for (const record of jobs) {
  const row = person(record.fields["Customer Name"]);
  if (!row) continue;
  const service = normalize(record.fields["Service Type"]);
  if (service === "recurring") row.recurring = true;
  if (service === "onetime" || service === "initial") row.oneTime = true;
  if (isCompleted(record.fields.Status)) {
    const date = String(record.fields.Date || "");
    row.completedJobs += 1;
    row.firstCompleted = !row.firstCompleted || date < row.firstCompleted ? date : row.firstCompleted;
    row.lastCompleted = latest(row.lastCompleted, date);
  }
  row.sources.add("Daily Job Log");
}

const reviewByClient = new Map();
const matchedReviews = new Set();
for (const review of reviews) {
  const match = people.get(normalize(review.matchName));
  if (!match) continue;
  reviewByClient.set(normalize(match.name), review);
  matchedReviews.add(review.reviewName);
}

const cutoff = new Date();
cutoff.setUTCDate(cutoff.getUTCDate() - RECENT_DAYS);
const cutoffDate = cutoff.toISOString().slice(0, 10);
const currentByClient = new Map(currentTracker.map((record) => [normalize(record.fields["Client Name"]), record]));
const rows = [...people.values()].map((client) => {
  const review = reviewByClient.get(normalize(client.name));
  const current = currentByClient.get(normalize(client.name))?.fields || {};
  const reviewed = Boolean(review) || current["Google Review"] === "Reviewed";
  const clientType = client.recurring ? "Recurring" : "One-time";
  let priority = "No completed job";
  if (reviewed) priority = "Do not contact - reviewed";
  else if (clientType === "Recurring" && client.completedJobs) priority = "Future automation";
  else if (client.lastCompleted >= cutoffDate) priority = "Highlight - recent one-time";
  else if (client.completedJobs || client.lastCompleted) priority = "Do not contact - past one-time";
  return {
    fields: {
      "Client Name": client.name,
      "Client Type": clientType,
      "Customer Status": client.status || (client.completedJobs ? "Past" : "Unknown"),
      "Google Review": reviewed ? "Reviewed" : "Not reviewed",
      "Review Name": review?.reviewName || current["Review Name"] || "",
      "Review Date": review?.reviewDate || current["Review Date"] || undefined,
      "Review Rating": review?.rating || current["Review Rating"] || undefined,
      "Google Review Aliases": current["Google Review Aliases"] || undefined,
      "First Completed Job": client.firstCompleted || undefined,
      "Last Completed Job": client.lastCompleted || undefined,
      "Completed Jobs": client.completedJobs,
      "Follow-up Priority": priority,
      "SNG Client ID": client.sngClientId || "",
      "Source Records": [...client.sources].join(", "),
      "Review URL": REVIEW_URL,
      "Notes": review?.reviewName.includes("Amanda Myers") ? "Review was submitted by Amanda Myers because the client did not have a Google account." : current.Notes || "",
    },
  };
}).sort((a, b) => a.fields["Client Name"].localeCompare(b.fields["Client Name"]));

for (const review of reviews.filter((item) => !matchedReviews.has(item.reviewName))) {
  rows.push({ fields: {
    "Client Name": review.matchName,
    "Client Type": "Unmatched review",
    "Customer Status": "Needs matching",
    "Google Review": "Reviewed",
    "Review Name": review.reviewName,
    "Review Date": review.reviewDate || undefined,
    "Review Rating": review.rating || undefined,
    "Completed Jobs": 0,
    "Follow-up Priority": "Do not contact - reviewed",
    "Source Records": "Google Reviews PDF",
    "Review URL": REVIEW_URL,
    "Notes": "Review name did not match a current Airtable customer or job name; verify the client alias manually.",
  } });
}

const summary = {
  sourceClients: people.size,
  trackerRows: rows.length,
  reviewedClients: rows.filter((row) => row.fields["Google Review"] === "Reviewed" && row.fields["Client Type"] !== "Unmatched review").length,
  notReviewedClients: rows.filter((row) => row.fields["Google Review"] === "Not reviewed").length,
  recentOneTimeHighlights: rows.filter((row) => row.fields["Follow-up Priority"] === "Highlight - recent one-time").map((row) => ({ name: row.fields["Client Name"], lastCompleted: row.fields["Last Completed Job"] })),
  unmatchedReviewNames: rows.filter((row) => row.fields["Client Type"] === "Unmatched review").map((row) => row.fields["Review Name"]),
  cutoffDate,
};

if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

let tracker = schema.tables.find((table) => table.name === TRACKER_NAME);
if (!tracker) {
  tracker = await request(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: "POST",
    body: JSON.stringify({
      name: TRACKER_NAME,
      description: "All service clients reconciled to the owner-provided Google review list. Recent means completed within the trailing 30 days.",
      fields: [
        { name: "Client Name", type: "singleLineText" },
        { name: "Client Type", type: "singleSelect", options: { choices: ["Recurring", "One-time", "Unmatched review"].map((name) => ({ name })) } },
        { name: "Customer Status", type: "singleLineText" },
        { name: "Google Review", type: "singleSelect", options: { choices: [{ name: "Reviewed", color: "greenBright" }, { name: "Not reviewed", color: "grayBright" }] } },
        { name: "Review Name", type: "singleLineText" },
        { name: "Review Date", type: "date", options: { dateFormat: { name: "local" } } },
        { name: "Review Rating", type: "number", options: { precision: 0 } },
        { name: "First Completed Job", type: "date", options: { dateFormat: { name: "local" } } },
        { name: "Last Completed Job", type: "date", options: { dateFormat: { name: "local" } } },
        { name: "Completed Jobs", type: "number", options: { precision: 0 } },
        { name: "Follow-up Priority", type: "singleSelect", options: { choices: [
          { name: "Highlight - recent one-time", color: "yellowBright" }, { name: "Future automation", color: "blueBright" },
          { name: "Do not contact - reviewed", color: "greenBright" }, { name: "Do not contact - past one-time", color: "grayBright" },
          { name: "No completed job", color: "grayLight2" },
        ] } },
        { name: "SNG Client ID", type: "singleLineText" },
        { name: "Source Records", type: "singleLineText" },
        { name: "Review URL", type: "url" },
        { name: "Notes", type: "multilineText" },
      ],
    }),
  });
}

let upserted = 0;
for (let index = 0; index < rows.length; index += 10) {
  const batch = rows.slice(index, index + 10).map(({ fields }) => ({ fields: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) }));
  const result = await request(`https://api.airtable.com/v0/${BASE_ID}/${tracker.id}`, {
    method: "PATCH",
    body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ["Client Name"] }, records: batch, typecast: true }),
  });
  upserted += result.records?.length || 0;
}

console.log(JSON.stringify({ ...summary, tableId: tracker.id, upserted }, null, 2));
