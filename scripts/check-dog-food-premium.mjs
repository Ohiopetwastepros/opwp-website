// Review integrity: preview may change presentation, never existing behavior.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='design/dog-food-premium',baseline=JSON.parse(fs.readFileSync(dir+'/baseline-hashes.json','utf8'));
const promoted=process.argv.includes('--promoted');
for(const [file,hash] of Object.entries(baseline.files)){
  assert.equal(createHash('sha256').update(fs.readFileSync(dir+'/baseline/'+file.split('/').at(-1))).digest('hex'),hash,'Archived baseline changed: '+file);
  if(promoted)assert.deepEqual(fs.readFileSync(file),fs.readFileSync(dir+'/account/'+file.split('/').at(-1)),'Published source differs from approved preview: '+file);
  else assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,'Production source changed: '+file);
}
function handlers(source){const found=[],pattern=/\b(on[A-Z]\w*)=\{/g;let m;while((m=pattern.exec(source))){let depth=1,q='',escape=false,i=pattern.lastIndex;for(;i<source.length&&depth;i++){const c=source[i];if(q){if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c===q)q='';}else if(['"',"'",'`'].includes(c))q=c;else if(c==='{')depth++;else if(c==='}')depth--;}
 assert.equal(depth,0,'Balanced handler expression');found.push(m[1]+'='+source.slice(pattern.lastIndex,i-1).replace(/\s+/g,' ').trim());pattern.lastIndex=i;}return found.sort();}
for(const file of Object.keys(baseline.files).filter(p=>p.endsWith('.js'))){const name=file.split('/').at(-1),original=fs.readFileSync(dir+'/baseline/'+name,'utf8'),preview=fs.readFileSync(dir+'/account/'+name,'utf8');assert.deepEqual(handlers(preview),handlers(original),`Existing handler changed: ${name}`);}
for(const [name,start,anchor] of [['FoodAccountClient.js','export default function FoodAccountClient','  return <div className={`'],['MonthlyPlans.js','export default function MonthlyPlans','  return <section'],['ProductShop.js','export default function ProductShop','  return <section'],['ProductShop.js','function ProductDetails','  return <dialog']]){const a=fs.readFileSync(dir+'/baseline/'+name,'utf8').replaceAll('\r\n','\n'),b=fs.readFileSync(dir+'/account/'+name,'utf8').replaceAll('\r\n','\n');assert.equal(b.slice(b.indexOf(start),b.indexOf(anchor,b.indexOf(start))),a.slice(a.indexOf(start),a.indexOf(anchor,a.indexOf(start))),`Non-presentation state/effects/logic changed: ${name} ${start}`);}
const original=fs.readFileSync(dir+'/baseline/OrderCheckout.js','utf8'),preview=fs.readFileSync(dir+'/account/OrderCheckout.js','utf8');
assert.equal(preview.slice(0,preview.indexOf('  if(shopping)return')).replaceAll('\r\n','\n'),original.slice(0,original.indexOf('  if(shopping)return')).replaceAll('\r\n','\n'),'All checkout computation and gating must remain byte-identical');
const consent=s=>s.slice(s.indexOf('<span>I authorize '),s.indexOf('</span></label>',s.indexOf('<span>I authorize ')));
assert.equal(consent(preview),consent(original),'Monthly authorization wording and amount must remain identical');
console.log('PASS: '+(promoted?'production sources match the approved premium preview':'production sources unchanged')+'; archived baseline intact; every existing callback expression preserved; checkout computation/gates and monthly authorization unchanged.');
