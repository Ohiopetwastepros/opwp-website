import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Render the shipped component and exercise its real controls. Every request and
// browser store is local to this fixture; no real account or sale is used.
const bundle=await build({entryPoints:[fileURLToPath(new URL('../app/food-sales/FoodSalesClient.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.js':'jsx'},jsxFactory:'h',jsxFragment:'Fragment',banner:{js:'const Fragment=Symbol("Fragment");const h=(type,props,...children)=>({type,props:{...props,children}});'},plugins:[{name:'food-sales-session-ui',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.testHooks;',loader:'js'}));
  b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'styles-fixture'}));
  b.onLoad({filter:/.*/,namespace:'styles-fixture'},()=>({contents:'export default {saleForm:"saleForm",summary:"summary"};',loader:'js'}));
  b.onResolve({filter:/^@\/components\//},()=>({path:'components',namespace:'component-fixture'}));
  b.onLoad({filter:/.*/,namespace:'component-fixture'},()=>({contents:'export default function Component(){return null;}export const invitationLabel=()=>"";',loader:'js'}));
  b.onResolve({filter:/^@\/lib\/food-sale-intake\.mjs$/},()=>({path:fileURLToPath(new URL('../lib/food-sale-intake.mjs',import.meta.url))}));
}}]});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...(node.props?.children||[]).flat(Infinity).flatMap(nodes)];
const text=node=>(node?.props?.children||[]).flat(Infinity).map(child=>typeof child==='object'?text(child):child??'').join('');
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const customer={id:'synthetic-buyer',first_name:'Synthetic',last_name:'Buyer',phone:'4195550100',contactComplete:true,intakeComplete:true,addresses:[]};
const model=id=>({member:{id,name:'Synthetic Staff'},office:false,recordingEnabled:true,inventoryConfigured:true,stockBasis:'confirmed_count',products:[{id:'synthetic-product',color:'Pink',formula_code:'22-12',name:'Synthetic formula',bag_weight_lb:40,retail_price_cents:5900,available:4}],customers:[customer],addresses:[],recent:[]});
async function app({save=async()=>Response.json({error:'Your food-sales session has expired.'},{status:401}),quote,lookup=()=>({saved:false}),selectedCustomer=customer,embedded=false,get}={}){
  const states=[],refs=[],effects=[],pendingEffects=[],timers=new Map(),requests=[];
  const sessionStorage=storage(),localStorage=storage(),module={exports:{}};
  let si=0,ri=0,ei=0,timerId=0,memberId='synthetic-staff';
  const testHooks={
    useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const i=ri++;return refs[i]??={current:initial};},
    useEffect(effect,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){effects[i]={deps,cleanup:old?.cleanup};pendingEffects.push(()=>{effects[i].cleanup?.();effects[i].cleanup=effect();});}},
  };
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,testHooks,Intl,Date,crypto,AbortController,sessionStorage,localStorage,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    window:{location:{hash:'',pathname:'/food-sales/',search:''},history:{replaceState(){}}},
    fetch:async(url,options)=>{
      const body=options.body?JSON.parse(options.body):undefined;requests.push({url,method:options.method,body});
      if(url.includes('/session/')){assert.equal(body.action,undefined,'recovery only signs in; it never resets credentials');memberId=body.email==='different@example.test'?'different-staff':'synthetic-staff';return Response.json({ok:true});}
      if(options.method==='POST')return body.action==='quote'?(quote?quote(body):Response.json({result:{total:6000,subtotal:6000,tax:0,quoteHash:'synthetic-quote'}})):save(body);
      if(url.includes('submission='))return Response.json(lookup(new URL(url,'https://example.test').searchParams.get('submission')));
      if(url.includes('/customers/'))return Response.json({customer:selectedCustomer});
      if(get){const result=await get(url);if(result)return result;}
      return Response.json(model(memberId));
    },
  });
  const render=()=>{si=0;ri=0;ei=0;const tree=module.exports.default({embedded});while(pendingEffects.length)pendingEffects.shift()();return tree;};
  async function settle(){for(let i=0;i<5;i++){render();for(const [id,timer] of timers)if(timer.delay===180){timers.delete(id);timer.fn();}await new Promise(setImmediate);}return render();}
  const findButton=label=>nodes(render()).find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));
  async function click(label){const button=findButton(label);assert.ok(button,`control exists: ${label}`);assert.ok(!button.props.disabled,`control is enabled: ${label}`);await button.props.onClick();await settle();}
  async function signIn(email='synthetic@example.test'){
    const emailInput=nodes(render()).find(n=>n.type==='input'&&n.props.autoComplete==='username');assert.ok(emailInput,'expired session provides sign-in controls');emailInput.props.onChange({target:{value:email}});
    nodes(render()).find(n=>n.type==='input'&&n.props.autoComplete==='current-password').props.onChange({target:{value:'Synthetic-password!26'}});
    await nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await settle();
  }
  await settle();
  return {render,settle,requests,findButton,click,signIn,sessionStorage,localStorage,async prepare(){
    nodes(render()).find(n=>typeof n.props?.onSelect==='function').props.onSelect(selectedCustomer);await settle();
    nodes(render()).find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic draft retained during reauthentication'}});
    await click('Add one Pink 22-12 bag');await click('Review current price');
    const submit=nodes(render()).find(n=>n.type==='form'&&n.props.className==='saleForm');assert.ok(submit);
    assert.equal(nodes(render()).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,!selectedCustomer.contactComplete);
    return submit;
  },async submit(){await nodes(render()).find(n=>n.type==='form'&&n.props.className==='saleForm').props.onSubmit({preventDefault(){}});await settle();}};
}

test('a save rejected by session expiry shows sign-in and retains the exact draft and submission',async()=>{
  const f=await app();await f.prepare();await f.submit();
  assert.ok(nodes(f.render()).some(n=>n.type==='input'&&n.props.autoComplete==='username'),'sign-in must be reachable after save 401');
  const key='opwp-food-sales:synthetic-staff';
  assert.ok(JSON.parse(f.localStorage.getItem(key+':pending')).commandId);
  assert.equal(JSON.parse(f.sessionStorage.getItem(key+':draft')).draft.saleNotes,'Synthetic draft retained during reauthentication');
  const sent=f.requests.find(r=>r.body?.action==='save').body;
  assert.deepEqual(JSON.parse(f.sessionStorage.getItem(key+':payload')),sent);
  await f.signIn();assert.ok(f.findButton('Retry same submission'));
  assert.equal(f.requests.filter(r=>r.body?.action==='save').length,1,'signing in must never automatically submit the sale');
});

test('same-account sign-in retries the original command and a lost response cannot duplicate the sale',async()=>{
  let attempts=0,committed=0;const commands=new Map();
  const f=await app({save:async body=>{
    if(++attempts===1)return Response.json({error:'Your food-sales session has expired.'},{status:401});
    if(!commands.has(body.commandId)){commands.set(body.commandId,{orderNumber:'SYNTHETIC-ONLY',balanceCents:6000});committed++;return Response.json({error:'Synthetic lost response',uncertain:true},{status:503});}
    return Response.json({result:commands.get(body.commandId)});
  }});
  await f.prepare();await f.submit();await f.signIn();await f.click('Retry same submission');await f.click('Retry same submission');
  const saves=f.requests.filter(r=>r.body?.action==='save').map(r=>r.body);
  assert.equal(saves.length,3);assert.deepEqual(saves[1],saves[0]);assert.deepEqual(saves[2],saves[0]);assert.equal(committed,1);
  assert.equal(f.findButton('Retry same submission'),undefined);
  assert.match(text(f.render()),/SYNTHETIC-ONLY saved/);
});

test('an unknown outcome stays locked after a negative lookup and later definitive rate-limit rejection',async()=>{
  let attempts=0;
  const f=await app({save:async()=>++attempts===1?Response.json({error:'Synthetic response lost',uncertain:true},{status:503}):Response.json({error:'Synthetic request limited',definitive:true},{status:429})});
  await f.prepare();await f.submit();await f.click('Check save status');
  assert.ok(f.findButton('Retry same submission'));assert.equal(f.findButton('Edit rejected draft'),undefined);
  await f.click('Retry same submission');
  assert.equal(f.findButton('Edit rejected draft'),undefined,'a later rejected retry cannot prove the first request did not commit');
  assert.ok(nodes(f.render()).filter(n=>n.type==='fieldset').every(n=>n.props.disabled));
  assert.match(text(nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary')),/Check or retry the pending submission/);
});

test('signing in as another account keeps the first account submission private and never retries it',async()=>{
  const f=await app();await f.prepare();await f.submit();await f.signIn('different@example.test');
  assert.equal(f.findButton('Retry same submission'),undefined);
  assert.equal(nodes(f.render()).find(n=>n.type==='textarea').props.value,'');
  assert.ok(f.localStorage.getItem('opwp-food-sales:synthetic-staff:pending'),'the original account can still recover its submission');
  assert.equal(f.requests.filter(r=>r.body?.action==='save').length,1);
});

for(const field of ['first_name','last_name'])test('a disabled save explains missing '+field+' beside the save button without demanding phone',async()=>{
  const f=await app({selectedCustomer:{...customer,[field]:'',phone:'',contactComplete:false}});await f.prepare();
  const summary=nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary');
  assert.match(text(summary),/Ask the customer or office to complete their name before saving/);
  assert.ok(nodes(summary).some(n=>n.props?.role==='status'&&/first name and last name/.test(text(n))));
  assert.doesNotMatch(text(summary),/phone/i);
  assert.equal(nodes(summary).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,true);
  assert.equal(f.requests.filter(r=>r.body?.action==='save').length,0);
});

test('a name-only customer can save with account follow-up shown in Review and the confirmed receipt',async()=>{
  const f=await app({selectedCustomer:{...customer,email:'',phone:'',contactComplete:true,intakeComplete:false,needsAccountCreated:true},save:async()=>Response.json({result:{orderNumber:'SYNTHETIC-NAME-ONLY',balanceCents:6000,needsAccountCreated:true}})});
  await f.prepare();
  let summary=nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary');
  assert.match(text(summary),/Needs account created/);
  assert.equal(nodes(summary).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,false);
  assert.match(text(f.render()),/Phone and email not recorded/);
  assert.doesNotMatch(text(summary),/phone number|name and phone/i);
  await f.submit();
  assert.ok(nodes(f.render()).some(n=>n.props?.role==='status'&&/SYNTHETIC-NAME-ONLY saved/.test(text(n))&&/Needs account created/.test(text(n))));
  assert.equal(f.requests.filter(r=>r.body?.action==='save').length,1);
});

test('a complete contact with reviewed price can save without an office-contact blocker',async()=>{
  const f=await app();await f.prepare();
  const summary=nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary');
  assert.doesNotMatch(text(summary),/Ask the office/);
  assert.doesNotMatch(text(summary),/Needs account created/);
  assert.equal(nodes(summary).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,false);
});

test('Review keeps inline reasons for no customer, no bags, price review and overpayment',async()=>{
  const f=await app(),summary=()=>nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary');
  assert.match(text(summary()),/Choose an existing customer before saving/);
  nodes(f.render()).find(n=>typeof n.props?.onSelect==='function').props.onSelect(customer);await f.settle();
  assert.match(text(summary()),/Choose at least one bag before saving/);
  await f.click('Add one Pink 22-12 bag');assert.match(text(summary()),/Select Review current price before saving/);
  await f.click('Review current price');
  nodes(f.render()).find(n=>n.type==='input'&&n.props.inputMode==='decimal').props.onChange({target:{value:'60.01'}});await f.settle();
  assert.match(text(summary()),/Amount collected exceeds the sale total/);
  assert.equal(nodes(summary()).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,true);
});

test('Review keeps paused-recording and unverified-stock disabled reasons',async()=>{
  for(const [field,hint] of [['recordingEnabled',/New sale recording is paused/],['inventoryConfigured',/No verified bags are available to sell/]]){
    const f=await app({get:()=>Response.json({...model('synthetic-staff'),[field]:false})});
    const summary=nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary');
    assert.match(text(summary),hint);assert.equal(nodes(summary).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,true);
  }
});

test('Review explains a pending price request beside the disabled Save button',async()=>{
  let finish;const result=new Promise(resolve=>{finish=resolve;}),f=await app({quote:()=>result});
  nodes(f.render()).find(n=>typeof n.props?.onSelect==='function').props.onSelect(customer);await f.settle();await f.click('Add one Pink 22-12 bag');
  const request=f.findButton('Review current price').props.onClick();
  const summary=nodes(f.render()).find(n=>n.type==='section'&&n.props.className==='summary');
  assert.match(text(summary),/Wait for the current request to finish before saving/);assert.equal(nodes(summary).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,true);
  finish(Response.json({result:{total:6000,subtotal:6000,tax:0,quoteHash:'synthetic-quote'}}));await request;await f.settle();
  assert.equal(nodes(f.render()).find(n=>n.type==='button'&&text(n).startsWith('Save sale')).props.disabled,false);
});

test('an expired embedded office session offers management sign-in and preserves its pending submission',async()=>{
  const f=await app({embedded:true});await f.prepare();await f.submit();
  const link=nodes(f.render()).find(n=>n.type==='a'&&text(n)==='Sign in to the office');
  assert.equal(link?.props.href,'/admin/login/?next=%2Fadmin%2Fdog-food%2Frecord-sale%2F');
  assert.equal(nodes(f.render()).find(n=>n.type==='input'&&n.props.autoComplete==='current-password'),undefined,'a staff password cannot renew the office session');
  assert.ok(f.localStorage.getItem('opwp-food-sales:synthetic-staff:pending'));
  assert.equal(f.requests.filter(r=>r.url.includes('/session/')).length,0);
});

test('a stale search 401 cannot expire a newly authenticated session',async()=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  const f=await app({get:url=>url.endsWith('q=delayed')?delayed:null});
  // Leave a search in flight before the save discovers expiry.
  nodes(f.render()).find(n=>typeof n.props?.onSelect==='function').props.onChange('delayed');await f.settle();
  await f.prepare();await f.submit();await f.signIn();
  release(Response.json({error:'Old session expired.'},{status:401}));await f.settle();
  assert.equal(nodes(f.render()).find(n=>n.type==='input'&&n.props.autoComplete==='username'),undefined,'the old request must not reopen sign-in');
  assert.ok(f.findButton('Retry same submission'));
});

test('account switching clears another account sale-confirmation banner',async()=>{
  let expired=false;
  const f=await app({save:async()=>Response.json({result:{orderNumber:'SYNTHETIC-FIRST-ACCOUNT',balanceCents:6000}}),get:()=>expired?Response.json({error:'Your food-sales session has expired.'},{status:401}):null});
  await f.prepare();await f.submit();assert.match(text(f.render()),/SYNTHETIC-FIRST-ACCOUNT saved/);
  expired=true;nodes(f.render()).find(n=>typeof n.props?.onSelect==='function').props.onChange('expire');await f.settle();
  expired=false;await f.signIn('different@example.test');
  assert.doesNotMatch(text(f.render()),/SYNTHETIC-FIRST-ACCOUNT/);
});
