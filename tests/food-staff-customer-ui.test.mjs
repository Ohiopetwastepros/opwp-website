import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Render the real workspace JSX and invoke its controls. Component markers let
// the test inspect the endpoint passed to the shared dialog without a browser.
const bundle=await build({entryPoints:[fileURLToPath(new URL('../app/food-sales/FoodSalesClient.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.js':'jsx'},jsxFactory:'h',jsxFragment:'Fragment',banner:{js:'const Fragment=Symbol("Fragment");const h=(type,props,...children)=>({type,props:{...props,children}});'},plugins:[{name:'food-staff-customer-test',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.testHooks;',loader:'js'}));
  b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'css-fixture'}));
  b.onLoad({filter:/.*/,namespace:'css-fixture'},()=>({contents:'export default {};',loader:'js'}));
  b.onResolve({filter:/^@\/components\//},args=>({path:args.path.split('/').at(-1),namespace:'component-fixture'}));
  b.onLoad({filter:/.*/,namespace:'component-fixture'},args=>({contents:`export default function ${args.path}(){return null;}export const invitationLabel=()=>"";`,loader:'js'}));
  b.onResolve({filter:/^@\/lib\/food-sale-intake\.mjs$/},()=>({path:fileURLToPath(new URL('../lib/food-sale-intake.mjs',import.meta.url))}));
}}]});
function nodes(node){if(!node||typeof node!=='object')return [];return [node,...(node.props?.children||[]).flat(Infinity).flatMap(nodes)];}
const text=node=>(node?.props?.children||[]).flat(Infinity).map(child=>typeof child==='object'?text(child):child??'').join('');
const button=(tree,label)=>nodes(tree).find(node=>node.type==='button'&&text(node)===label);
const component=(tree,name)=>nodes(tree).find(node=>typeof node.type==='function'&&node.type.name===name);
async function workspace({office=false,canEditCustomerIntake=true}={}){
  const states=[],refs=[],effects=[],requests=[];let si=0,ri=0,mounted=false;
  const module={exports:{}},testHooks={
    useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const i=ri++;return refs[i]??={current:initial};},useEffect(effect){if(!mounted)effects.push(effect);},
  };
  const data={member:{id:'synthetic-salesperson',name:'Synthetic Salesperson'},office,canEditCustomerIntake,recordingEnabled:true,inventoryConfigured:false,stockBasis:'confirmed_count',customers:[],addresses:[],products:[],recent:[{id:'synthetic-order',customerName:'Synthetic Buyer',totalCents:6000,receivedCents:0,balanceCents:6000,paymentStatus:'unpaid',fulfillmentStatus:'pending',fulfillmentMethod:'pickup'}]};
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,testHooks,crypto,Intl,Date,AbortController,setTimeout,clearTimeout,window:{location:{hash:'',pathname:'/food-sales/',search:''}},fetch:async(url,options)=>{requests.push({url,options});return Response.json(data);}});
  const render=()=>{si=0;ri=0;return module.exports.default({embedded:office});};
  render();mounted=true;for(const effect of effects)effect();await new Promise(setImmediate);
  return {render,requests};
}
const eligible={id:'synthetic-customer',first_name:'Synthetic',last_name:'Buyer',email:'customer@example.test',phone:'4195550199',addresses:[],canEditIntake:true,contactComplete:true};

test('food-sales staff can open add and eligible edit dialogs through the dedicated customer API without office controls',async()=>{
  const f=await workspace();let tree=f.render();
  assert.ok(button(tree,'+ Add a new customer'));
  assert.ok(!nodes(tree).some(node=>node.type==='a'&&String(node.props.href).startsWith('/admin/')),'staff does not gain the inventory admin link');
  button(tree,'+ Add a new customer').props.onClick();tree=f.render();
  let dialog=component(tree,'FoodCustomerDialog');assert.ok(dialog);assert.equal(dialog.props.endpoint,'/api/food-sales/customers/');assert.equal(dialog.props.customer,null);
  dialog.props.onClose();tree=f.render();
  component(tree,'FoodCustomerSearch').props.onSelect(eligible);tree=f.render();
  assert.ok(button(tree,'Edit customer information'));button(tree,'Edit customer information').props.onClick();
  dialog=component(f.render(),'FoodCustomerDialog');assert.equal(dialog.props.endpoint,'/api/food-sales/customers/');assert.equal(dialog.props.customer.id,eligible.id);
  dialog.props.onClose();tree=f.render();button(tree,'Recent entries 1').props.onClick();tree=f.render();
  for(const label of ['Add receipt','Record handoff','Request correction'])assert.equal(button(tree,label),undefined,label+' stays office-only');
  assert.ok(f.requests.every(request=>!request.options.headers['X-Food-Office']));
});

test('staff cannot open edit for a portal-owned customer or add without the intake capability',async()=>{
  const f=await workspace();component(f.render(),'FoodCustomerSearch').props.onSelect({...eligible,canEditIntake:false});
  assert.equal(button(f.render(),'Edit customer information'),undefined);
  assert.equal(component(f.render(),'FoodCustomerDialog'),undefined);
  const blocked=await workspace({canEditCustomerIntake:false});assert.equal(button(blocked.render(),'+ Add a new customer'),undefined);
});

test('office add and edit dialogs keep the admin customer API and office-only controls',async()=>{
  const f=await workspace({office:true});let tree=f.render();
  assert.ok(nodes(tree).some(node=>node.type==='a'&&node.props.href==='/admin/dog-food/inventory/?tab=inventory'));
  button(tree,'+ Add a new customer').props.onClick();let dialog=component(f.render(),'FoodCustomerDialog');assert.equal(dialog.props.endpoint,'/api/admin/dog-food/customers/');
  dialog.props.onClose();component(f.render(),'FoodCustomerSearch').props.onSelect({...eligible,canEditIntake:false});tree=f.render();
  button(tree,'Edit customer information').props.onClick();dialog=component(f.render(),'FoodCustomerDialog');assert.equal(dialog.props.endpoint,'/api/admin/dog-food/customers/');
  assert.ok(f.requests.every(request=>request.options.headers['X-Food-Office']==='1'));
});
