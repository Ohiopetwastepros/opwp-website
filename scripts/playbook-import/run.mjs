import fs from "node:fs";
import path from "node:path";
import { args, assertDryRun, outputFolder, writeReport, resetImportManifest, isMain } from "./common.mjs";
import { importQuo } from "./quo.mjs";
import { importMeta } from "./meta.mjs";
import { mine } from "./mine.mjs";

export async function runImports(options = {}, dependencies = {}) {
  assertDryRun(options);
  const folder = outputFolder(options.output);
  fs.writeFileSync(path.join(folder, ".gitignore"), "*\n");
  resetImportManifest(folder);
  const quo = await importQuo(options, dependencies), meta = await importMeta(options, dependencies);
  const iphoneFile = path.join(folder, "iphone-report.json");
  writeReport(folder, "iphone", { source: "iphone_backup", status: "skipped", reason: "This aggregate run does not import an iPhone backup. Run the explicit Python import afterward with copied sms.db and allowlist/denylist.", threads: 0, kept: 0, dropped: 0, turns: 0 });
  const mining = await mine(options, dependencies);
  const report = { generatedAt: new Date().toISOString(), dryRun: true, sources: { quo, meta, iphone: JSON.parse(fs.readFileSync(iphoneFile, "utf8")), mining }, productionWrites: 0, sends: 0 };
  fs.writeFileSync(path.join(folder, "import-report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
if (isMain(import.meta.url)) runImports(args()).then(report => console.log(JSON.stringify({ dryRun: report.dryRun, quo: report.sources.quo.status, meta: report.sources.meta.status, iphone: report.sources.iphone.status, candidates: report.sources.mining.candidates, productionWrites: 0, sends: 0 }))).catch(() => { console.error("Read-only dry-run import failed. No sends or production writes were attempted."); process.exitCode = 1; });
