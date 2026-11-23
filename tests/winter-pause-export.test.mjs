import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, symlinkSync, unlinkSync, rmdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {winterPauseCsv, winterPauseRows} from '../lib/winter-pause-export.mjs';
import {exportWinterPauses, privateExportPath} from '../scripts/export-winter-pauses.mjs';

const row = (overrides = {}, metadata = {}) => ({snapshot_key: 'winter_pause:org-opwp:fictional-thread',
  payload: {conversationId: 'fictional-thread', name: 'Casey Example', phone: '+14195550100', pauseStart: '',
    plannedRestart: 'March 2027', status: 'staff_review', ...overrides}, ...metadata});

test('winter export keeps staff-review requests without inventing a pause start or applying a pause', () => {
  assert.deepEqual(winterPauseRows([row()]), [{name: 'Casey Example', phone: '+14195550100', pause_start: '', planned_restart: 'March 2027'}]);
  assert.equal(winterPauseRows([row({}, {payload: JSON.stringify(row().payload)})]).length, 1);
});

test('winter export excludes other organizations, malformed payloads and mismatched thread identities', () => {
  assert.deepEqual(winterPauseRows([row({}, {snapshot_key: 'winter_pause:other-org:fictional-thread'}),
    row({}, {payload: '{broken'}), row({conversationId: 'different-thread'}), row({status: 'applied'}), row({phone: 'invalid'})]), []);
  assert.throws(() => winterPauseRows({}), /Expected an array/);
});

test('winter export selects the latest request and neutralizes CSV formulas and embedded line breaks', () => {
  const older = row({name: 'Earlier Example'}, {updated_at: '2026-11-22T12:00:00Z'});
  const newer = row({name: '=DANGEROUS()\n"quoted"', pauseStart: '@unexpected'}, {updated_at: '2026-11-23T12:00:00Z'});
  const csv = winterPauseCsv([newer, older]);
  assert.match(csv, /"'=DANGEROUS\(\) ""quoted"""/);
  assert.match(csv, /"'\+14195550100"/);
  assert.match(csv, /"'@unexpected"/);
  assert.doesNotMatch(csv, /Earlier Example/);
  assert.equal(csv.trimEnd().split('\n').length, 2);
});

test('winter export refuses public and outside paths and only writes a private CSV from local snapshots', t => {
  assert.throws(() => privateExportPath('docs/winter-pause-list.csv'), /ignored private/);
  assert.throws(() => privateExportPath('../winter-pause-list.csv'), /ignored private/);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const folder = mkdtempSync(path.join(root, 'tmp/winter-export-test-'));
  t.after(() => {
    const relative = path.relative(realpathSync(path.join(root, 'tmp')), realpathSync(folder));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    rmSync(folder, {recursive: true, force: true});
  });
  const input = path.join(folder, 'requests.json'), output = path.join(folder, 'winter-pause-list.csv');
  writeFileSync(input, JSON.stringify([row()]));
  assert.deepEqual(exportWinterPauses(['--input', input, '--output', output]), {requests: 1, appliedPauses: 0});
  assert.equal(readFileSync(output, 'utf8'), winterPauseCsv([row()]));
  assert.throws(() => exportWinterPauses(['--input', input, '--output', input]), /must differ/);
});

test('winter export refuses a private directory junction that actually points at public source', t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const folder = mkdtempSync(path.join(root, 'tmp/winter-export-link-'));
  const publicFolder = mkdtempSync(path.join(root, 'docs/winter-export-link-'));
  const link = path.join(folder, 'linked-public');
  t.after(() => {
    if (existsSync(link)) unlinkSync(link);
    // Both directories were created by this test; nonrecursive removal refuses unexpected contents.
    rmdirSync(folder);
    rmdirSync(publicFolder);
  });
  symlinkSync(publicFolder, link, 'junction');
  assert.throws(() => privateExportPath(path.join(link, 'winter-pause-list.csv')), /resolve inside ignored/);
  assert.equal(existsSync(path.join(publicFolder, 'winter-pause-list.csv')), false);
});
