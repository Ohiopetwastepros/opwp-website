export function patchInitialSmsWatchdog(source) {
  const marker = "// OPWP_INITIAL_SMS_WATCHDOG_V1";
  if (source.includes(marker)) {
    if (!source.includes("() => runInitialSmsWatchdog(env)")) throw new Error("Initial SMS watchdog handler is incomplete.");
    return source;
  }
  const scheduled = "async scheduled(controller, env, ctx) {";
  if (!source.includes(scheduled)) throw new Error("Scheduled handler missing for the initial SMS watchdog.");
  return 'import { runInitialSmsWatchdog } from "../lib/quote-sms-monitor.js";\n' + source.replace(scheduled, `${scheduled}
        ${marker}
        if (controller.cron === "* * * * *") ctx.waitUntil(
            runWithCloudflareRequestContext(new Request("https://opwp.internal/initial-sms-watchdog"), env, ctx,
                () => runInitialSmsWatchdog(env))
        );`);
}
