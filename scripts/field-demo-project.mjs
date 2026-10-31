import {prepareBuildInputs} from './prepare-build-inputs.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root,run } from './deployment-store.mjs';
export const demoProject=path.join(root,'tmp/field-demo-deploy');
export const demoOrigin='https://opwp-field-demo.ohiopetwastepros.workers.dev';
export const demoFiles=[
  'app/field-demo','app/api/field-demo','app/field-sandbox','app/api/field-sandbox',
  'app/field/app/WorkdayApp.js','app/field/app/workday.module.css','app/admin/route-partner/workdays/WorkdayOffice.js','app/admin/route-partner/workdays/office.module.css',
  'public/field-sandbox','public/field-demo','public/assets/opwp-logo.webp',
  'lib/field-demo-model.mjs','lib/field-demo-legacy.mjs','lib/field-demo-server.mjs','lib/field-demo-storage.mjs','lib/field-timer.mjs','lib/field-policy.mjs','lib/field-quota.mjs','lib/bounded-body.mjs',
  'lib/field-sandbox-server.mjs','lib/field-workday-model.mjs','lib/field-workday-device.mjs','lib/field-workday-insights.mjs','lib/field-service-catalog.mjs','lib/field-recurring-services.mjs',
  'field-demo-runtime','package.json','package-lock.json','jsconfig.json','open-next.config.ts',
  'tmp/test-migrations/0047_field_mobile_demo.sql','tmp/test-migrations/0048_field_demo_photo_limit.sql','tmp/test-migrations/0028_api_rate_limits.sql','wrangler.field-demo.jsonc',
  'scripts/deploy.mjs','scripts/deploy-field-demo.mjs','scripts/field-demo-project.mjs','scripts/deployment-store.mjs','scripts/deployment-controller.mjs','lib/deployment-policy.mjs',
  'tests/field-mobile-demo.test.mjs','tests/field-demo-deployment.test.mjs','tests/field-demo-v2.test.mjs','tests/field-sandbox.test.mjs',
];
function filesWithin(relative){const target=path.join(root,relative);return fs.statSync(target).isDirectory()?fs.readdirSync(target).sort().flatMap(name=>filesWithin(`${relative}/${name}`)):[relative];}
export function demoFingerprint(){prepareBuildInputs();const hash=createHash('sha256');for(const file of demoFiles.flatMap(filesWithin).sort())hash.update(file+'\0').update(fs.readFileSync(path.join(root,file)));return hash.digest('hex');}
export function prepareDemoProject(release,{logFile}={}){
  fs.mkdirSync(demoProject,{recursive:true});
  // Copy an explicit allowlist. No production routes, middleware, secrets,
  // customer seed data, provider adapters or live database binding are included.
  for(const file of demoFiles.filter(file=>/^(app\/|public\/|lib\/field-|lib\/bounded-body)/.test(file))){const dest=path.join(demoProject,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(root,file),dest,{recursive:true});}
  fs.cpSync(path.join(root,'field-demo-runtime'),demoProject,{recursive:true});
  for(const file of ['package-lock.json','jsconfig.json','open-next.config.ts'])fs.copyFileSync(path.join(root,file),path.join(demoProject,file));
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));pkg.scripts={build:'next build','build:cloudflare':'opennextjs-cloudflare build'};fs.writeFileSync(path.join(demoProject,'package.json'),JSON.stringify(pkg,null,2));
  fs.writeFileSync(path.join(demoProject,'lib/demo-release.json'),JSON.stringify({id:release.id,sourceHash:release.sourceHash,summary:release.summary}));
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.field-demo.jsonc'),'utf8'));config.$schema='./node_modules/wrangler/config-schema.json';config.main='.open-next/worker.js';config.assets.directory='.open-next/assets';config.d1_databases[0].migrations_dir='demo-migrations';fs.writeFileSync(path.join(demoProject,'wrangler.jsonc'),JSON.stringify(config,null,2));
  fs.mkdirSync(path.join(demoProject,'demo-migrations'),{recursive:true});fs.writeFileSync(path.join(demoProject,'demo-migrations/0001_demo.sql'),fs.readFileSync(path.join(root,'tmp/test-migrations/0028_api_rate_limits.sql'),'utf8')+'\n'+fs.readFileSync(path.join(root,'tmp/test-migrations/0047_field_mobile_demo.sql'),'utf8'));
  fs.copyFileSync(path.join(root,'tmp/test-migrations/0048_field_demo_photo_limit.sql'),path.join(demoProject,'demo-migrations/0002_photo_limit.sql'));
  const lockHash=createHash('sha256').update(fs.readFileSync(path.join(demoProject,'package-lock.json'))).digest('hex');const marker=path.join(demoProject,'.dependency-hash');
  if(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==lockHash||!fs.existsSync(path.join(demoProject,'node_modules/next/package.json'))){run('npm',['ci','--ignore-scripts','--prefer-offline'],{cwd:demoProject,logFile});fs.writeFileSync(marker,lockHash);}
}
