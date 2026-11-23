import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
export { redactPlaybookText, redactPlaybookSlots } from "../../lib/playbook-redaction.mjs";

export const RUN_IMPORT = "D:\\Codex Projects\\_agent-runs\\2026-11-19-lead-playbook\\import";
export const args = (argv = process.argv.slice(2)) => Object.fromEntries(argv.map((value, index) => value.startsWith("--") ? [value.slice(2), argv[index + 1]?.startsWith("--") ? true : (argv[index + 1] ?? true)] : null).filter(Boolean));
export function assertDryRun(options = {}) {
  if (options.apply || options.write || options.send || options.production) throw new Error("Imports support read-only dry-run only.");
}
export function outputFolder(value = RUN_IMPORT) {
  const base = path.resolve(RUN_IMPORT), target = path.resolve(String(value));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error("Import output must stay inside the approved private run folder.");
  fs.mkdirSync(target, { recursive: true });
  return target;
}
export function loadEnv(filename) {
  const env = { ...process.env };
  if (filename) for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const pair = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (pair) env[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}
export function privateHasher(folder) {
  const target = path.join(outputFolder(folder), "private", "redaction-key");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, randomBytes(32), { mode: 0o600, flag: "wx" });
  const key = fs.readFileSync(target);
  return value => createHmac("sha256", key).update(String(value)).digest("hex");
}
export const phoneKey = value => {
  const text = String(value ?? "").trim();
  if (!/^\+?[\d ().-]+$/.test(text)) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10 && !text.startsWith("+")) return digits;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : "";
};
const MANIFEST = "active-import-manifest.json";
export function readImportManifest(folder) {
  const filename = path.join(outputFolder(folder), MANIFEST);
  if (!fs.existsSync(filename)) return { schemaVersion: 1, sources: {} };
  const value = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (value.schemaVersion !== 1 || !value.sources || typeof value.sources !== "object" || Array.isArray(value.sources)) throw new Error("Invalid active import manifest.");
  return value;
}
export function saveImportManifest(folder, manifest) {
  const target = path.join(outputFolder(folder), MANIFEST), temporary = target + "." + randomUUID() + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n"); fs.renameSync(temporary, target);
}
export function resetImportManifest(folder) { saveImportManifest(folder, { schemaVersion: 1, runId: randomUUID(), startedAt: new Date().toISOString(), sources: {} }); }
export function clearSourceDatasets(folder, sources) {
  const manifest = readImportManifest(folder);
  for (const source of sources) delete manifest.sources[source];
  saveImportManifest(folder, manifest);
}
export function activeDatasetFiles(folder) {
  const manifest = readImportManifest(folder), base = outputFolder(folder);
  return Object.entries(manifest.sources).map(([source, entry]) => {
    if (!/^(quo_2371|quo_7970|meta_leadgen|meta_messenger|meta_instagram|iphone_backup)$/.test(source) || !new RegExp(`^datasets/${source}-[a-f0-9-]{36}\\.jsonl$`).test(entry.file || "")) throw new Error("Invalid active import dataset.");
    const filename = path.resolve(base, entry.file);
    if (!filename.startsWith(base + path.sep) || !fs.existsSync(filename)) throw new Error("Active import dataset is missing.");
    return { source, filename };
  });
}
export function readIdentityIndex(filename) {
  const source = filename ? JSON.parse(fs.readFileSync(filename, "utf8")) : {};
  const index = new Map();
  for (const kind of ["leads", "customers", "staff", "vendors"]) for (const item of source[kind] || []) {
    const row = typeof item === "string" ? { phone: item } : item;
    if (phoneKey(row.phone).length === 10) index.set(phoneKey(row.phone), { ...row, kind });
  }
  return index;
}
export function writeReport(folder, name, report) { fs.writeFileSync(path.join(outputFolder(folder), name + "-report.json"), JSON.stringify({ dryRun: true, productionWrites: 0, sends: 0, ...report }, null, 2) + "\n"); }
export function jsonlWriter(folder, name) {
  if (!/^(quo_2371|quo_7970|meta_leadgen|meta_messenger|meta_instagram|iphone_backup)$/.test(name)) throw new Error("Unknown import source.");
  const relative = `datasets/${name}-${randomUUID()}.jsonl`, filename = path.join(outputFolder(folder), relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, "", { flag: "wx" });
  const manifest = readImportManifest(folder);
  manifest.sources[name] = { file: relative, importedAt: new Date().toISOString() }; saveImportManifest(folder, manifest);
  return row => fs.appendFileSync(filename, JSON.stringify(row) + "\n");
}
export function isMain(url) { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url); }

export class ReadOnlyApiError extends Error { constructor(status) { super(`Read-only provider request failed (${status}).`); this.status = status; } }
export async function readJson(url, { authorization, fetcher = fetch, retries = 5, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const parsed = new URL(url);
  if (!new Set(["api.openphone.com", "api.quo.com", "graph.facebook.com", "openapi.sweepandgo.com"]).has(parsed.hostname) || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Unapproved read-only API origin.");
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetcher(parsed, { method: "GET", headers: { Authorization: authorization, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20000) });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const wait = Math.min(60000, Math.max(500, Number(response.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt));
      await response.body?.cancel(); await sleep(wait); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new ReadOnlyApiError(response.status); }
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new Error("Provider response exceeded the bounded import size.");
    return JSON.parse(text);
  }
  throw new Error("Read-only provider retries exhausted.");
}
export async function* quoPages(pathname, query, api) {
  if (!["https://api.openphone.com", "https://api.quo.com"].includes(api.origin || "https://api.openphone.com")) throw new Error("Unapproved Quo API origin.");
  let token = ""; const seen = new Set();
  do {
    const url = new URL(pathname, api.origin || "https://api.openphone.com");
    for (const [key, value] of Object.entries(query)) for (const part of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(part));
    if (token) url.searchParams.set("pageToken", token);
    const page = await readJson(url, api);
    if (!Array.isArray(page.data)) throw new Error("Invalid Quo history page.");
    yield page.data;
    token = page.nextPageToken || "";
    if (token && seen.has(token)) throw new Error("Provider repeated a history cursor.");
    seen.add(token);
  } while (token);
}
export async function* graphPages(pathname, query, api) {
  let next = new URL(pathname, "https://graph.facebook.com"); const seen = new Set();
  for (const [key, value] of Object.entries(query)) next.searchParams.set(key, String(value));
  while (next) {
    // Never trust a provider-supplied next link with a different origin or echo its token.
    if (next.origin !== "https://graph.facebook.com") throw new Error("Invalid Graph pagination origin.");
    const page = await readJson(next, api);
    if (!Array.isArray(page.data)) throw new Error("Invalid Graph history page.");
    yield page.data;
    const link = page.paging?.next;
    if (link && seen.has(link)) throw new Error("Provider repeated a Graph cursor.");
    if (link) seen.add(link);
    next = link ? new URL(link) : null;
  }
}
