import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import { SITE_ORIGIN } from '../lib/canonical-redirect.mjs';

const apex = 'https://ohiopetwastepros.com';
const localOrigin = process.env.SEO_LOCAL_ORIGIN;
const { redirects, feeds, noindex } = JSON.parse(readFileSync(new URL('../tests/fixtures/search-console-2026-11-25.json', import.meta.url), 'utf8'));
const query = '?utm_source=seo&q=a%2Fb&q=two+words';
if (localOrigin) assert.match(localOrigin, /^https:\/\/127\.0\.0\.1:\d+$/);

function request(url, method = 'GET') {
  const signal = AbortSignal.timeout(20_000);
  if (!localOrigin) return fetch(url, { method, redirect: 'manual', signal });
  const { host, pathname, search } = new URL(url);
  return new Promise((resolve, reject) => {
    // Keep the production Host while connecting to Wrangler's local TLS listener.
    get(localOrigin, { method, path: pathname + search, headers: { host }, rejectUnauthorized: false, signal }, (message) => {
      resolve({
        status: message.statusCode,
        headers: new Headers(message.headers),
        async text() {
          message.setEncoding('utf8');
          let body = '';
          for await (const chunk of message) body += chunk;
          return body;
        },
      });
    }).on('error', reject);
  });
}

async function checkRedirect(source, destination, method = 'GET') {
  const response = await request(source, method);
  await response.text();
  assert.equal(response.status, 301, `${method} ${source}`);
  assert.equal(response.headers.get('location'), destination, source);
}

async function readPage(url) {
  const response = await request(url);
  const html = await response.text();
  assert.equal(response.status, 200, url);
  assert.equal(response.headers.get('location'), null, url);
  return html;
}

async function checkStatuses(url, expected) {
  const response = await request(url);
  await response.text();
  assert.ok(expected.includes(response.status), `${url} returned ${response.status}, expected ${expected.join(' or ')}`);
  assert.equal(response.headers.get('location'), null, url);
}

async function runBatches(items, check) {
  for (let index = 0; index < items.length; index += 8) {
    await Promise.all(items.slice(index, index + 8).map(check));
  }
}

await checkRedirect(apex + '/' + query, SITE_ORIGIN + '/' + query, 'HEAD');
await checkRedirect(apex + '/assets/opwp-logo.webp' + query, SITE_ORIGIN + '/assets/opwp-logo.webp' + query);
await checkRedirect(apex + '/sitemap.xml', SITE_ORIGIN + '/sitemap.xml');
await runBatches(Object.entries(redirects), async ([source, destination]) => {
  await checkRedirect(apex + source + query, SITE_ORIGIN + destination + query);
  if (source !== destination) await checkRedirect(SITE_ORIGIN + source + query, SITE_ORIGIN + destination + query);
});
await runBatches(feeds, async (path) => {
  await checkRedirect(apex + path, SITE_ORIGIN + path);
  await checkStatuses(SITE_ORIGIN + path, [404, 410]);
});

const sitemap = await readPage(SITE_ORIGIN + '/sitemap.xml');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
assert.equal(new Set(urls).size, urls.length, 'sitemap has duplicate URLs');
for (const path of new Set(['/', '/free-quote/', ...Object.values(redirects)])) {
  assert.ok(urls.includes(SITE_ORIGIN + path), `sitemap is missing ${path}`);
}
for (const excluded of [noindex, '/food-sales/', ...feeds]) {
  assert.ok(!urls.includes(SITE_ORIGIN + excluded), `sitemap includes ${excluded}`);
}
await runBatches(urls, async (url) => {
  const { origin, pathname, search, hash } = new URL(url);
  assert.equal(origin, SITE_ORIGIN, url);
  assert.ok(pathname.endsWith('/') && !search && !hash, url);
  const html = await readPage(url);
  const canonical = [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(([link]) => link.match(/\bhref="([^"]+)"/)?.[1]);
  assert.deepEqual(canonical, [url], `canonical tag for ${url}`);
});

await checkRedirect(apex + noindex, SITE_ORIGIN + noindex);
assert.ok(/<meta\b[^>]*name="robots"[^>]*content="[^>"]*\bnoindex\b/.test(await readPage(SITE_ORIGIN + noindex)), 'dog food account must be noindex');
assert.ok(/Record a food sale/i.test(await readPage(SITE_ORIGIN + '/food-sales/')), 'staff food sales shell is missing');
assert.ok(/<title>Technician workday\b/.test(await readPage(SITE_ORIGIN + '/field/app/')), 'technician workday shell is missing');
await checkStatuses(SITE_ORIGIN + '/api/field/workday/', [401]);
console.log(`Verified ${Object.keys(redirects).length} Search Console redirects, ${urls.length} sitemap URLs and canonical tags, feeds, food sales, and field clock-in access.`);
