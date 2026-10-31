import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const receiptDir = path.join(root, 'tmp/deployments');
export const lockPath = path.join(os.homedir(), '.codex', 'opwp-website-deployment.lock');
export const controllerLockPath = path.join(os.homedir(), '.codex', 'opwp-website-recovery.lock');
export const recoveryRequestPath = path.join(receiptDir, 'controller-request.json');
export const recoveryTaskName = 'OPWP Deployment Recovery';
fs.mkdirSync(receiptDir, { recursive: true });
export function run(command, args = [], { capture = false, logFile, timeout = 900_000, cwd = root } = {}) {
  let executable = command;
  if (command === 'npm') {
    executable = process.execPath;
    const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
    const cli = candidates.find(file => fs.existsSync(file));
    if (!cli) throw new Error('npm CLI could not be located');
    args = [cli, ...args];
  } else if (command === 'wrangler' || command === 'opennext') {
    executable = process.execPath;
    const packageRoot = path.join(root, 'node_modules', command === 'wrangler' ? 'wrangler' : '@opennextjs/cloudflare');
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[command === 'wrangler' ? 'wrangler' : 'opennextjs-cloudflare'];
    args = [path.join(packageRoot, bin), ...args];
  }
  const fd = logFile ? fs.openSync(logFile, 'a') : null;
  try {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, stdio: fd !== null ? ['ignore', fd, fd] : capture ? 'pipe' : 'inherit' });
    if (result.status !== 0) throw new Error(result.error?.code === 'ETIMEDOUT' ? 'Command timed out' : 'Command failed');
    return result.stdout || '';
  } finally { if (fd !== null) fs.closeSync(fd); }
}
export function fingerprint() {
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { capture: true }).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    if (file === 'lib/deployment-release.json') continue;
    hash.update(file + '\0');
    const target = path.join(root, file);
    hash.update(fs.existsSync(target) ? fs.readFileSync(target) : 'DELETED');
  }
  return hash.digest('hex');
}
export function readRuns() {
  return fs.readdirSync(receiptDir).filter(file => /^[a-f0-9-]{36}\.json$/.test(file)).flatMap(file => {
    try { const entry = JSON.parse(fs.readFileSync(path.join(receiptDir, file), 'utf8')); return entry.id === file.slice(0, -5) ? [entry] : []; } catch { return []; }
  }).sort((a, b) => (b.createdAt || b.updatedAt || '').localeCompare(a.createdAt || a.updatedAt || ''));
}
export function saveSnapshot(key, payload, localFile) {
  fs.writeFileSync(localFile, JSON.stringify(payload, null, 2));
  const outboxFile = localFile + '.pending';
  fs.writeFileSync(outboxFile, key);
  const literal = text => "'" + text.replaceAll("'", "''") + "'";
  const sql = `INSERT INTO airtable_cockpit_snapshots (snapshot_key,payload,status,captured_at,updated_at) VALUES (${literal(key)},${literal(JSON.stringify(payload))},'success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP;`;
  const file = localFile.replace(/\.json$/, '.sql'); fs.writeFileSync(file, sql);
  run('wrangler', ['d1', 'execute', 'opwp-backend', '--remote', '--file', file, '--yes'], { capture: true, timeout: 60_000 });
  acknowledgeSnapshot(outboxFile);
}
export function acknowledgeSnapshot(file) {
  // The foreground runner and receipt flusher may both acknowledge the same
  // successful remote write. Missing is already acknowledged; other errors fail.
  try { fs.unlinkSync(file); } catch(error) { if(error.code!=='ENOENT')throw error; }
}
export function flushReceipts() {
  for (const name of fs.readdirSync(receiptDir).filter(file => /^(?:[a-f0-9-]{36}|controller)\.json\.pending$/.test(file)).slice(0, 20)) {
    const marker = path.join(receiptDir, name);
    const file = marker.slice(0, -8);
    saveSnapshot(fs.readFileSync(marker, 'utf8'), JSON.parse(fs.readFileSync(file, 'utf8')), file);
  }
}
export function record(release) {
  release.updatedAt = new Date().toISOString();
  saveSnapshot('deployment_run:' + release.id, release, path.join(receiptDir, `${release.id}.json`));
}
export function heartbeat(state) {
  saveSnapshot('deployment_controller_v1', { mode: 'failure_triggered', ...state, checkedAt: new Date().toISOString() }, path.join(receiptDir, 'controller.json'));
}
export function requestRecovery(releaseId, { file = recoveryRequestPath, platform = process.platform, spawn = spawnSync } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(releaseId || '')) throw new Error('A valid release ID is required for automatic recovery');
  fs.writeFileSync(file, JSON.stringify({ releaseId, requestedAt: new Date().toISOString() }, null, 2));
  if (platform !== 'win32') throw new Error('Automatic recovery requires the configured Windows scheduled task');
  const result = spawn('schtasks.exe', ['/Run', '/TN', recoveryTaskName], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  if (result.status !== 0) throw new Error('The OPWP deployment recovery task could not be started');
  return true;
}
export function readRecoveryRequest(file = recoveryRequestPath) {
  if (!fs.existsSync(file)) return null;
  try {
    const request = JSON.parse(fs.readFileSync(file, 'utf8'));
    return /^[a-f0-9-]{36}$/.test(request.releaseId || '') ? request : null;
  } catch { return null; }
}
export function clearRecoveryRequest(releaseId, file = recoveryRequestPath) {
  const request = readRecoveryRequest(file);
  if (request?.releaseId !== releaseId) return false;
  fs.unlinkSync(file);
  return true;
}
export function acquireLock(file, id) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, root, id, createdAt: new Date().toISOString() }), { flag: 'wx' }); return true; }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}
export function recoverAbandonedLock(file, now = Date.now()) {
  if (!fs.existsSync(file) || now - fs.statSync(file).mtimeMs < 30 * 60_000) return false;
  let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') return false; }
  fs.unlinkSync(file); return true;
}
