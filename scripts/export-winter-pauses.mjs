import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {winterPauseCsv, winterPauseRows} from '../lib/winter-pause-export.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function privateExportPath(value, {input = false} = {}) {
  const target = path.resolve(root, value), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^(?:tmp|private)[\\/]/.test(relative)) {
    throw new Error('Winter-pause input and output must stay in ignored private or tmp storage.');
  }
  const existingParent = input ? target : path.dirname(target);
  let ancestor = existingParent;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolvedTarget = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  const realRelative = path.relative(fs.realpathSync(root), resolvedTarget);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative) || !/^(?:tmp|private)[\\/]/.test(realRelative)
    || fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error('Private export paths must resolve inside ignored private or tmp storage.');
  }
  execFileSync('git', ['check-ignore', '--quiet', '--', relative], {cwd: root, stdio: 'ignore', windowsHide: true});
  execFileSync('git', ['check-ignore', '--quiet', '--', realRelative], {cwd: root, stdio: 'ignore', windowsHide: true});
  return target;
}

export function exportWinterPauses(argv) {
  const args = argv.filter(value => value !== '--');
  if (args.length !== 2 && args.length !== 4 || args[0] !== '--input' || args.length === 4 && args[2] !== '--output') {
    throw new Error('Usage: node scripts/export-winter-pauses.mjs --input private/snapshots.json [--output private/winter-pause-list.csv]');
  }
  const input = privateExportPath(args[1], {input: true});
  const output = privateExportPath(args[3] || 'private/lead-playbook/winter-pause-list.csv');
  if (input === output) throw new Error('Input and output paths must differ.');
  const snapshots = JSON.parse(fs.readFileSync(input, 'utf8'));
  const csv = winterPauseCsv(snapshots);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, csv, {mode: 0o600});
  return {requests: winterPauseRows(snapshots).length, appliedPauses: 0};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(exportWinterPauses(process.argv.slice(2)))); }
  catch { console.error('Winter-pause export failed. Verify the private input format and ignored output location.'); process.exitCode = 1; }
}
