import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { patchQuoteFollowUpWorker } from "../scripts/patch-quote-follow-up-worker.mjs";
import { checkQuoteFollowUpWorker } from "../scripts/check-quote-follow-up-worker.mjs";

const processors = ["runScheduledQuoteFollowUps", "runScheduledYardOps", "runFailedPaymentRecovery", "processFieldMessages", "runScheduledReviewRequests"];
const existingTasks = ["runScheduledDensityRefresh", "runScheduledDispatchPreparation", "runScheduledFoodOperations"];
const imports = `import { runScheduledQuoteFollowUps } from "../lib/quote-follow-up-delivery.js";
import { runScheduledYardOps } from "../lib/lead-assistant.js";
import { runFailedPaymentRecovery } from "../lib/failed-payment-reconciliation.js";
import { processFieldMessages } from "../lib/field-messages.js";
import { runScheduledReviewRequests } from "../lib/review-requests.js";
`;
const fixture = `export default {
    async scheduled(controller, env, ctx) {
        ${existingTasks.map(name => `if (controller.cron === "*/10 * * * *") ctx.waitUntil(${name}(env));`).join("\n        ")}
        const task = Promise.resolve({ skipped: true });
        ctx.waitUntil(task);
    },
};`;

async function executeWorker(source, cron, rejectedProcessor = "") {
  const calls = [];
  const contexts = [];
  const logs = [];
  const env = { fixture: true };
  const waits = [];
  const ctx = { waitUntil(task) { waits.push(task); } };
  const scope = {
    Request,
    console: { log: value => logs.push(JSON.parse(value)), error: value => logs.push(JSON.parse(value)) },
    isEasternMidnight: () => false,
    isUtcHour: () => false,
    runWithCloudflareRequestContext(request, actualEnv, actualCtx, run) {
      assert.equal(actualEnv, env);
      assert.equal(actualCtx, ctx);
      contexts.push(request.url);
      return run();
    },
    ...Object.fromEntries([...processors, ...existingTasks, "runScheduledPlaybook"].map(name => [name, async actualEnv => {
      assert.equal(actualEnv, env);
      calls.push(name);
      if (name === rejectedProcessor) throw new Error("Fixture processor failed");
      return name;
    }])),
  };
  const runnable = source.replace(/^import .*;\r?\n/gm, "").replace("export default", "globalThis.worker =");
  vm.runInNewContext(runnable, scope);
  await scope.worker.scheduled({ cron, scheduledTime: Date.now() }, env, ctx);
  const outcomes = await Promise.allSettled(waits);
  return { calls, contexts, waits, logs, outcomes };
}

test("all five processors run once on */10 alongside other */10 blocks, even with preexisting imports", async () => {
  for (const source of [fixture, imports + fixture]) {
    const patched = patchQuoteFollowUpWorker(source);
    assert.equal(patchQuoteFollowUpWorker(patched), patched, "patch is byte-idempotent");
    const result = await executeWorker(patched, "*/10 * * * *");
    assert.deepEqual(result.calls.sort(), [...processors, ...existingTasks].sort());
    assert.deepEqual(result.contexts, ["https://opwp.internal/quote-follow-ups"]);
    assert.equal(result.waits.length, existingTasks.length + 2, "quote group has its own waitUntil");
    assert.deepEqual(result.logs, processors.map(processor => ({ event: "scheduled_follow_up_processor", processor, success: true })));
    assert.ok(result.outcomes.every(outcome => outcome.status === "fulfilled"));
    assert.deepEqual(Array.from(result.outcomes[0].value), processors, "completion logging preserves processor results");
    for (const cron of ["0 * * * *", "5 * * * *", "15 * * * *", "35 * * * *"]) {
      const skipped = await executeWorker(patched, cron);
      assert.deepEqual(skipped.calls, cron === "0 * * * *" ? ["runScheduledPlaybook"] : []);
      if (cron === "0 * * * *") assert.deepEqual(skipped.contexts, ["https://opwp.internal/lead-playbook"]);
      assert.deepEqual(skipped.logs, []);
    }
  }
});

test("processor failures are observable without logging error details or swallowing the rejection", async () => {
  const result = await executeWorker(patchQuoteFollowUpWorker(fixture), "*/10 * * * *", "runFailedPaymentRecovery");
  assert.deepEqual(result.logs, processors.map(processor => ({
    event: "scheduled_follow_up_processor", processor, success: processor !== "runFailedPaymentRecovery",
  })));
  assert.equal(result.outcomes[0].status, "rejected");
  assert.match(result.outcomes[0].reason.message, /Fixture processor failed/);
  assert.equal(JSON.stringify(result.logs).includes("Fixture processor failed"), false);
});

test('review processing is added when the quote processor was already called', async () => {
  const previous = patchQuoteFollowUpWorker(fixture)
    .replace('report("runScheduledReviewRequests", runScheduledReviewRequests(env)),', '')
    .replace('import { runScheduledReviewRequests } from "../lib/review-requests.js";', '');
  const patched = patchQuoteFollowUpWorker(previous);
  assert.equal(patchQuoteFollowUpWorker(patched), patched);
  const result = await executeWorker(patched, '*/10 * * * *');
  assert.equal(result.calls.filter(name=>name==='runScheduledReviewRequests').length, 1);
  assert.deepEqual(result.calls.sort(), [...processors, ...existingTasks].sort());
});

test("missing worker markers fail before writing an incomplete patch", () => {
  assert.throws(() => patchQuoteFollowUpWorker("export default {};"), /scheduled handler marker was not found/);
  assert.throws(() => patchQuoteFollowUpWorker("async scheduled(controller, env, ctx) {}"), /export marker was not found/);
});

test("worker check rejects imported processors with no call, including the reported broken worker", () => {
  assert.throws(() => checkQuoteFollowUpWorker(imports + fixture), /imports runScheduledQuoteFollowUps but never calls it/);
  const patched = patchQuoteFollowUpWorker(fixture);
  for (const name of processors) {
    assert.throws(() => checkQuoteFollowUpWorker(patched.replace(`${name}(env)`, "Promise.resolve()")), new RegExp(`imports ${name} but never calls it`));
  }
  assert.doesNotThrow(() => checkQuoteFollowUpWorker(patched));
});

test("worker check requires every processor and an actual call inside the ten-minute guard", () => {
  assert.throws(() => checkQuoteFollowUpWorker(fixture), /missing required processor import runScheduledQuoteFollowUps/);
  const patched = patchQuoteFollowUpWorker(fixture);
  for (const name of processors) {
    const removedImport = patched.replace(new RegExp(`^import \\{ ${name} \\} from [^\\n]+\\n`, "m"), "");
    assert.throws(() => checkQuoteFollowUpWorker(removedImport), new RegExp(`missing required processor import ${name}`));
    const commentOnly = patched.replace(`${name}(env)`, `Promise.resolve(/* ${name}(env) */)`);
    assert.throws(() => checkQuoteFollowUpWorker(commentOnly), new RegExp(`imports ${name} but never calls it on the \\*/10 schedule`));
    const outsideSchedule = patched.replace(`${name}(env)`, "Promise.resolve()")
      .replace("async scheduled(controller, env, ctx) {", `async scheduled(controller, env, ctx) { ctx.waitUntil(${name}(env));`);
    assert.throws(() => checkQuoteFollowUpWorker(outsideSchedule), new RegExp(`imports ${name} but never calls it`));
  }
  assert.throws(() => checkQuoteFollowUpWorker(patched.replaceAll('controller.cron === "*/10 * * * *"', 'controller.cron === "5 * * * *"')), /never calls it on the \*\/10 schedule/);
  const commentedGuard = patched.replace('if (controller.cron === "*/10 * * * *") ctx.waitUntil(', 'if (controller.cron === "5 * * * *") ctx.waitUntil(/* if (controller.cron === "*/10 * * * *") ctx.waitUntil( */');
  assert.throws(() => checkQuoteFollowUpWorker(commentedGuard), /never calls it on the \*\/10 schedule/);
});

test("the actual build patch chain installs and validates follow-ups on an OpenNext fixture", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opwp-quote-worker-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"));
  await fs.mkdir(path.join(root, ".open-next"));
  for (const file of ["patch-open-next-worker.mjs", "patch-quote-follow-up-worker.mjs", "check-quote-follow-up-worker.mjs"]) {
    await fs.copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(root, "scripts", file));
  }
  const workerPath = path.join(root, ".open-next", "worker.js");
  await fs.writeFile(workerPath, "export default {\n    async fetch(request, env, ctx) { return new Response('fixture'); },\n};\n");
  const run = file => spawnSync(process.execPath, [path.join(root, "scripts", file)], { cwd: root, encoding: "utf8", windowsHide: true });
  for (const file of ["patch-open-next-worker.mjs", "patch-quote-follow-up-worker.mjs", "check-quote-follow-up-worker.mjs"]) {
    const result = run(file);
    assert.equal(result.status, 0, result.stderr);
  }
  const patched = await fs.readFile(workerPath, "utf8");
  const result = await executeWorker(patched, "*/10 * * * *");
  assert.deepEqual(result.calls.sort(), [...processors, ...existingTasks].sort());
  assert.equal(run("patch-quote-follow-up-worker.mjs").status, 0);
  assert.equal(await fs.readFile(workerPath, "utf8"), patched);

  await fs.writeFile(workerPath, patched.replace("runScheduledQuoteFollowUps(env)", "Promise.resolve()"));
  const rejected = run("check-quote-follow-up-worker.mjs");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /imports runScheduledQuoteFollowUps but never calls it/);
});
