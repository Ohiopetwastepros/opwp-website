import { readBoundedProviderJson } from "./bounded-body.mjs";
import { isCraigMetaTest } from "./lead-rollout-policy.mjs";

const ORIGIN = "https://api.airtable.com/v0";
const BASE = "appcAWPBQB8GmOrcT";
export const AIRTABLE_TEXT_SAFETY_TABLES = ["tblhi8MGUOsWNmd37", "tblxniDSLBZdba6Z7"];
const STATUSES = ["OK", "Asked to stop", "Opted out in Quo", "Text failed", "No reply"];
const BLOCKED = new Set(["Asked to stop", "Opted out in Quo", "Text failed"]);
const MAX_PAGES = 10;

class SafetyError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function phoneNumber(value) {
  if (typeof value !== "string" || !/^[+\d().\s-]{10,40}$/.test(value)) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? `+${digits}` : "";
}

function config(env) {
  if (!env?.AIRTABLE_API_KEY || typeof env.AIRTABLE_API_KEY !== "string") throw new SafetyError("airtable_auth_unavailable");
  if ((env.AIRTABLE_BASE_ID || BASE) !== BASE) throw new SafetyError("airtable_base_mismatch");
  return { key: env.AIRTABLE_API_KEY, base: BASE };
}

async function request(configured, url, fetcher, options = {}) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      method: options.method || "GET",
      headers: { Authorization: `Bearer ${configured.key}`, Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new SafetyError("airtable_request_unavailable"); }
  if (!response?.ok) throw new SafetyError(response?.status === 401 || response?.status === 403 ? "airtable_auth_unavailable" : "airtable_request_unavailable");
  try { return await readBoundedProviderJson(response, 1024 * 1024); }
  catch { throw new SafetyError("airtable_response_unverified"); }
}

function tableSchema(table, id) {
  if (!table || !Array.isArray(table.fields)) throw new SafetyError("airtable_schema_unknown");
  const find = (name, type) => {
    const fields = table.fields.filter((field) => field.name === name);
    if (fields.length !== 1 || fields[0].type !== type || !/^fld[A-Za-z0-9]{14}$/.test(fields[0].id || "")) throw new SafetyError("airtable_schema_unknown");
    return fields[0];
  };
  const phone = find("Phone", "phoneNumber");
  const blocked = find("Do Not Text", "checkbox");
  const status = find("Text Status", "singleSelect");
  const choices = status.options?.choices;
  if (!Array.isArray(choices) || !STATUSES.every((name) => choices.some((choice) => choice.name === name))) throw new SafetyError("airtable_schema_unknown");
  const noteFields = table.fields.filter((field) => field.name === "Text Status Notes");
  if (noteFields.length > 1 || (noteFields.length && (noteFields[0].type !== "multilineText" || !/^fld[A-Za-z0-9]{14}$/.test(noteFields[0].id || "")))) throw new SafetyError("airtable_schema_unknown");
  return { tableId: id, phoneId: phone.id, blockedId: blocked.id, statusId: status.id, notesId: noteFields[0]?.id || null };
}

function projectRecord(row, schema, phone) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(row?.id || "") || !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) throw new SafetyError("airtable_record_unverified");
  const fields = row.fields;
  if (phoneNumber(fields[schema.phoneId]) !== phone) throw new SafetyError("airtable_phone_match_unverified");
  if (fields[schema.blockedId] !== undefined && typeof fields[schema.blockedId] !== "boolean") throw new SafetyError("airtable_record_unverified");
  const status = fields[schema.statusId] ?? "";
  if (typeof status !== "string" || (status && !STATUSES.includes(status))) throw new SafetyError("airtable_record_unverified");
  const notes = schema.notesId ? fields[schema.notesId] ?? "" : "";
  if (typeof notes !== "string") throw new SafetyError("airtable_record_unverified");
  return { ...schema, id: row.id, doNotText: fields[schema.blockedId] === true || BLOCKED.has(status), status, notes };
}

function recordUrl(configured, schema, id = "") {
  const url = new URL(`${ORIGIN}/${configured.base}/${schema.tableId}${id ? `/${id}` : ""}`);
  url.searchParams.set("returnFieldsByFieldId", "true");
  if (!id) for (const field of [schema.phoneId, schema.blockedId, schema.statusId, schema.notesId].filter(Boolean)) url.searchParams.append("fields[]", field);
  return url;
}

async function matchingRecords(configured, schema, phone, fetcher) {
  const records = [], seenOffsets = new Set(), seenIds = new Set();
  let offset;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = recordUrl(configured, schema);
      const digits = phone.slice(1);
      url.searchParams.set("filterByFormula", `OR(REGEX_REPLACE({Phone}&"","[^0-9]","")="${digits}",REGEX_REPLACE({Phone}&"","[^0-9]","")="${digits.slice(1)}")`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);
      const data = await request(configured, url, fetcher);
      if (!Array.isArray(data?.records) || data.records.length > 100) throw new SafetyError("airtable_response_unverified");
      for (const row of data.records) {
        const record = projectRecord(row, schema, phone);
        if (seenIds.has(record.id)) throw new SafetyError("airtable_pagination_incomplete");
        seenIds.add(record.id); records.push(record);
      }
      if (data.offset === undefined) return { verified: true, records, reason: "" };
      if (typeof data.offset !== "string" || !data.offset || data.offset.length > 512 || seenOffsets.has(data.offset)) throw new SafetyError("airtable_pagination_incomplete");
      seenOffsets.add(data.offset); offset = data.offset;
    }
    throw new SafetyError("airtable_pagination_incomplete");
  } catch (error) { return { verified: false, records, reason: error.reason || "airtable_request_unavailable" }; }
}

export async function readAirtableTextSafety(env, value, { fetcher = fetch, now = new Date() } = {}) {
  const records = [];
  let checkedAt = null;
  try {
    const date = new Date(now);
    if (!Number.isFinite(date.getTime())) throw new SafetyError("airtable_safety_date_invalid");
    checkedAt = date.toISOString();
    const phone = phoneNumber(value);
    if (!phone) throw new SafetyError("airtable_phone_invalid");
    const configured = config(env);
    const metadata = await request(configured, `${ORIGIN}/meta/bases/${configured.base}/tables`, fetcher);
    if (!Array.isArray(metadata?.tables)) throw new SafetyError("airtable_schema_unknown");
    const results = await Promise.all(AIRTABLE_TEXT_SAFETY_TABLES.map(async (id) => {
      try {
        const matches = metadata.tables.filter((table) => table.id === id);
        if (matches.length !== 1) throw new SafetyError("airtable_schema_unknown");
        return await matchingRecords(configured, tableSchema(matches[0], id), phone, fetcher);
      } catch (error) { return { verified: false, records: [], reason: error.reason || "airtable_schema_unknown" }; }
    }));
    for (const result of results) records.push(...result.records);
    const failures = [...new Set(results.filter((result) => !result.verified).map((result) => result.reason))];
    const verified = failures.length === 0;
    const blocked = records.some((record) => record.doNotText);
    return { verified, doNotText: !verified || blocked, records, reason: failures[0] || (blocked ? "airtable_do_not_text" : "airtable_verified"), reasons: failures, checkedAt };
  } catch (error) {
    return { verified: false, doNotText: true, records, reason: error.reason || "airtable_safety_unavailable", reasons: [error.reason || "airtable_safety_unavailable"], checkedAt };
  }
}

export async function syncAirtableTextStatus(env, { phone: value, doNotText, status, note = "", at = new Date(), eventId = "" } = {}, { fetcher = fetch } = {}) {
  const updated = [], reasons = [];
  try {
    const phone = phoneNumber(value);
    if (!phone) throw new SafetyError("airtable_phone_invalid");
    if (typeof doNotText !== "boolean" || !STATUSES.includes(status) || typeof note !== "string" || note.length > 2000 || (eventId && !/^[A-Za-z0-9:_-]{1,160}$/.test(eventId))) throw new SafetyError("airtable_status_invalid");
    const date = new Date(at);
    if (!Number.isFinite(date.getTime())) throw new SafetyError("airtable_status_date_invalid");
    const configured = config(env);
    const safety = await readAirtableTextSafety(env, phone, { fetcher, now: date });
    if (!safety.verified) reasons.push(...safety.reasons);
    // Test replies still read Customers as a safety authority, but the owner's
    // real customer record is never a write target for the controlled Meta test.
    const metaTestOnly = isCraigMetaTest(env, phone);
    const targets = metaTestOnly ? safety.records.filter(record => record.tableId === AIRTABLE_TEXT_SAFETY_TABLES[1]) : safety.records;
    if (!targets.length) reasons.push("airtable_contact_not_found");
    for (const record of targets) {
      try {
        // Refresh immediately before PATCH to preserve existing notes and opt-outs.
        const fresh = projectRecord(await request(configured, recordUrl(configured, record, record.id), fetcher), record, phone);
        const blocked = fresh.doNotText || doNotText || BLOCKED.has(status);
        const nextStatus = fresh.doNotText && !BLOCKED.has(status) ? fresh.status || "Asked to stop" : status;
        const fields = { [record.blockedId]: blocked, [record.statusId]: nextStatus };
        const marker = eventId ? `[event:${eventId}]` : "";
        const line = `${date.toISOString()} ${note.replace(/[\r\n]+/g, " ").trim()}${marker ? ` ${marker}` : ""}`.trim();
        let noteIssue = "";
        if (!record.notesId) noteIssue = "airtable_text_status_notes_missing";
        else if (!note.trim()) noteIssue = "airtable_text_status_note_missing";
        else if (!(marker && fresh.notes.includes(marker)) && !fresh.notes.split(/\r?\n/).includes(line)) {
          const appended = `${fresh.notes}${fresh.notes ? "\n" : ""}${line}`;
          if (appended.length > 95000) noteIssue = "airtable_text_status_notes_capacity";
          else fields[record.notesId] = appended;
        }
        // Existing IDs only. Never upsert, create, or alter an Airtable field.
        const url = `${ORIGIN}/${configured.base}/${record.tableId}/${record.id}`;
        const patched = await request(configured, url, fetcher, { method: "PATCH", body: JSON.stringify({ fields, typecast: false }) });
        if (patched?.id !== record.id) throw new SafetyError("airtable_write_unverified");
        updated.push({ tableId: record.tableId, id: record.id });
        const readback = await request(configured, recordUrl(configured, record, record.id), fetcher);
        const verified = projectRecord(readback, record, phone);
        if ((readback.fields[record.blockedId] ?? false) !== blocked || verified.doNotText !== blocked || verified.status !== nextStatus || (Object.hasOwn(fields, record.notesId) && verified.notes !== fields[record.notesId])) throw new SafetyError("airtable_write_unverified");
        if (noteIssue) reasons.push(noteIssue);
      } catch (error) { reasons.push(error.reason || "airtable_write_unverified"); }
    }
    const unique = [...new Set(reasons)];
    return { verified: unique.length === 0 && updated.length === targets.length, partial: updated.length > 0 && unique.length > 0, records: updated, reason: unique[0] || "airtable_status_verified", reasons: unique,
      ...(metaTestOnly ? {scope: "meta_leads_test_only"} : {}) };
  } catch (error) {
    const reason = error.reason || "airtable_status_unavailable";
    return { verified: false, partial: updated.length > 0, records: updated, reason, reasons: [...new Set([...reasons, reason])] };
  }
}
