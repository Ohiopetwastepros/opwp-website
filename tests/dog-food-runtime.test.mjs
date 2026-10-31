import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
test('production workerd supports the selected OWASP scrypt parameters',async()=>{
  const mf = new Miniflare(convertV4MiniflareOptions({name:'food-password-test',modules:true,compatibilityDate:'2026-08-28',compatibilityFlags:['nodejs_compat'],script:`
    import {scrypt} from 'node:crypto';
    export default {async fetch(){const key=await new Promise((resolve,reject)=>scrypt('a long test passphrase','fixed_test_salt',32,{N:16384,r:8,p:5,maxmem:25165824},(e,k)=>e?reject(e):resolve(k)));return new Response(String(key.length));}};
  `}));
  try {const response=await mf.dispatchFetch('https://example.com');assert.equal(response.status,200);assert.equal(await response.text(),'32');}
  finally {await mf.dispose();}
});
