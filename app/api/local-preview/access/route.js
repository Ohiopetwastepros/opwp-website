import { getRuntimeEnv } from '@/lib/cloudflare';
import { localPreviewPaymentOrigin } from '@/lib/local-preview-payments.mjs';
import { localPreviewAdminCode, LOCAL_PREVIEW_ADMIN_EMAIL } from '@/lib/local-preview-admin.mjs';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  const env = getRuntimeEnv();
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  if (!localPreviewPaymentOrigin(env, request.url)) return Response.json({ ok: false }, { status: 404, headers });
  try { return Response.json({ ok: true, admin: { username: LOCAL_PREVIEW_ADMIN_EMAIL, code: localPreviewAdminCode(env) }, validForSeconds: 30 - Math.floor(Date.now() / 1000) % 30 }, { headers }); }
  catch { return Response.json({ ok: false, error: 'Local preview MFA is not configured.' }, { status: 503, headers }); }
}
