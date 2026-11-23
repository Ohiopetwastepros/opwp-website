import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const LIVE_RELEASE_ID = 'meta-live-2026-11-23-golive';
export const TEST_VARS = Object.freeze({META_AUTOMATION_ENABLED:'false', META_TEST_MODE:'true', META_TEST_RECIPIENTS:'+14192620424', META_TEST_FORM_IDS:'1725121795904553', LEAD_AUTOMATION_CONTROLLED_TEST_ONLY:'true', LEAD_PLAYBOOK_AUTO_SEND_ENABLED:'false', META_CADENCE_ENABLED:'false'});
export function rollbackPlan(vars = {}) {
  return {vars: {...vars, ...TEST_VARS}, sql: `UPDATE meta_automation_releases SET revoked_at=CURRENT_TIMESTAMP WHERE id='${LIVE_RELEASE_ID}' AND organization_id='org-opwp' AND policy_version='meta-confirmation-v2' AND revoked_at IS NULL;`,
    deploy: ['npm','run','deploy','--','--summary','Approved Facebook rollback to Craig-only test mode']};
}
function run(command, args, capture = false) {
  let executable = command;
  if (['npm','npx'].includes(command)) {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(cli)) throw new Error('The local Node installation must include its npm CLI.');
    executable = process.execPath;
    args = [cli, ...(command === 'npx' ? ['exec','--no','--'] : []), ...args];
  }
  const result = spawnSync(executable, args, {cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true});
  if (result.status !== 0) throw new Error('Rollback prerequisite or guarded command failed. No retry is automatic.');
  return String(result.stdout || '').trim();
}
export function validateRollbackApproval(approval, head) {
  if (approval?.approvedBy !== 'Craig Bridgman' || approval?.action !== 'fb-live-rollback' || approval?.releaseId !== LIVE_RELEASE_ID || approval?.expectedCommit !== head || !/^[a-f0-9]{40}$/.test(head) || approval?.approveProductionD1Write !== true || approval?.approveProductionDeploy !== true || typeof approval.approvalText !== 'string' || !/\bapproved\b/i.test(approval.approvalText) || /<[^>]+>/.test(approval.approvalText)) throw new Error('A private, commit-scoped approval for both rollback actions is required.');
  const at = Date.parse(approval.approvedAt);
  if (!Number.isFinite(at) || at > Date.now() || Date.now() - at > 24 * 3600000) throw new Error('Rollback approval must be current.');
}
async function apply(approvalFile) {
  if (!approvalFile) throw new Error('--approval-file is required for --apply.');
  const absolute = fs.realpathSync(path.resolve(root, approvalFile));
  const privateRoot = fs.realpathSync(path.join(root, 'private')) + path.sep;
  if (!absolute.startsWith(privateRoot)) throw new Error('Rollback approval must be in ignored private storage.');
  run('git', ['check-ignore', '--quiet', absolute], true);
  const head = run('git', ['rev-parse','HEAD'], true), approval = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  validateRollbackApproval(approval, head);
  if (run('git', ['status','--porcelain'], true)) throw new Error('Rollback requires a clean, reviewed test-mode commit.');
  // Strict JSON is intentional: if config format changes, stop for review.
  const vars = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8')).vars;
  if (Object.entries(TEST_VARS).some(([key, value]) => vars[key] !== value)) throw new Error('Commit and validate the prepared test-mode vars patch before applying rollback.');
  const headers = {Accept:'application/vnd.github+json', ...(process.env.GH_TOKEN ? {Authorization:`Bearer ${process.env.GH_TOKEN}`} : {})};
  const request = async suffix => { const r = await fetch('https://api.github.com/repos/Ohiopetwastepros/opwp-website/' + suffix, {headers, signal:AbortSignal.timeout(15000)}); if (!r.ok) throw new Error('GitHub release gate could not be verified.'); return r.json(); };
  if (!(await request('pulls/4')).merged) throw new Error('PR #4 must be merged before release.');
  const runs = await request('actions/runs?head_sha=' + head + '&per_page=100');
  if (!runs.workflow_runs?.some(row => row.head_sha === head && row.name === 'Production quality gate' && row.status === 'completed' && row.conclusion === 'success')) throw new Error('The exact rollback commit needs a successful Production quality gate.');
  const plan = rollbackPlan(vars);
  run('npx', ['wrangler','d1','execute','opwp-backend','--remote','--command', plan.sql]);
  // All existing release locks, private-input checks and security checks apply.
  run('npm', plan.deploy.slice(1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--apply')) apply(args.includes('--approval-file') ? args[args.indexOf('--approval-file') + 1] : null).catch(() => { console.error('Rollback stopped. Review prerequisites and the private approval; no automatic retry.'); process.exitCode = 1; });
  else console.log(JSON.stringify(rollbackPlan(), null, 2));
}
