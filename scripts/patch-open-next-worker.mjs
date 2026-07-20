import fs from "node:fs/promises";

const workerPath = new URL("../.open-next/worker.js", import.meta.url);
let source = await fs.readFile(workerPath, "utf8");
if (!source.includes("runScheduledSubscriptionRefresh")) {
  const importMarker = "export default {";
  if (!source.includes(importMarker)) throw new Error("OpenNext worker export marker was not found.");
  source = source.replace(importMarker, `import { runScheduledSubscriptionRefresh } from "../lib/subscription-refresh-worker.js";\nimport { runScheduledDogFoodRenewals } from "../lib/dog-food-renewals.js";\nimport { runScheduledAirtableCockpitRefresh } from "../lib/airtable.js";\nimport { runScheduledRouteBookRefresh } from "../lib/route-intelligence.js";\n${importMarker}\n    async scheduled(controller, env, ctx) {\n        const task = controller.cron === "0 11 * * *"\n            ? Promise.all([runScheduledSubscriptionRefresh(env), runScheduledDogFoodRenewals(env)])\n            : controller.cron === "15 * * * *"\n                ? runScheduledAirtableCockpitRefresh(env)\n                : runScheduledRouteBookRefresh(env);\n        ctx.waitUntil(task);\n    },`);
  await fs.writeFile(workerPath, source);
}
