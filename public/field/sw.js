const CACHE = "opwp-field-shell-v1";
const ROOT = "/field/app/";
function allowed(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname === ROOT ||
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/field-app/") ||
      url.pathname === "/assets/opwp-logo.webp")
  );
}
async function prepare() {
  const shell = await fetch(ROOT, { cache: "reload", credentials: "omit" });
  if (
    !shell.ok ||
    shell.redirected ||
    !shell.headers.get("content-type")?.includes("text/html")
  )
    throw new Error("Field shell unavailable");
  const html = await shell.clone().text(),
    assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((m) => new URL(m[1], self.location.origin))
      .filter((url) => allowed(url) && url.pathname !== ROOT);
  if (!assets.some((u) => u.pathname.endsWith(".js")))
    throw new Error("Field app assets missing");
  const responses = await Promise.all(
    [...new Set(assets.map((u) => u.href))].map(async (url) => {
      const r = await fetch(url, { cache: "reload", credentials: "omit" });
      if (!r.ok || r.redirected) throw new Error("Field download failed");
      return [url, r];
    }),
  );
  const cache = await caches.open(CACHE);
  for (const [url, r] of responses) await cache.put(url, r);
  await cache.put(ROOT, shell);
}
self.addEventListener("install", (event) =>
  event.waitUntil(prepare().then(() => self.skipWaiting())),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("opwp-field-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "PREPARE_FIELD")
    event.waitUntil(
      prepare()
        .then(() => event.ports[0]?.postMessage({ ok: true }))
        .catch(async () =>
          event.ports[0]?.postMessage({
            ok: false,
            cached: !!(await (await caches.open(CACHE)).match(ROOT)),
          }),
        ),
    );
});
self.addEventListener("fetch", (event) => {
  const r = event.request,
    url = new URL(r.url);
  if (r.method !== "GET" || !allowed(url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (url.pathname === ROOT) {
        try {
          const response = await fetch(r);
          if (response.ok && !response.redirected) {
            await prepare();
            return response;
          }
        } catch {}
        const saved = await cache.match(ROOT);
        return saved || Response.error();
      }
      const cached = await cache.match(r);
      if (cached) return cached;
      const response = await fetch(r);
      if (response.ok && !response.redirected)
        await cache.put(r, response.clone());
      return response;
    })(),
  );
});
