import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opwp-build-input-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'scripts'));
  fs.mkdirSync(path.join(root,'tests/fixtures'),{recursive:true});
  fs.copyFileSync(new URL('../scripts/prepare-build-inputs.mjs',import.meta.url),path.join(root,'scripts/prepare-build-inputs.mjs'));
  fs.copyFileSync(new URL('../scripts/render-test-migrations.mjs',import.meta.url),path.join(root,'scripts/render-test-migrations.mjs'));
  fs.cpSync(new URL('./fixtures/migration-templates/',import.meta.url),path.join(root,'tests/fixtures/migration-templates'),{recursive:true});
  for(const file of ['migration-template-index.json','migration-bindings.json'])fs.copyFileSync(new URL('./fixtures/'+file,import.meta.url),path.join(root,'tests/fixtures',file));
  for(const file of ['meta-ads.json','route-density.json','dog-food-reconciliation.json','financial-defaults.json','routing-private.json','staff-private.json','operational-private.json','bank-example.json'])fs.copyFileSync(new URL('./fixtures/'+file,import.meta.url),path.join(root,'tests/fixtures',file));
  const run=(args=[],source=null,ci='true')=>spawnSync(process.execPath,source?['--input-type=module','-e',source]:['scripts/prepare-build-inputs.mjs',...args],{cwd:root,env:{...process.env,CI:ci},encoding:'utf8',windowsHide:true});
  return {root,run};
}
test('synthetic inputs are explicit, deterministic and refused by production deployment',t=>{
  const f=fixture(t);
  assert.notEqual(f.run().status,0);
  assert.notEqual(f.run(['--synthetic'],null,'false').status,0);
  {const prepared=f.run(['--synthetic']);assert.equal(prepared.status,0,prepared.stderr);}
  const release=fs.readFileSync(path.join(f.root,'lib/deployment-release.json'),'utf8');
  assert.equal(f.run().status,0);
  assert.equal(fs.readFileSync(path.join(f.root,'lib/deployment-release.json'),'utf8'),release);
  const result=f.run([],"import {validateBuildInputs} from './scripts/prepare-build-inputs.mjs';validateBuildInputs({production:true});");
  assert.notEqual(result.status,0);assert.match(result.stderr,/refuses synthetic/);
});
test('changed inputs fail closed and synthetic preparation cannot overwrite a private workspace',t=>{
  const f=fixture(t);{const prepared=f.run(['--synthetic']);assert.equal(prepared.status,0,prepared.stderr);}
  const input=path.join(f.root,'data/meta-ads-audit-2026-10-06.json');
  fs.appendFileSync(input,' ');assert.notEqual(f.run().status,0);
  const manifest=path.join(f.root,'tmp/private-build-inputs-manifest.json');
  const value=JSON.parse(fs.readFileSync(manifest,'utf8'));value.mode='private';fs.writeFileSync(manifest,JSON.stringify(value));
  const before=fs.readFileSync(input,'utf8');const result=f.run(['--synthetic']);
  assert.notEqual(result.status,0);assert.match(result.stderr,/Refusing to overwrite/);assert.equal(fs.readFileSync(input,'utf8'),before);
});
