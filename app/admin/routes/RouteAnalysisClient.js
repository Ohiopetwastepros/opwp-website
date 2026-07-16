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

  const transition = plan?.officeTransitionScenario;
  const transitionTechnicians = useMemo(() => {
    const technicians = new Map();
    for (const route of transition?.routes ?? []) {
      const row = technicians.get(route.technicianName) || { technician: route.technicianName, stops: 0, miles: 0, minutes: 0, revenue: 0 };
      row.stops += Number(route.stopCount || 0);
      row.miles += Number(route.distanceMiles || 0);
      row.minutes += Number(route.plannedMinutes || 0);
      row.revenue += Number(route.routeRevenue || 0);
      technicians.set(route.technicianName, row);
    }
    return [...technicians.values()].map((row) => ({ ...row, revenuePerHour: row.minutes ? row.revenue / (row.minutes / 60) : 0, capacityHours: Math.max(0, 40 - row.minutes / 60) }));
  }, [transition]);

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

    {transition ? <section className={styles.candidates}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Read-only future-state scenario</div><h2>Craig office transition + Tony full-time</h2></div><p>Customer service days stay fixed. Craig retains one dense Monday route during the transition; Tony and Bria own the remaining route books, with Tony carrying Wednesday and Friday. Nothing is written back.</p></div>
      <div className={styles.summaryGrid}>
        <div><span>Modeled customers moved</span><strong>{number(transition.changedCustomers)}</strong></div>
        <div><span>Current fragmented miles</span><strong>{number(transition.currentTotals?.miles, 1)}</strong></div>
        <div><span>Modeled route miles</span><strong>{number(transition.modeledTotals?.miles, 1)}</strong></div>
        <div><span>Modeled field time</span><strong>{hours(transition.modeledTotals?.plannedMinutes)}</strong></div>
        <div><span>Team revenue / hr</span><strong className={Number(transition.modeledTotals?.revenuePerPlannedHour) >= 100 ? "" : styles.belowTarget}>{money(transition.modeledTotals?.revenuePerPlannedHour)}</strong></div>
      </div>
      <div className={styles.scenarioGrid}>
        {transitionTechnicians.map((row) => <article className={styles.scenarioCard} key={row.technician}><span>Future field book</span><h3>{row.technician}</h3><strong>{hours(row.minutes)}</strong><p>{number(row.stops)} stops · {number(row.miles, 1)} road miles · {money(row.revenuePerHour)}/hour · {number(row.capacityHours, 1)} hours open to 40.</p></article>)}
      </div>
      <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Day</th><th>Modeled owner</th><th>Stops</th><th>Miles</th><th>Field time</th><th>Revenue</th><th>Revenue / hour</th></tr></thead><tbody>{(transition.routes ?? []).map((route) => <tr key={`transition-${route.technicianName}-${route.routeId}`}><td><strong>{route.routeId}</strong></td><td>{route.technicianName}</td><td>{number(route.stopCount)}</td><td>{number(route.distanceMiles, 1)}</td><td>{hours(route.plannedMinutes)}</td><td>{money(route.routeRevenue)}</td><td><span className={Number(route.revenuePerPlannedHour) >= 100 ? styles.gain : styles.warningRate}>{money(route.revenuePerPlannedHour)}</span></td></tr>)}</tbody></table></div>
      <div className={styles.disclosure}><strong>Scenario boundary:</strong> This compares open customer-to-customer routes. Depot travel, breaks, vehicle loading, one-time jobs, and paid non-route time remain excluded. “Customers moved” means modeled technician ownership only; no customer day changes and no SNG/Airtable updates occur.</div>
    </section> : null}

    {plan?.recommendations?.length ? <section className={styles.candidates}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Approval queue</div><h2>Flexible-day density opportunities</h2></div><p>Twice-weekly customers are excluded. These are screening candidates based on nearby customers; approve only after checking customer preference and full-route impact.</p></div>
      <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Customer</th><th>Area</th><th>Current</th><th>Consider</th><th>Current neighbor</th><th>Proposed neighbor</th><th>Proximity gain</th></tr></thead><tbody>{plan.recommendations.map((item) => <tr key={item.customerId}><td><strong>{item.customer}</strong></td><td>{item.region}</td><td>{item.currentDay}</td><td><b>{item.suggestedDay}</b></td><td>{item.currentNearestCustomer}<small>{number(item.currentNearestMiles, 2)} mi</small></td><td>{item.suggestedNearestCustomer}<small>{number(item.suggestedNearestMiles, 2)} mi</small></td><td><span className={styles.gain}>{number(item.proximityMilesSaved, 2)} mi</span></td></tr>)}</tbody></table></div>
    </section> : null}
  </>;
}
