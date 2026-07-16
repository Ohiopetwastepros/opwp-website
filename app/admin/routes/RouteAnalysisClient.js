"use client";

import { useMemo, useState } from "react";
import styles from "./routes.module.css";

const number = (value, digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value) || 0);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);
const hours = (minutes) => `${number((Number(minutes) || 0) / 60, 1)} hr`;

export default function RouteAnalysisClient({ initialSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const plan = summary?.plan;

  const totals = useMemo(() => (plan?.routes ?? []).reduce((result, route) => ({
    miles: result.miles + Number(route.distanceMiles || 0),
    drive: result.drive + Number(route.driveMinutes || 0),
    service: result.service + Number(route.serviceMinutes || 0),
  }), { miles: 0, drive: 0, service: 0 }), [plan]);

  const tonyScenario = useMemo(() => {
    const routes = plan?.routes ?? [];
    const core = routes.filter((route) => route.technicianName === "Tony Bridgman");
    const additions = routes.filter((route) => route.technicianName === "Bria Mahaney" && ["Wednesday", "Friday"].includes(String(route.routeId).split(" - ")[0]));
    const aggregate = (rows) => rows.reduce((result, route) => ({
      stops: result.stops + Number(route.stopCount || 0),
      miles: result.miles + Number(route.distanceMiles || 0),
      minutes: result.minutes + Number(route.plannedMinutes || 0),
      revenue: result.revenue + Number(route.routeRevenue || 0),
    }), { stops: 0, miles: 0, minutes: 0, revenue: 0 });
    const current = aggregate(core);
    const projectedRoutes = [...core, ...additions];
    const projected = aggregate(projectedRoutes);
    return {
      core,
      additions,
      current,
      projected,
      projectedRate: projected.minutes ? projected.revenue / (projected.minutes / 60) : 0,
      openHours: Math.max(0, 40 - projected.minutes / 60),
      priorityRoutes: routes.filter((route) => Number(route.stopCount) >= 5).sort((left, right) => Number(left.revenuePerPlannedHour) - Number(right.revenuePerPlannedHour)).slice(0, 4),
    };
  }, [plan]);

  async function refreshPlan() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/route-intelligence/?mode=active", { method: "POST", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The route book could not be refreshed.");
      setSummary(data.summary);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The route book could not be refreshed.");
    } finally { setLoading(false); }
  }

  return <>
    <section className={styles.controlPanel}>
      <div className={styles.controlIntro}><div className={styles.eyebrow}>Current paid route book</div><h2>Plan from every active subscription</h2><p>Source data comes from the protected hourly Airtable snapshot. Coordinates and route results are retained in D1 so the dashboard does not depend on a live Airtable request.</p></div>
      <div className={styles.controls}><button type="button" onClick={refreshPlan} disabled={loading}>{loading ? <><i />Refreshing route book…</> : "Refresh road-time plan"}</button></div>
    </section>

    <section className={styles.results}>
      <div className={styles.resultHead}><div><div className={styles.eyebrow}>Subscription coverage</div><h2>The weekly operating footprint</h2><p>Captured {summary?.sourceSnapshotAt ? new Date(summary.sourceSnapshotAt).toLocaleString() : "from the latest protected snapshot"}.</p></div><span className={`${styles.status} ${summary?.geocodedCustomers === summary?.activeCustomers ? styles.complete : ""}`}>{summary?.geocodedCustomers === summary?.activeCustomers ? "street-ready" : "building coordinates"}</span></div>
      <div className={styles.summaryGrid}>
        <div><span>Active customers</span><strong>{number(summary?.activeCustomers)}</strong></div>
        <div><span>Weekly equivalent</span><strong>{number(summary?.weeklyEquivalentVisits, 1)}</strong></div>
        <div><span>Fixed 2× weekly</span><strong>{number(summary?.fixedTwiceWeekly)}</strong></div>
        <div><span>Street matched</span><strong>{number(summary?.geocodedCustomers)} / {number(summary?.activeCustomers)}</strong></div>
        <div><span>Move candidates</span><strong>{number(plan?.recommendations?.length)}</strong></div>
      </div>
    </section>

    {summary?.serviceDayAnomalies?.length ? <div className={styles.error}><strong>Service-day review:</strong> {summary.serviceDayAnomalies.map((item) => `${item.customer} is marked ${item.frequency} but has ${item.serviceDays.join(" and ")}`).join("; ")}. Both days remain locked until the source record is confirmed.</div> : null}

    <section className={styles.candidates}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Day capacity</div><h2>Where the weekly work currently sits</h2></div><p>MRR is allocated across service days for twice-weekly accounts; service minutes show the current planned field workload before driving.</p></div>
      <div className={styles.dayGrid}>{(summary?.days ?? []).map((day) => <article className={styles.dayCard} key={day.day}><span>{day.day}</span><strong>{number(day.equivalentVisits, 1)} weekly-equivalent</strong><div><b>{number(day.customers)}</b> route memberships</div><div><b>{money(day.mrr)}</b> allocated MRR</div><small>{number(day.fixedVisits)} fixed twice-weekly anchors</small></article>)}</div>
    </section>

    <section className={styles.candidates}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Territory density</div><h2>Established service areas by day</h2></div><p>This is the boundary model used to keep proposed moves inside the existing operating geography.</p></div>
      <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Area</th><th>Customers</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Fixed</th></tr></thead><tbody>{(summary?.regions ?? []).map((region) => <tr key={region.region}><td><strong>{region.region}</strong></td><td>{number(region.customers)}</td>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => <td key={day}>{number(region.byDay?.[day])}</td>)}<td>{number(region.fixedCustomers)}</td></tr>)}</tbody></table></div>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    {loading ? <section className={styles.loading}><div className={styles.loadingMark}><i /></div><div><strong>Updating the route book</strong><p>Reusing street coordinates and calculating road-time sequences without changing any customer commitments.</p></div></section> : null}

    {plan ? <section className={styles.results}>
      <div className={styles.resultHead}><div><div className={styles.eyebrow}>Road-time model · week of {plan.planningWeekStart ? new Date(`${plan.planningWeekStart}T12:00:00`).toLocaleDateString() : "current"}</div><h2>Shortest current-week sequence by day and technician</h2><p>Weekly work is always included. Biweekly A/B and monthly cohorts are anchored from the latest completed service date; depot travel is not included yet.</p></div><span className={`${styles.status} ${plan.status === "complete" ? styles.complete : ""}`}>{plan.status}</span></div>
      <div className={styles.summaryGrid}><div><span>Route sectors</span><strong>{number(plan.routes?.length)}</strong></div><div><span>Road miles</span><strong>{number(totals.miles, 1)}</strong></div><div><span>Drive time</span><strong>{hours(totals.drive)}</strong></div><div><span>Service time</span><strong>{hours(totals.service)}</strong></div><div><span>Snapshot</span><strong className={styles.smallStrong}>{plan.sourceSnapshotAt ? new Date(plan.sourceSnapshotAt).toLocaleDateString() : "Current"}</strong></div></div>
      <div className={styles.routeGrid}>{(plan.routes ?? []).map((route) => <article className={styles.routeCard} key={`${route.technicianId}-${route.routeId}`}>
        <header><div><span>{route.routeId}</span><h3>{route.technicianName || "Unassigned"}</h3></div><b>{number(route.distanceMiles, 1)} mi</b></header>
        <div className={styles.routeStats}><div><span>Stops</span><strong>{number(route.stopCount)}</strong></div><div><span>Drive</span><strong>{hours(route.driveMinutes)}</strong></div><div><span>Revenue</span><strong>{money(route.routeRevenue)}</strong></div><div><span>Revenue / hr</span><strong className={Number(route.revenuePerPlannedHour) >= 100 ? "" : styles.belowTarget}>{money(route.revenuePerPlannedHour)}</strong></div></div>
        <ol className={styles.stopList}>{(route.stopSequence ?? []).map((stop) => <li key={`${stop.sequence}-${stop.customer}`}><span>{stop.sequence}</span><div><strong>{stop.customer}</strong><small>{stop.address}</small></div>{stop.fixedDays ? <b>fixed</b> : null}</li>)}</ol>
      </article>)}</div>
      <div className={styles.disclosure}><strong>Interpretation:</strong> Road-time sequencing optimizes this week's cadence-eligible customers already assigned to that day and technician. Revenue/hour uses recurring revenue per scheduled visit against service plus road time, with a $100/hour target. {number(plan.cadenceAnchoredCustomers)}/{number(plan.cadenceCustomerCount)} biweekly/monthly accounts are date-anchored; {number(plan.unanchoredCadenceCustomers?.length)} are included pending a completed-date anchor. This does not change SNG.</div>
    </section> : <section className={styles.loading}><div className={styles.loadingMark}>→</div><div><strong>The route plan is being assembled automatically</strong><p>{number(summary?.activeCustomers - summary?.geocodedCustomers)} addresses remain to be street-matched. The hourly recovery job will continue until the road-time model is complete.</p></div></section>}

    {plan ? <section className={styles.candidates}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Read-only staffing scenario</div><h2>Tony full-time route runway</h2></div><p>This models Tony retaining his current Monday, Tuesday, and Thursday routes and covering Bria's current Wednesday and Friday routes. It changes no service day, customer, or source assignment.</p></div>
      <div className={styles.summaryGrid}>
        <div><span>Current core field time</span><strong>{hours(tonyScenario.current.minutes)}</strong></div>
        <div><span>Modeled five-day time</span><strong>{hours(tonyScenario.projected.minutes)}</strong></div>
        <div><span>Modeled stops</span><strong>{number(tonyScenario.projected.stops)}</strong></div>
        <div><span>Modeled revenue / hr</span><strong className={tonyScenario.projectedRate >= 100 ? "" : styles.belowTarget}>{money(tonyScenario.projectedRate)}</strong></div>
        <div><span>Capacity to 40 hours</span><strong>{hours(tonyScenario.openHours * 60)}</strong></div>
      </div>
      <div className={styles.scenarioGrid}>
        <article className={styles.scenarioCard}><span>Expansion order 01</span><h3>Friday route</h3><strong>{hours(tonyScenario.additions.find((route) => String(route.routeId).startsWith("Friday"))?.plannedMinutes)}</strong><p>{number(tonyScenario.additions.find((route) => String(route.routeId).startsWith("Friday"))?.stopCount)} stops at {money(tonyScenario.additions.find((route) => String(route.routeId).startsWith("Friday"))?.revenuePerPlannedHour)}/hour. This is the strongest full-day addition using the current setup.</p></article>
        <article className={styles.scenarioCard}><span>Expansion order 02</span><h3>Wednesday route</h3><strong>{hours(tonyScenario.additions.find((route) => String(route.routeId).startsWith("Wednesday"))?.plannedMinutes)}</strong><p>{number(tonyScenario.additions.find((route) => String(route.routeId).startsWith("Wednesday"))?.stopCount)} stops at {money(tonyScenario.additions.find((route) => String(route.routeId).startsWith("Wednesday"))?.revenuePerPlannedHour)}/hour. It creates a fifth field day with room for one-time work.</p></article>
        <article className={styles.scenarioCard}><span>Primary constraint</span><h3>Tony's Monday route</h3><strong>{money(tonyScenario.core.find((route) => String(route.routeId).startsWith("Monday"))?.revenuePerPlannedHour)}/hr</strong><p>{number(tonyScenario.core.find((route) => String(route.routeId).startsWith("Monday"))?.distanceMiles, 1)} road miles for {number(tonyScenario.core.find((route) => String(route.routeId).startsWith("Monday"))?.stopCount)} stops. Geographic consolidation on Monday matters more than adding volume.</p></article>
      </div>
      <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Efficiency priority</th><th>Current owner</th><th>Stops</th><th>Miles</th><th>Field time</th><th>Revenue / hour</th><th>Read-only action</th></tr></thead><tbody>{tonyScenario.priorityRoutes.map((route) => <tr key={`priority-${route.technicianName}-${route.routeId}`}><td><strong>{route.routeId}</strong></td><td>{route.technicianName}</td><td>{number(route.stopCount)}</td><td>{number(route.distanceMiles, 1)}</td><td>{hours(route.plannedMinutes)}</td><td><span className={Number(route.revenuePerPlannedHour) >= 100 ? styles.gain : styles.warningRate}>{money(route.revenuePerPlannedHour)}</span></td><td>{String(route.routeId).startsWith("Monday") ? "Consolidate same-day geographic pockets" : "Review isolated street clusters"}</td></tr>)}</tbody></table></div>
      <div className={styles.disclosure}><strong>Scenario boundary:</strong> The modeled five-day total excludes Bria/Tony or Craig/Tony shared records, depot travel, breaks, vehicle loading, office time, and one-time work. The open hours are operating capacity—not a recommendation to fill all 40 hours with recurring scooping.</div>
    </section> : null}

    {plan?.recommendations?.length ? <section className={styles.candidates}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Approval queue</div><h2>Flexible-day density opportunities</h2></div><p>Twice-weekly customers are excluded. These are screening candidates based on nearby customers; approve only after checking customer preference and full-route impact.</p></div>
      <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Customer</th><th>Area</th><th>Current</th><th>Consider</th><th>Current neighbor</th><th>Proposed neighbor</th><th>Proximity gain</th></tr></thead><tbody>{plan.recommendations.map((item) => <tr key={item.customerId}><td><strong>{item.customer}</strong></td><td>{item.region}</td><td>{item.currentDay}</td><td><b>{item.suggestedDay}</b></td><td>{item.currentNearestCustomer}<small>{number(item.currentNearestMiles, 2)} mi</small></td><td>{item.suggestedNearestCustomer}<small>{number(item.suggestedNearestMiles, 2)} mi</small></td><td><span className={styles.gain}>{number(item.proximityMilesSaved, 2)} mi</span></td></tr>)}</tbody></table></div>
    </section> : null}
  </>;
}
