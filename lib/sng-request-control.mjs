const KEY = 'sng_request_control_v1';

export class SngDeferredError extends Error {
  constructor(until) { super('Sweep & Go checks deferred until the provider cooldown ends.'); this.status = 429; this.retryAt = until; }
}

export function retryAtFrom(response, now = Date.now()) {
  const retry = response.headers.get('retry-after');
  const seconds = retry === null || retry.trim() === '' ? NaN : Number(retry);
  const date = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(retry || '');
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
  return Math.max(now + 60000, Number.isFinite(date) && date > now ? date : Number.isFinite(reset) && reset > now ? reset : now + 15 * 60000);
}

// Shared across Worker instances and consumers; no in-memory cooldown assumption.
export async function controlledSngFetch(env, url, options = {}) {
  const target = new URL(url);
  if (target.origin !== 'https://openapi.sweepandgo.com') throw new Error('Invalid SNG origin');
  const db = env?.DB;
  if (db) {
    const state = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(KEY).first();
    const until = JSON.parse(state?.payload || '{}').blockedUntil || 0;
    if (until > Date.now()) throw new SngDeferredError(until);
  }
  const response = await fetch(target, { ...options, signal: options.signal || AbortSignal.timeout(20000) });
  if (db && (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0')) {
    const until = retryAtFrom(response);
    await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at)
      VALUES (?,?,'partial',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='partial',updated_at=CURRENT_TIMESTAMP
      WHERE COALESCE(json_extract(airtable_cockpit_snapshots.payload,'$.blockedUntil'),0)<json_extract(excluded.payload,'$.blockedUntil')`)
      .bind(KEY, JSON.stringify({ blockedUntil: until })).run();
  }
  return response;
}
