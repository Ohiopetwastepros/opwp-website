import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkQuoteFollowUpWorker(source) {
  for (const name of ["runScheduledQuoteFollowUps", "runScheduledYardOps", "runFailedPaymentRecovery", "processFieldMessages", "runScheduledReviewRequests"]) {
    const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']`, "s").test(source);
    if (imported && !new RegExp(`\\b${name}\\s*\\(\\s*env\\b`).test(source)) {
      throw new Error(`OpenNext worker imports ${name} but never calls it; scheduled follow-up processing is missing.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workerPath = new URL("../.open-next/worker.js", import.meta.url);
  checkQuoteFollowUpWorker(await fs.readFile(workerPath, "utf8"));
  console.log("Scheduled quote follow-up worker calls verified.");
}
