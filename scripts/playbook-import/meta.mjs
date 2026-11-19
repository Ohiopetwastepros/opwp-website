import fs from "node:fs";
import { args, assertDryRun, loadEnv, outputFolder, privateHasher, writeReport, jsonlWriter, graphPages, redactPlaybookText, clearSourceDatasets, isMain } from "./common.mjs";
export const REQUIRED_META_PERMISSIONS = { meta_leadgen: ["leads_retrieval", "pages_read_engagement"], meta_messenger: ["pages_messaging", "pages_read_engagement", "pages_manage_metadata"], meta_instagram: ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"] };
export async function importMeta(options = {}, dependencies = {}) {
  assertDryRun(options);
  const folder = outputFolder(options.output), env = dependencies.env || loadEnv(options.env);
  clearSourceDatasets(folder, Object.keys(REQUIRED_META_PERMISSIONS));
  const report = { source: "meta", status: "skipped", reason: "META_PAGE_ACCESS_TOKEN unavailable locally", permissions: { status: "not_checked", granted: [], missing: [], unknown: Object.values(REQUIRED_META_PERMISSIONS).flat().filter((value, index, all) => all.indexOf(value) === index) }, sources: {}, tokens: 0 };
  for (const kind of Object.keys(REQUIRED_META_PERMISSIONS)) report.sources[kind] = { threads: 0, kept: 0, excluded: 0, turns: 0, reasons: {}, complete: false };
  if (!env.META_PAGE_ACCESS_TOKEN) { writeReport(folder, "meta", report); return report; }
  const version = env.META_GRAPH_API_VERSION;
  if (!/^v\d{1,2}\.\d$/.test(version || "")) { report.reason = "META_GRAPH_API_VERSION unavailable or invalid"; writeReport(folder, "meta", report); return report; }
  const api = { authorization: `Bearer ${env.META_PAGE_ACCESS_TOKEN}`, ...dependencies.api }, hash = privateHasher(folder);
  const manualMessageIds = new Set(options["manual-meta-messages"] ? JSON.parse(fs.readFileSync(options["manual-meta-messages"], "utf8")) : []);
  report.status = "complete"; delete report.reason;
  try {
    const granted = [];
    for await (const rows of graphPages(`/${version}/me/permissions`, {}, api)) for (const permission of rows) if (permission.status === "granted") granted.push(permission.permission);
    report.permissions = { status: "checked", granted, missing: Object.values(REQUIRED_META_PERMISSIONS).flat().filter((value, index, all) => all.indexOf(value) === index && !granted.includes(value)), unknown: [] };
  } catch (error) { report.permissions.status = `check_failed_${error.status || "read"}`; report.status = "partial"; }
  const pageIds = String(options.pages || env.META_ALLOWED_PAGE_IDS || "").split(",").filter(value => /^\d+$/.test(value));
  const formIds = String(options.forms || env.META_LEAD_FORM_IDS || "").split(",").filter(value => /^\d+$/.test(value));
  const formWrite = jsonlWriter(folder, "meta_leadgen"), formCounts = report.sources.meta_leadgen;
  if (!formIds.length) { formCounts.reasons.form_ids_not_configured = 1; report.status = "partial"; }
  else try {
    for (const id of formIds) for await (const rows of graphPages(`/${version}/${id}/leads`, { fields: "id,created_time,field_data", limit: 100 }, api)) for (const lead of rows) {
      formCounts.threads += 1; formCounts.kept += 1;
      const fields = lead.field_data || [], names = fields.filter(row => /name/.test(row.name)).flatMap(row => row.values || []);
      // Lead form identity fields become placeholders, never persisted as raw slots.
      const body = fields.map(row => `${row.name}: ${/name|email|phone|address|street/i.test(row.name) ? "[REDACTED]" : (row.values || []).join(", ")}`).join("\n");
      formWrite({ id: hash("meta-lead:" + lead.id), thread_id: hash("meta-lead:" + lead.id), source: "meta_leadgen", external_ref_hash: hash(lead.id), channel: "leadgen", author: "lead", direction: "inbound", body_redacted: redactPlaybookText(body, { names }), created_at: lead.created_time, slots_json: {}, outcome: "unknown" });
      formCounts.turns += 1;
      if (!formCounts.oldest || lead.created_time < formCounts.oldest) formCounts.oldest = lead.created_time;
      if (!formCounts.newest || lead.created_time > formCounts.newest) formCounts.newest = lead.created_time;
    }
    formCounts.complete = true;
  } catch (error) { formCounts.error = `provider_http_${error.status || "read_failed"}`; report.status = "partial"; }
  for (const [platform, kind] of [["messenger", "meta_messenger"], ["instagram", "meta_instagram"]]) {
    const counts = report.sources[kind], write = jsonlWriter(folder, kind), seen = new Set();
    if (!pageIds.length) { counts.reasons.page_ids_not_configured = 1; report.status = "partial"; continue; }
    if (report.permissions.status === "checked" && REQUIRED_META_PERMISSIONS[kind].some(permission => !report.permissions.granted.includes(permission))) { counts.reasons.required_permissions_missing = 1; report.status = "partial"; continue; }
    try {
      for (const pageId of pageIds) for await (const conversations of graphPages(`/${version}/${pageId}/conversations`, { platform, fields: "id,participants", limit: 100 }, api)) for (const conversation of conversations) {
        if (seen.has(conversation.id)) continue; seen.add(conversation.id); counts.threads += 1;
        const participants = conversation.participants?.data || [], names = participants.map(person => person.name || person.username).filter(Boolean), businessIds = new Set([pageId, env.META_INSTAGRAM_ACCOUNT_ID].filter(Boolean));
        const threadId = hash(kind + ":" + conversation.id), turnSeen = new Set();
        // The messages edge is paginated separately; a nested field alone can silently truncate.
        for await (const messages of graphPages(`/${version}/${encodeURIComponent(conversation.id)}/messages`, { fields: "id,message,from,to,created_time", limit: 100 }, api)) for (const message of messages) {
          if (turnSeen.has(message.id)) continue; turnSeen.add(message.id);
          const outgoing = businessIds.has(String(message.from?.id));
          write({ id: hash(message.id), thread_id: threadId, source: kind, external_ref_hash: hash(conversation.id), channel: platform, author: outgoing ? manualMessageIds.has(message.id) ? "craig" : "sona" : "lead", direction: outgoing ? "outbound" : "inbound", body_redacted: redactPlaybookText(message.message, { names: [...names, message.from?.name].filter(Boolean) }), created_at: message.created_time, slots_json: {}, outcome: "unknown" }); counts.turns += 1;
        }
        counts.kept += 1;
      }
      counts.complete = true;
    } catch (error) { counts.error = `provider_http_${error.status || "read_failed"}`; report.status = "partial"; }
  }
  report.coverageNote = "Counts describe API-visible history only. Meta can limit retained lead forms and Instagram messages; an empty API result does not prove no historical conversations.";
  report.authorshipNote = "A business Page/IG sender ID does not prove a human wrote the message. Only owner-verified message IDs from --manual-meta-messages become Craig examples; other outgoing turns are quarantined as sona.";
  writeReport(folder, "meta", report); return report;
}
if (isMain(import.meta.url)) importMeta(args()).then(report => console.log(JSON.stringify(report))).catch(() => { console.error("Meta dry-run import failed; no sends or production writes were attempted."); process.exitCode = 1; });
