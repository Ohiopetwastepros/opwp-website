import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

export function verifyInitialSmsWorker(source) {
  for (const [marker,call] of [
    ["// OPWP_INITIAL_QUOTE_SMS_V1","() => runScheduledInitialQuoteSms(env)"],
    ["// OPWP_INITIAL_SMS_WATCHDOG_V1","() => runInitialSmsWatchdog(env)"],
  ]) {
    if (!source.includes(marker) || source.split(call).length !== 2) throw new Error("The built Worker must contain one initial SMS scheduler and one independent watchdog.");
  }
  if (!source.includes('controller.cron === "* * * * *"')) throw new Error("Initial SMS minute schedule is missing from the built Worker.");
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyInitialSmsWorker(await fs.readFile(new URL("../.open-next/worker.js",import.meta.url),"utf8"));
  console.log("Initial SMS scheduler and independent watchdog are included in the built Worker.");
}
