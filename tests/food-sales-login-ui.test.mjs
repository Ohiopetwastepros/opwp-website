import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Render the actual JSX with persistent hook state and invoke its real controls.
// All fetches stay in this harness; no live session or account is used.
const bundle=await build({entryPoints:[fileURLToPath(new URL('../app/food-sales/FoodSalesClient.js',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.js':'jsx'},jsxFactory:'h',jsxFragment:'Fragment',banner:{js:'const Fragment=Symbol("Fragment");const h=(type,props,...children)=>({type,props:{...props,children}});'},plugins:[{name:'food-sales-login-test',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.testHooks;',loader:'js'}));
  b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'css-fixture'}));
  b.onLoad({filter:/.*/,namespace:'css-fixture'},()=>({contents:'export default {};',loader:'js'}));
  b.onResolve({filter:/^@\/components\//},()=>({path:'components',namespace:'component-fixture'}));
  b.onLoad({filter:/.*/,namespace:'component-fixture'},()=>({contents:'export default function Component(){return null;}export const invitationLabel=()=>"";',loader:'js'}));
  b.onResolve({filter:/^@\/lib\/food-sale-intake\.mjs$/},()=>({path:fileURLToPath(new URL('../lib/food-sale-intake.mjs',import.meta.url))}));
}}]});
function nodes(node){
  if(!node||typeof node!=='object')return [];
  return [node,...(node.props?.children||[]).flat(Infinity).flatMap(nodes)];
}
const text=node=>(node?.props?.children||[]).flat(Infinity).map(child=>typeof child==='object'?text(child):child??'').join('');
const input=(tree,autocomplete)=>nodes(tree).filter(node=>node.type==='input'&&node.props.autoComplete===autocomplete);
function visibility(tree,label){
  const control=nodes(tree).find(node=>node.type==='label'&&text(node)===label);
  assert.ok(control,`${label} has a visible label`);
  const checkbox=nodes(control).find(node=>node.type==='input'&&node.props.type==='checkbox');
  assert.ok(checkbox,'visibility is keyboard-accessible through a native checkbox');
  return checkbox;
}
async function form({setup=false,post=async()=>Response.json({error:'Test sign-in failed.'},{status:401})}={}){
  const states=[],refs=[],effects=[],requests=[];let si=0,ri=0,mounted=false;
  const module={exports:{}};
  const testHooks={
    useState(initial){const i=si++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(initial){const i=ri++;return refs[i]??={current:initial};},
    useEffect(effect){if(!mounted)effects.push(effect);},
  };
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,testHooks,Intl,Date,AbortController,setTimeout,clearTimeout,window:{location:{hash:setup?'#setup='+'a'.repeat(64):'',pathname:'/food-sales/',search:''},history:{replaceState(){}}},fetch:async(url,options)=>{
    if(options.method==='GET')return Response.json({error:'Sign in required.'},{status:401});
    requests.push({url,body:JSON.parse(options.body)});return post(requests.at(-1));
  }});
  const render=()=>{si=0;ri=0;return module.exports.default({});};
  render();mounted=true;for(const effect of effects)effect();
  await new Promise(setImmediate);
  return {render,requests,submit:()=>nodes(render()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}})};
}

test('staff sign-in checkbox shows and hides the current password without changing its value or autofill',async()=>{
  const f=await form();let tree=f.render();
  input(tree,'current-password')[0].props.onChange({target:{value:'  Typed-password!26  '}});
  tree=f.render();assert.equal(input(tree,'current-password')[0].props.type,'password');
  assert.equal(visibility(tree,'Show password').props.checked,false);
  visibility(tree,'Show password').props.onChange({target:{checked:true}});
  tree=f.render();assert.equal(input(tree,'current-password')[0].props.type,'text');
  assert.equal(input(tree,'current-password')[0].props.value,'  Typed-password!26  ');
  assert.equal(visibility(tree,'Show password').props.checked,true);
  visibility(tree,'Show password').props.onChange({target:{checked:false}});
  assert.equal(input(f.render(),'current-password')[0].props.type,'password');
  assert.equal(f.requests.length,0,'using visibility must not submit the login form');
});

test('setup checkbox shows and hides both new-password fields while retaining password bounds',async()=>{
  const f=await form({setup:true});let tree=f.render();
  const initial=input(tree,'new-password');assert.equal(initial.length,2);
  initial[0].props.onChange({target:{value:'First-password!26'}});
  input(f.render(),'new-password')[1].props.onChange({target:{value:'Confirm-password!26'}});
  tree=f.render();assert.ok(input(tree,'new-password').every(node=>node.props.type==='password'));
  visibility(tree,'Show passwords').props.onChange({target:{checked:true}});
  tree=f.render();const shown=input(tree,'new-password');
  assert.ok(shown.every(node=>node.props.type==='text'&&node.props.required&&node.props.minLength===12&&node.props.maxLength===256));
  assert.deepEqual(shown.map(node=>node.props.value),['First-password!26','Confirm-password!26']);
  visibility(tree,'Show passwords').props.onChange({target:{checked:false}});
  assert.ok(input(f.render(),'new-password').every(node=>node.props.type==='password'));
  assert.equal(f.requests.length,0,'using visibility must not submit password setup');
});

test('sign-in submit trims and lowercases email state and payload without trimming the password',async()=>{
  const f=await form();
  input(f.render(),'username')[0].props.onChange({target:{value:'  Mixed.Case@Example.Test  '}});
  input(f.render(),'current-password')[0].props.onChange({target:{value:'  Typed-password!26  '}});
  await f.submit();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/food-sales/session/');
  assert.equal(f.requests[0].body.email,'mixed.case@example.test');
  assert.equal(f.requests[0].body.password,'  Typed-password!26  ');
  assert.equal(input(f.render(),'username')[0].props.value,'mixed.case@example.test');
});
