import app from "../.open-next/worker.js";

// An isolated visual review deployment: never expose provider/webhook/mutation routes.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/admin/quote-funnel") return Response.redirect("https://www.ohiopetwastepros.com/admin/quote-funnel/", 302);
    if (path === "/" || path === "/admin") return Response.redirect(`${url.origin}/admin/quote-funnel/meta-preview/`, 302);
    const session = path === "/api/admin/session";
    const page = path === "/admin/login" || path === "/admin/quote-funnel/meta-preview";
    const asset = path.startsWith("/_next/static/") || path.startsWith("/assets/") || path === "/favicon.ico";
    if ((!session && !page && !asset) || (!session && !["GET", "HEAD"].includes(request.method))) return new Response("Not available in this visual preview.", { status: 404 });
    if (asset) return env.ASSETS.fetch(request);
    // No scheduled handler is exported, and no provider credentials are provisioned.
    const response = await app.fetch(request, { ...env, META_AUTOMATION_ENABLED: "false", META_TEST_MODE: "false", EMAIL_SENDING_ENABLED: "false" }, ctx);
    const safe = new Response(response.body, response);
    safe.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (!asset) safe.headers.set("Cache-Control", "private, no-store");
    return safe;
  },
};
