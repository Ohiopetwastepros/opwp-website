import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {customerBody} from './helpers/food-customer-input.mjs';
import {foodCustomerCommand,readFoodCustomerHub} from '../lib/food-customer-hub.mjs';
import {FoodError} from '../lib/dog-food-operations.mjs';

// Exercise the component's actual submit handler with persistent React hook state.
// JSX rendering is covered by the production build; no test-only submit implementation.
const source=fs.readFileSync(new URL('../components/FoodCustomerDialog.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('export default function'),source.indexOf('  if(!mounted)return null;')).replace('export default ','')+'return {save,set,refreshRequired,error};}\nFoodCustomerDialog';
function dialog(fetch,props={}){
  const states=[],refs=[],saved=[];let si=0,ri=0;
  const Component=vm.runInNewContext(handler,{crypto,fetch,useEffect:()=>{},useRef:value=>{const i=ri++;return refs[i]??=( {current:value} );},useState:value=>{const i=si++;if(!(i in states))states[i]=value;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}});
  const render=()=>{si=0;ri=0;return Component({onClose:()=>{},onSaved:async(c,m)=>saved.push({customer:c,messages:m}),...props});};
  return {render,saved,submit:()=>render().save({preventDefault(){}})};
}
function api(f,actor,office=false){return async(_url,request)=>{
  try{const result=await foodCustomerCommand(f.db,JSON.parse(request.body),actor,{office});return Response.json({customer:(await readFoodCustomerHub(f.db,{id:result.id})).customers[0],messages:[]});}
  catch(error){return Response.json({error:error.message,definitive:error.definitive===true,refreshRequired:error.refreshRequired===true},{status:error instanceof FoodError?error.status:503});}
};}
function fill(d,body){for(const [key,value] of Object.entries(body))if(!['action','commandId'].includes(key))d.render().set(key,value);}

test('duplicate-email conflict allows correcting the form and saving the new values',async()=>{
  const f=setup(),d=dialog(api(f,'seller'));fill(d,customerBody({email:'buyer@example.test'}));
  await d.submit();assert.match(d.render().error,/already exists/);assert.equal(d.saved.length,0);
  d.render().set('email','corrected@example.test');await d.submit();
  assert.equal(d.saved.length,1);assert.equal(d.saved[0].customer.email,'corrected@example.test');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_customers').get().n,2);
});

test('stale customer edits require refreshing before any further submission',async()=>{
  const f=setup(),body=customerBody(),created=await foodCustomerCommand(f.db,body,'seller');
  const customer=(await readFoodCustomerHub(f.db,{id:created.id})).customers[0];let requests=0;
  const d=dialog(async(...args)=>{requests++;return api(f,'owner',true)(...args);},{customer});
  await foodCustomerCommand(f.db,{...body,action:'update_customer',customerId:customer.id,commandId:crypto.randomUUID(),revision:customer.revision,version:customer.version,notes:'New office information'},'owner',{office:true});
  await d.submit();assert.equal(d.render().refreshRequired,true);assert.match(d.render().error,/Refresh/);
  d.render().set('notes','Stale change');await d.submit();assert.equal(requests,1);
  const fresh=(await readFoodCustomerHub(f.db,{id:created.id})).customers[0],reopened=dialog(api(f,'owner',true),{customer:fresh});
  reopened.render().set('notes','Reviewed latest record');await reopened.submit();assert.equal(reopened.saved.length,1);
  assert.equal(reopened.saved[0].customer.notes,'Reviewed latest record');
});

for(const failure of ['network','server','replay-conflict'])test(`${failure} preserves the original submission for a safe retry`,async()=>{
  const payloads=[];let first=true;
  const d=dialog(async(_url,options)=>{payloads.push(JSON.parse(options.body));if(first){first=false;if(failure==='network')throw Error('response lost');return Response.json({error:'Check this submission',definitive:false},{status:failure==='server'?503:409});}return Response.json({customer:{id:'saved'},messages:[]});});
  fill(d,customerBody());await d.submit();d.render().set('email','changed@example.test');await d.submit();
  assert.deepEqual(payloads[1],payloads[0]);assert.equal(d.saved.length,1);
});

test('repeated submit while a request is pending sends only once',async()=>{
  let release,requests=0;const pending=new Promise(resolve=>{release=resolve;});
  const d=dialog(async()=>{requests++;await pending;return Response.json({customer:{id:'saved'},messages:[]});});
  const first=d.submit();await d.submit();assert.equal(requests,1);release();await first;assert.equal(d.saved.length,1);
});

test('stale edit recovery is wired to a reload action rather than another save',()=>{
  assert.match(source,/if\(saving\.current\|\|refreshRequired\)return/);
  assert.match(source,/refreshRequired\?<button type='button'.*onClick=\{onRefresh\|\|onClose\}>Reload customer record/);
  const hub=fs.readFileSync(new URL('../app/admin/dog-food/CustomerHub.js',import.meta.url),'utf8');
  assert.match(hub,/onRefresh=\{\(\)=>\{setDialog\(null\);setDetail\(null\);setVersion\(v=>v\+1\)/);
});
