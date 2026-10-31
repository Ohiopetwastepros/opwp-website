/* Scope is /field-demo/ only. Never cache APIs or authenticated live pages. */
const CACHE='opwp-field-demo-shell-v4';
const SHELL='/field-demo/';
const allowed=url=>url.origin===self.location.origin && (url.pathname.startsWith('/_next/static/') || ['/field-demo/','/field-demo/pink-bag.webp','/field-demo/green-bag.webp','/field-demo/blue-bag.webp','/field-demo/placement.svg','/field-demo/icon.svg','/field-demo/icon-192.png','/field-demo/icon-512.png','/field-demo/manifest.webmanifest','/assets/opwp-logo.webp'].includes(url.pathname));
async function prepare(){
  const cache=await caches.open(CACHE),response=await fetch(SHELL,{cache:'reload'});
  if(!response.ok)throw new Error('Demo shell unavailable');
  const html=await response.clone().text();await cache.put(SHELL,response);
  const assets=new Set(['/field-demo/pink-bag.webp','/field-demo/green-bag.webp','/field-demo/blue-bag.webp','/field-demo/placement.svg','/field-demo/icon.svg','/field-demo/manifest.webmanifest','/assets/opwp-logo.webp']);
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const url=new URL(match[1].replaceAll('&amp;','&'),self.location.origin);if(allowed(url)&&url.pathname!==SHELL)assets.add(url.href);}
  for(const asset of assets){const result=await fetch(asset,{cache:'reload'});if(!result.ok)throw new Error('Offline asset unavailable');await cache.put(asset,result.clone());if(new URL(asset,self.location.origin).pathname.endsWith('.css')){const css=await result.text();for(const match of css.matchAll(/url\(["']?([^\s)'";]+)["']?\)/g)){const url=new URL(match[1],new URL(asset,self.location.origin));if(allowed(url))assets.add(url.href);}}}
  await cache.put('/field-demo/offline-ready',new Response('ready'));
}
self.addEventListener('install',event=>event.waitUntil(prepare().then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('opwp-field-demo-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='PREPARE_DEMO')event.waitUntil(prepare().then(()=>event.ports[0]?.postMessage({ok:true})).catch(async()=>event.ports[0]?.postMessage({ok:Boolean(await (await caches.open(CACHE)).match('/field-demo/offline-ready'))})));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||!allowed(url))return;
  if(event.request.mode==='navigate'&&url.pathname===SHELL){event.respondWith(fetch(event.request).then(async response=>response.ok?response:await caches.match(SHELL)||response).catch(async()=>await caches.match(SHELL)||Response.error()));return;}
  event.respondWith((async()=>{const cached=await caches.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());}return response;})());
});
