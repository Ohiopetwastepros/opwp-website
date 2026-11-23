import { getRuntimeEnv } from '@/lib/cloudflare';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { localPreviewPaymentOrigin } from '@/lib/local-preview-payments.mjs';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  const origin = localPreviewPaymentOrigin(getRuntimeEnv(), request.url);
  if (!origin) return new Response('Not found', { status: 404 });
  if (!(await verifyAdminRequest(request.headers)).authorized) return new Response('Administrator sign-in required.', { status: 401 });
  const methodType = new URL(request.url).searchParams.get('methodType');
  if (!['card', 'ach'].includes(methodType)) return new Response('Choose a fake payment method.', { status: 400 });
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const label = methodType === 'card' ? 'Fake Visa ending 4242' : 'Fake checking ending 6789';
  const token = methodType === 'card' ? '9000000000000001' : '9000000000000002';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local fake payment form</title><style nonce="${nonce}">body{font:16px system-ui;margin:18px;color:#18212f}h3{margin:0 0 8px}p{line-height:1.5}button{background:#a8202f;color:white;border:0;border-radius:6px;padding:12px 18px;font:inherit;cursor:pointer}.ready{color:#1b7340}</style></head><body><h3>Local fake tokenizer</h3><p>${label}. This sample contains no real card or bank details.</p><button id="choose" type="button">Use this fake ${methodType === 'card' ? 'card' : 'bank account'}</button><p id="status" role="status"></p><script nonce="${nonce}">document.getElementById('choose').addEventListener('click',function(){parent.postMessage(JSON.stringify({token:${JSON.stringify(token)},errorCode:'0'}),${JSON.stringify(origin)});document.getElementById('status').textContent='Fake method ready. Complete Billing ZIP and authorization in the parent form.';document.getElementById('status').className='ready';});</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'` } });
}
