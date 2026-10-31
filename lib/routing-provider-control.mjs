// Shared by foreground requests and cron jobs. D1's conditional upsert keeps
// concurrent Worker isolates inside the same daily allowance.
export async function controlledRoutingRequest({ db, key, cost, ttl, request, now = Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const seconds = Math.floor(now / 1000);
  const day = new Date(now).toISOString().slice(0, 10);
  const unavailable = (error, errorCode) => ({ ok: false, configured: true, status: 429, data: null, error, errorCode });
  if (!Number.isInteger(cost) || cost < 1 || cost > 2500) return unavailable('Route request exceeds the daily provider allowance.', 'quota_exceeded');
  if (!db) return { ok: false, configured: false, status: 503, data: null, error: 'Route provider protection is unavailable.', errorCode: 'protection_unavailable' };
  try {
    const cached = await db.prepare('SELECT payload FROM routing_provider_cache WHERE cache_key=? AND expires_at>?').bind(key, seconds).first();
    if (cached) return { ok: true, configured: true, status: 200, data: JSON.parse(cached.payload), cached: true };
    const reserved = await db.prepare(`INSERT INTO routing_provider_usage (usage_day,credits,next_request_ms) VALUES (?,?,?)
      ON CONFLICT(usage_day) DO UPDATE SET credits=credits+excluded.credits,next_request_ms=MAX(next_request_ms,?)+250
      WHERE credits+excluded.credits<=2500 AND blocked_until<=? AND next_request_ms<=?
      RETURNING credits,next_request_ms`).bind(day, cost, now + 250, now, seconds, now + 5000).first();
    if (!reserved) return unavailable('Live road-time allowance is exhausted; current route geography is still available.', 'quota_exceeded');
    const delay = Math.max(0, reserved.next_request_ms - now - 250);
    if (delay) await wait(delay);
    const result = await request();
    if (result.status === 429 || result.status === 401 || result.status === 403) {
      const until = result.status === 429 ? result.errorCode === 'rate_limited' ? seconds + 2 : Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 86400 : seconds + 3600;
      await db.prepare('UPDATE routing_provider_usage SET blocked_until=MAX(blocked_until,?) WHERE usage_day=?').bind(until, day).run();
    }
    if (result.ok) {
      await db.prepare(`INSERT INTO routing_provider_cache (cache_key,payload,expires_at) VALUES (?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`).bind(key, JSON.stringify(result.data), seconds + ttl).run();
    }
    return result;
  } catch {
    // Never call the paid provider when its persistent usage protection failed.
    return { ok: false, configured: true, status: 503, data: null, error: 'Route provider protection is unavailable.', errorCode: 'protection_unavailable' };
  }
}

export async function routingRequestKey(path, params, body) {
  const bytes = new TextEncoder().encode(JSON.stringify([path, params, body]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
