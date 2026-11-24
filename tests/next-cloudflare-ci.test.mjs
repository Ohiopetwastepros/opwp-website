import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {allowsSyntheticCi} from '../scripts/prepare-build-inputs.mjs';

const source=fs.readFileSync(new URL('../next.config.js',import.meta.url),'utf8');
function loadConfiguration(ci){
  const calls=[],module={exports:{}};
  vm.runInNewContext(source,{module,process:{env:{CI:ci}},require(name){assert.equal(name,'@opennextjs/cloudflare');return{initOpenNextCloudflareForDev(options){calls.push(options);}};}});
  return {calls,config:module.exports};
}

for(const ci of ['true','1'])test(`CI=${ci} compiles with local bindings and no remote Cloudflare credential requirement`,async()=>{
  assert.equal(allowsSyntheticCi(ci),true);
  const {calls,config}=loadConfiguration(ci);
  assert.equal(calls.length,1);assert.equal(calls[0].remoteBindings,false);
  assert.equal(config.poweredByHeader,false);assert.equal(config.trailingSlash,true);
  const headers=await config.headers();assert.ok(headers.some(rule=>rule.headers.some(header=>header.key==='Strict-Transport-Security')));
});

test('ordinary local development retains the configured remote binding behavior',()=>{
  for(const ci of [undefined,'','false'])assert.equal(loadConfiguration(ci).calls[0].remoteBindings,true);
});
