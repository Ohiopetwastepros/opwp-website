import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalRedirect, legacyPageRedirects, legacySectionRedirects, SITE_ORIGIN } from '../lib/canonical-redirect.mjs';

const apex = 'https://ohiopetwastepros.com';
const { redirects, feeds } = JSON.parse(readFileSync(new URL('./fixtures/search-console-2026-11-25.json', import.meta.url), 'utf8'));
const query = '?utm_source=search&q=a%2Fb&q=two+words';

function checkRedirect(origin, path, finalPath, method = 'GET') {
  const response = canonicalRedirect(new Request(origin + path + query, { method }));
  assert.equal(response?.status, 301, `${method} ${origin}${path}`);
  assert.equal(response.headers.get('location'), SITE_ORIGIN + finalPath + query);
  assert.equal(canonicalRedirect(new Request(response.headers.get('location'))), null, 'destination must not redirect');
}

test('apex redirects every method and preserves the path and query for canonical URLs', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/', '/residential/', '/api/sng-webhooks/', '/assets/opwp-logo.webp', '/.well-known/example']) {
      checkRedirect(apex, path, path, method);
    }
  }
  for (const host of ['localhost:3000', 'opwp-website.ohiopetwastepros.workers.dev', 'opwp-preview.vercel.app', 'ohiopetwastepros.com.evil.test']) {
    assert.equal(canonicalRedirect(new Request(`https://${host}/free-quote`)), null);
  }
  assert.equal(canonicalRedirect(new Request(SITE_ORIGIN + '/api/sng-webhooks/', { method: 'POST' })), null);
  const response = canonicalRedirect(new Request(apex + '//example.net/residential/?next=https://example.net'));
  assert.equal(new URL(response.headers.get('location')).origin, SITE_ORIGIN);
});

test('Search Console URLs and WordPress redirects resolve directly to the final www URL', () => {
  for (const [path, finalPath] of Object.entries(redirects)) {
    checkRedirect(apex, path, finalPath);
    if (path !== finalPath) checkRedirect(SITE_ORIGIN, path, finalPath);
  }
  for (const [path, finalPath] of [...legacyPageRedirects, ...legacySectionRedirects]) {
    for (const host of [apex, SITE_ORIGIN]) {
      checkRedirect(host, path, finalPath, 'HEAD');
      checkRedirect(host, path + '/', finalPath);
    }
  }
});

test('old feeds reach a gone response before a WordPress section can redirect them', () => {
  for (const feed of feeds) {
    for (const path of [feed, feed.slice(0, -1)]) {
      assert.equal(canonicalRedirect(new Request(SITE_ORIGIN + path))?.status, 410, path);
      const redirect = canonicalRedirect(new Request(apex + path + query));
      assert.equal(redirect.status, 301);
      assert.equal(redirect.headers.get('location'), SITE_ORIGIN + path + query);
      assert.equal(canonicalRedirect(new Request(redirect.headers.get('location')))?.status, 410);
    }
  }
});
