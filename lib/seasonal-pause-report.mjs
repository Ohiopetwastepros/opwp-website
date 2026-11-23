const TIME_ZONE = "America/New_York";
const DAY = 86400000;
export const SEASONAL_PATTERN_LABELS = Object.freeze({
  year_round: "Year-round",
  winter: "Winter pauser",
  spring_fall: "Spring/Fall pauser",
  summer: "Summer pauser",
  other: "Other",
  unknown: "Unknown",
});

function businessDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function patternKey(value) {
  if (Object.hasOwn(SEASONAL_PATTERN_LABELS, value)) return value;
  return Object.keys(SEASONAL_PATTERN_LABELS).find(key => SEASONAL_PATTERN_LABELS[key] === value) || "unknown";
}

function season(date) {
  const month = Number(date.slice(5, 7));
  return month === 12 || month < 3 ? "winter" : month < 6 ? "spring" : month < 9 ? "summer" : "fall";
}

function clientSummary(row) {
  const pattern = patternKey(row.seasonal_pattern);
  return {
    sngClientId: row.sng_client_id,
    name: row.client_name || "Unnamed client",
    pattern,
    patternLabel: SEASONAL_PATTERN_LABELS[pattern],
    pauseStartDate: dateOnly(row.pause_start_date),
    pauseEndDate: dateOnly(row.pause_end_date),
    plannedRestartDate: dateOnly(row.planned_restart_date),
    nextActionDate: dateOnly(row.next_action_date),
    reason: row.pause_reason || "",
    pauseCount: Number(row.pause_count) || 0,
    isPaused: Number(row.is_paused) === 1,
  };
}

const byDate = (left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name) || String(left.sngClientId).localeCompare(String(right.sngClientId));

// Dates describe the client's requested season, never a season inferred from a 90-day pause cap.
export function buildSeasonalPauseReport(clients, events, { now = new Date() } = {}) {
  const today = businessDate(now);
  if (!today) throw new Error("A valid report date is required.");
  const currentYear = Number(today.slice(0, 4));
  const through = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * DAY).toISOString().slice(0, 10);
  const summaries = clients.map(clientSummary);
  const countsByPattern = Object.fromEntries(Object.keys(SEASONAL_PATTERN_LABELS).map(key => [key, 0]));
  for (const client of summaries) countsByPattern[client.pattern]++;

  const periods = new Map();
  for (const event of [...events].sort((left, right) => String(right.event_at).localeCompare(String(left.event_at))
    || String(right.created_at || "").localeCompare(String(left.created_at || "")) || String(right.id || "").localeCompare(String(left.id || "")))) {
    if (!["paused", "canceled_seasonal"].includes(event.event_type)) continue;
    const start = dateOnly(event.pause_start_date) || businessDate(event.event_at);
    // A core plan and its add-ons can pause together. Customer analytics count
    // that business-date window once, independently of subscription line count.
    const key = start ? JSON.stringify([event.sng_client_id, start])
      : event.period_key || JSON.stringify([event.sng_client_id, event.event_at]);
    if (!periods.has(key)) periods.set(key, { clientId: event.sng_client_id, start, restart: dateOnly(event.planned_restart_date) });
    else if (!periods.get(key).restart) periods.get(key).restart = dateOnly(event.planned_restart_date);
  }
  // Human restart dates live in the mirrored client state. Apply them only to
  // that client's matching latest window; leave earlier historical periods alone.
  for (const client of summaries) {
    if (!client.pauseStartDate || !client.plannedRestartDate) continue;
    for (const period of periods.values()) {
      if (period.clientId === client.sngClientId && period.start === client.pauseStartDate) period.restart = client.plannedRestartDate;
    }
  }
  const previousYear = currentYear - 1;
  const hasPrevious = [...periods.values()].some(period => [period.start, period.restart].some(date => date && Number(date.slice(0, 4)) === previousYear));
  const years = hasPrevious ? [previousYear, currentYear] : [currentYear];
  const monthlyCounts = years.flatMap(year => Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, "0")}`, pauseStarts: 0, plannedRestarts: 0,
  })));
  const seasonCounts = years.flatMap(year => ["winter", "spring", "summer", "fall"].map(value => ({ year, season: value, pauseStarts: 0, plannedRestarts: 0 })));
  const months = new Map(monthlyCounts.map(row => [row.month, row]));
  const seasons = new Map(seasonCounts.map(row => [`${row.year}-${row.season}`, row]));
  for (const { start, restart } of periods.values()) {
    for (const [date, field] of [[start, "pauseStarts"], [restart, "plannedRestarts"]]) {
      if (!date || !months.has(date.slice(0, 7))) continue;
      months.get(date.slice(0, 7))[field]++;
      seasons.get(`${date.slice(0, 4)}-${season(date)}`)[field]++;
    }
  }

  const currentPausers = summaries.filter(client => client.isPaused && (!client.pauseStartDate || client.pauseStartDate <= today))
    .sort((left, right) => left.name.localeCompare(right.name));
  const inWindow = date => date && date >= today && date <= through;
  const upcomingRestarts = summaries.filter(client => inWindow(client.plannedRestartDate))
    .map(client => ({ ...client, date: client.plannedRestartDate })).sort(byDate);
  const upcomingActions = summaries.filter(client => inWindow(client.nextActionDate)).map(client => ({
    ...client,
    date: client.nextActionDate,
    action: client.pauseEndDate && client.plannedRestartDate > client.pauseEndDate && client.nextActionDate === client.pauseEndDate ? "re_pause" : "follow_up",
  }));
  for (const client of summaries) {
    if (client.isPaused && client.pauseStartDate > today && inWindow(client.pauseStartDate)) {
      upcomingActions.push({ ...client, date: client.pauseStartDate, action: "scheduled_pause" });
    }
  }
  upcomingActions.sort(byDate);

  const airtableSync = { pending: 0, failed: 0, unmatched: 0, synced: 0, latestSyncedAt: null, oldestPendingAt: null };
  for (const client of clients) {
    const status = ["pending", "failed", "unmatched", "synced"].includes(client.airtable_sync_status) ? client.airtable_sync_status : "pending";
    airtableSync[status]++;
    if (client.airtable_synced_at && (!airtableSync.latestSyncedAt || client.airtable_synced_at > airtableSync.latestSyncedAt)) airtableSync.latestSyncedAt = client.airtable_synced_at;
    if (status !== "synced" && client.updated_at && (!airtableSync.oldestPendingAt || client.updated_at < airtableSync.oldestPendingAt)) airtableSync.oldestPendingAt = client.updated_at;
  }
  return {
    asOf: new Date(now).toISOString(), businessDate: today, timeZone: TIME_ZONE,
    window: { from: today, through, days: 90 }, years,
    totals: { trackedClients: clients.length, currentPausers: currentPausers.length, documentedPeriods: periods.size },
    countsByPattern, monthlyCounts, seasonCounts, currentPausers, upcomingRestarts, upcomingActions, airtableSync,
  };
}

export async function getSeasonalPauseReport(db, options = {}) {
  if (!db) throw new Error("Seasonal pause storage is not configured.");
  const [clients, events] = await Promise.all([
    db.prepare(`SELECT sng_client_id,client_name,seasonal_pattern,pause_start_date,pause_end_date,
      planned_restart_date,pause_reason,pause_count,next_action_date,is_paused,
      airtable_synced_at,airtable_sync_status,updated_at FROM seasonal_pause_clients`).all(),
    db.prepare(`SELECT id,sng_client_id,sng_subscription_id,event_type,event_at,pause_start_date,
      planned_restart_date,period_key,created_at FROM seasonal_pause_events
      WHERE event_type IN ('paused','canceled_seasonal')`).all(),
  ]);
  return buildSeasonalPauseReport(clients.results || [], events.results || [], options);
}
