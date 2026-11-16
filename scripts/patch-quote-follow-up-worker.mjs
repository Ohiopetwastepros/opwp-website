import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This independent task cannot activate dormant queues or collide with another cron.
export function patchQuoteWorker(source) {
  const marker = "// OPWP_INITIAL_QUOTE_SMS_V1";
  if (source.includes(marker)) {
    if (!source.includes("() => runInitialQuoteSms(env)")) throw new Error("Initial quote SMS handler is incomplete.");
    return source;
  }
  const scheduled = "async scheduled(controller, env, ctx) {";
  if (!source.includes(scheduled)) throw new Error("OpenNext scheduled handler was not found for initial quote SMS.");
  return 'import { runInitialQuoteSms } from "../lib/quote-initial-sms.mjs";\n' + source.replace(scheduled, `${scheduled}
        ${marker}
        if (controller.cron === "* * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/initial-quote-sms"), env, ctx,
                () => runInitialQuoteSms(env))
        );`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workerPath = new URL("../.open-next/worker.js", import.meta.url);
  await fs.writeFile(workerPath, patchQuoteWorker(await fs.readFile(workerPath, "utf8")));
}
