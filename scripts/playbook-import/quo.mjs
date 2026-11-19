import { classifyQuoLeadIntent } from "../../lib/quo-lead-intake.mjs";
import { args, assertDryRun, loadEnv, outputFolder, privateHasher, phoneKey, readIdentityIndex, writeReport, jsonlWriter, quoPages, redactPlaybookText, clearSourceDatasets, isMain } from "./common.mjs";

export const QUO_SOURCES = [{ kind: "quo_2371", envKey: "QUO_BUSINESS_PHONE_NUMBER_ID" }, { kind: "quo_7970", envKey: "QUO_INDUSTRY_PHONE_NUMBER_ID" }];
export function resolveImportAuthor(message, { humanIds = [], sonaIds = [], backendIds = [] } = {}) {
  if (message.direction === "incoming") return "lead";
  const ids = [message.userId, message.createdBy?.id, message.createdByUserId, typeof message.createdBy === "string" ? message.createdBy : null].filter(value => typeof value === "string");
  const types = [message.createdBy?.type, message.authorType, message.author?.type, message.source].filter(value => typeof value === "string");
  if (ids.some(id => sonaIds.includes(id)) || types.some(type => /sona|ai_agent|assistant|^ai$|^automation$/i.test(type))) return "sona";
  if (backendIds.includes(message.id)) return "backend";
  return ids.some(id => humanIds.includes(id)) ? "craig" : "sona";
}
export function threadClassification(participants, messages, identities) {
  const people = participants.map(phone => identities.get(phoneKey(phone))).filter(Boolean);
  if (people.some(person => person.kind === "staff")) return { keep: false, category: "staff", reason: "staff_directory_match" };
  if (people.some(person => person.kind === "vendors")) return { keep: false, category: "vendor", reason: "vendor_directory_match" };
  if (participants.length !== 1) return { keep: false, category: "other", reason: "group_thread_requires_manual_review" };
  const incoming = messages.filter(message => message.direction === "incoming").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const sales = incoming.some(message => classifyQuoLeadIntent(message.text).eligible);
  if (people.some(person => person.kind === "customers")) return { keep: sales, category: sales ? "existing_customer_sales" : "existing_customer", reason: sales ? "customer_directory_and_sales_intent" : "existing_customer_without_sales_intent" };
  if (people.some(person => person.kind === "leads")) return { keep: true, category: "lead", reason: "submission_directory_match" };
  if (incoming[0] && classifyQuoLeadIntent(incoming[0].text).eligible) return { keep: true, category: "lead", reason: "first_inbound_sales_intent" };
  return { keep: false, category: "other", reason: "no_positive_sales_match" };
}

export async function importQuo(options = {}, dependencies = {}) {
  assertDryRun(options);
  const folder = outputFolder(options.output), env = dependencies.env || loadEnv(options.env);
  clearSourceDatasets(folder, QUO_SOURCES.map(source => source.kind));
  const report = { source: "quo", status: "skipped", reason: "QUO_API_KEY unavailable locally", sources: {}, authorFieldsObserved: {}, sonaDiscriminatorVerified: false, identityDirectoryProvided: Boolean(options.identities), tokens: 0 };
  for (const source of QUO_SOURCES) report.sources[source.kind] = { threads: 0, kept: 0, excluded: 0, turns: 0, reasons: {}, complete: false };
  if (!env.QUO_API_KEY) { writeReport(folder, "quo", report); return report; }
  const api = { authorization: env.QUO_API_KEY, origin: env.QUO_API_BASE_URL || "https://api.quo.com", ...dependencies.api };
  const hash = privateHasher(folder), identities = readIdentityIndex(options.identities);
  const authors = { humanIds: String(env.QUO_HUMAN_USER_IDS || "").split(",").filter(Boolean), sonaIds: String(env.QUO_SONA_USER_IDS || "").split(",").filter(Boolean), backendIds: [] };
  report.status = "complete"; delete report.reason;
  for (const source of QUO_SOURCES) {
    const counts = report.sources[source.kind], seenThreads = new Set(), seenMessages = new Set();
    const id = env[source.envKey];
    if (!/^PN[A-Za-z0-9_-]{1,100}$/.test(id || "")) { counts.reasons.phone_number_id_not_configured = 1; report.status = "partial"; continue; }
    const write = jsonlWriter(folder, source.kind);
    try {
      for await (const conversations of quoPages("/v1/conversations", { phoneNumbers: id, maxResults: 100 }, api)) for (const conversation of conversations) {
        if (conversation.phoneNumberId !== id || seenThreads.has(conversation.id)) continue;
        seenThreads.add(conversation.id); counts.threads += 1;
        const participants = Array.isArray(conversation.participants) ? conversation.participants.filter(value => /^\+[1-9]\d{1,14}$/.test(value)) : [];
        if (!participants.length || participants.length !== conversation.participants?.length) { counts.excluded += 1; counts.reasons.invalid_participant = (counts.reasons.invalid_participant || 0) + 1; continue; }
        if (env.LEAD_PLAYBOOK_CRAIG_CELL && participants.some(phone => phoneKey(phone) === phoneKey(env.LEAD_PLAYBOOK_CRAIG_CELL))) { counts.excluded += 1; counts.reasons.owner_notification_contact = (counts.reasons.owner_notification_contact || 0) + 1; continue; }
        const messages = [];
        for await (const page of quoPages("/v1/messages", { phoneNumberId: id, participants, maxResults: 100 }, api)) for (const message of page) {
          if (message.phoneNumberId !== id || message.conversationId !== conversation.id || seenMessages.has(message.id)) continue;
          const incoming = message.direction === "incoming", outgoing = message.direction === "outgoing";
          const roster = new Set([phoneKey(message.from), ...(message.to || []).map(phoneKey)]);
          if ((!incoming && !outgoing) || participants.some(participant => !roster.has(phoneKey(participant)))) continue;
          seenMessages.add(message.id); messages.push(message);
          for (const field of ["userId", "createdByUserId", "createdBy", "authorType"]) if (message[field] != null) report.authorFieldsObserved[field] = (report.authorFieldsObserved[field] || 0) + 1;
        }
        messages.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        const classification = threadClassification(participants, messages, identities);
        counts.reasons[classification.reason] = (counts.reasons[classification.reason] || 0) + 1;
        if (!classification.keep) { counts.excluded += 1; continue; }
        counts.kept += 1;
        const known = participants.map(phone => identities.get(phoneKey(phone))).filter(Boolean);
        const context = { names: known.flatMap(row => [row.name, row.first_name, row.last_name]).filter(Boolean), emails: known.map(row => row.email).filter(Boolean), addresses: known.map(row => row.address).filter(Boolean), phones: participants };
        const thread = hash(source.kind + ":" + conversation.id);
        for (const message of messages) {
          write({ id: hash(message.id), thread_id: thread, source: source.kind, external_ref_hash: hash(participants.join(",")), channel: "sms", category: classification.category, outcome: known.find(row => row.outcome)?.outcome || "unknown", outcome_source: known.find(row => row.outcome)?.outcome_source || "unknown", direction: message.direction === "incoming" ? "inbound" : "outbound", author: resolveImportAuthor(message, authors), body_redacted: redactPlaybookText(message.text, context), created_at: message.createdAt, slots_json: {} });
          counts.turns += 1;
        }
      }
      counts.complete = true;
    } catch (error) { report.status = "partial"; counts.error = error.status ? `provider_http_${error.status}` : "provider_read_failed"; }
  }
  writeReport(folder, "quo", report); return report;
}
if (isMain(import.meta.url)) importQuo(args()).then(report => console.log(JSON.stringify(report))).catch(() => { console.error("Quo dry-run import failed; no sends or production writes were attempted."); process.exitCode = 1; });
