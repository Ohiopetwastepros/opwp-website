import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PREVIEW_BRANCH = 'codex/route-os-billing-uat-2026-11-21';
export const PREVIEW_ORIGIN = 'http://localhost:8787';
export const PREVIEW_DATABASE = 'opwp-route-os-local-preview';
const source = fileURLToPath(new URL('../', import.meta.url));
export const previewBuild = path.join(process.env.LOCALAPPDATA || 'C:/Users/Craig/AppData/Local', 'CodexBuildCaches', 'opwp-route-os-local-preview-20261121');
export const previewState = path.join(source, '.wrangler', 'route-os-ui-preview');

export function previewVars() {
  return {
    APP_ENV: 'development', LOCAL_PREVIEW_ENABLED: 'true', LOCAL_PREVIEW_ORIGIN: PREVIEW_ORIGIN,
    ROUTE_OS_SUBSCRIPTIONS_ENABLED: 'true', ROUTE_OS_BILLING_ENABLED: 'true', CRM_PAYMENTS_ENV: 'uat', CRM_PAYMENTS_PROVIDER: 'fake', CRM_QBO_FIXTURES_ENABLED: 'true',
    SITE_ORIGIN: PREVIEW_ORIGIN, WORKER_ORIGIN: PREVIEW_ORIGIN,
    ADMIN_USERNAME: 'preview.admin@example.test', ADMIN_PASSWORD: 'LocalPreview!2026',
    ADMIN_SESSION_SECRET: 'local-preview-admin-session-secret-only-2026-11-21',
    ADMIN_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), LOCAL_PREVIEW_ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    FIELD_AUTH_SECRET: 'local-preview-field-secret-only-2026-11-21',
    OFFICE_SESSION_SECRET: 'local-preview-office-session-secret-only-2026-11-21',
    FOOD_SALES_AUTH_SECRET: 'local-preview-food-sales-secret-only-2026-11-21',
    FOOD_SALES_NATIVE_ENABLED: 'true', FOOD_SALES_RECORDING_ENABLED: 'true', FOOD_SALES_LEGACY_WRITES_FROZEN: 'true',
    EMAIL_SENDING_ENABLED: 'false', EMAIL_PROVIDER: 'disabled', SMS_PROVIDER: 'disabled',
    FIELD_NOTIFICATIONS_ENABLED: 'false', META_AUTOMATION_ENABLED: 'false', META_TEST_MODE: 'false',
    DISPATCH_AUTOMATION_ENABLED: 'false', ROUTE_ROAD_CALCULATIONS_ENABLED: 'false', REVIEW_REQUESTS_ENABLED: 'false',
    OWNER_NOTIFICATION_EMAIL: 'preview.admin@example.test', EMAIL_FROM: 'preview.admin@example.test',
  };
}
export function previewConfig() {
  return {
    name: 'opwp-route-os-local-preview', main: '.open-next/local-preview-worker.mjs',
    compatibility_date: '2026-08-28', compatibility_flags: ['nodejs_compat'],
    assets: { binding: 'ASSETS', directory: '.open-next/assets' },
    d1_databases: [{ binding: 'DB', database_name: PREVIEW_DATABASE, database_id: '00000000-0000-4000-8000-000000000071', migrations_dir: 'tmp/local-preview/migrations' }],
    r2_buckets: [{ binding: 'FIELD_PROOFS', bucket_name: 'opwp-local-preview-proofs' }],
    vars: previewVars(), dev: { ip: '127.0.0.1', port: 8787, local_protocol: 'http' },
    observability: { enabled: false }, triggers: { crons: [] },
  };
}
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CLOUDFLARE_|CF_API|AIRTABLE_|QUO_|RESEND_|SNG_|STRIPE_|QBO_|QUICKBOOKS_|CARDPOINTE_|ADMIN_|FIELD_AUTH_SECRET|OFFICE_SESSION_SECRET)/i.test(key)));
  return { ...env, WRANGLER_SEND_METRICS: 'false', CI: 'true', ...extra };
}
function run(args, { cwd = previewBuild, extraEnv = {} } = {}) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true, env: cleanEnv(extraEnv) });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Local preview command failed (${result.status}): ${args[0]}`);
}
export function wranglerArgs(operation, extra = []) {
  if (!['migrate', 'seed', 'serve'].includes(operation)) throw new Error('Unknown local operation.');
  const common = ['--config', 'wrangler.local-preview.json', '--env-file', 'tmp/local-preview/no-secrets.env'];
  const local = ['--local', '--persist-to', previewState];
  const head = operation === 'migrate' ? ['d1', 'migrations', 'apply', PREVIEW_DATABASE] : operation === 'seed' ? ['d1', 'execute', PREVIEW_DATABASE, '--file', 'tmp/local-preview/seed.sql', '--yes'] : ['dev', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '9238', '--show-interactive-dev-session=false'];
  return ['node_modules/wrangler/bin/wrangler.js', ...head, ...common, ...local, ...extra];
}
export function assertPreviewBranch() {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: source, encoding: 'utf8' }).trim();
  if (branch !== PREVIEW_BRANCH) throw new Error(`Local preview must run from ${PREVIEW_BRANCH}.`);
}
export function copyPreviewSources() {
  assertPreviewBranch();
  fs.mkdirSync(previewBuild, { recursive: true });
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const relative of files) {
    const destination = path.join(previewBuild, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(source, relative), destination);
  }
  // This independent cache contains fabricated bindings only. Never copy private inputs or environment files.
  const manifestPath = path.join(previewBuild, 'tmp/private-build-inputs-manifest.json');
  if (fs.existsSync(manifestPath) && JSON.parse(fs.readFileSync(manifestPath, 'utf8')).mode !== 'synthetic') throw new Error('Refusing to overwrite a private-input build cache.');
  run(['scripts/prepare-build-inputs.mjs', '--synthetic']);
  const localDirectory = path.join(previewBuild, 'tmp/local-preview'); fs.mkdirSync(path.join(localDirectory, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(localDirectory, 'no-secrets.env'), '# Deliberately empty; all local-only fixture values are in wrangler.local-preview.json.\n');
  for (const name of fs.readdirSync(path.join(previewBuild, 'tmp/test-migrations')).filter(name => name.endsWith('.sql'))) fs.copyFileSync(path.join(previewBuild, 'tmp/test-migrations', name), path.join(localDirectory, 'migrations', name));
  for (const name of fs.readdirSync(path.join(previewBuild, 'schema-proposals')).filter(name => /^00(?:6\d|7[01])_.*\.sql$/.test(name))) fs.copyFileSync(path.join(previewBuild, 'schema-proposals', name), path.join(localDirectory, 'migrations', name));
  fs.writeFileSync(path.join(previewBuild, 'wrangler.local-preview.json'), JSON.stringify(previewConfig(), null, 2));
}
export async function seedPreview() {
  assertPreviewBranch();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const { createLocalPreviewCrmSeed } = await import(pathToFileURL(path.join(previewBuild, 'scripts/local-preview-crm-seed.mjs')));
  const { createLocalPreviewFieldSeed } = await import(pathToFileURL(path.join(previewBuild, 'scripts/local-preview-field-seed.mjs')));
  const { localPreviewAdminSeed } = await import(pathToFileURL(path.join(previewBuild, 'lib/local-preview-admin.mjs')));
  const crm = await createLocalPreviewCrmSeed({ today });
  const field = await createLocalPreviewFieldSeed({ today, fieldSecret: previewVars().FIELD_AUTH_SECRET });
  const admin = await localPreviewAdminSeed(previewVars());
  const directory = path.join(previewBuild, 'tmp/local-preview');
  fs.writeFileSync(path.join(directory, 'seed.sql'), [crm.sql, field.sql, admin.sql].join('\n'));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ today, origin: PREVIEW_ORIGIN, branch: PREVIEW_BRANCH, crm: crm.manifest, field: field.manifest }, null, 2));
  run(wranglerArgs('migrate')); run(wranglerArgs('seed'));
}
export function writePreviewWorker() {
  const markReviewSource = path.join(source, 'output/route-os-mark-v2');
  if (fs.existsSync(markReviewSource)) {
    const markReviewDestination = path.join(previewBuild, '.open-next/assets/local-preview/mark-review');
    fs.cpSync(markReviewSource, markReviewDestination, {recursive:true,filter:filename=>fs.statSync(filename).isDirectory()||/\.(?:html|png|jpe?g|json)$/.test(filename)});
  }
  const reviewSource = path.join(source, 'output/route-os-rebuild');
  if (fs.existsSync(reviewSource)) {
    const reviewDestination = path.join(previewBuild, '.open-next/assets/local-preview/review');
    fs.mkdirSync(reviewDestination, { recursive: true });
    for (const name of fs.readdirSync(reviewSource).filter(name => /\.(?:html|png|jpe?g|json)$/.test(name))) fs.copyFileSync(path.join(reviewSource, name), path.join(reviewDestination, name));
  }
  const photoPath = path.join(source, 'tmp/local-preview-test-photo.jpg');
  if (fs.existsSync(photoPath)) {
    const photoDirectory = path.join(previewBuild, '.open-next/assets/local-preview');
    fs.mkdirSync(photoDirectory, { recursive: true }); fs.copyFileSync(photoPath, path.join(photoDirectory, 'test-photo.jpg'));
  }
  const documents = ['docs/ROUTE_OS_LOCAL_PREVIEW.md', 'docs/LOCAL_PREVIEW_ADMIN_PAGES.md', 'docs/ROUTE_OS_LOCAL_FIELD_CLICKTHROUGH.md'];
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const inline = text => escape(text).replace(/\[([^\]]+)\]\((http:\/\/localhost:8787[^)]*)\)/g, '<a href="$2">$1</a>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const render = markdown => {
    let table = false, list = false; const output = [];
    for (const line of markdown.split(/\r?\n/)) {
      if (!line.startsWith('|') && table) { output.push('</tbody></table></div>'); table = false; }
      if (!/^(?:- |\d+\. )/.test(line) && list) { output.push('</ul>'); list = false; }
      if (line.startsWith('|')) {
        if (/^\|[\s|:-]+\|$/.test(line)) continue;
        if (!table) { output.push('<div class="table"><table><tbody>'); table = true; }
        output.push('<tr>' + line.slice(1, -1).split('|').map(cell => `<td>${inline(cell.trim())}</td>`).join('') + '</tr>');
      } else if (/^#{1,4} /.test(line)) { const depth = line.match(/^#+/)[0].length; output.push(`<h${depth}>${inline(line.slice(depth + 1))}</h${depth}>`); }
      else if (/^(?:- |\d+\. )/.test(line)) { if (!list) { output.push('<ul>'); list = true; } output.push(`<li>${inline(line.replace(/^(?:- |\d+\. )/, ''))}</li>`); }
      else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
    }
    if (table) output.push('</tbody></table></div>'); if (list) output.push('</ul>'); return output.join('\n');
  };
  const body = documents.filter(file => fs.existsSync(path.join(source, file))).map(file => render(fs.readFileSync(path.join(source, file), 'utf8'))).join('<hr>');
  const guide = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Route OS full local click-through guide</title><style>body{font:16px/1.55 system-ui;color:#18263a;background:#f5f7fb;margin:30px auto;max-width:1150px;padding:0 20px}a{color:#174c9c}h1,h2{line-height:1.2;margin-top:36px}.table{overflow:auto}table{border-collapse:collapse;background:white;width:100%;margin:18px 0}td{border:1px solid #d3dce8;padding:12px;vertical-align:top}code{background:#e8edf5;padding:2px 4px}li{margin:10px 0}hr{margin:50px 0}</style><body><a href="/local-preview/">Back to local preview</a>${body}</body></html>`;
  const worker = fs.readFileSync(path.join(source, 'scripts/local-preview-worker.mjs'), 'utf8').replace(JSON.stringify('__LOCAL_PREVIEW_GUIDES__'), JSON.stringify(guide));
  fs.writeFileSync(path.join(previewBuild, '.open-next/local-preview-worker.mjs'), worker);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action === 'prepare') copyPreviewSources();
  else if (action === 'build') {
    assertPreviewBranch();
    run(['node_modules/@opennextjs/cloudflare/dist/cli/index.js', 'build']);
    run(['scripts/patch-open-next-worker.mjs']); run(['scripts/patch-quote-follow-up-worker.mjs']); run(['scripts/check-quote-follow-up-worker.mjs']);
    writePreviewWorker();
  }
  else if (action === 'seed') await seedPreview();
  else if (action === 'worker') writePreviewWorker();
  else if (action === 'start') { assertPreviewBranch(); run(wranglerArgs('serve'), { extraEnv: { CI: 'false' } }); }
  else throw new Error('Use prepare, build, seed, worker or start.');
}
