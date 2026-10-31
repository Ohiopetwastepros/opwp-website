import auditSeed from '../data/meta-ads-audit-2026-10-06.json' with {type:'json'};
import { importMetaDaily, importOutcomes, mergeDaily } from './marketing-metrics.mjs';
export const MARKETING_KEY = 'marketing:org-opwp:meta-v1';
export async function readMarketingSnapshot(db) {
  if (!db) throw new Error('Private reporting storage is unavailable.');
  const row = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(MARKETING_KEY).first();
  if (!row) return { revision: '', daily: [], outcomes: [], updatedAt: null };
  const snapshot = JSON.parse(row.payload);
  if (snapshot.organizationId !== 'org-opwp' || !Array.isArray(snapshot.daily) || !Array.isArray(snapshot.outcomes)) throw new Error('Private reporting storage is invalid.');
  return snapshot;
}
export async function saveMarketingImport(db, body, actor) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action','csv','revision'].includes(key)) || !['meta','outcomes'].includes(body.action) || typeof body.csv !== 'string' || typeof body.revision !== 'string' || body.revision.length > 100) return { status: 400, error: 'Invalid import request.' };
  const current = await readMarketingSnapshot(db);
  if (body.revision !== current.revision) return { status:409, error:'Another session updated this view. Refresh before importing.' };
  let next;
  try {
    if (body.action === 'meta') {
      const imported = importMetaDaily(body.csv,String(auditSeed.accountId));
      const zeroKeys = new Set(current.zeroKeys || []);
      for (const row of imported.rows) {
        const key = `${row.adId}:${row.date}`;
        if (row.spend || row.leads || row.impressions || row.clicks) zeroKeys.delete(key); else zeroKeys.add(key);
      }
      next = { ...current, daily: mergeDaily(current.daily,imported.rows).filter(row => row.spend || row.leads || row.impressions || row.clicks),
        zeroKeys: [...zeroKeys],
        reportingStart: !current.reportingStart || imported.start < current.reportingStart ? imported.start : current.reportingStart,
        reportingEnd: !current.reportingEnd || imported.end > current.reportingEnd ? imported.end : current.reportingEnd,
        metaImportedAt: new Date().toISOString() };
    } else next = { ...current, outcomes: importOutcomes(body.csv), outcomesImportedAt: new Date().toISOString() };
  } catch (error) { return { status:400, error:error.message }; }
  next = { ...next, organizationId:'org-opwp', revision:crypto.randomUUID(), updatedAt:new Date().toISOString(), updatedBy:String(actor).slice(0,254) };
  const payload = JSON.stringify(next);
  if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024) return { status:413, error:'Normalized history exceeds 2 MB. Import a smaller history window.' };
  const result = current.revision
    ? await db.prepare(`UPDATE airtable_cockpit_snapshots SET payload=?,status='success',captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND json_extract(payload,'$.revision')=?`).bind(payload,next.updatedAt,MARKETING_KEY,current.revision).run()
    : await db.prepare(`INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)`).bind(MARKETING_KEY,payload,next.updatedAt).run();
  if (Number(result.meta?.changes || 0) !== 1) return { status:409, error:'Another session updated this view. Refresh before importing.' };
  return { status:200, snapshot:next };
}
export function marketingHandlers({ verifyAdminRequest, getDb, checkRateLimit, readBody }) {
  const headers = { 'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer' };
  const response = (body,status=200) => Response.json(body,{status,headers});
  return {
    async GET(request) {
      const auth = await verifyAdminRequest(request.headers);
      if (!auth.authorized) return response({error:'Unauthorized'},401);
      try { return response({snapshot:await readMarketingSnapshot(getDb())}); }
      catch { return response({error:'Private reporting storage is unavailable.'},503); }
    },
    async POST(request) {
      const auth = await verifyAdminRequest(request.headers);
      if (!auth.authorized) return response({error:'Unauthorized'},401);
      if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return response({error:'Cross-site request blocked.'},403);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return response({error:'JSON required.'},415);
      const actorRequest = new Request(request.url,{headers:{'cf-connecting-ip':'actor','user-agent':'marketing-import'}});
      const limit = await checkRateLimit(actorRequest,{scope:`marketing_import:${auth.email}`,limit:12,windowSeconds:3600,failClosed:true});
      if (!limit.allowed) return response({error:limit.unavailable ? 'Service protection is unavailable.' : 'Import limit reached. Try again later.'},limit.unavailable ? 503 : 429);
      try {
        const result = await saveMarketingImport(getDb(),await readBody(request,8 * 1024 * 1024),auth.email);
        return response(result.snapshot ? {snapshot:result.snapshot} : {error:result.error},result.status);
      } catch (error) { return response({error:error instanceof RangeError ? 'Request too large.' : 'Private reporting storage is unavailable.'},error instanceof RangeError ? 413 : 503); }
    },
  };
}
