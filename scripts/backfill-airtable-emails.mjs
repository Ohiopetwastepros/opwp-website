// Fill blank Customers Phone and Email values from active Sweep & Go clients.
// Airtable field names: Phone (fld6ZCwqkM4KOK1oA) and Email (fldvPD16o3KFGl9gS).
// This script does not create fields and never replaces a phone or email that
// is already stored. Clients who are not on the Sweep & Go active list are skipped.
//
//   node scripts/backfill-airtable-emails.mjs
//   node scripts/backfill-airtable-emails.mjs --dry-run
//   node scripts/backfill-airtable-emails.mjs --apply
//
// AIRTABLE_API_KEY and SNG_API_KEY are read from the environment. When either
// one is unset, the same name is read from .dev.vars. The values are never printed.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { indexSngClients, parseContactBackfillArgs, planCustomerContactBackfill } from "../lib/sng-client-email.mjs";

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_BASE_ID = "appcAWPBQB8GmOrcT";
const AIRTABLE_CUSTOMERS_TABLE = "tblhi8MGUOsWNmd37";
const SNG_BASE_URL = "https://openapi.sweepandgo.com";
const SNG_ACTIVE_CLIENTS = "/api/v1/clients/active";
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeProviderMessage(status, data) {
  const raw = data?.error?.message || data?.error?.type || (typeof data?.message === "string" ? data.message : "") || (typeof data?.error === "string" ? data.error : "");
  const message = String(raw || "").replace(/bearer\s+\S+/gi, "bearer [redacted]").replace(/\bpat[A-Za-z0-9]{10,}\b/g, "[redacted]").slice(0, 180);
  if (/api[_-]?key|token|secret|authorization/i.test(message)) return `request failed (${status})`;
  return message ? `${message} (${status})` : `request failed (${status})`;
}

async function credential(name) {
  const fromEnv = String(process.env[name] || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const source = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
    const match = source.match(new RegExp(`^${name}\\s*=\\s*["']?([^\\r\\n"']+)["']?\\s*$`, "m"));
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

async function requestJson(url, options, label) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    lastStatus = response.status;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 3) {
      const message = safeProviderMessage(response.status, data);
      if (label === "Airtable" && /unknown field name/i.test(message) && /email/i.test(message)) {
        throw new Error("Airtable Customers is missing the Email field (fldvPD16o3KFGl9gS). The field name is Email and the type is email.");
      }
      if (label === "Airtable" && /unknown field name/i.test(message) && /phone/i.test(message)) {
        throw new Error("Airtable Customers is missing the Phone field (fld6ZCwqkM4KOK1oA). The field name is Phone.");
      }
      throw new Error(`${label} ${message}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 300 * (2 ** (attempt - 1)));
  }
  throw new Error(`${label} request failed (${lastStatus}).`);
}

function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  return null;
}

function totalPages(data) {
  const value = data?.paginate?.total_pages ?? data?.pagination?.total_pages ?? data?.meta?.last_page ?? data?.last_page;
  return value == null ? null : Number(value);
}

async function airtableCustomers(apiKey) {
  const records = [];
  let offset = "";
  const seen = new Set();
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    for (const field of ["Client Name", "SNG Client ID", "Phone", "Email"]) params.append("fields[]", field);
    if (offset) params.set("offset", offset);
    const page = await requestJson(`${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${AIRTABLE_CUSTOMERS_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    }, "Airtable");
    records.push(...(page.records ?? []));
    offset = page.offset || "";
    if (offset && seen.has(offset)) throw new Error("Airtable pagination repeated a page.");
    if (offset) seen.add(offset);
    if (seen.size > 100) throw new Error("Airtable pagination exceeded its limit.");
  } while (offset);
  return records;
}

async function sngClientPages(path, apiKey) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const url = new URL(path, SNG_BASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("length", "50");
    const data = await requestJson(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    }, "Sweep & Go");
    const pageRows = rowsFrom(data);
    if (!pageRows) throw new Error(`Sweep & Go ${path} returned an unexpected client list.`);
    rows.push(...pageRows);
    const total = totalPages(data);
    if (total !== null) {
      if (!Number.isInteger(total) || total < page || total > 50 || (!pageRows.length && page < total)) {
        throw new Error(`Sweep & Go ${path} pagination is incomplete.`);
      }
      if (page === total) return rows;
    } else if (pageRows.length < 50) return rows;
  }
  throw new Error(`Sweep & Go ${path} pagination exceeded its limit.`);
}

async function loadActiveSngClients(apiKey) {
  return indexSngClients(await sngClientPages(SNG_ACTIVE_CLIENTS, apiKey));
}

function contactFields(fields) {
  const next = {};
  if (fields.Phone) next.Phone = fields.Phone;
  if (fields.Email) next.Email = fields.Email;
  return next;
}

async function writeContacts(apiKey, updates) {
  for (let index = 0; index < updates.length; index += 10) {
    const records = updates.slice(index, index + 10).map((update) => ({ id: update.id, fields: contactFields(update.fields) }));
    await requestJson(`${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${AIRTABLE_CUSTOMERS_TABLE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ records, typecast: true }),
    }, "Airtable");
  }
}

async function main() {
  const mode = parseContactBackfillArgs(process.argv.slice(2));
  const airtableKey = await credential("AIRTABLE_API_KEY");
  const sngKey = await credential("SNG_API_KEY");
  if (!airtableKey) throw new Error("AIRTABLE_API_KEY is not set.");
  if (!sngKey) throw new Error("SNG_API_KEY is not set.");

  const records = await airtableCustomers(airtableKey);
  const clientsById = await loadActiveSngClients(sngKey);
  const plan = planCustomerContactBackfill(records, clientsById);
  console.log(JSON.stringify({
    mode: mode.apply ? "apply" : "dry-run",
    source: SNG_ACTIVE_CLIENTS,
    ...plan.summary,
    unmatchedSample: plan.unmatchedIds.slice(0, 20),
  }));
  for (const update of plan.updates) {
    console.log(JSON.stringify({
      action: mode.apply ? "update" : "would-update",
      recordId: update.id,
      clientName: update.clientName,
      sngClientId: update.sngClientId,
      phone: update.fields.Phone || undefined,
      email: update.fields.Email || undefined,
    }));
  }
  if (!mode.apply) {
    console.log(JSON.stringify({ wrote: false, message: "Dry-run only. Re-run with --apply to write blank Phone and Email fields." }));
    return;
  }
  await writeContacts(airtableKey, plan.updates);
  console.log(JSON.stringify({ wrote: true, updated: plan.updates.length }));
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Customer contact backfill failed.");
    process.exitCode = 1;
  });
}
