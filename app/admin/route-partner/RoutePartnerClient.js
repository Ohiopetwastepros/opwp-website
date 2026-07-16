"use client";

import { useMemo, useState } from "react";
import styles from "./route-partner.module.css";

const number = (value) => new Intl.NumberFormat("en-US").format(Number(value) || 0);
const minutes = (value) => `${Math.round(Number(value) || 0)} min`;
const longDate = (value) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`));

function Status({ value }) {
  return <span className={`${styles.status} ${styles[`status_${value}`] || ""}`}>{String(value || "unknown").replaceAll("_", " ")}</span>;
}

export default function RoutePartnerClient({ initialDate, initialDay }) {
  const [date, setDate] = useState(initialDate);
  const [day, setDay] = useState(initialDay);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmPlan, setConfirmPlan] = useState(null);
  const hasPlans = Boolean(day?.plans?.length);
  const allFinalized = useMemo(() => hasPlans && day.plans.every((plan) => plan.status === "finalized"), [day, hasPlans]);

  async function parse(response) {
    if (response.status === 401) { window.location.assign(`/admin/login/?next=${encodeURIComponent(window.location.pathname)}`); throw new Error("Your session expired. Redirecting to sign in…"); }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "The route operation could not be completed.");
    return data;
  }

  async function request(body) {
    return parse(await fetch("/api/admin/route-partner/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }));
  }

  async function loadDate(nextDate) {
    if (!nextDate) return;
    setDate(nextDate); setLoading("load"); setError(""); setNotice("");
    try { setDay((await parse(await fetch(`/api/admin/route-partner/?date=${encodeURIComponent(nextDate)}`, { cache: "no-store" }))).day); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The route day could not be loaded."); }
    finally { setLoading(""); }
  }

  async function importDay() {
    if (loading) return;
    setLoading("import"); setError(""); setNotice("");
    try {
      const data = await request({ action: "import", date });
      setDay(data.day);
      setNotice(data.imported.createdCount ? `${data.imported.createdCount} route ${data.imported.createdCount === 1 ? "draft is" : "drafts are"} ready for review.` : "This route is already current—no duplicate version was created.");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The route day could not be imported."); }
    finally { setLoading(""); }
  }

  async function finalize() {
    const plan = confirmPlan;
    if (!plan || loading || plan.status !== "draft") return;
    setConfirmPlan(null); setLoading(plan.id); setError(""); setNotice("");
    try {
      const data = await request({ action: "finalize", date, planId: plan.id });
      setDay(data.day); setNotice(`${plan.technicianName || "Unassigned"}’s route is finalized and ready for field release.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The route could not be finalized."); }
    finally { setLoading(""); }
  }

  return <>
    <section className={styles.control} aria-labelledby="route-control-title">
      <div><span className={styles.sectionLabel}>Today’s control point</span><h2 id="route-control-title">{longDate(date)}</h2><p>{hasPlans ? "Review the route cards below, then release each approved route." : "Choose a service date and import its dispatched work."}</p></div>
      <div className={styles.controls}>
        <label><span>Service date</span><input type="date" value={date} onChange={(event) => loadDate(event.target.value)} disabled={Boolean(loading)} /></label>
        <button className={styles.primaryButton} type="button" onClick={importDay} disabled={Boolean(loading)}>{loading === "import" ? <><i />Importing…</> : hasPlans ? "Refresh route" : "Import route"}</button>
      </div>
    </section>

    <section className={styles.progress} aria-label="Route release workflow">
      {[{ n: 1, title: "Import", detail: "Read CRM dispatch", state: hasPlans ? "done" : "current" }, { n: 2, title: "Review", detail: "Confirm stops", state: hasPlans && !allFinalized ? "current" : allFinalized ? "done" : "" }, { n: 3, title: "Release", detail: "Approve for field", state: allFinalized ? "done" : "" }].map((step) => <div className={styles[step.state] || ""} key={step.n}><span>{step.state === "done" ? "✓" : step.n}</span><p><strong>{step.title}</strong><small>{step.detail}</small></p></div>)}
    </section>

    <div className={styles.alerts} aria-live="polite">{error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice}>{notice}</div> : null}</div>

    {hasPlans ? <section className={styles.metrics} aria-label="Route totals">
      <div><span>Routes</span><strong>{number(day.totals?.routes)}</strong></div><div><span>Stops</span><strong>{number(day.totals?.locations)}</strong></div><div><span>Scooping</span><strong>{number(day.totals?.scoopTasks)}</strong></div><div><span>Food</span><strong>{number(day.totals?.foodTasks)}</strong></div><div><span>Released</span><strong>{number(day.totals?.finalized)} <small>/ {number(day.totals?.routes)}</small></strong></div>
    </section> : null}

    {!hasPlans ? <section className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden="true"><span>↗</span></div>
      <div><span className={styles.sectionLabel}>Ready when dispatch is ready</span><h2>Build the day’s field route.</h2><p>We’ll read the selected Sweep &amp; Go dispatch, combine matching food deliveries at the same address, and keep food-only stops inside Route Partner.</p></div>
      <button className={styles.primaryButton} type="button" onClick={importDay} disabled={Boolean(loading)}>Import {longDate(date)}</button>
    </section> : <div className={styles.routeList}>{day.plans.map((plan) => <article className={styles.route} key={plan.id}>
      <header><div><div className={styles.routeMeta}><Status value={plan.status} /><span>Version {plan.version}</span></div><h2>{plan.technicianName || "Unassigned route"}</h2><p>{plan.routeId || "Default route"} · {number(plan.locationCount)} physical stops</p></div><button className={styles.releaseButton} type="button" onClick={() => setConfirmPlan(plan)} disabled={Boolean(loading) || plan.status !== "draft"}>{loading === plan.id ? <><i />Finalizing…</> : plan.status === "finalized" ? "✓ Route released" : plan.status === "draft" ? "Review & release" : "Unavailable"}</button></header>
      <div className={styles.routeSummary}><span><b>{number(plan.sourceJobCount)}</b> scoop jobs</span><span><b>{number(plan.foodTaskCount)}</b> food deliveries</span><span><b>{minutes(plan.locations.reduce((sum, location) => sum + location.estimatedMinutes, 0))}</b> estimated service</span><span>Imported <b>{plan.importedAt ? new Date(plan.importedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</b></span></div>
      <ol className={styles.locations}>{plan.locations.map((location) => <li key={location.id}><span className={styles.sequence}>{location.sequence}</span><div className={styles.locationBody}><div className={styles.locationHead}><div><strong>{location.customerName || "Service location"}</strong><p>{location.address}</p></div><small>{minutes(location.estimatedMinutes)}</small></div><div className={styles.tasks}>{location.tasks.map((task) => <div className={`${styles.task} ${task.type === "dog_food" ? styles.foodTask : styles.scoopTask}`} key={task.id}><span>{task.type === "dog_food" ? "Food" : "Scoop"}</span><div><strong>{task.type === "dog_food" ? task.productSummary || "Dog food delivery" : task.customerName || "Scooping service"}</strong><small>{task.type === "dog_food" ? task.placementNote || "Placement confirmation required" : `CRM completion: ${task.crmCompletionStatus}`}</small></div><Status value={task.status} /></div>)}</div></div></li>)}</ol>
    </article>)}</div>}

    <section className={styles.boundary}><span aria-hidden="true">i</span><div><strong>Safe initial release</strong><p>Route Partner reads the CRM, combines service work, and records management approval. It will not change CRM routing, charge a card, or message a customer in this release.</p></div></section>

    {confirmPlan ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmPlan(null); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="release-title"><span className={styles.modalIcon} aria-hidden="true">✓</span><h2 id="release-title">Release this route?</h2><p>You’re approving <strong>{confirmPlan.technicianName || "this technician"}</strong> with {number(confirmPlan.locationCount)} stops for {longDate(date)}.</p><div><button type="button" className={styles.secondaryButton} onClick={() => setConfirmPlan(null)}>Keep reviewing</button><button type="button" className={styles.primaryButton} onClick={finalize}>Release route</button></div></section></div> : null}
  </>;
}
