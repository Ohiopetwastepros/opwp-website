"use client";

import { useEffect, useMemo, useState } from "react";
import { shiftTravelDate, summarizeTravel, summarizeTravelDates, travelDate, travelWeek } from "@/lib/stop-travel.mjs";
import styles from "./stop-travel.module.css";

const number = value => value === null || value === undefined ? "--" : new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(value);
const time = value => value ? new Date(value).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit",second:"2-digit"}) : "Missing";
const shortDate = value => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric"});
const longDate = value => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US",{timeZone:"UTC",weekday:"long",month:"long",day:"numeric"});

export default function StopTravelPanel() {
  const [today] = useState(()=>travelDate());
  const [week] = useState(()=>travelWeek(today));
  const [rangeFrom,setRangeFrom]=useState(week.from), [rangeThrough,setRangeThrough]=useState(today);
  const [fromInput,setFromInput]=useState(week.from), [throughInput,setThroughInput]=useState(today), [selectedDate,setSelectedDate]=useState(today);
  const [data,setData]=useState(null), [error,setError]=useState(""), [loading,setLoading]=useState(false);
  const [tech,setTech]=useState(""), [status,setStatus]=useState("flagged"), [page,setPage]=useState(0);
  const [refreshDate,setRefreshDate]=useState(today);
  const [refreshing,setRefreshing]=useState(false), [message,setMessage]=useState(""), [revision,setRevision]=useState(0);

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError("");setData(null);setPage(0);
    fetch(`/api/admin/stop-travel/?from=${rangeFrom}&through=${rangeThrough}`,{signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not load travel records.");setData(result);
    }).catch(e=>{if(e.name!=="AbortError")setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[rangeFrom,rangeThrough,revision]);

  const all=data?.rows||[];
  const selected=all.filter(row=>(!tech||row.technicianId===tech)&&(!selectedDate||row.date===selectedDate));
  const patterns=useMemo(()=>summarizeTravel(selected),[selected]);
  const rows=selected.filter(row=>status==="all"||row.status===status).sort((a,b)=>b.date.localeCompare(a.date)||(b.excessMinutes??-Infinity)-(a.excessMinutes??-Infinity));
  const safePage=Math.min(page,Math.max(0,Math.ceil(rows.length/15)-1));
  const flagged=selected.filter(row=>row.flagged), pending=selected.filter(row=>row.status==="pending");
  const days=data?.days||[];
  const daily=useMemo(()=>summarizeTravelDates(all,days,week.dates),[all,days,week.dates]);
  const visibleRows=rows.slice(safePage*15,safePage*15+15);
  const currentWeekLoaded=rangeFrom===week.from&&rangeThrough===today;

  function setPeriod(from,through,date="",clearMessage=true) {
    setFromInput(from);setThroughInput(through);setRangeFrom(from);setRangeThrough(through);setSelectedDate(date);setRefreshDate(date||through);setPage(0);if(clearMessage)setMessage("");
  }
  function applyRange(event) { event.preventDefault();setPeriod(fromInput,throughInput); }
  function selectWeekDay(date="") { setPeriod(week.from,today,date); }
  function download() {
    const fields=["date","technician","previousCustomer","nextCustomer","completedAt","nextStartedAt","nextCompletedAt","elapsedMinutes","roadMiles","expectedDriveMinutes","excessMinutes","status","issue","locationBasis","baselineAt","previousJobId","nextJobId"];
    const cell=value=>{let text=String(value??"");if(typeof value!=="number"&&/^[\s]*[=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    const csv=[fields,...rows.map(row=>fields.map(field=>row[field]))].map(row=>row.map(cell).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=url;anchor.download=`operations-gaps-${rangeFrom}-to-${rangeThrough}-${status}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function refresh() {
    setRefreshing(true);setMessage("");setError("");
    try {
      const response=await fetch("/api/admin/stop-travel/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date:refreshDate})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Refresh failed.");
      const refreshed=result.refresh;
      setMessage(refreshed.skipped?`${refreshed.date}: ${refreshed.reason}. Showing the latest saved analysis.`:`${refreshed.date}: ${refreshed.transitions} transitions, ${refreshed.flagged} flagged, ${refreshed.pending} awaiting evidence.`);
      if(refreshDate<rangeFrom||refreshDate>rangeThrough)setPeriod(refreshDate,refreshDate,refreshDate,false);else{setSelectedDate(refreshDate);setRevision(value=>value+1);}
    }catch(e){setError(e.message);}finally{setRefreshing(false);}
  }

  return <section id="stop-travel" className={styles.panel}>
    <div className={styles.heading}><div><span>Time between stops</span><h2>Daily gap follow-up</h2><p>Previous job finished -&gt; next job started. Flag when the gap exceeds mapped drive time by more than 5 minutes.</p></div><a href="#travel-ledger">Review transitions</a></div>

    <div className={styles.presetBar} aria-label="Reporting period shortcuts">
      <button type="button" className={rangeFrom===week.from&&rangeThrough===today&&!selectedDate?styles.activePreset:""} onClick={()=>selectWeekDay()}>Current week</button>
      <button type="button" className={selectedDate===today?styles.activePreset:""} onClick={()=>selectWeekDay(today)}>Today</button>
      <button type="button" onClick={()=>setPeriod(shiftTravelDate(today,-30),shiftTravelDate(today,-1))}>Last 30 completed days</button>
    </div>
    <form className={styles.filters} onSubmit={applyRange}><label>From<input type="date" required min={shiftTravelDate(today,-399)} max={throughInput||today} value={fromInput} onChange={event=>setFromInput(event.target.value)} /></label><label>Through<input type="date" required min={fromInput} max={today} value={throughInput} onChange={event=>setThroughInput(event.target.value)} /></label><button type="submit" disabled={loading}>Apply dates</button></form>
    <p className={styles.note}>Review period: {rangeFrom} through {rangeThrough}. {selectedDate?`Showing ${longDate(selectedDate)}.`:"Showing every day in the selected period."} Saved history only; no technician messages are sent.</p>

    <div className={styles.weekHeading}><div><span>Current week by day</span><strong>{shortDate(week.from)} - {shortDate(week.through)}</strong></div><small>Select a day to isolate its follow-up list. Future days unlock as the week progresses.</small></div>
    <div className={styles.dayGrid}>
      {daily.map(day=>{
        const future=day.date>today, active=selectedDate===day.date;
        return <button type="button" key={day.date} disabled={future} className={`${styles.dayCard} ${active?styles.dayCardActive:""}`} aria-pressed={active} onClick={()=>selectWeekDay(day.date)}>
          <span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US",{timeZone:"UTC",weekday:"short"})}{day.date===today?<em>Today</em>:null}</span>
          <strong>{shortDate(day.date)}</strong>
          {future?<small>Upcoming</small>:day.analyzed?<small><b>{day.flagged}</b> flagged | {day.measured} measured{day.pending?` | ${day.pending} pending`:""}</small>:<small>{currentWeekLoaded?"Not analyzed - select and refresh":"Select to load"}</small>}
        </button>;
      })}
    </div>

    <div className={styles.metrics}><div><span>Flagged transitions</span><strong>{flagged.length}</strong><small>More than 5 extra minutes</small></div><div><span>Excess time in flags</span><strong>{number(flagged.reduce((total,row)=>total+row.excessMinutes,0))}<em> min</em></strong><small>Elapsed minus expected driving</small></div><div><span>Measured transitions</span><strong>{selected.length-pending.length}<em> / {selected.length}</em></strong><small>{pending.length} need timing or map evidence</small></div></div>
    <p className={styles.note}>Road miles are estimated from recorded stop GPS locations. Actual driven miles and historical traffic are unavailable. A flag is a prompt to ask about the gap; it does not establish its cause. All times are Eastern.</p>

    <div className={styles.filters}><label>Technician<select value={tech} onChange={event=>{setTech(event.target.value);setPage(0);}}><option value="">All technicians</option>{[...new Map(all.map(row=>[row.technicianId,row.technician])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>Show<select value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}><option value="flagged">Flagged gaps</option><option value="all">All transitions</option><option value="pending">Missing evidence</option><option value="within_allowance">Within allowance</option></select></label><button type="button" disabled={loading||!rows.length} onClick={download}>Download review CSV</button><div className={styles.refresh}><label>Service day<input type="date" min={shiftTravelDate(today,-399)} max={today} value={refreshDate} onChange={event=>setRefreshDate(event.target.value)} /></label><button type="button" disabled={refreshing||!refreshDate} onClick={refresh}>{refreshing?"Refreshing...":refreshDate===today?"Refresh today":"Refresh selected day"}</button></div></div>
    {selectedDate===today?<p className={styles.todayNote}>Today is included. Refresh after route activity to pull the latest archived starts and completions; a job still in progress may not form a completed stop-to-stop transition yet.</p>:null}
    {error?<p role="alert" className={styles.warning}>{error}</p>:null}{message?<p role="status" className={styles.note}>{message}</p>:null}
    {loading?<p role="status">Loading travel history...</p>:null}
    {data?.truncated?<p className={styles.warning}>This range exceeds the display limit. Narrow the reporting period for complete results.</p>:null}
    {days.some(day=>day.unassignedJobs)?<p className={styles.warning}>{days.reduce((total,day)=>total+day.unassignedJobs,0)} jobs lack a technician ID and could not be matched to a route.</p>:null}
    {patterns.some(pattern=>pattern.repeatDays>1)?<div className={styles.patterns}><h3>Repeated across route days</h3>{patterns.filter(pattern=>pattern.repeatDays>1).slice(0,6).map(pattern=><p key={pattern.key}><strong>{pattern.technician} | {pattern.weekday}</strong><span>{pattern.flagged} flags across {pattern.repeatDays} days | {number(pattern.flagRate*100)}% of measured transitions | {number(pattern.excessMinutes)} extra minutes</span></p>)}</div>:null}

    <div id="travel-ledger" className={styles.tableWrap}><table><thead><tr><th>Date / technician</th><th>From -&gt; to</th><th>Finished -&gt; started</th><th>Gap</th><th>Road miles</th><th>Expected drive</th><th>Extra time</th><th>Review</th></tr></thead><tbody>{visibleRows.map(row=><tr key={row.id}><td><strong>{longDate(row.date)}</strong><small>{row.technician}</small></td><td><strong>{row.previousCustomer}</strong><small>-&gt; {row.nextCustomer}</small></td><td>{time(row.completedAt)}<small>-&gt; {time(row.nextStartedAt)}</small><small>Next job finished {time(row.nextCompletedAt)}</small></td><td>{number(row.elapsedMinutes)} min</td><td>{number(row.roadMiles)} mi</td><td>{number(row.expectedDriveMinutes)} min</td><td>{row.excessMinutes===null?"--":`${row.excessMinutes>0?"+":""}${number(row.excessMinutes)} min`}</td><td><span className={row.flagged?styles.flag:row.status==="pending"?styles.pending:styles.ok}>{row.flagged?"Ask about gap":row.status==="pending"?"Needs evidence":"Within allowance"}</span><small>{row.issue||`Flag above ${number(row.expectedDriveMinutes+5)} min elapsed`}</small><small>{row.locationBasis}</small></td></tr>)}{!rows.length&&!loading?<tr><td colSpan="8">{!days.length?`No saved travel analysis for ${selectedDate?longDate(selectedDate):"this period"}. Select the service day above and refresh it to pull available activity.`:selected.length?"No transitions match this filter. Choose All transitions to review coverage.":`No matched transitions for ${selectedDate?longDate(selectedDate):"the selected dates"}. Refresh the day after route activity; an empty list does not confirm no travel occurred.`}</td></tr>:null}</tbody></table></div>
    <div className={styles.footer}><span>{rows.length} transitions | {days.length} dates analyzed in this window</span><button type="button" disabled={!safePage} onClick={()=>setPage(safePage-1)}>Previous</button><button type="button" disabled={(safePage+1)*15>=rows.length} onClick={()=>setPage(safePage+1)}>Next</button></div>
    <details className={styles.note}><summary>Coverage and calculation</summary><p>Dates with zero archived jobs do not confirm a day off. The ledger covers available SNG events and cannot prove complete source history. CSV exports follow the current technician, selected date, and status filters, include every matching row across pages, and use ISO timestamps with a UTC offset. Hourly refreshes analyze today, yesterday, and one older date from the last 35 days. Refresh any available date from the last 400 days above. Only consecutive jobs for the same technician on the same Eastern date are compared. The next job's service time is excluded. Missing timestamps, missing GPS, or overlapping jobs remain pending. Stored road estimates are reused; their capture time is retained with each record. The five-minute allowance is applied before rounding.</p><p>Analyzed dates: {days.map(day=>`${day.date} (${day.jobs} jobs, updated ${new Date(day.capturedAt).toLocaleString("en-US",{timeZone:"America/New_York"})})`).join("; ")||"None yet"}.</p></details>
  </section>;
}
