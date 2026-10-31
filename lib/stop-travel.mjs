export const shiftTravelDate = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0,10);
export const travelDay = date => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US",{weekday:"long",timeZone:"UTC"});
export function travelWeek(date = travelDate()) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const from = shiftTravelDate(date, -((weekday + 6) % 7));
  return { from, through: shiftTravelDate(from, 6), dates: Array.from({length:7},(_,index)=>shiftTravelDate(from,index)) };
}
export function summarizeTravelDates(rows = [], metadata = [], dates = []) {
  const saved = new Map(metadata.map(day => [day.date,day]));
  const included = dates.length ? dates : [...new Set([...saved.keys(),...rows.map(row=>row.date)])].sort();
  return included.map(date => {
    const dayRows = rows.filter(row=>row.date===date);
    const day = saved.get(date);
    const pending = dayRows.filter(row=>row.status==="pending").length;
    return { date, analyzed:Boolean(day), capturedAt:day?.capturedAt||null, jobs:Number(day?.jobs||0), transitions:dayRows.length, flagged:dayRows.filter(row=>row.flagged).length, pending, measured:dayRows.length-pending };
  });
}
export const TRAVEL_GRACE_MINUTES = 5;
const zone = "America/New_York";
const localParts = (time) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(time)).map(p => [p.type, p.value]));
export function travelDate(time = Date.now()) {
  const p = localParts(time);
  return `${p.year}-${p.month}-${p.day}`;
}
// SNG's unzoned job timestamps are Eastern wall time, not webhook receipt UTC.
// Reject ambiguous/nonexistent DST times instead of assigning a false delay.
export function parseTravelTime(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/i.test(raw)) {
    const n = Date.parse(raw); return Number.isFinite(n) ? n : null;
  }
  const m = raw.match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)$/);
  if (!m) return null;
  const wall = Date.parse(`${m[1]}T${m[2]}Z`);
  if (!Number.isFinite(wall)) return null;
  const matches = [4, 5].map(h => wall + h * 3600000).filter(t => {
    const p = localParts(t);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` === `${m[1]} ${m[2]}`;
  });
  return matches.length === 1 ? matches[0] : null;
}
const id = value => String(value ?? "").trim().replace(/\.0+$/, "").slice(0, 100);
const text = value => String(value || "").trim().slice(0, 160);
const presentNumber = value => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function travelPoint(lat, lon) {
  const latitude = presentNumber(lat), longitude = presentNumber(lon);
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0) ? { latitude, longitude } : null;
}
export function travelJobs(events) {
  const jobs = new Map();
  // Dispatch fallback first, then starts, then completions; latest correction wins.
  const priority = e => e.source === "sweep_and_go_dispatch_api" ? 0 : e.event_type === "job:started" ? 1 : 2;
  for (const event of [...events].sort((a,b) => priority(a)-priority(b) || String(a.received_at||"").localeCompare(String(b.received_at||"")))) {
    if (!["job:started", "job:completed"].includes(event.event_type)) continue;
    let body; try { body = JSON.parse(event.payload); } catch { continue; }
    const d = body?.data || {};
    const jobId = id(d.job_id ?? d.id ?? event.external_id);
    if (!jobId) continue;
    const job = jobs.get(jobId) || { jobId, customer: "", technicianId: "", technician: "", start: null, end: null, point: null, sourceEventIds: [] };
    const techId = id(d.employee_id ?? d.assigned_to_id);
    if (job.technicianId && techId && job.technicianId !== techId) job.conflict = true;
    job.technicianId = techId || job.technicianId;
    job.technician = text(d.employee_name) || job.technician || text(d.assigned_to_name);
    job.customer = text(d.client_name || d.full_name) || job.customer;
    if (d.start_time) job.start = parseTravelTime(d.start_time);
    if (d.end_time) job.end = parseTravelTime(d.end_time);
    job.point = travelPoint(d.start_latitude, d.start_longitude) || job.point;
    job.endPoint = travelPoint(d.end_latitude, d.end_longitude) || job.endPoint || null;
    job.date = job.start !== null ? travelDate(job.start) : job.end !== null ? travelDate(job.end) : String(d.date || body.source?.date || "").slice(0,10);
    job.sourceEventIds = [...new Set([...job.sourceEventIds, text(event.id)])].filter(Boolean).slice(-8);
    jobs.set(jobId, job);
  }
  return [...jobs.values()];
}
export function travelPairs(jobs, date) {
  const groups = new Map();
  const unassigned = jobs.filter(j => j.date === date && !j.technicianId);
  for (const job of jobs.filter(j => j.date === date && j.technicianId)) {
    const group = groups.get(job.technicianId) || []; group.push(job); groups.set(job.technicianId, group);
  }
  const pairs = [];
  for (const group of groups.values()) {
    const unordered = group.some(j => j.start === null && j.end === null);
    group.sort((a,b) => (a.start ?? a.end ?? Infinity)-(b.start ?? b.end ?? Infinity) || a.jobId.localeCompare(b.jobId));
    let lastEnd = null;
    for (let i=1;i<group.length;i++) {
      const previous = group[i-1], next = group[i];
      lastEnd = Math.max(lastEnd ?? 0, previous.end ?? 0);
      let issue = unassigned.length ? "Unassigned jobs prevent verification of the full stop sequence" : unordered ? "A job has no timestamp; stop order needs verification" : null;
      if (previous.conflict || next.conflict) issue = "Conflicting technician assignments";
      else if (previous.end === null || next.start === null) issue = "Missing completion or next-job start time";
      else if (next.start < lastEnd || (previous.start !== null && previous.end < previous.start) || (next.end !== null && next.end < next.start)) issue = "Overlapping or invalid job timestamps";
      const elapsedMinutes = !issue ? (next.start-previous.end)/60000 : null;
      pairs.push({ id: `${date}:${previous.technicianId}:${previous.jobId}:${next.jobId}`, date, technicianId: previous.technicianId, technician: previous.technician || `Technician ${previous.technicianId}`, previousJobId: previous.jobId, nextJobId: next.jobId, previousCustomer: previous.customer || `Job ${previous.jobId}`, nextCustomer: next.customer || `Job ${next.jobId}`, completedAt: previous.end === null ? null : new Date(previous.end).toISOString(), nextStartedAt: next.start === null ? null : new Date(next.start).toISOString(), nextCompletedAt: next.end === null ? null : new Date(next.end).toISOString(), elapsedMinutes, fromPoint: previous.endPoint || previous.point, toPoint: next.point, locationBasis: previous.endPoint ? "Completion GPS to next start GPS" : "Job-start GPS locations", sourceEventIds: [...previous.sourceEventIds, ...next.sourceEventIds], issue });
    }
  }
  return { pairs, unassignedJobs: unassigned.length, jobs: jobs.filter(j => j.date === date).length };
}
export function evaluateTravel(pair, baseline) {
  const minutes = presentNumber(baseline?.minutes), miles = presentNumber(baseline?.miles);
  const valid = minutes !== null && minutes >= 0 && minutes <= 1440 && miles !== null && miles >= 0 && miles <= 1000;
  const issue = pair.issue || (!pair.fromPoint || !pair.toPoint ? "Missing stop GPS location" : !valid ? "Road estimate pending" : null);
  const excessMinutes = !issue && pair.elapsedMinutes !== null ? pair.elapsedMinutes - minutes : null;
  const { fromPoint, toPoint, ...publicPair } = pair;
  return { ...publicPair, issue, expectedDriveMinutes: valid ? minutes : null, roadMiles: valid ? miles : null, actualMiles: null, excessMinutes, graceMinutes: TRAVEL_GRACE_MINUTES, flagged: excessMinutes !== null && excessMinutes > TRAVEL_GRACE_MINUTES, status: issue ? "pending" : excessMinutes > TRAVEL_GRACE_MINUTES ? "flagged" : "within_allowance", baselineAt: baseline?.capturedAt || null };
}
export function summarizeTravel(rows) {
  const groups = new Map();
  for (const row of rows) {
    const weekday = new Intl.DateTimeFormat("en-US", {timeZone:"UTC",weekday:"long"}).format(new Date(`${row.date}T12:00:00Z`));
    const key = `${row.technicianId}:${weekday}`;
    const g = groups.get(key) || { key, technician: row.technician, weekday, reviewed: 0, flagged: 0, excessMinutes: 0, dates: new Set() };
    if (row.status !== "pending") g.reviewed++;
    if (row.flagged) { g.flagged++; g.excessMinutes += row.excessMinutes; g.dates.add(row.date); }
    groups.set(key,g);
  }
  return [...groups.values()].map(g => ({...g, dates: [...g.dates], repeatDays: g.dates.size, flagRate: g.reviewed ? g.flagged/g.reviewed : null})).sort((a,b)=>b.flagged-a.flagged || b.excessMinutes-a.excessMinutes);
}
