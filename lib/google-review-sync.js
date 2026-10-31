import { matchGoogleReviews } from "./google-review-matching.mjs";
import { buildReviewTrackerRoster } from "./review-tracker-roster.mjs";
import { buildGoogleReviewAudit, saveGoogleReviewAudit, getGoogleReviewDecisions } from "./google-review-state.mjs";
import { withRecordLease, patchCockpitRecord } from "./admin-record-store.mjs";
import { runScheduledAirtableCockpitRefresh } from "./airtable";

const AIRTABLE_BASE_ID = "appcAWPBQB8GmOrcT";
const AIRTABLE_REVIEW_TABLE_ID = "tblzRg9DZKdIRQDrn";
const AIRTABLE_CUSTOMERS_TABLE_ID = "tblhi8MGUOsWNmd37";
const AIRTABLE_JOBS_TABLE_ID = "tbls15v5OYexAIULc";
const AIRTABLE_ONE_TIME_TABLE_ID = "tblGLypXMPxEZQb6B";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVIEWS_URL = "https://mybusiness.googleapis.com/v4";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REVIEW_PAGES = 20;
const MAX_AIRTABLE_PAGES = 10;
const MAX_AIRTABLE_SOURCE_PAGES = 300;
const SOURCE_FIELDS = {
  [AIRTABLE_CUSTOMERS_TABLE_ID]: ["Client Name", "Status", "SNG Client ID", "Frequency", "Subscription Name", "MRR ($)"],
  [AIRTABLE_JOBS_TABLE_ID]: ["Customer Name", "Status", "Date", "Service Type"],
  [AIRTABLE_ONE_TIME_TABLE_ID]: ["Client Name", "Last Invoice Date", "Onboarded Date"],
};

function googleConfigured(env) {
  return Boolean(
    env?.GOOGLE_BUSINESS_CLIENT_ID &&
    env?.GOOGLE_BUSINESS_CLIENT_SECRET &&
    env?.GOOGLE_BUSINESS_REFRESH_TOKEN &&
    env?.GOOGLE_BUSINESS_LOCATION
  );
}

function validateLocation(value) {
  const location = String(value ?? "").trim();
  if (!/^accounts\/[A-Za-z0-9_-]{1,100}\/locations\/[A-Za-z0-9_-]{1,100}$/.test(location)) {
    throw new Error("GOOGLE_BUSINESS_LOCATION must use accounts/{accountId}/locations/{locationId}.");
  }
  return location;
}

async function boundedJson(response, label) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error(`${label} response was too large.`);
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${label} response was too large.`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!bytes) return {};
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function googleAccessToken(env) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: String(env.GOOGLE_BUSINESS_CLIENT_ID),
      client_secret: String(env.GOOGLE_BUSINESS_CLIENT_SECRET),
      refresh_token: String(env.GOOGLE_BUSINESS_REFRESH_TOKEN),
      grant_type: "refresh_token",
    }),
  });
  const data = await boundedJson(response, "Google OAuth");
  if (!response.ok || !data.access_token) throw new Error(`Google OAuth failed (${response.status}). Reauthorize the Business Profile connection.`);
  return String(data.access_token);
}

async function googleReviews(env, accessToken) {
  const location = validateLocation(env.GOOGLE_BUSINESS_LOCATION);
  const reviews = [];
  let pageToken = "";
  for (let page = 0; page < MAX_REVIEW_PAGES; page += 1) {
    const url = new URL(`${GOOGLE_REVIEWS_URL}/${location}/reviews`);
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("orderBy", "updateTime desc");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const data = await boundedJson(response, "Google reviews");
    if (!response.ok) throw new Error(`Google reviews request failed (${response.status}).`);
    reviews.push(...(Array.isArray(data.reviews) ? data.reviews.slice(0, 50) : []));
    pageToken = String(data.nextPageToken ?? "");
    if (!pageToken) return reviews;
  }
  throw new Error("Google reviews exceeded the configured pagination limit.");
}

async function airtableRecords(env, tableId, maxPages = MAX_AIRTABLE_PAGES) {
  const records = [];
  let offset = "";
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    for (const field of SOURCE_FIELDS[tableId] || []) url.searchParams.append("fields[]", field);
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: "application/json" } });
    const data = await boundedJson(response, "Airtable records");
    if (!response.ok) throw new Error(`Airtable records read failed (${response.status}).`);
    records.push(...(Array.isArray(data.records) ? data.records.slice(0, 100) : []));
    offset = String(data.offset ?? "");
    if (!offset) return records;
    await new Promise((resolve) => setTimeout(resolve, 225));
  }
  throw new Error("Airtable records exceeded the configured pagination limit.");
}

async function writeAirtableRecords(env, method, records, label) {
  let written = 0;
  for (let index = 0; index < records.length; index += 10) {
    let completed = false;
    for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
      const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_REVIEW_TABLE_ID}`, {
        signal: AbortSignal.timeout(15000),
        method,
        headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ records: records.slice(index, index + 10), typecast: false }),
      });
      if (response.status === 429 && attempt < 2) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      const data = await boundedJson(response, label);
      if (!response.ok) throw new Error(`${label} failed (${response.status}).`);
      written += Array.isArray(data.records) ? data.records.length : 0;
      completed = true;
    }
    if (index + 10 < records.length) await new Promise((resolve) => setTimeout(resolve, 225));
  }
  return written;
}

async function syncReviewRoster(env, tracker) {
  // Keep this sequential so the roster itself stays below Airtable's per-base request rate.
  const customers = await airtableRecords(env, AIRTABLE_CUSTOMERS_TABLE_ID, MAX_AIRTABLE_SOURCE_PAGES);
  const jobs = await airtableRecords(env, AIRTABLE_JOBS_TABLE_ID, MAX_AIRTABLE_SOURCE_PAGES);
  const oneTime = await airtableRecords(env, AIRTABLE_ONE_TIME_TABLE_ID, MAX_AIRTABLE_SOURCE_PAGES);
  const roster = buildReviewTrackerRoster({ customers, jobs, oneTime, tracker });
  const updated = await writeAirtableRecords(env, "PATCH", roster.updates, "Airtable review roster update");
  const created = await writeAirtableRecords(env, "POST", roster.creates, "Airtable review roster create");
  return { ...roster, updated, created };
}

async function updateAirtableMatches(env, matches) {
  const changed = matches.filter((match) => Object.keys(match.fields ?? {}).length);
  return writeAirtableRecords(env, "PATCH", changed.map((match) => ({ id: match.record.id, fields: match.fields })), "Airtable review update");
}

async function recordSyncRun(env, { id, status, recordsProcessed = 0, error = null }) {
  if (!env?.DB) return;
  await env.DB.prepare(
    `INSERT INTO system_sync_runs (id,sync_name,status,snapshot_date,records_processed,error,completed_at)
     VALUES (?,'google_reviews',?,date('now'),?,?,CURRENT_TIMESTAMP)`
  ).bind(id, status, recordsProcessed, error ? String(error).slice(0, 500) : null).run();
}

export async function readGoogleReviewTracker(env) { return airtableRecords(env,AIRTABLE_REVIEW_TABLE_ID); }

export async function runScheduledGoogleReviewSync(env,options={}) {
  return withRecordLease(env.DB,'google-reviews',()=>runGoogleReviewSync(env,options),900000);
}

async function runGoogleReviewSync(env,{refreshRoster=true}={}) {
  const id = crypto.randomUUID();
  if (!env?.AIRTABLE_API_KEY) {
    await recordSyncRun(env, { id, status: "skipped", error: "Airtable is not configured." });
    return { configured: false, status: "skipped", reviews: 0, matched: 0, updated: 0, rosterUpdated: 0, rosterCreated: 0, unmatched: 0, ambiguous: 0 };
  }
  try {
    const initialRecords = await airtableRecords(env, AIRTABLE_REVIEW_TABLE_ID);
    let roster;
    let rosterError;
    try { roster = refreshRoster ? await syncReviewRoster(env, initialRecords) : {updated:0,created:0,sourceClients:0}; }
    catch (error) { rosterError = error; roster = { updated: 0, created: 0, sourceClients: 0 }; }
    if (!googleConfigured(env)) {
      if (rosterError) throw rosterError;
      const summary = { configured: false, status: "roster_only", reviews: 0, matched: 0, updated: 0, rosterUpdated: roster.updated, rosterCreated: roster.created, unmatched: 0, ambiguous: 0 };
      await recordSyncRun(env, { id, status: "roster_only", recordsProcessed: roster.sourceClients, error: "Google Business Profile authorization is not configured. New Google reviews are not being checked." });
      console.log(JSON.stringify({ event: "google_review_roster_sync", ...summary }));
      return summary;
    }
    const accessToken = await googleAccessToken(env);
    const reviews = await googleReviews(env, accessToken);
    const records = await airtableRecords(env, AIRTABLE_REVIEW_TABLE_ID);
    const decisions=await getGoogleReviewDecisions(env.DB);
    const result = matchGoogleReviews(records, reviews, decisions.reviews);
    const updated = await updateAirtableMatches(env, result.matches);
    for (const match of result.matches) {
      if (!Object.keys(match.fields).length) continue;
      match.record.fields={...match.record.fields,...match.fields};
      await patchCockpitRecord(env.DB,AIRTABLE_REVIEW_TABLE_ID,{id:match.record.id,fields:match.fields});
    }
    await saveGoogleReviewAudit(env.DB, buildGoogleReviewAudit(records, reviews, result));
    const summary = { configured: true, status: "success", reviews: reviews.length, matched: result.matches.length, updated, rosterUpdated: roster.updated, rosterCreated: roster.created, unmatched: result.unmatched.length, ambiguous: result.ambiguous.length };
    if (rosterError) throw new Error("Google reviews reconciled, but the customer roster refresh failed. Inspect the roster source and retry.");
    await recordSyncRun(env, { id, status: "success", recordsProcessed: reviews.length });
    console.log(JSON.stringify({ event: "google_review_sync", ...summary }));
    return summary;
  } catch (error) {
    await recordSyncRun(env, { id, status: "failed", error });
    console.error(JSON.stringify({ event: "google_review_sync_failed", message: String(error) }));
    throw error;
  }
}

export async function runScheduledReviewPipeline(env) {
  let syncResult;
  let syncError;
  try {
    syncResult = await runScheduledGoogleReviewSync(env);
  } catch (error) {
    syncError = error;
  }
  const cockpit = await runScheduledAirtableCockpitRefresh(env);
  if (syncError) throw syncError;
  return { sync: syncResult, cockpit };
}
