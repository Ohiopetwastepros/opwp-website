import { getRuntimeEnv } from '@/lib/cloudflare';
import { runOwnerReviewGoogleLinkTest } from '@/lib/review-request-owner-test.mjs';
import { readBoundedBytes } from '@/lib/bounded-body.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'cross_site_request_blocked' }, 403);
  if (request.headers.get('content-type') !== 'application/json' || Number(request.headers.get('content-length') || 0) > 512) return reply({ error: 'invalid_request' }, 400);
  try {
    const raw = new TextDecoder().decode(await readBoundedBytes(request, 512));
    const body = JSON.parse(raw);
    if (!body || Object.keys(body).some(key => !['phone', 'email'].includes(key))) return reply({ error: 'invalid_request' }, 400);
    return reply(await runOwnerReviewGoogleLinkTest(getRuntimeEnv(), { ...body, authorization: request.headers.get('authorization') }));
  } catch (error) {
    const safe = /^owner_test_[a-z_]+$/.test(error.message || '');
    return reply({ error: safe ? error.message : 'owner_test_unavailable_verify_ledger_before_retry' }, safe ? error.status || 503 : 503);
  }
}
