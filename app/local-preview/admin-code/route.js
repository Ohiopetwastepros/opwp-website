import { getRuntimeEnv } from '@/lib/cloudflare';
import { localPreviewPaymentOrigin } from '@/lib/local-preview-payments.mjs';
import { localPreviewAdminCode } from '@/lib/local-preview-admin.mjs';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  const env = getRuntimeEnv();
  if (!localPreviewPaymentOrigin(env, request.url)) return new Response('Not found', { status: 404 });
  let code;
  try { code = localPreviewAdminCode(env); } catch { return new Response('Local preview MFA is not configured.', { status: 503 }); }
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="15"><title>Local preview admin code</title></head><body><h1>Local preview admin verification</h1><p>This code is for the fabricated local admin account only.</p><p><strong>${code}</strong></p><p>Refreshes every 15 seconds. Use a fresh code if one was already used.</p><p><a href="/admin/login/">Open administrator sign-in</a></p></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
}
