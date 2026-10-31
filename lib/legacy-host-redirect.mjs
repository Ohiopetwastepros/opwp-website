const LEGACY_HOST = "opwp-website.ohiopetwastepros.workers.dev";
const SITE_HOST = "www.ohiopetwastepros.com";

export function legacyHostRedirect(request) {
  const url = new URL(request.url);
  if (url.hostname !== LEGACY_HOST || !["GET", "HEAD"].includes(request.method)) return null;
  // Existing provider callbacks, webhooks, data fetches and open browser tabs
  // must continue using their original endpoint and authentication context.
  if (request.headers.has("upgrade") || request.headers.has("rsc") || request.headers.has("next-router-prefetch")) return null;
  if (["/api", "/_next", "/.well-known", "/cdn-cgi"].some(path => url.pathname === path || url.pathname.startsWith(`${path}/`))) return null;
  url.protocol = "https:";
  url.hostname = SITE_HOST;
  url.port = "";
  return new Response(null, { status: 307, headers: {
    Location: url.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } });
}
