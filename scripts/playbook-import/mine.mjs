import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { classifyPlaybookIntent } from "../../lib/lead-playbook-classifier.mjs";
import { lintPlaybookText, PLAYBOOK_POLICY_VERSION, PLAYBOOK_CLASSIFIER_VERSION } from "../../lib/lead-playbook.mjs";
import { args, assertDryRun, loadEnv, outputFolder, writeReport, redactPlaybookText, redactPlaybookSlots, activeDatasetFiles, isMain } from "./common.mjs";

export async function localUsageStore(folder) {
  const { DatabaseSync } = await import("node:sqlite");
  const filename = path.join(outputFolder(folder), "private", "classifier-usage.sqlite");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS daily(day TEXT,provider TEXT,calls INTEGER NOT NULL,PRIMARY KEY(day,provider)); CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,day TEXT,provider TEXT,input_tokens INTEGER,output_tokens INTEGER DEFAULT 0,actual_tokens INTEGER,status TEXT)");
  return {
    async claim({ usageDate, provider, cap, id, estimatedInputTokens }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT OR IGNORE INTO daily(day,provider,calls) VALUES(?,?,0)").run(usageDate, provider);
        const claimed = db.prepare("UPDATE daily SET calls=calls+1 WHERE day=? AND provider=? AND calls<?").run(usageDate, provider, cap).changes === 1;
        if (claimed) db.prepare("INSERT INTO calls(id,day,provider,input_tokens,status) VALUES(?,?,?,?,'claimed')").run(id, usageDate, provider, estimatedInputTokens);
        db.exec("COMMIT"); return claimed;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async finish({ id, status, estimatedOutputTokens, actualTokens }) { db.prepare("UPDATE calls SET status=?,output_tokens=?,actual_tokens=? WHERE id=?").run(status, estimatedOutputTokens, actualTokens, id); },
    totals() { return db.prepare("SELECT COUNT(*) AS calls,COALESCE(SUM(input_tokens+output_tokens),0) AS estimatedTokens,COALESCE(SUM(actual_tokens),0) AS actualTokens FROM calls").get(); },
    close() { db.close(); },
  };
}
export function cloudflareClassifierProvider(env, fetcher = fetch) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return undefined;
  return async ({ model, ...body }) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/run/${model}`;
    const response = await fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Local mining classifier request failed."); }
    const value = await response.json();
    if (!value.success) throw new Error("Local mining classifier request failed.");
    return value.result;
  };
}
const words = text => new Set(String(text).toLowerCase().replace(/\[[^\]]+\]/g, " ").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean));
export function similarity(left, right) {
  const a = words(left), b = words(right), union = new Set([...a, ...b]);
  return union.size ? [...a].filter(word => b.has(word)).length / union.size : 1;
}
const identifier = value => createHash("sha256").update(value).digest("hex");
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function mineTurns(turns, { classify = text => classifyPlaybookIntent(text), lint = lintPlaybookText } = {}) {
  const threads = new Map(), candidates = [];
  for (const raw of turns) {
    // Defense in depth: imported files can be edited, so sanitize again before review output.
    const turn = { ...raw, body_redacted: redactPlaybookText(raw.body_redacted), slots_json: redactPlaybookSlots(raw.slots_json || {}) };
    if (!threads.has(turn.thread_id)) threads.set(turn.thread_id, []);
    threads.get(turn.thread_id).push(turn);
  }
  let classified = 0;
  for (const [threadId, messages] of threads) {
    messages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const decisions = new Map();
    for (let index = 0; index < messages.length; index++) if (messages[index].author === "lead") { decisions.set(index, await classify(messages[index].body_redacted)); classified += 1; }
    const laterReady = index => [...decisions.entries()].some(([position, decision]) => position > index && decision.intent === "ready_to_sign_up");
    for (let index = 0; index < messages.length - 1; index++) {
      const question = messages[index];
      let decision = decisions.get(index);
      const temporaryNeed = question.author === "lead" && /\b(?:surgery|temporary|few months|couple (?:of )?months|recover(?:y|ing))\b/i.test(question.body_redacted);
      // Preserve Craig's empathy/month-to-month handling as a review example even
      // when the lead's main intent was a confirmation, never as a pricing override.
      if (temporaryNeed && decision && !/^(question_|objection_|is_this_ai)/.test(decision.intent)) decision = { ...decision, intent: "question_contract", confidence: 1 };
      if (!decision || decision.intent === "other" || decision.confidence < 0.8 || !/^(question_|objection_|is_this_ai)/.test(decision.intent)) continue;
      // A Sona/backend answer never becomes an example of Craig's voice.
      const answers = [];
      for (let next = index + 1; next < messages.length && messages[next].author === "craig"; next++) answers.push(messages[next]);
      if (!answers.length) continue;
      const answer = answers.map(turn => turn.body_redacted).join("\n"), isObjection = decision.intent.startsWith("objection_");
      const recorded = messages.find(turn => ["won", "lost", "no_reply"].includes(turn.outcome));
      const outcome = recorded?.outcome || (laterReady(index) ? "won" : "unknown");
      const violations = lint(answer, { intent: decision.intent, slots: decision.slots || {}, state: {} });
      const existing = candidates.find(item => item.intent === decision.intent && similarity(item.answer_redacted, answer) >= 0.82 && similarity(item.question_redacted, question.body_redacted) >= 0.6);
      if (existing) {
        if (!existing.thread_ids.includes(threadId)) { existing.thread_ids.push(threadId); existing.support_count += 1; existing.outcomes.push(outcome); }
        existing.example_turn_ids.push(question.id, ...answers.map(turn => turn.id));
        existing.rule_violations_json = [...new Set([...existing.rule_violations_json, ...violations])];
      } else candidates.push({ id: identifier(decision.intent + ":" + answer), kind: isObjection ? "objection" : "qa", intent: decision.intent, source: temporaryNeed ? "approved_edit" : "mined", context: temporaryNeed ? "temporary_need_empathy_month_to_month" : null, question_redacted: question.body_redacted, answer_redacted: answer, objection_text: isObjection ? question.body_redacted : "", proposed_template: answer, support_count: 1, example_turn_ids: [question.id, ...answers.map(turn => turn.id)], thread_ids: [threadId], outcomes: [outcome], outcome, outcome_source: recorded?.outcome_source || (laterReady(index) ? "later_ready_turn" : "unknown"), status: "pending_review", rule_violations_json: violations, policy_version: PLAYBOOK_POLICY_VERSION, classifier_version: PLAYBOOK_CLASSIFIER_VERSION });
    }
  }
  for (const candidate of candidates) {
    const known = candidate.outcomes.filter(value => ["won", "lost"].includes(value));
    candidate.win_rate = known.length ? candidate.outcomes.filter(value => value === "won").length / known.length : null;
    delete candidate.thread_ids;
  }
  candidates.sort((a, b) => a.intent.localeCompare(b.intent) || b.support_count - a.support_count || (b.win_rate || 0) - (a.win_rate || 0));
  const counts = new Map();
  return { candidates: candidates.filter(candidate => { const count = counts.get(candidate.intent) || 0; counts.set(candidate.intent, count + 1); return count < 5; }), threads: threads.size, turns: turns.length, classified };
}
export async function mine(options = {}, dependencies = {}) {
  assertDryRun(options);
  const folder = outputFolder(options.output), env = dependencies.env || loadEnv(options.env), usage = await localUsageStore(folder);
  const before = usage.totals(), provider = dependencies.provider || cloudflareClassifierProvider(env);
  try {
    const turns = [];
    const datasets = activeDatasetFiles(folder);
    for (const { source, filename } of datasets) {
      for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean)) {
        const turn = JSON.parse(line);
        if (turn.source !== source) throw new Error("Imported turn source does not match the active manifest.");
        turns.push(turn);
      }
    }
    const result = await mineTurns(turns, { classify: text => classifyPlaybookIntent(text, {}, { env, provider, usageStore: usage }) });
    const after = usage.totals();
    fs.writeFileSync(path.join(folder, "candidates.jsonl"), result.candidates.map(candidate => JSON.stringify(candidate)).join("\n") + (result.candidates.length ? "\n" : ""));
    const keys = ["id", "kind", "intent", "proposed_template", "question_redacted", "support_count", "win_rate", "rule_violations_json", "example_turn_ids"];
    fs.writeFileSync(path.join(folder, "candidates.csv"), [keys.join(","), ...result.candidates.map(candidate => keys.map(key => csvCell(Array.isArray(candidate[key]) ? candidate[key].join("; ") : candidate[key])).join(","))].join("\n") + "\n");
    let markdown = "# Playbook candidate review\n\nDry-run only. Every candidate requires Craig's review before promotion.\n";
    if (!result.candidates.length) markdown += "\nNo imported eligible Craig replies were available. No sample candidates were substituted.\n";
    let intent;
    for (const candidate of result.candidates) {
      if (candidate.intent !== intent) { intent = candidate.intent; markdown += `\n## ${intent}\n`; }
      markdown += `\n### ${candidate.id.slice(0, 12)}\n\nSupport: ${candidate.support_count} threads. Win rate: ${candidate.win_rate == null ? "unknown" : (candidate.win_rate * 100).toFixed(0) + "%"}.\n\nProposed template:\n\n${candidate.proposed_template.replace(/^/gm, "> ")}\n\nExample question:\n\n${candidate.question_redacted.replace(/^/gm, "> ")}\n\nViolations: ${candidate.rule_violations_json.join(", ") || "none detected"}.\n\nExample turn IDs: ${candidate.example_turn_ids.join(", ")}.\n`;
    }
    fs.writeFileSync(path.join(folder, "candidates.md"), markdown);
    const report = { source: "mining", status: result.turns ? "complete" : "no_imported_history", activeSources: datasets.map(dataset => dataset.source), threads: result.threads, turns: result.turns, classified: result.classified, candidates: result.candidates.length, classifierCalls: after.calls - before.calls, estimatedTokens: after.estimatedTokens - before.estimatedTokens, actualTokens: after.actualTokens - before.actualTokens, actualCostUsd: after.calls === before.calls ? 0 : null, costNote: "No paid-price assumption is substituted for measured usage. Workers AI daily allocation and account billing must be checked before enabling classification.", livePromotions: 0 };
    writeReport(folder, "mining", report); return report;
  } finally { usage.close(); }
}
if (isMain(import.meta.url)) mine(args()).then(report => console.log(JSON.stringify(report))).catch(() => { console.error("Dry-run mining failed. No live library changes were attempted."); process.exitCode = 1; });
