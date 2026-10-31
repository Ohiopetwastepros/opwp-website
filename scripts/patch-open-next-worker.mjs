import fs from "node:fs/promises";

const workerPath = new URL("../.open-next/worker.js", import.meta.url);
let source = await fs.readFile(workerPath, "utf8");
if (!source.includes("runScheduledSubscriptionRefresh")) {
  const importMarker = "export default {";
  if (!source.includes(importMarker)) throw new Error("OpenNext worker export marker was not found.");
  source = source.replace(importMarker, `import { runScheduledSubscriptionReconciliation, runScheduledSubscriptionRecovery, runScheduledSubscriptionRefresh } from "../lib/subscription-refresh-worker.js";
import { runScheduledSngOperationalRecovery } from "../lib/sng-operational-recovery.js";
import { runScheduledStopTravel } from "../lib/stop-travel.js";
import { runScheduledDogFoodRenewals } from "../lib/dog-food-renewals.js";
import { runScheduledReviewPipeline } from "../lib/google-review-sync.js";
import { runScheduledRouteBookRefresh } from "../lib/route-intelligence.js";
import { flushSubmissionNotifications } from "../lib/submission-notifications.js";
import { runFinancialReconciliation } from "../lib/financial-reconciliation.js";
import { isEasternMidnight, isUtcHour } from "../lib/scheduled-time.mjs";
${importMarker}
    async scheduled(controller, env, ctx) {
        const atEasternMidnight = isEasternMidnight(controller.scheduledTime);
        const task = runWithCloudflareRequestContext(new Request("https://opwp.internal/scheduled"), env, ctx, () => controller.cron === "0 * * * *"
            ? atEasternMidnight
                ? runScheduledSubscriptionRefresh(env)
                : isUtcHour(controller.scheduledTime, 11)
                    ? Promise.all([
                        runScheduledDogFoodRenewals(env),
                        runWithCloudflareRequestContext(new Request("https://opwp.internal/financial-snapshot"), env, ctx, () =>
                            import("../lib/financial-management.js").then(({ captureDailyFinancialSnapshot }) => captureDailyFinancialSnapshot())
                        ),
                    ])
                    : Promise.resolve({ skipped: true, reason: "no_top_of_hour_task" })
            : controller.cron === "5 * * * *"
                ? atEasternMidnight
                    ? runScheduledSubscriptionReconciliation(env)
                    : Promise.all([
                        runScheduledSubscriptionRecovery(env),
                        runWithCloudflareRequestContext(new Request("https://opwp.internal/sng-operational-recovery"), env, ctx, async () => {
                            try { await runScheduledSngOperationalRecovery(env); }
                            finally { await runScheduledStopTravel(env); }
                        }),
                        flushSubmissionNotifications(env),
                        runFinancialReconciliation(env),
                    ])
                : controller.cron === "15 * * * *"
                        ? runScheduledReviewPipeline(env)
                    : controller.cron === "35 * * * *"
                        ? runScheduledRouteBookRefresh(env)
                        : Promise.resolve({ skipped: true, reason: "no_route_book_task" }));
        ctx.waitUntil(task);
    },`);
  await fs.writeFile(workerPath, source);
}

if (!source.includes("legacyHostRedirect")) {
  const fetchMarker = "async fetch(request, env, ctx) {";
  if (!source.includes(fetchMarker)) throw new Error("OpenNext fetch marker was not found; legacy-host routing was not installed.");
  source = 'import { legacyHostRedirect } from "../lib/legacy-host-redirect.mjs";\n' + source.replace(fetchMarker, `${fetchMarker}
        const legacyRedirect = legacyHostRedirect(request);
        if (legacyRedirect) return legacyRedirect;`);
  await fs.writeFile(workerPath, source);
}

// Separate waitUntil task so the existing scheduler's branches and failures do
// not suppress the daily dispatch preparation. The runner gates Eastern time.
if (!source.includes('from "../lib/dog-food-ops-automation.js"')) {
  const marker = "async scheduled(controller, env, ctx) {";
  if (!source.includes(marker)) throw new Error("Scheduled handler missing; dog-food operations were not installed.");
  source = 'import { runScheduledFoodOperations } from "../lib/dog-food-ops-automation.js";\n' + source.replace(marker, `${marker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/dog-food-operations"), env, ctx,
                () => runScheduledFoodOperations(env, controller.scheduledTime))
        );`);
  await fs.writeFile(workerPath, source);
}

if (!source.includes('from "../lib/dispatch-automation.js"')) {
  const marker = "async scheduled(controller, env, ctx) {";
  if (!source.includes(marker)) throw new Error("Scheduled handler missing; dispatch automation was not installed.");
  source = 'import { runScheduledDispatchPreparation } from "../lib/dispatch-automation.js";\n' + source.replace(marker, `${marker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/dispatch-preparation"), env, ctx,
                () => runScheduledDispatchPreparation(env, controller.scheduledTime))
        );`);
  await fs.writeFile(workerPath, source);
}

// An independent, bounded customer-only feed. Existing dispatch and financial
// branches remain independent; a provider failure retains the last good roster.
if (!source.includes('from "../lib/live-density-worker.js"')) {
  const marker = "async scheduled(controller, env, ctx) {";
  if (!source.includes(marker)) throw new Error("Scheduled handler missing; density refresh was not installed.");
  source = 'import { runScheduledDensityRefresh } from "../lib/live-density-worker.js";\n' + source.replace(marker, `${marker}
        if (controller.cron === "*/10 * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/acquisition-density"), env, ctx,
                () => runScheduledDensityRefresh(env))
        );`);
  await fs.writeFile(workerPath, source);
}
