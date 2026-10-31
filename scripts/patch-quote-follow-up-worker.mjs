import fs from "node:fs/promises";

const workerPath = new URL("../.open-next/worker.js", import.meta.url);
let source = await fs.readFile(workerPath, "utf8");

if (!source.includes('from "../lib/quote-follow-up-delivery.js"')) {
  const importMarker = "export default {";
  if (!source.includes(importMarker)) throw new Error("OpenNext worker export marker was not found for quote follow-up scheduling.");
  source = source.replace(importMarker, `import { runScheduledQuoteFollowUps } from "../lib/quote-follow-up-delivery.js";\n${importMarker}`);
}

if (!source.includes('from "../lib/lead-assistant.js"')) {
  const importMarker = "export default {";
  if (!source.includes(importMarker)) throw new Error("OpenNext worker export marker was not found for YardOps scheduling.");
  source = source.replace(importMarker, `import { runScheduledYardOps } from "../lib/lead-assistant.js";\n${importMarker}`);
}

if (!source.includes('controller.cron === "*/10 * * * *"')) {
  const taskMarker = "const task = ";
  if (!source.includes(taskMarker)) throw new Error("OpenNext scheduled task marker was not found for quote follow-up scheduling.");
  source = source.replace(taskMarker, `const task = controller.cron === "*/10 * * * *"\n            ? runWithCloudflareRequestContext(new Request("https://opwp.internal/quote-follow-ups"), env, ctx, () => Promise.all([runScheduledQuoteFollowUps(env), runScheduledYardOps(env)]))\n            : `);
}

await fs.writeFile(workerPath, source);

if (!source.includes('from "../lib/failed-payment-reconciliation.js"')) {
  source=source.replace('export default {','import { runFailedPaymentRecovery } from "../lib/failed-payment-reconciliation.js";\nexport default {');
  source=source.replace('runScheduledQuoteFollowUps(env), runScheduledYardOps(env)', 'runScheduledQuoteFollowUps(env), runScheduledYardOps(env), runFailedPaymentRecovery(env)');
  await fs.writeFile(workerPath,source);
}

if (!source.includes('from "../lib/field-messages.js"')) {
  source=source.replace('export default {','import { processFieldMessages } from "../lib/field-messages.js";\nexport default {');
  source=source.replace('runScheduledQuoteFollowUps(env), runScheduledYardOps(env)', 'runScheduledQuoteFollowUps(env), runScheduledYardOps(env), processFieldMessages(env)');
  await fs.writeFile(workerPath,source);
}
