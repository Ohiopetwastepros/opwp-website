export const ROUTE_BOOK_RUN_CREDITS = 800;

export function routeBookSchedule(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, overnight: part('hour') === '02' };
}

// Snapshot capture times and completed-job timestamps change hourly even when
// routing inputs do not. Only a real roster/planning change permits a daytime rebuild.
export async function routeBookFingerprint(customers) {
  const cadence = row => {
    if (!['Biweekly', 'Monthly'].includes(row.frequency) || !row.latestServiceDate) return null;
    const instant = new Date(`${String(row.latestServiceDate).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(instant.getTime())) return null;
    const weekday = instant.getUTCDay() || 7;
    instant.setUTCDate(instant.getUTCDate() - weekday + 1);
    const period = row.frequency === 'Biweekly' ? 2 : 4;
    const bucket = Math.floor((instant.getTime() - Date.UTC(2024, 0, 1)) / 604800000);
    return ((bucket % period) + period) % period;
  };
  const rows = customers.map(row => ({
    id: row.customerId, name: row.customerName, address: String(row.address || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    days: row.serviceDays, technicians: row.technicianNames || [row.technicianName], frequency: row.frequency,
    minutes: row.serviceMinutes, revenue: row.mrr,
    cadence: cadence(row),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function claimRouteBookRebuild(db, date, fingerprint) {
  // An atomic D1 daily lease prevents overlapping crons and hourly retries of
  // an unchanged, incomplete or over-budget plan. No new schema is needed.
  const key = `route_book_rebuild_v1:${date}:${fingerprint}`;
  const lease = await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at)
    VALUES (?,?,'success',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO NOTHING RETURNING snapshot_key`)
    .bind(key, JSON.stringify({ date, fingerprint })).first();
  return Boolean(lease);
}
