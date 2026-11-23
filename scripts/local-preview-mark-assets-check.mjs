// Read-only artifact checks for the current local clarity pass.
// --files-only checks disk artifacts without contacting the preview server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { reviewScreens } from './local-preview-mark-gallery.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'output', 'route-os-mark-v2');
const origin = 'http://localhost:8787', prefix = '/local-preview/mark-review/';
const filesOnly = process.argv.includes('--files-only');
const reportPath = path.join(root, 'tmp', filesOnly ? 'simple-ui-gallery-files-report.json' : 'simple-ui-gallery-http-report.json');
function save(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: report.ok, status: report.status, beforeCaptures: report.beforeCaptures, afterCaptures: report.afterCaptures, images: report.images, viewportCaptures: report.captures.length, missingCaptures: report.missingCaptures.length, errors: report.errors }, null, 2));
}
export async function checkSimpleGallery() {
  const report = { ok: false, status: 'checking', newSimpleUIPass: true, origin, filesOnly, checkedAt: new Date().toISOString(), beforeCaptures: 0, afterCaptures: 0, images: 0, missingCaptures: [], captures: [], checks: [], errors: [] };
  try {
    assert.equal(reviewScreens.length, 28);
    assert.equal(new Set(reviewScreens.map(screen => screen.id)).size, 28);
    const expectedReferences = [];
    for (const version of ['before-simple', 'after-simple']) for (const screen of reviewScreens) for (const device of ['phone', 'desktop']) {
      const relative = `${version}/${screen.id}-${device}.png`, absolute = path.join(directory, relative);
      expectedReferences.push(relative);
      if (!fs.existsSync(absolute)) { report.missingCaptures.push(relative); continue; }
      const bytes = fs.readFileSync(absolute);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', relative);
      assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR', relative);
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      assert.equal(width, device === 'phone' ? 780 : 2880, `${relative}: intended viewport at 2x resolution required`);
      assert.equal(height, device === 'phone' ? 1688 : 2000, `${relative}: viewport capture required, not a full-page substitute`);
      report[version === 'before-simple' ? 'beforeCaptures' : 'afterCaptures']++;
      report.captures.push({ file: relative, width, height, cssWidth: width / 2, cssHeight: height / 2 });
    }
    if (report.missingCaptures.length) {
      report.status = 'incomplete';
      report.errors.push('This pass requires 56 exact before-simple PNGs and 56 new after-simple PNGs. Earlier After captures are not substituted.');
      save(report); return report;
    }
    assert.equal(report.beforeCaptures, 56); assert.equal(report.afterCaptures, 56); assert.equal(report.captures.length, 112);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'capture-manifest.json'), 'utf8'));
    assert.equal(manifest.newSimpleUIPass, true); assert.equal(manifest.referenceBoardReviewed, true);
    assert.equal(manifest.referenceUse, 'general_layout_only'); assert.equal(manifest.beforeDirectory, 'before-simple');
    assert.equal(manifest.afterDirectory, 'after-simple'); assert.equal(manifest.beforeVersion, 'V2'); assert.equal(manifest.afterVersion, 'V3');
    assert.equal(manifest.fieldReviewOrigin, 'http://localhost:8797'); assert.equal(manifest.screens.length, 28);
    assert.equal(manifest.coverage.afterCaptures, 56); assert.equal(manifest.coverage.matchedBaselines, 56); assert.equal(manifest.coverage.missingBaselines, 0);
    for (const screen of manifest.screens) for (const device of ['phone', 'desktop']) {
      assert.equal(screen.captures[device].before, `before-simple/${screen.id}-${device}.png`);
      assert.equal(screen.captures[device].after, `after-simple/${screen.id}-${device}.png`);
      assert.equal(screen.captures[device].baseline, 'exact');
    }
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const imageSources = [...new Set([...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]))];
    assert.ok(imageSources.length >= 112, 'At least 112 actual before/after image sources are required.');
    for (const relative of expectedReferences) assert.ok(imageSources.includes(relative), `Exact viewport image omitted: ${relative}`);
    const imageReferences = [...new Set([...html.matchAll(/(?:src|href)="([^"#]+\.(?:png|jpe?g|webp))"/g)].map(match => match[1]))];
    for (const relative of imageReferences) {
      assert.ok(!relative.includes('://'));
      assert.ok(relative.startsWith('before-simple/') || relative.startsWith('after-simple/'), `Unexpected capture directory: ${relative}`);
      assert.ok(fs.existsSync(path.join(directory, relative)), `Broken capture reference: ${relative}`);
    }
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    for (const match of html.matchAll(/href="(https?:[^" ]+)"/g)) {
      const url = new URL(match[1].replaceAll('&amp;', '&'));
      if (url.pathname.startsWith('/field/')) assert.equal(url.origin, 'http://localhost:8797');
    }
    assert.ok(!/primary visual board unavailable|requested mark screens|Mark screen coverage/i.test(html));
    report.images = imageReferences.length; report.coverage = manifest.coverage;
    if (!filesOnly) {
      const response = await fetch(`${origin}/local-preview/health/`, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
      const health = await response.json(); assert.equal(health.localOnly, true); assert.equal(health.processor, 'fake'); assert.equal(health.outboundFetch, 'blocked');
      const landing = await fetch(`${origin}/local-preview/`, { signal: AbortSignal.timeout(15000) }).then(result => result.text());
      assert.ok(landing.includes('href="/local-preview/mark-review/"'));
      const gallery = await fetch(origin + prefix, { signal: AbortSignal.timeout(15000) }); assert.equal(gallery.status, 200);
      const served = await gallery.text(); assert.ok(served.includes('56 / 56') && served.includes('after-simple/'));
      const servedImages = new Set([...served.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]));
      for (const relative of expectedReferences) assert.ok(servedImages.has(relative), `Served gallery omits ${relative}`);
      let index = 0;
      await Promise.all(Array.from({ length: 6 }, async () => { while (index < imageReferences.length) {
        const file = imageReferences[index++];
        const asset = await fetch(origin + prefix + file, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
        assert.equal(asset.status, 200, file); assert.match(asset.headers.get('content-type') || '', /^image\//, file);
        report.checks.push({ file, status: asset.status });
      } }));
    }
    report.ok = true; report.status = 'complete';
  } catch (error) { report.status = 'failed'; report.errors.push(error.message); }
  save(report); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkSimpleGallery(); if (!result.ok) process.exitCode = 1;
}
