import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Exercise the actual workers-og WASM under workerd, with local assets only.
// No D1, providers, credentials, remote storage, or network sends are bound.
export async function createReviewPreviewTestWorker() {
  const wasmModules = new Map();
  const bundled = await build({
    stdin:{ contents:`import { renderReviewPreview } from './lib/review-preview-renderer.mjs';
      export default { async fetch(request, env) {
        const url=new URL(request.url);
        const result=await renderReviewPreview(env,{firstName:url.searchParams.get('name'),tech:url.searchParams.get('tech')});
        return new Response(result.bytes,{headers:{'Content-Type':result.contentType}});
      } };`, resolveDir:root, sourcefile:'review-preview-test-worker.mjs' },
    bundle:true, write:false, format:'esm', platform:'neutral', target:'es2022', logLevel:'silent',
    plugins:[{ name:'worker-wasm', setup(builder) {
      builder.onResolve({ filter:/\.wasm$/ }, async args => {
        const file = path.resolve(args.resolveDir,args.path);
        const name = `./${path.basename(file)}`;
        wasmModules.set(name,await fs.readFile(file));
        return { path:name, external:true };
      });
    } }],
  });
  const allowedAssets = new Set(['/assets/fonts/HankenGrotesk-ExtraBold.ttf','/assets/photos/review-craig-og.jpg','/assets/photos/review-tony-og.jpg']);
  return new Miniflare(convertV4MiniflareOptions({
    log:new Log(LogLevel.NONE),
    compatibilityDate:'2026-08-28',
    modulesRoot:root,
    modules:[
      { type:'ESModule', path:path.join(root,'review-preview-test-worker.mjs'), contents:bundled.outputFiles[0].text },
      ...Array.from(wasmModules,([name,contents]) => ({ type:'CompiledWasm', path:path.resolve(root,name), contents })),
    ],
    serviceBindings:{ ASSETS:async request => {
      const pathname = new URL(request.url).pathname;
      if (!allowedAssets.has(pathname)) return new Response(null,{status:404});
      const bytes = await fs.readFile(path.join(root,'public',pathname));
      return new Response(bytes,{headers:{'Content-Type':pathname.endsWith('.jpg')?'image/jpeg':'font/ttf'}});
    } },
  }));
}
