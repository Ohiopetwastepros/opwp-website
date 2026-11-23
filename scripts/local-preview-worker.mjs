// Copied beside the generated OpenNext worker in the isolated synthetic preview cache.
import application from './worker.js';

let blockedRequests = 0;
globalThis.fetch = async () => { blockedRequests++; throw new Error('LOCAL_PREVIEW_OUTBOUND_BLOCKED: all external network requests are disabled.'); };
const json = value => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
const guide = "__LOCAL_PREVIEW_GUIDES__";
function permitted(request, env) {
  const url = new URL(request.url);
  return ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8787' && env.LOCAL_PREVIEW_ENABLED === 'true' && env.APP_ENV === 'development' && env.CRM_PAYMENTS_PROVIDER === 'fake';
}
const landing = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Route OS local preview</title><style>body{font:17px system-ui;margin:40px auto;max-width:960px;padding:0 24px;color:#172437;background:#f6f8fb}article{background:white;padding:24px;border:1px solid #d7dfe9;border-radius:12px;margin:16px 0}h1{font-size:34px}a{color:#174c9c}code{background:#edf1f7;padding:3px 6px}li{margin:12px 0}.tag{color:#9c1728;font-weight:700}#code{font-size:30px;letter-spacing:5px}</style><body><p class="tag">LOCAL ONLY · FABRICATED DATA · NO EXTERNAL PAYMENTS OR MESSAGES</p><h1>Route OS click-through preview</h1><article><h2>Admin sign-in</h2><p>Email: <code>preview.admin@example.test</code><br>Password: <code>LocalPreview!2026</code></p><p>Current authenticator code: <strong id="code">Loading…</strong> <small id="valid"></small></p><p>Use the normal sign-in form and this changing MFA code. If a code was already used, wait for the next one.</p><p><a href="/admin/login/?next=/admin/crm/subscriptions/">Open admin sign-in</a> · <a href="/admin/crm/subscriptions/">Customer subscriptions</a> · <a href="/admin/crm/billing/">Monthly billing review</a></p></article><article><h2>Technician sign-in</h2><p><code>tech1@example.test</code> / PIN <code>246810</code><br><code>tech2@example.test</code> / PIN <code>135790</code></p><p><a href="/field/login/?next=/field/app/">Open technician sign-in</a> · <a href="/field/app/">Technician workday</a></p><p>Each technician has a separate route for today's Eastern date. Clock in, work a stop, add notes and a sample photo, or select a skipped-visit reason. Use a separate browser profile/window for each technician.</p></article><article><h2>What is real in this preview?</h2><ul><li>Local D1 saves your CRM, invoice and route edits. Uploaded proof stays in local R2 storage.</li><li>Payments use the in-memory fake provider. The fake tokenizer offers sample card/ACH choices and never asks for account numbers.</li><li>All server outbound fetches and scheduled processors are blocked. No live processor, texts, emails or QBO connection.</li><li>Some older admin areas depend on unconnected providers and will show empty, unavailable or configuration-needed states. The complete local click-through guide identifies these separately.</li></ul><p><a href="/local-preview/health/">Local health and safety status</a></p></article><script>async function refresh(){try{const r=await fetch('/api/local-preview/access/',{cache:'no-store'});const x=await r.json();document.getElementById('code').textContent=x.admin?.code||'Unavailable';document.getElementById('valid').textContent=x.validForSeconds+' seconds remaining';}catch{document.getElementById('code').textContent='Refresh to retry';}}refresh();setInterval(refresh,1000);</script></body></html>`;
export default {
  async fetch(request, env, ctx) {
    if (!permitted(request, env)) return new Response('This worker is restricted to the local fake preview.', { status: 403 });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/local-preview/review/') || url.pathname.startsWith('/local-preview/mark-review/')) {
      if (url.pathname === '/local-preview/review/' || url.pathname === '/local-preview/mark-review/') url.pathname += 'index.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (url.pathname === '/local-preview/guide/') return new Response(guide, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (url.pathname === '/local-preview/test-photo.jpg') {
      const response = await env.ASSETS.fetch(request), headers = new Headers(response.headers);
      headers.set('Content-Disposition', 'attachment; filename="route-os-test-photo.jpg"');
      return new Response(response.body, { status: response.status, headers });
    }
    if (['/', '/local-preview', '/local-preview/'].includes(url.pathname)) return new Response(landing.replace('<article><h2>Admin sign-in', '<p><a href="/admin/crm/">Route OS dashboard</a> · <a href="/admin/crm/customers/">Customer directory</a> · <a href="/local-preview/mark-review/">Latest screen review and remaining gaps</a> · <a href="/local-preview/review/">Earlier CRM review</a></p><p><a href="/local-preview/guide/">Original local click-through guide</a></p><article><h2>Admin sign-in'), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (url.pathname === '/local-preview/health/') {
      const counts = {};
      for (const table of ['crm_subscription_customers', 'crm_subscriptions', 'crm_billing_invoices', 'route_partner_members', 'route_partner_locations']) {
        try { counts[table] = (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count; } catch { counts[table] = 'unavailable'; }
      }
      return json({ localOnly: true, origin: env.LOCAL_PREVIEW_ORIGIN, processor: 'fake', outboundFetch: 'blocked', blockedRequests, scheduledProcessors: 'disabled', counts });
    }
    if (url.pathname === '/local-preview/check-egress/') {
      try { await globalThis.fetch('https://example.invalid/local-preview-check'); return json({ blocked: false }); } catch { return json({ blocked: true, blockedRequests }); }
    }
    if (url.pathname.startsWith('/api/admin/deployments') && !['GET', 'HEAD'].includes(request.method)) return new Response('Deployments are disabled in local preview.', { status: 403 });
    const response = await application.fetch(request, env, ctx);
    const headers = new Headers(response.headers); headers.set('X-Local-Preview', 'fake-data-only'); headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async scheduled() { /* Intentionally never invoke any application scheduler in the local preview. */ },
};
