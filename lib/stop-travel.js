import { getDb } from "./db";
import { calculateTravelLegs, geoapifyConfigured } from "./geoapify";
import { travelDate, travelJobs, travelPairs, evaluateTravel } from "./stop-travel.mjs";
import { shiftTravelDate } from "./stop-travel.mjs";

const PREFIX = "stop_travel_v1:";
const MAX_EVENTS = 1500;
const MAX_CALLS = 8;
const MAX_DAILY_CALLS = 120;

export function validTravelDate(value, now = Date.now()) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value && value <= travelDate(now) && value >= shiftTravelDate(travelDate(now), -399);
}
async function snapshot(db, key) {
  const row = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(key).first();
  return row?.payload ? JSON.parse(row.payload) : null;
}
async function save(db, key, data) {
  const payload = JSON.stringify(data);
  if (new TextEncoder().encode(payload).length > 1000000) throw new Error("Stop travel storage budget exceeded.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(key,payload,new Date().toISOString()).run();
}
async function providerBudget(db) {
  // One shared server-side spend cap across scheduled and manual refreshes.
  const start = Math.floor(Date.now()/86400000)*86400;
  const row = await db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at) VALUES ('stop_travel_geo','global',?,1,datetime(?,'unixepoch'))
    ON CONFLICT(scope,client_key,window_start) DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(start,start+172800).first();
  return Number(row?.request_count) <= MAX_DAILY_CALLS;
}
async function pointKey(pair) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([pair.fromPoint,pair.toPoint])));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function refreshStopTravelDate(date, db = getDb()) {
  if (!db || !validTravelDate(date)) throw new Error("Stop travel date or storage unavailable.");
  // Atomic per-date lease/cooldown prevents concurrent overwrites and repeated paid work.
  const lease = await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,'{}','success',?)
    ON CONFLICT(snapshot_key) DO UPDATE SET captured_at=excluded.captured_at WHERE captured_at < ? RETURNING snapshot_key`).bind(`stop_travel_lock:${date}`,new Date().toISOString(),new Date(Date.now()-600000).toISOString()).first();
  if (!lease) return { date, skipped: true, reason: "Recently refreshed; retry after ten minutes" };
  const result = await db.prepare(`SELECT id,event_type,source,external_id,payload,received_at FROM sng_events
    WHERE event_type IN ('job:started','job:completed') AND json_valid(payload)
    AND (substr(json_extract(payload,'$.data.start_time'),1,10)=? OR substr(json_extract(payload,'$.data.end_time'),1,10)=?
      OR json_extract(payload,'$.data.date')=? OR json_extract(payload,'$.source.date')=?)
    ORDER BY received_at ASC,id ASC LIMIT ?`).bind(date,date,date,date,MAX_EVENTS+1).all();
  if (result.results.length > MAX_EVENTS) throw new Error("Stop event coverage exceeded its limit; previous ledger retained.");
  const prior = await snapshot(db,PREFIX+date);
  const { pairs, jobs, unassignedJobs } = travelPairs(travelJobs(result.results),date);
  const baselines = {};
  const pending = [];
  for (const pair of pairs) {
    pair.baselineKey = await pointKey(pair);
    const cached = prior?.baselines?.[pair.baselineKey];
    if (cached) baselines[pair.baselineKey] = cached;
    else if (!pair.issue && pair.fromPoint && pair.toPoint && !pending.some(p=>p.baselineKey===pair.baselineKey)) pending.push(pair);
  }
  let calls = 0;
  if (geoapifyConfigured()) {
    // 12 independent pairs per 24-waypoint request. Only each pair's own leg is
    // retained; connector legs between pairs are deliberately discarded.
    for (let i=0;i<pending.length && calls<MAX_CALLS;i+=12) {
      if (!await providerBudget(db)) break;
      const batch = pending.slice(i,i+12);
      calls++;
      const route = await calculateTravelLegs(batch.flatMap(p=>[p.fromPoint,p.toPoint]));
      if (!route.ok) break;
      batch.forEach((p,index)=>{ baselines[p.baselineKey] = {...route.data[index*2],capturedAt:new Date().toISOString()}; });
    }
  }
  const rows = pairs.map(pair=>evaluateTravel(pair,baselines[pair.baselineKey]));
  const data = { date, capturedAt:new Date().toISOString(), jobs, unassignedJobs, rows, baselines, sourceEvents:result.results.length, pending:rows.filter(r=>r.status==="pending").length };
  await save(db,PREFIX+date,data);
  return { date, jobs, transitions:rows.length, flagged:rows.filter(r=>r.flagged).length, pending:data.pending, providerCalls:calls };
}
export async function readStopTravel(from, through, db = getDb()) {
  if (!db) throw new Error("Stop travel storage unavailable.");
  // Bound public rows in SQL; never load hundreds of full private snapshots
  // (including their map caches) into a single Worker request.
  const [metadata, records] = await Promise.all([
    db.prepare(`SELECT json_extract(payload,'$.date') AS date,json_extract(payload,'$.capturedAt') AS capturedAt,
      json_extract(payload,'$.jobs') AS jobs,json_extract(payload,'$.unassignedJobs') AS unassignedJobs,json_extract(payload,'$.pending') AS pending
      FROM airtable_cockpit_snapshots WHERE snapshot_key>=? AND snapshot_key<=? ORDER BY snapshot_key DESC LIMIT 400`).bind(PREFIX+from,PREFIX+through).all(),
    db.prepare(`SELECT j.value AS row FROM airtable_cockpit_snapshots s,json_each(s.payload,'$.rows') j
      WHERE s.snapshot_key>=? AND s.snapshot_key<=? ORDER BY s.snapshot_key DESC,CAST(j.key AS INTEGER) ASC LIMIT 15001`).bind(PREFIX+from,PREFIX+through).all(),
  ]);
  return { from, through, rows:records.results.slice(0,15000).map(r=>JSON.parse(r.row)), truncated:records.results.length>15000, days:metadata.results, mileageBasis:"Geoapify road estimate between recorded stop GPS locations; actual driven mileage is unavailable without a GPS trail.", thresholdMinutes:5 };
}
export async function runScheduledStopTravel(env) {
  if (!env?.DB) return { skipped:true };
  const today = travelDate();
  // Recent jobs first, then one older day per hourly run. Backfill the last
  // 35 days automatically; any retained source day can be refreshed by admin.
  const history = await readStopTravel(shiftTravelDate(today,-34),today,env.DB);
  const known = new Map(history.days.map(d=>[d.date,d]));
  const candidates = Array.from({length:33},(_,i)=>shiftTravelDate(today,-i-2));
  candidates.sort((a,b)=>(known.get(a)?.capturedAt||"").localeCompare(known.get(b)?.capturedAt||"") || b.localeCompare(a));
  const results=[];
  for (const date of [today,shiftTravelDate(today,-1),candidates[0]]) {
    try { results.push(await refreshStopTravelDate(date,env.DB)); }
    catch { console.error(JSON.stringify({event:"stop_travel_refresh_failed",date})); }
  }
  return results;
}
