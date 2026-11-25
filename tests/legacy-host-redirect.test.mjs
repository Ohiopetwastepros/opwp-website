import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyHostRedirect } from '../lib/legacy-host-redirect.mjs';
const old = 'https://opwp-website.ohiopetwastepros.workers.dev';

test('old browser bookmarks retain their route and filters on the live domain', () => {
  for (const path of ['/', '/admin/', '/admin/?view=customers', '/field/', '/office/login/?next=%2Foffice%2F']) {
    const response=legacyHostRedirect(new Request(old+path));
    assert.equal(response.status,307);
    assert.equal(response.headers.get('location'),'https://www.ohiopetwastepros.com'+path);
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
test('API callbacks, webhooks, mutations and framework requests retain their original handling', () => {
  for (const path of ['/api', '/api/sng-webhooks/', '/api/quickbooks/callback?code=test&state=test', '/api/stripe/webhook/', '/api/webhooks/quo-messages/', '/_next/static/main.js', '/.well-known/example', '/cdn-cgi/image/test']) assert.equal(legacyHostRedirect(new Request(old+path)),null);
  for (const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) assert.equal(legacyHostRedirect(new Request(old+'/admin/',{method})),null);
  for (const headers of [{rsc:'1'},{'next-router-prefetch':'1'},{upgrade:'websocket'}]) assert.equal(legacyHostRedirect(new Request(old+'/admin/',{headers})),null);
});
test('current domains and independent previews never redirect; destination cannot be injected', () => {
  for (const host of ['ohiopetwastepros.com','www.ohiopetwastepros.com','localhost:3000','opwp-meta-visual-review.ohiopetwastepros.workers.dev','opwp-website.ohiopetwastepros.workers.dev.evil.test']) assert.equal(legacyHostRedirect(new Request('https://'+host+'/admin/')),null);
  const response=legacyHostRedirect(new Request(old+'//evil.test/admin/?next=https://evil.test',{headers:{host:'evil.test','x-forwarded-host':'evil.test'}}));
  assert.equal(new URL(response.headers.get('location')).origin,'https://www.ohiopetwastepros.com');
  assert.equal(legacyHostRedirect(new Request(old+'/admin/',{method:'HEAD'})).status,307);
});
