import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkQuoteFollowUpWorker } from "./check-quote-follow-up-worker.mjs";

export function patchQuoteFollowUpWorker(source) {
  const importMarker = "export default {";
  const scheduledMarker = "async scheduled(controller, env, ctx) {";
  if (!source.includes(importMarker)) throw new Error("OpenNext worker export marker was not found for quote follow-up scheduling.");
  if (!source.includes(scheduledMarker)) throw new Error("OpenNext scheduled handler marker was not found for quote follow-up scheduling.");

  for (const [name, file] of [
    ["runScheduledQuoteFollowUps", "quote-follow-up-delivery.js"],
    ["runScheduledYardOps", "lead-assistant.js"],
    ["runFailedPaymentRecovery", "failed-payment-reconciliation.js"],
    ["processFieldMessages", "field-messages.js"],
    ["runScheduledReviewRequests", "review-requests.js"],
  ]) {
    if (!source.includes(`from "../lib/${file}"`)) {
      source = source.replace(importMarker, `import { ${name} } from "../lib/${file}";\n${importMarker}`);
    }
  }

  // Other independent */10 tasks must not suppress quote processing.
  if (!/\brunScheduledQuoteFollowUps\s*\(\s*env\b/.test(source)) {
    source = source.replace(scheduledMarker, `${scheduledMarker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/quote-follow-ups"), env, ctx,
                () => {
                    const report = (processor, task) => task.then(result => {
                        console.log(JSON.stringify({ event: "scheduled_follow_up_processor", processor, success: true }));
                        return result;
                    }, error => {
                        console.error(JSON.stringify({ event: "scheduled_follow_up_processor", processor, success: false }));
                        throw error;
                    });
                    return Promise.all([
                        report("runScheduledQuoteFollowUps", runScheduledQuoteFollowUps(env)),
                        report("runScheduledYardOps", runScheduledYardOps(env)),
                        report("runFailedPaymentRecovery", runFailedPaymentRecovery(env)),
                        report("processFieldMessages", processFieldMessages(env)),
                        report("runScheduledReviewRequests", runScheduledReviewRequests(env)),
                    ]);
                })
        );`);
  }
  // Repair workers already patched with other */10 calls. Import presence or an
  // existing quote group must never suppress the review processor's invocation.
  if (!/\brunScheduledReviewRequests\s*\(\s*env\b/.test(source)) {
    source = source.replace(scheduledMarker, `${scheduledMarker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/review-requests"), env, ctx,
                () => runScheduledReviewRequests(env))
        );`);
  }
  // The native subscription scheduler is independent and disabled unless its
  // separately approved flag is enabled. It records reminders; it never sends.
  if (!source.includes('from "../lib/crm-subscription-store.mjs"')) {
    source = source.replace(importMarker, `import { processDueCrmSubscriptions } from "../lib/crm-subscription-store.mjs";\n${importMarker}`);
  }
  if (!/\bprocessDueCrmSubscriptions\s*\(\s*env\b/.test(source)) {
    source = source.replace(scheduledMarker, `${scheduledMarker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/subscription-schedule"), env, ctx,
                () => processDueCrmSubscriptions(env, { now: controller.scheduledTime }))
        );`);
  }
  if (!source.includes('from "../lib/crm-billing-worker.mjs"')) {
    source = source.replace(importMarker, `import { runScheduledCrmBilling } from "../lib/crm-billing-worker.mjs";\n${importMarker}`);
  }
  if (!/\brunScheduledCrmBilling\s*\(\s*env\b/.test(source)) {
    source = source.replace(scheduledMarker, `${scheduledMarker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/crm-billing-uat"), env, ctx,
                () => runScheduledCrmBilling(env, { now: controller.scheduledTime }))
        );`);
  }
  checkQuoteFollowUpWorker(source);
  return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workerPath = new URL("../.open-next/worker.js", import.meta.url);
  const source = await fs.readFile(workerPath, "utf8");
  await fs.writeFile(workerPath, patchQuoteFollowUpWorker(source));
}
