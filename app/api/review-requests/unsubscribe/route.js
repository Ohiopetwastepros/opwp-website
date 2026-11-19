import { getRuntimeEnv } from '@/lib/cloudflare';
import { unsubscribeReviewEmail } from '@/lib/review-requests';

export const dynamic = 'force-dynamic';

// GET/prefetch never changes consent. RFC 8058 one-click clients POST with the
// unguessable capability in the URL; the confirmation page POSTs it in the form.
export async function POST(request) {
  if (Number(request.headers.get('content-length')) > 2048) return new Response('Request too large.', { status: 413 });
  const reader = request.body?.getReader();
  let length = 0, body = '';
  const decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); return new Response('Request too large.', { status: 413 }); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  }
  const token = new URL(request.url).searchParams.get('token') || new URLSearchParams(body).get('token') || '';
  try {
    const ok = await unsubscribeReviewEmail(getRuntimeEnv(), token);
    return new Response(ok ? 'You have been unsubscribed from Ohio Pet Waste Pros review request emails.' : 'This unsubscribe link is invalid. Please use the link in your review email.', { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch { return new Response('Your preference could not be saved. Please try again.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
