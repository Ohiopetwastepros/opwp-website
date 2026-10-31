import { verifyAdminRequest } from '@/lib/admin-auth';
import { protectJsonRequest } from '@/lib/public-api-security';
import { getDb } from '@/lib/db';
import { getRouteRevenueDetail } from '@/lib/airtable';
import { saveCleanupWork } from '@/lib/cleanup-work';
import { validateCleanupWorkInput } from '@/lib/cleanup-work.mjs';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
export async function POST(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Cross-site request blocked.' }, { status: 403, headers });
  const guarded = await protectJsonRequest(request, { scope: `cleanup_work:${auth.email}`, limit: 12, windowSeconds: 600, maxBytes: 8192, turnstile: false, failClosed: true });
  if (guarded.response) {
    for (const [name, value] of Object.entries(headers)) guarded.response.headers.set(name, value);
    return guarded.response;
  }
  let input;
  try { input = validateCleanupWorkInput(guarded.body); }
  catch (error) { return Response.json({ error: error.message }, { status: 400, headers }); }
  const db = getDb();
  if (!db) return Response.json({ error: 'Job work storage is unavailable.' }, { status: 503, headers });
  try {
    const records = await getRouteRevenueDetail({ from: input.date, through: input.date });
    const source = records.find(record => record.id === input.jobId);
    const result = await saveCleanupWork(db, input, source, auth.email);
    return Response.json(result, { status: result.status || 200, headers });
  } catch { return Response.json({ error: 'Job work could not be saved. Reload before retrying.' }, { status: 503, headers }); }
}
