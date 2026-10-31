"use client";

import { useMemo, useState } from "react";
import { ROUTE_DAYS, routeDay, routeWeek, shiftRouteDate, summarizeRouteProfit, selectRouteWindow } from "@/lib/route-profitability-calculations.mjs";
import { applyTechnicianRouteCosts, combineTechnicianDays } from "@/lib/quickbooks-route-cost-calculations.mjs";
import TechnicianWeekdays from "./TechnicianWeekdays";
import TechnicianComparison from "./TechnicianComparison";
import { technicianStatus } from "@/lib/route-technicians.mjs";
import RouteCostPanel from "./RouteCostPanel";
import RouteDataReview from "./RouteDataReview";
import RouteRevenueMix, { RevenueBreakdown, RevenueDetailDialog } from "./RouteRevenueMix";
import BillingRevenueMix from "./BillingRevenueMix";
import styles from "./profitability.module.css";

const money = (value, digits = 0) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(value);
const number = value => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value || 0);
const dateLabel = date => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No history";
const distance = (from, through) => Math.round((Date.parse(through) - Date.parse(from)) / 86400000);
const metrics = { revenue: "Total revenue", averageRevenue: "Revenue / service day", revenuePerHour: "Revenue / tech hour", averageProfit: "Profit / service day", profitPerHour: "Profit / tech hour" };
function rateReason(summary) {
  if (!summary.routeDays) return "No service records";
  if (!summary.hours) return "Technician hours unavailable";
  if (summary.missingValues) return "Service prices need verification";
  return "Some technician hours missing or excluded";
}
function Kpi({ title, value, detail, primary }) {
  return <article className={`${styles.kpi} ${primary ? styles.kpiPrimary : ""}`}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export default function RouteProfitabilityClient({ initialData }) {
  const [data, setData] = useState(initialData);
  const view = "revenue";
  const [period, setPeriod] = useState(28);
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState(null);
  const [technician, setTechnician] = useState("");
  const [dayFilter, setDayFilter] = useState("All days");
  const [metric, setMetric] = useState("revenue");
  const [detailMode, setDetailMode] = useState("daily");
  const [page, setPage] = useState(0);
  const [revenueDetail, setRevenueDetail] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [updateWarning, setUpdateWarning] = useState("");
  const profitabilityView = view === "profitability";
  const history = data?.history;
  const latest = history?.throughDate || "", earliest = history?.fromDate || "";
  const maxOffset = latest && earliest ? Math.max(0, distance(earliest, latest) - period + 1) : 0;
  const through = custom?.through || (latest ? shiftRouteDate(latest, -Math.min(offset, maxOffset)) : "");
  const from = custom?.from || (through ? [earliest, shiftRouteDate(through, 1 - period)].sort().at(-1) : "");
  const duration = from && through ? distance(from, through) + 1 : period;
  const technicianRows = useMemo(() => applyTechnicianRouteCosts(history?.rows ?? [], data?.costs, { coveredFrom: earliest, coveredThrough: latest, ownerKey: String(data.staffing?.reliefName||'').toLowerCase().replace(/[^a-z0-9]/g,'') }), [history, data?.costs, data.staffing?.reliefName, earliest, latest]);
  const technicians = [...new Set(technicianRows.map(row => row.name))].sort();
  const priced = combineTechnicianDays(technicianRows.filter(row => !technician || row.name === technician));
  const technicianWindow = selectRouteWindow(technicianRows, from, through).filter(row => !technician || row.name === technician);
  const windowRows = selectRouteWindow(priced, from, through);
  const selected = selectRouteWindow(priced, from, through, dayFilter);
  const total = summarizeRouteProfit(selected);
  const previousFrom = from ? shiftRouteDate(from, -duration) : "";
  const previous = summarizeRouteProfit(selectRouteWindow(priced, previousFrom, from ? shiftRouteDate(from, -1) : "", dayFilter));
  const comparison = previousFrom >= earliest && previous.revenue && !total.missingValues && !previous.missingValues ? (total.revenue - previous.revenue) / previous.revenue * 100 : null;
  const days = ROUTE_DAYS.slice(0, 5).map(day => ({ day, ...summarizeRouteProfit(windowRows.filter(row => routeDay(row.date) === day)) }));
  const maxBar = Math.max(1, ...days.map(day => Math.abs(day[metric] || 0)));
  const weeks = [...new Set(selected.map(row => routeWeek(row.date)))].sort().reverse().map(week => ({ week, ...summarizeRouteProfit(selected.filter(row => routeWeek(row.date) === week)) }));
  const detailRows = detailMode === "daily" ? [...selected].sort((a, b) => b.date.localeCompare(a.date)) : weeks;
  const safePage = Math.min(page, Math.max(0, Math.ceil(detailRows.length / 12) - 1));
  const reviewCount = (data?.review?.issues || []).filter(issue => issue.date >= from && issue.date <= through && (dayFilter === "All days" || routeDay(issue.date) === dayFilter)).length;
  const stale = history && (history.status !== "success" || Date.now() - Date.parse(history.capturedAt) > 36 * 3600000);
  function update(result) { setData(result); setPage(0); setUpdateWarning(result.warning || result.warnings?.join(" ") || ""); }
  function resetWindow(next) { setPeriod(next); setCustom(null); setOffset(0); setPage(0); setRevenueDetail(null); }
  function setDate(which, value) {
    if (!value || value < earliest || value > latest) return;
    const next = { from, through, [which]: value };
    if (next.from > next.through) next[which === "from" ? "through" : "from"] = value;
    setCustom(next); setPage(0); setRevenueDetail(null);
  }
  function openDetail(category = "", label = "All services", detailFrom = from, detailThrough = through, expectedRevenue = null) {
    setRevenueDetail({ from: detailFrom, through: detailThrough, category, label, weekday: dayFilter, technician, expectedRevenue });
  }
  function selectTechnician(name, day = "All days") {
    setTechnician(name); setDayFilter(day); setPage(0); setRevenueDetail(null);

  }
  function showTechnicianHistory() { const dates = technicianRows.filter(row => row.name === technician && row.jobs > 0).map(row => row.date).sort(); if (dates.length) { setCustom({ from: dates[0], through: dates.at(-1) }); setDayFilter("All days"); setPage(0); } }
  return <div className={styles.dashboard} id="profitability">
    <div className={styles.topline}><span className={styles.eyebrow}>Route revenue & technician performance</span><a className={styles.sourceLink} href="#route-sources"><i className={styles.statusDot} />{stale ? "Refresh recommended" : history ? `Updated ${dateLabel(String(history.capturedAt).slice(0, 10))}` : "Connect route data"} ↗</a></div>

    <section className={styles.timePanel} aria-label="Reporting period">
      <div className={styles.timeTop}><div><span className={styles.eyebrow}>Reporting period</span><h2 aria-live="polite">{dateLabel(from)} <span>–</span> {dateLabel(through)}</h2></div><div className={styles.presets}>{latest ? <button aria-pressed={custom?.from === `${latest.slice(0,4)}-01-01` && custom?.through === latest} onClick={() => { setCustom({ from: [earliest, `${latest.slice(0,4)}-01-01`].sort().at(-1), through: latest }); setOffset(0); setPage(0); setRevenueDetail(null); }}>Year to date</button> : null}{[[7, "7 days"], [28, "4 weeks"], [91, "13 weeks"], [365, "1 year"]].map(([value, label]) => <button key={value} aria-pressed={!custom && period === value} onClick={() => resetWindow(value)}>{label}</button>)}</div></div>
      <div className={styles.filterRow}><div className={styles.periodArrows}><button aria-label="Previous period" disabled={!latest || Boolean(custom) || offset >= maxOffset} onClick={() => { setOffset(Math.min(maxOffset, offset + period)); setPage(0); }}>←</button><button aria-label="Next period" disabled={!offset || Boolean(custom)} onClick={() => { setOffset(Math.max(0, offset - period)); setPage(0); }}>→</button></div><label>From<input type="date" min={earliest} max={latest} value={from} disabled={!latest} onChange={event => setDate("from", event.target.value)} /></label><label>Through<input type="date" min={earliest} max={latest} value={through} disabled={!latest} onChange={event => setDate("through", event.target.value)} /></label><label>Technician<select value={technician} onChange={event => selectTechnician(event.target.value)}><option value="">All technicians</option>{technicians.map(name => <option key={name} value={name}>{name} ({technicianStatus(name, data?.technicians)})</option>)}</select></label><label>Service day<select value={dayFilter} onChange={event => { setDayFilter(event.target.value); setPage(0); }}><option>All days</option>{ROUTE_DAYS.map(day => <option key={day}>{day}</option>)}</select></label><p>{number(total.routeDays)} service days · today excluded{custom ? <button className={styles.textButton} onClick={() => resetWindow(period)}>Reset dates</button> : null}</p></div>
    </section>

    {technician && !total.jobs ? <p className={styles.notice}>No completed services for {technician} in the selected dates. <button className={styles.textButton} onClick={showTechnicianHistory}>Show available history</button></p> : null}
    {history && !history.technicianHoursBackfilled ? <p className={styles.notice}>Historical route records need rebuilding. <a href="#route-sources">Refresh route data</a> to reconcile visits and available shifts.</p> : null}
    {updateWarning ? <p className={styles.notice} role="status">{updateWarning} <a href="#route-sources">Refresh route data</a>.</p> : null}
    {!history ? <p className={styles.notice}>Route history is not available. <a href="#route-sources">Refresh route data</a> to load available records.</p> : !history.backfilled || stale ? <p className={styles.notice}>{!history.backfilled ? "Only the recent snapshot is loaded." : "Route history may be stale or incomplete."} <a href="#route-sources">Refresh route data</a> before relying on these results.</p> : null}
    {total.routeDays > 0 && total.revenuePerHour === null ? <p className={styles.coverageNote}><span className={styles.statusDot} /><strong>{rateReason(total)}.</strong> Service revenue is shown; hourly rates remain unavailable. {total.hours === 0 ? "Recorded technician shifts are required; owner hours are excluded." : "Review the flagged days below."}</p> : null}
    {reviewCount || total.missingValues ? <p className={styles.coverageNote}><span className={styles.statusDot} />{total.missingValues ? `${total.missingValues} service values are pending reconciliation; revenue is partial. ` : ""}{reviewCount ? <>{reviewCount} services need your answer. <a href="#route-data-review" onClick={() => setReviewOpen(true)}>Review questions →</a></> : <>Source checks are pending. <a href="#route-data-review" onClick={() => setReviewOpen(true)}>Inspect pending records</a></>}</p> : null}

    <section className={styles.kpis} aria-label="Route financial summary">
      <Kpi title="Service revenue" value={total.routeDays ? money(total.revenue) : "—"} primary detail={total.missingValues ? "Incomplete · service prices need review" : comparison === null ? `${number(total.jobs)} completed visits` : `${comparison >= 0 ? "+" : ""}${number(comparison)}% vs previous ${duration} days`} />
      <Kpi title={profitabilityView ? "Estimated route profit" : "Average / service day"} value={money(profitabilityView ? total.profit : total.averageRevenue)} detail={profitabilityView ? total.margin == null ? "Awaiting complete costs & service values" : `${number(total.margin)}% margin · allocated company costs` : `${number(total.routeDays)} recorded service ${total.routeDays === 1 ? "day" : "days"}`} />
      <Kpi title="Revenue / tech hour" value={money(total.revenuePerHour, 2)} detail={total.revenuePerHour == null ? rateReason(total) : `${number(total.hours)} tech hours · $100/hr target`} />
      <Kpi title={profitabilityView ? "Profit / tech hour" : "Completed visits"} value={profitabilityView ? money(total.profitPerHour, 2) : number(total.jobs)} detail={profitabilityView ? "Estimate after allocated expenses" : `${total.estimatedJobs ? `${total.estimatedJobs} estimated prices` : (technician || "All serviced accounts")} · ${dayFilter.toLowerCase()}`} />
    </section>
    <p className={styles.measurementNote}>{technician || "All-account revenue / employee hours; owner time excluded"} · Historical visit assignments · {dateLabel(from)} – {dateLabel(through)}{dayFilter !== "All days" ? ` · ${dayFilter} only` : ""}</p>

    <section className={styles.weekPanel} aria-label="Weekday performance">
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Monday – Friday</span><h2>Weekday performance</h2><p>{dateLabel(from)} – {dateLabel(through)} · select a day to filter the dashboard</p></div><label className={styles.chartSelect}>Compare<select value={metric} onChange={event => setMetric(event.target.value)}>{Object.entries(metrics).filter(([key]) => profitabilityView || !key.toLowerCase().includes("profit")).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className={styles.dayGrid}>{days.map(day => <button key={day.day} className={styles.dayCard} aria-pressed={dayFilter === day.day} data-dimmed={dayFilter !== "All days" && dayFilter !== day.day} onClick={() => { setDayFilter(dayFilter === day.day ? "All days" : day.day); setPage(0); }}><span className={styles.dayName}>{day.day}<span>{dayFilter === day.day ? "✓" : "↗"}</span></span><strong>{day.routeDays ? money(day[metric], metric.includes("Hour") ? 2 : 0) : "—"}</strong><span className={styles.barTrack}><span className={day[metric] < 0 ? styles.barNegative : styles.bar} style={{ width: `${Math.min(100, Math.abs(day[metric] || 0) / maxBar * 100)}%` }} /></span><small>{!day.routeDays ? "No service records" : day[metric] == null ? metric.includes("Hour") && day.revenuePerHour == null ? rateReason(day) : "Cost inputs incomplete" : `${day.routeDays} service ${day.routeDays === 1 ? "day" : "days"} · ${number(day.jobs)} visits`}</small>{metric !== "revenue" && day.routeDays ? <span className={styles.daySecondary}>{money(day.revenue)} service revenue</span> : null}</button>)}</div>
      {dayFilter !== "All days" ? <p className={styles.note}>{dayFilter} is selected. The five-day comparison stays visible for context. <button className={styles.textButton} onClick={() => { setDayFilter("All days"); setPage(0); }}>Show all days</button></p> : null}
      {selected.some(row => ["Saturday", "Sunday"].includes(routeDay(row.date))) ? <p className={styles.note}>Weekend service is included in totals and the ledger below.</p> : null}
    </section>

    <TechnicianComparison rows={technicianRows} roster={data?.technicians} from={from} through={through} />
    <TechnicianWeekdays reliefName={data.staffing?.reliefName} rows={technicianWindow} profitabilityView={profitabilityView} onSelect={selectTechnician} />

    <RouteRevenueMix total={total} mrrAudit={data?.mrrAudit} subscriptions={data?.subscriptions || []} through={through} onOpen={(category, label) => openDetail(category, label, from, through, total.revenueMix[category].revenue)} />
    <BillingRevenueMix data={data?.billings} from={from} through={through} />

    <section className={styles.ledger}>
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Service ledger</span><h2>Every day, accounted for</h2></div><div className={styles.presets}>{["daily", "weekly"].map(mode => <button key={mode} aria-pressed={detailMode === mode} onClick={() => { setDetailMode(mode); setPage(0); }}>{mode === "daily" ? "Daily" : "Weekly"}</button>)}</div></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{detailMode === "daily" ? "Service date" : "Week starting"}</th><th>Visits</th><th>Clocked hours</th><th>Revenue</th><th>Revenue / hr</th>{profitabilityView ? <><th>Allocated costs</th><th>Est. profit</th></> : null}<th>Data status</th></tr></thead><tbody>{detailRows.slice(safePage * 12, safePage * 12 + 12).map(row => {
        const start = row.date || [row.week, from].sort().at(-1), end = row.date || [shiftRouteDate(row.week, 6), through].sort()[0];
        const rate = row.revenuePerHour;
        return <tr key={row.id || row.week}><td><button className={styles.dayDetailButton} onClick={() => openDetail("", dateLabel(row.date || row.week), start, end, row.revenue)}><strong>{dateLabel(row.date || row.week)} ↗</strong><small>{row.date ? `${row.name} · ${routeDay(row.date)}` : start !== row.week || end !== shiftRouteDate(row.week, 6) ? "Partial week" : "Selected service days"}</small></button></td><td>{row.jobs}</td><td>{row.hours ? number(row.hours) : "—"}</td><td><strong>{money(row.revenue, 2)}</strong><RevenueBreakdown mix={row.revenueMix} onOpen={(category, label) => openDetail(category, label, start, end, row.revenueMix[category].revenue)} /></td><td>{money(rate, 2)}</td>{profitabilityView ? <><td>{money(row.totalCost, 2)}</td><td className={row.profit < 0 ? styles.negative : styles.profit}>{money(row.profit, 2)}</td></> : null}<td><span className={row.missingValues || rate == null || (profitabilityView && row.profit == null) ? styles.pendingBadge : styles.readyBadge}>{row.missingValues ? "Verify prices" : rate == null ? "Hours unavailable" : profitabilityView && row.profit == null ? "Costs pending" : row.estimatedJobs ? "Estimated prices" : "Reported values"}</span>{profitabilityView && row.issues?.length ? <small>{row.issues.join("; ")}</small> : null}</td></tr>;
      })}{!detailRows.length ? <tr><td colSpan={profitabilityView ? 8 : 6} className={styles.empty}>No completed service records match this selection. Try all days, widen the dates, or refresh route data.</td></tr> : null}</tbody></table></div>
      <div className={styles.pagination}><span>{detailRows.length ? `${safePage * 12 + 1}–${Math.min((safePage + 1) * 12, detailRows.length)} of ${detailRows.length}` : "0 records"}</span><button disabled={!safePage} onClick={() => setPage(safePage - 1)}>Previous</button><button disabled={(safePage + 1) * 12 >= detailRows.length} onClick={() => setPage(safePage + 1)}>Next</button></div>
    </section>

    {revenueDetail ? <RevenueDetailDialog key={JSON.stringify(revenueDetail)} detail={revenueDetail} onClose={() => setRevenueDetail(null)} onUpdate={update} /> : null}
    <details className={styles.utilityPanel} id="route-data-review" open={reviewOpen} onToggle={event => setReviewOpen(event.currentTarget.open)}><summary>Company service verification <span>{reviewCount ? `${reviewCount} to review` : "Review queue & correction history"}</span></summary><RouteDataReview review={data?.review} from={from} through={through} weekday={dayFilter} onUpdate={update} /></details>
    <div id="route-sources"><RouteCostPanel key={`${data?.history?.capturedAt}-${view}`} revenueOnly={!profitabilityView} initialData={data} onUpdate={update} /></div>
    <details className={styles.method}><summary>How these numbers are calculated</summary><p>Revenue uses completed service dates, including both ends of the selected range. Each completed visit belongs to its recorded historical technician. Selecting a technician filters service revenue, hours, costs, weekday comparisons, and the ledger. Hourly rates require complete shifts for the same technician and dates. Craig’s mixed office/field hours are excluded. With all technicians selected, hourly results blend all-account revenue with employee hours; selecting one technician uses only that person’s visits and hours. Today is excluded while shifts are open.</p><p>Recorded or verified job values are used first. Current subscription prices are never substituted for historical visit values. Source zero or missing prices remain flagged unless dated evidence or an owner correction establishes the amount. Unknown service labels require classification and never silently become recurring revenue. Service revenue does not establish payment collection.</p><p>Weekday cards use the selected date range. Selecting a weekday filters the totals, service categories, records, and verification queue; all five comparison cards remain visible. Missing or invalid technician shifts leave hourly rates unavailable, while service revenue remains visible.</p>{profitabilityView ? <p>All company expenses in each QuickBooks month are allocated by completed visit count before any date or weekday filtering. Payroll, vehicles, supplies, and overhead are included without adding a second wage model. Incomplete expense reconciliation or cost-period coverage withholds profit. Profit remains an allocation estimate and inherits the status of the books.</p> : null}</details>
  </div>;
}
