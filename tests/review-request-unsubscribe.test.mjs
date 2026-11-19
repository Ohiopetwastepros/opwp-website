import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app/api/review-requests/unsubscribe/route.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function fixture(){
  const tokens=[];
  const POST=vm.runInNewContext(source+'\nPOST;', {Response,TextDecoder,URL,URLSearchParams,getRuntimeEnv:()=>({}),unsubscribeReviewEmail:async(_env,token)=>{tokens.push(token);return token==='a'.repeat(72);}});
  return {POST,tokens};
}
test('email confirmation and RFC one-click POST use the capability without exposing contact details',async()=>{
  const f=fixture(),token='a'.repeat(72);
  const result=await f.POST(new Request('https://www.ohiopetwastepros.com/api/review-requests/unsubscribe/',{method:'POST',body:new URLSearchParams({token})}));
  assert.equal(result.status,200);assert.match(await result.text(),/unsubscribed/);
  const click=await f.POST(new Request('https://www.ohiopetwastepros.com/api/review-requests/unsubscribe/?token='+token,{method:'POST',body:'List-Unsubscribe=One-Click'}));
  assert.equal(click.status,200);assert.deepEqual(f.tokens,[token,token]);
  assert.equal(click.headers.get('cache-control'),'no-store');
  assert.doesNotMatch(source,/export\s+async\s+function\s+GET/);
});
test('invalid and oversized unsubscribe requests do not authorize a consent change',async()=>{
  const f=fixture();
  assert.equal((await f.POST(new Request('https://www.ohiopetwastepros.com/api/review-requests/unsubscribe/',{method:'POST',body:'token=wrong'}))).status,400);
  const before=f.tokens.length;
  assert.equal((await f.POST(new Request('https://www.ohiopetwastepros.com/api/review-requests/unsubscribe/',{method:'POST',body:'x'.repeat(2049)}))).status,413);
  assert.equal(f.tokens.length,before);
});
