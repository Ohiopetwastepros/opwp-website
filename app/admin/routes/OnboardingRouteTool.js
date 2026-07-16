"use client";

import { useEffect, useState } from "react";
import styles from "./routes.module.css";

const number = (value, digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value) || 0);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);

export default function OnboardingRouteTool() {
  const [form, setForm] = useState({ address: "", frequency: "once_a_week", estimated_service_minutes: "", monthly_revenue: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [assignments, setAssignments] = useState([]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/route-assignment/", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (active && data.ok) setAssignments(data.assignments ?? []);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  async function analyze(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/route-assignment/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form), cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The address could not be analyzed.");
      setResult(data.recommendation);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The address could not be analyzed."); }
    finally { setLoading(false); }
  }

  return <section className={styles.assignmentTool}>
    <div className={styles.assignmentHead}><div><div className={styles.eyebrow}>OPWP Route Assignment Tool · live Airtable edition</div><h2>Type an address. Confirm the best service day.</h2><p>The engine refreshes the active Airtable customer book when needed, then tests real road-time insertion into every weekday route. Excel is no longer part of the operating flow.</p></div><span>Live customers + road time</span></div>
    <form className={styles.assignmentForm} onSubmit={analyze}>
      <label className={styles.addressField}><span>Full service address</span><input required value={form.address} onChange={update("address")} placeholder="123 Main St, Toledo, OH 43615" autoComplete="street-address" /></label>
      <label><span>Frequency</span><select value={form.frequency} onChange={update("frequency")}><option value="once_a_week">Weekly</option><option value="every_other_week">Biweekly</option><option value="twice_a_week">Twice weekly</option><option value="once_a_month">Monthly</option></select></label>
      <button disabled={loading}>{loading ? "Refreshing and calculating…" : "Confirm the best day"}</button>
      <details className={styles.assignmentAdvanced}><summary>Optional planning inputs</summary><div>
        <label><span>Estimated minutes</span><input type="number" min="1" max="120" value={form.estimated_service_minutes} onChange={update("estimated_service_minutes")} placeholder="Use area median" /></label>
        <label><span>Core monthly revenue</span><input type="number" min="0" step="1" value={form.monthly_revenue} onChange={update("monthly_revenue")} placeholder="Optional" /></label>
      </div></details>
    </form>
    {error ? <div className={styles.error}>{error}</div> : null}
    {result?.eligible ? <div className={styles.assignmentResult}>
      <div className={styles.assignmentDecision}><div><span>Recommended assignment</span><strong>{result.recommendedPair || result.recommendedDay || "Review required"}</strong><p>{result.recommendedTechnician} · {result.region} · {result.confidence} confidence</p></div><div><span>Service-time assumption</span><strong>{number(result.estimatedServiceMinutes)} min</strong><p>{result.estimatedMinutesSource}</p></div><div><span>Airtable route source</span><strong>{result.airtableFreshness?.refreshed ? "Refreshed now" : "Current"}</strong><p>{result.sourceSnapshotAt ? new Date(result.sourceSnapshotAt).toLocaleString() : "Current active customer book"}</p></div></div>
      {result.airtableFreshness?.warning ? <div className={styles.error}>{result.airtableFreshness.warning}</div> : null}
      <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Rank</th><th>Day</th><th>Modeled owner</th><th>Road insertion</th><th>Added miles</th><th>Projected route</th><th>Projected $/hr</th><th>Area density</th><th>Nearest active customers</th></tr></thead><tbody>{(result.rankedDays ?? []).map((day) => <tr key={day.day} className={day.day === result.recommendedDay || result.recommendedPair?.includes(day.day) ? styles.recommendedRow : ""}><td>{day.rank || "—"}</td><td><strong>{day.day}</strong>{!day.allowed ? <small>Outside current lane</small> : null}</td><td>{day.technician || "—"}</td><td>{day.insertionMinutes == null ? "—" : `${number(day.insertionMinutes, 1)} min`}</td><td>{day.insertionMiles == null ? "—" : `${number(day.insertionMiles, 1)} mi`}</td><td>{day.projectedMinutes == null ? "—" : `${number(day.projectedMinutes / 60, 1)} hr`}</td><td><span className={Number(day.projectedRevenuePerHour) >= 100 ? styles.gain : styles.warningRate}>{day.projectedRevenuePerHour == null ? "—" : money(day.projectedRevenuePerHour)}</span></td><td>{number(day.regionDensity)} customers</td><td>{(day.nearest ?? []).map((neighbor) => <small key={neighbor.customer}>{neighbor.customer} · {number(neighbor.roadMinutes, 1)} min</small>)}</td></tr>)}</tbody></table></div>
      <div className={styles.disclosure}><strong>Automatic onboarding behavior:</strong> Website signups receive the same live-data analysis, the result is stored in D1, and the recommended day is appended to the internal SNG account note. The office must still confirm the service day in SNG until a supported schedule-write endpoint is proven.</div>
    </div> : null}
    <div className={styles.assignmentQueue}>
      <div className={styles.candidateHead}><div><div className={styles.eyebrow}>Automatic onboarding queue</div><h2>Recent route assignments</h2></div><p>Real website onboardings appear here after road-time analysis. Simulations entered above are not saved to this queue.</p></div>
      {assignments.length ? <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Received</th><th>Customer</th><th>Address</th><th>Frequency</th><th>Recommended assignment</th><th>Technician</th><th>Confidence</th><th>Status</th></tr></thead><tbody>{assignments.map((assignment) => <tr key={assignment.id}><td>{new Date(`${assignment.created_at}Z`).toLocaleString()}</td><td><strong>{assignment.customer_name || "Website onboarding"}</strong></td><td>{assignment.address}</td><td>{assignment.frequency}</td><td><b>{assignment.recommended_pair || assignment.recommended_day || "Review"}</b></td><td>{assignment.recommended_technician || "Review"}</td><td>{assignment.confidence}</td><td>{assignment.status}</td></tr>)}</tbody></table></div> : <div className={styles.disclosure}><strong>Ready:</strong> The queue is connected. The next recurring website onboarding will create the first automatic assignment.</div>}
    </div>
  </section>;
}
