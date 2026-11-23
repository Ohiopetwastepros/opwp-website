import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../app/admin/dog-food/CustomerHub.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.js':'jsx'},jsxFactory:'h',jsxFragment:'Fragment',banner:{js:'const Fragment=Symbol("Fragment");const h=(type,props,...children)=>({type,props:{...props,children}});'},plugins:[{name:'food-account-hub-ui',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.testHooks;',loader:'js'}));
  b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'styles-fixture'}));
  b.onLoad({filter:/.*/,namespace:'styles-fixture'},()=>({contents:'export default new Proxy({},{get:(target,key)=>key});',loader:'js'}));
  b.onResolve({filter:/^@\/components\//},()=>({path:'components',namespace:'component-fixture'}));
  b.onLoad({filter:/.*/,namespace:'component-fixture'},()=>({contents:'export default function Component(){return null;}export const invitationLabel=()=>"";',loader:'js'}));
  b.onResolve({filter:/^@\/lib\/food-customer-intake\.mjs$/},()=>({path:fileURLToPath(new URL('../lib/food-customer-intake.mjs',import.meta.url))}));
}}]});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...(node.props?.children||[]).flat(Infinity).flatMap(nodes)];
const text=node=>(node?.props?.children||[]).flat(Infinity).map(child=>typeof child==='object'?text(child):child??'').join('');

test('office customer directory renders the account-needed badge and applies its account filter through the API',async()=>{
  const states=[],refs=[],effects=[],pendingEffects=[],timers=new Map(),requests=[],module={exports:{}};
  let si=0,ri=0,ei=0,timerId=0;
  const needed={id:'needs-office',first_name:'Synthetic',last_name:'Needs',status:'active',customer_type:'on_demand',email:'',phone:'',needsAccountCreated:true,establishedAccount:false};
  const established={...needed,id:'established',last_name:'Established',needsAccountCreated:false,establishedAccount:true};
  const testHooks={
    useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    useRef(initial){const i=ri++;return refs[i]??={current:initial};},
    useEffect(effect,deps){const i=ei++,old=effects[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){effects[i]={deps,cleanup:old?.cleanup};pendingEffects.push(()=>{effects[i].cleanup?.();effects[i].cleanup=effect();});}},
  };
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,testHooks,Intl,Date,crypto,AbortController,
    setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{
      requests.push({url,method:options?.method||'GET'});const query=new URL(url,'https://example.test').searchParams;
      if(query.has('id'))return Response.json({customers:[{...needed,addresses:[],orders:[],sourceLinks:[],messages:[],plans:[],portalLinkCandidates:[],orderSummary:{count:0,total_cents:0,balance_cents:0}}]});
      const account=query.get('accountStatus'),customers=account==='needs_account'?[needed]:account==='established'?[established]:[needed,established];
      return Response.json({customers,hasMore:false,offset:0});
    },
  });
  const render=()=>{si=0;ri=0;ei=0;const tree=module.exports.default();while(pendingEffects.length)pendingEffects.shift()();return tree;};
  async function settle(){for(let n=0;n<4;n++){render();for(const [id,fn] of timers){timers.delete(id);fn();}await new Promise(setImmediate);}return render();}
  await settle();
  let body=nodes(render()).find(n=>n.type==='tbody');
  assert.equal(nodes(body).filter(n=>n.type==='tr').length,2);
  assert.equal(nodes(body).filter(n=>n.type==='span'&&text(n)==='Needs account created').length,1);
  const filter=nodes(render()).find(n=>n.type==='select'&&nodes(n).some(o=>o.type==='option'&&o.props.value==='needs_account'));
  assert.ok(filter,'the office can choose an account follow-up view');
  filter.props.onChange({target:{value:'needs_account'}});await settle();
  assert.equal(new URL(requests.at(-1).url,'https://example.test').searchParams.get('accountStatus'),'needs_account');
  body=nodes(render()).find(n=>n.type==='tbody');assert.equal(nodes(body).filter(n=>n.type==='tr').length,1);
  assert.match(text(body),/Synthetic Needs/);assert.doesNotMatch(text(body),/Synthetic Established/);
  nodes(body).find(n=>n.type==='button'&&text(n).startsWith('Open profile')).props.onClick();await settle();
  const profile=nodes(render()).find(n=>n.type==='article'&&n.props.className==='profile');
  assert.match(text(profile),/Needs account created/);assert.match(text(profile),/create the account through the office process/);
  assert.ok(requests.every(r=>r.method==='GET'),'viewing and filtering never creates an account or sends an invitation');
});
