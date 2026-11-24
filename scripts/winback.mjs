import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseWinbackCsv, planWinbackImport, winbackHash, winbackReport } from '../lib/winback-policy.mjs';
import { importWinbackCampaign, winbackRecipients } from '../lib/winback-store.mjs';
import { buildWinbackDryRun, winbackDryRunMarkdown } from '../lib/winback-dry-run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function localPath(value) {
  const target = path.resolve(root, value || 'tmp/winback/campaign.sqlite'), allowed = path.resolve(root, 'tmp', 'winback');
  if (!target.toLowerCase().startsWith(allowed.toLowerCase() + path.sep) || !target.endsWith('.sqlite')) throw new Error('Only a local tmp/winback/*.sqlite database is allowed.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const realParent = fs.realpathSync(path.dirname(target));
  if (!realParent.toLowerCase().startsWith(allowed.toLowerCase() + path.sep) && realParent.toLowerCase() !== allowed.toLowerCase()) throw new Error('Local database target leaves the private workspace.');
  return target;
}
function database(file, { readOnly = false } = {}) {
  const target = localPath(file);
  if (readOnly && !fs.existsSync(target)) throw new Error('An imported local campaign database is required.');
  const sqlite = new DatabaseSync(target, { readOnly });
  sqlite.exec('PRAGMA foreign_keys=ON');
  if (!sqlite.prepare("SELECT 1 ok FROM sqlite_master WHERE name='winback_campaigns'").get()) {
    if (readOnly) throw new Error('Local campaign storage has not been imported.');
    sqlite.exec(fs.readFileSync(path.join(root, 'schema-proposals/0072_win_back_campaign.sql'), 'utf8'));
  }
  const wrap = (sql, values = []) => ({ bind: (...args) => wrap(sql, args), first: async () => sqlite.prepare(sql).get(...values) || null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }), execute: () => sqlite.prepare(sql).run(...values) });
  return { sqlite, prepare: sql => wrap(sql), batch: async statements => { sqlite.exec('BEGIN'); try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
function ignoredOutput(value) {
  if (!value) throw new Error('An explicit ignored --out path is required.');
  const target = path.resolve(root, value), relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dry-run output must remain inside the private workspace.');
  try { execFileSync('git', ['check-ignore', '--quiet', '--', relative], { cwd: root, stdio: 'ignore' }); } catch { throw new Error('Operational reports must use a git-ignored output path.'); }
  return target;
}
export async function winbackCli(args = process.argv.slice(2)) {
  const [command, ...tail] = args, options = {};
  for (let i = 0; i < tail.length; i += 2) { if (!/^--[a-z-]+$/.test(tail[i]) || !tail[i + 1] || tail[i + 1].startsWith('--') || Object.hasOwn(options, tail[i].slice(2))) throw new Error('Use explicit --option value arguments.'); options[tail[i].slice(2)] = tail[i + 1]; }
  if (!['dry-run', 'import-local', 'report'].includes(command)) throw new Error('Commands: dry-run, import-local, report. There is no send or remote command.');
  if (Object.keys(options).some(key => !['csv','copy','rules','batch','out','database','campaign','name'].includes(key))) throw new Error('Unknown option.');
  if (!options.campaign && command !== 'dry-run') throw new Error('--campaign is required.');
  if (command === 'report') { const db = database(options.database, {readOnly:true}); try { return { report: winbackReport(await winbackRecipients(db, options.campaign)) }; } finally { db.sqlite.close(); } }
  if (!options.csv || !options.copy || !options.rules) throw new Error('The original CSV, approved private --copy, and private --rules files are required. No fabricated production input is substituted.');
  const csv = fs.readFileSync(path.resolve(options.csv), 'utf8'), rows = parseWinbackCsv(csv), copy = JSON.parse(fs.readFileSync(path.resolve(options.copy), 'utf8')), rules = options.rules ? JSON.parse(fs.readFileSync(path.resolve(options.rules), 'utf8')) : {};
  if (command === 'dry-run') {
    const batch = Number(options.batch || 1);
    if (!Number.isInteger(batch) || batch < 1 || batch > 1000) throw new Error('Invalid batch.');
    // This CLI intentionally has no credentials, network or sender. Missing
    // send-time authority is reported as held, never as will-send.
    let assignedRecipients = null;
    if (options.campaign) { const db = database(options.database, {readOnly:true}); try { assignedRecipients = await winbackRecipients(db, options.campaign); } finally { db.sqlite.close(); } }
    const result = await buildWinbackDryRun(rows, copy, { rules, batch, assignedRecipients });
    const output = ignoredOutput(options.out); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, winbackDryRunMarkdown(result, { batch }));
    return { totals: result.totals, reportSaved: true, providerChecks: 'not verified; all sends held' };
  }
  const db = database(options.database);
  try { const plan = planWinbackImport(rows, rules); return await importWinbackCampaign(db, { id: options.campaign, name: options.name || options.campaign, sourceSha256: await winbackHash(csv), copy, recipients: plan.recipients, reviewEnabled: plan.reviewEnabled }); }
  finally { db.sqlite.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await winbackCli())); }
  catch { console.error('Win-back command refused. Verify the command, original private inputs, approval, and ignored output path. No send was attempted.'); process.exitCode = 1; }
}
