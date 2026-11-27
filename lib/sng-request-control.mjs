const KEY = 'sng_request_control_v1';
const RETRY_DELAYS_MS = [750, 2000, 5000];

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

// Sweep&Go uses HTTP 403 for authorization failures. The same token and
// endpoints succeed on later hours, so a single 403 is not treated as final.
export function sngProviderMessageText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed || trimmed.length > 4096) return '';
  let data;
  try { data = JSON.parse(trimmed); } catch { return ''; }
  const raw = Array.isArray(data?.errors) ? data.errors : typeof data?.message === 'string' ? [data.message] : [];
  const message = raw.filter((item) => typeof item === 'string').join('; ').replace(/\s+/g, ' ').trim();
  if (!message || /bearer\s+/i.test(message)) return '';
  return message.slice(0, 180);
}

export async function sngProviderMessage(response) {
  try { return sngProviderMessageText(await response.text()); } catch { return ''; }
}

function defaultSngWait(attempt) {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[Math.min(Math.max(attempt, 1) - 1, RETRY_DELAYS_MS.length - 1)]));
}

// One isolate's scheduled jobs otherwise open the client and dispatch calls together.
let tail = Promise.resolve();
function serialize(task) {
  const result = tail.then(task, task);
  tail = result.then(() => undefined, () => undefined);
  return result;
}

async function runControlledSngFetch(env, target, requestOptions, attempts, sngWait) {
  const db = env?.DB;
  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (db) {
      const state = await db.prepare('SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?').bind(KEY).first();
      const until = JSON.parse(state?.payload || '{}').blockedUntil || 0;
      if (until > Date.now()) throw new SngDeferredError(until);
    }
    response = await fetch(target, { ...requestOptions, signal: requestOptions.signal || AbortSignal.timeout(20000) });
    if (db && (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0')) {
      const until = retryAtFrom(response);
      await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at)
        VALUES (?,?,'partial',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='partial',updated_at=CURRENT_TIMESTAMP
        WHERE COALESCE(json_extract(airtable_cockpit_snapshots.payload,'$.blockedUntil'),0)<json_extract(excluded.payload,'$.blockedUntil')`)
        .bind(KEY, JSON.stringify({ blockedUntil: until })).run();
    }
    if (response.status !== 403 || attempt === attempts) return response;
    await response.body?.cancel();
    await sngWait(attempt);
  }
  return response;
}

// Shared across Worker instances and consumers; no in-memory cooldown assumption.
export async function controlledSngFetch(env, url, options = {}) {
  const target = new URL(url);
  if (target.origin !== 'https://openapi.sweepandgo.com') throw new Error('Invalid SNG origin');
  const { sngAttempts = 4, sngWait = defaultSngWait, ...requestOptions } = options;
  const attempts = Math.min(4, Math.max(1, Number(sngAttempts) || 1));
  return serialize(() => runControlledSngFetch(env, target, requestOptions, attempts, sngWait));
}
