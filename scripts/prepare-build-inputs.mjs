import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {renderTestMigrations} from './render-test-migrations.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
const manifestPath=path.join(root,'tmp/private-build-inputs-manifest.json');
const digest=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const privatePaths=['data/meta-ads-audit-2026-10-06.json','data/route-density-audit-2026-10-06.json','scripts/dog-food-inventory-rollback.sql','lib/dog-food-reconciliation.json','migrations/0056_dog_food_inventory_costs.sql','lib/financial-defaults.json','lib/routing-private.json','lib/staff-private.json','private/production-migrations.json','lib/operational-private.json','scripts/create-meta-audit-report.py','scripts/prepare-meta-audit.py','lib/bank-private.json'];
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n');};
export function validateBuildInputs({production=false}={}) {
  if(!fs.existsSync(manifestPath))throw Error('Private build inputs are required. CI must explicitly prepare synthetic inputs.');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(production && manifest.mode!=='private')throw Error('Production deployment refuses synthetic build inputs.');
  if(!['private','synthetic'].includes(manifest.mode))throw Error('Unknown build-input mode.');
  if(manifest.mode==='synthetic' && process.env.CI!=='true')throw Error('Synthetic build inputs are restricted to CI.');
  const expected=manifest.mode==='private'?privatePaths:['data/meta-ads-audit-2026-10-06.json','data/route-density-audit-2026-10-06.json','lib/dog-food-reconciliation.json','lib/financial-defaults.json','lib/routing-private.json','lib/staff-private.json','lib/operational-private.json','lib/bank-private.json'];
  if(!Array.isArray(manifest.files)||manifest.files.length!==expected.length||!expected.every(file=>manifest.files.filter(item=>item.path===file).length===1))throw Error('Build-input manifest is incomplete.');
  for(const item of manifest.files)if(!expected.includes(item.path)||digest(item.path)!==item.sha256)throw Error('Private build input changed; review the source before release.');
  if(manifest.mode==='private'){
    const archive=JSON.parse(fs.readFileSync(path.join(root,'private/production-migrations.json'),'utf8'));
    if(!Array.isArray(archive.files)||archive.files.length!==60)throw Error('Original production migration archive is incomplete.');
    for(const file of archive.files)if(!/^migrations\/\d{4}_[a-z0-9_]+\.sql$/.test(file.path)||digest(file.path)!==file.sha256)throw Error('Original production migration bytes changed.');
  }
  return manifest.mode;
}
export function prepareBuildInputs({synthetic=false}={}) {
  if(synthetic){
    if(process.env.CI!=='true')throw Error('Synthetic preparation requires the explicit CI environment.');
    if(fs.existsSync(manifestPath)&&JSON.parse(fs.readFileSync(manifestPath,'utf8')).mode==='private')throw Error('Refusing to overwrite existing private production inputs.');
    const pairs=[['tests/fixtures/meta-ads.json','data/meta-ads-audit-2026-10-06.json'],['tests/fixtures/route-density.json','data/route-density-audit-2026-10-06.json'],['tests/fixtures/dog-food-reconciliation.json','lib/dog-food-reconciliation.json'],['tests/fixtures/financial-defaults.json','lib/financial-defaults.json'],['tests/fixtures/routing-private.json','lib/routing-private.json'],['tests/fixtures/staff-private.json','lib/staff-private.json'],['tests/fixtures/operational-private.json','lib/operational-private.json'],['tests/fixtures/bank-example.json','lib/bank-private.json']];
    for(const [source,target] of pairs){fs.mkdirSync(path.dirname(path.join(root,target)),{recursive:true});fs.copyFileSync(path.join(root,source),path.join(root,target));}
    write('tmp/private-build-inputs-manifest.json',{mode:'synthetic',files:pairs.map(([,file])=>({path:file,sha256:digest(file)}))});
  }
  validateBuildInputs();
  renderTestMigrations(root,validateBuildInputs());
  const release='lib/deployment-release.json';
  if(!fs.existsSync(path.join(root,release)))write(release,{id:'00000000-0000-4000-8000-000000000000',sourceHash:'local-or-ci-build',summary:'Local or CI build; not a production release',updatedAt:'1970-01-01T00:00:00.000Z'});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareBuildInputs({synthetic:process.argv.includes('--synthetic')});
