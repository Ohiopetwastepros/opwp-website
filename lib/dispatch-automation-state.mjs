export const DISPATCH_AUTOMATION_KEY = date => `dispatch_automation:org-opwp:${date}`;

export function dispatchSchedule(scheduledTime) {
  const instant = new Date(scheduledTime);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid dispatch schedule time.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, due: parts.hour === "04" && Number(parts.minute) % 10 === 0 };
}

export async function readDispatchAutomation(db, date) {
  const row = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?")
    .bind(DISPATCH_AUTOMATION_KEY(date)).first();
  let run = null;
  try { run = JSON.parse(row?.payload || "null"); } catch { /* Retain explicit unavailable state. */ }
  return { schedule: "Daily at 4:00 AM America/New_York", publishing: "browser_required", run };
}

export async function saveDispatchSnapshot(db, key, value) {
  const payload = JSON.stringify(value);
  if (new TextEncoder().encode(payload).length > 1000000) throw new Error("Dispatch snapshot exceeds the safe storage limit.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at)
    VALUES (?,?,'success',?,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET
    payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(key, payload, new Date().toISOString()).run();
}
