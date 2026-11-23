import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkQuoteFollowUpWorker(source) {
  const processors = ["runScheduledQuoteFollowUps", "runScheduledYardOps", "runFailedPaymentRecovery", "processFieldMessages", "runScheduledReviewRequests"];
  for (const name of processors) {
    const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']`, "s").test(source);
    if (!imported) throw new Error(`OpenNext worker is missing required processor import ${name}.`);
  }
  // Preserve offsets while hiding comments and literals, so a commented-out
  // call or a string containing a processor's name cannot satisfy the gate.
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    value => value.replace(/[^\r\n]/g, " "));
  const scheduled = /async\s+scheduled\s*\(\s*controller\s*,\s*env\s*,\s*ctx\s*\)\s*\{/.exec(code);
  const guardedCalls = [];
  if (scheduled) {
    const start = scheduled.index + scheduled[0].length - 1;
    const end = closingOffset(code, start, "{", "}");
    const body = source.slice(start, end + 1);
    const bodyCode = code.slice(start, end + 1);
    const guard = /\bif\s*\(\s*controller\.cron\s*===\s*(["'])\*\/10 \* \* \* \*\1\s*\)\s*(?:\{\s*)?ctx\.waitUntil\s*\(/g;
    for (const match of body.matchAll(guard)) {
      if (bodyCode.slice(match.index, match.index + 2) !== "if") continue;
      const open = match.index + match[0].length - 1;
      const close = closingOffset(bodyCode, open, "(", ")");
      guardedCalls.push(bodyCode.slice(open, close + 1));
    }
  }
  for (const name of processors) {
    if (!guardedCalls.some(block => new RegExp(`\\b${name}\\s*\\(\\s*env\\b`).test(block))) {
      throw new Error(`OpenNext worker imports ${name} but never calls it on the */10 schedule; scheduled follow-up processing is missing.`);
    }
  }
}

function closingOffset(code, start, open, close) {
  let depth = 0;
  for (let index = start; index < code.length; index++) {
    if (code[index] === open) depth++;
    if (code[index] === close && --depth === 0) return index;
  }
  throw new Error("OpenNext scheduled processor block is incomplete.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workerPath = new URL("../.open-next/worker.js", import.meta.url);
  checkQuoteFollowUpWorker(await fs.readFile(workerPath, "utf8"));
  console.log("Scheduled quote follow-up worker calls verified.");
}
