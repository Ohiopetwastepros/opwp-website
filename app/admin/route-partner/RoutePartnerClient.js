"use client";

import { useMemo, useState } from "react";
import styles from "./route-partner.module.css";

const number = (value) => new Intl.NumberFormat("en-US").format(Number(value) || 0);
const minutes = (value) => `${Math.round(Number(value) || 0)} min`;

function Status({ value }) {
  return <span className={`${styles.status} ${styles[`status_${value}`] || ""}`}>{String(value || "unknown").replaceAll("_", " ")}</span>;
}

export default function RoutePartnerClient({ initialDate, initialDay }) {
  const [date, setDate] = useState(initialDate);
  const [day, setDay] = useState(initialDay);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState(initialDay ? "" : "The Route Partner database foundation is not available yet.");
  const [notice, setNotice] = useState("");

  const allFinalized = useMemo(() => Boolean(day?.plans?.length) && day.plans.every((plan) => plan.status === "finalized"), [day]);

  async function request(body) {
    const response = await fetch("/api/admin/route-partner/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "The route operation could not be completed.");
    return data;
  }

  async function loadDate(nextDate) {
    setDate(nextDate);
    setLoading("load");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/route-partner/?date=${encodeURIComponent(nextDate)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The route day could not be loaded.");
      setDay(data.day);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The route day could not be loaded."); }
    finally { setLoading(""); }
  }

  async function importDay() {
    if (loading) return;
    setLoading("import");
    setError("");
    setNotice("");
    try {
      const data = await request({ action: "import", date });
      setDay(data.day);
      setNotice(data.imported.createdCount
        ? `${data.imported.createdCount} route ${data.imported.createdCount === 1 ? "draft" : "drafts"} created for management review.`
        : "The dispatched route is already current. No duplicate version was created.");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The route day could not be imported."); }
    finally { setLoading(""); }
  }

  async function finalize(plan) {
    if (loading || plan.status !== "draft") return;
    setLoading(plan.id);
    setError("");
    setNotice("");
    try {
      const data = await request({ action: "finalize", date, planId: plan.id });
      setDay(data.day);
      setNotice(`${plan.technicianName || "Unassigned"}'s route is finalized and ready for the field release workflow.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The route could not be finalized."); }
    finally { setLoading(""); }
  }

  return <>
    <section className={styles.commandBar}>
      <div><div className={styles.eyebrow}>Daily control point</div><h2>Import, review, release</h2><p>A new version is created only when the CRM route or native food work changes.</p></div>
      <div className={styles.commands}>
        <label><span>Service date</span><input type="date" value={date} onChange={(event) => loadDate(event.target.value)} disabled={Boolean(loading)} /></label>
        <button type="button" onClick={importDay} disabled={Boolean(loading)}>{loading === "import" ? <><i />Importing…</> : "Import dispatched route"}</button>
      </div>
    </section>

    <section className={styles.workflow} aria-label="Route release workflow">
      <div className={day?.plans?.length ? styles.done : ""}><span>1</span><p><strong>Import</strong><small>Read CRM dispatch</small></p></div>
      <b />
      <div className={day?.plans?.some((plan) => plan.status === "draft") ? styles.current : day?.plans?.length ? styles.done : ""}><span>2</span><p><strong>Review</strong><small>Confirm route cards</small></p></div>
      <b />
      <div className={allFinalized ? styles.done : ""}><span>3</span><p><strong>Release</strong><small>Finalize for field use</small></p></div>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    <section className={styles.snapshot}>
      <div><span>Routes</span><strong>{number(day?.totals?.routes)}</strong></div>
      <div><span>Location cards</span><strong>{number(day?.totals?.locations)}</strong></div>
      <div><span>Scooping jobs</span><strong>{number(day?.totals?.scoopTasks)}</strong></div>
      <div><span>Food deliveries</span><strong>{number(day?.totals?.foodTasks)}</strong></div>
      <div><span>Finalized</span><strong>{number(day?.totals?.finalized)} / {number(day?.totals?.routes)}</strong></div>
    </section>

    {!day?.plans?.length ? <section className={styles.empty}>
      <div className={styles.emptyMark}>RP</div>
      <div><div className={styles.eyebrow}>No route version for {date}</div><h2>Start with the CRM dispatch.</h2><p>Import the selected day after Sweep &amp; Go has created its jobs. Scheduled dog-food deliveries will be attached to matching addresses automatically; food-only stops remain native to this system.</p></div>
      <button type="button" onClick={importDay} disabled={Boolean(loading)}>Import this day</button>
    </section> : <div className={styles.routeList}>{day.plans.map((plan) => <article className={styles.route} key={plan.id}>
      <header>
        <div><div className={styles.routeMeta}><Status value={plan.status} /><span>Version {plan.version}</span><span>{plan.sourceProvider === "sweep_and_go" ? "Sweep & Go + native" : plan.sourceProvider}</span></div><h2>{plan.technicianName || "Unassigned"}</h2><p>{plan.routeId || "Default route"} · {number(plan.locationCount)} physical stops</p></div>
        <button type="button" onClick={() => finalize(plan)} disabled={Boolean(loading) || plan.status !== "draft"}>{loading === plan.id ? <><i />Finalizing…</> : plan.status === "finalized" ? "Route finalized" : plan.status === "draft" ? "Finalize route" : "Locked"}</button>
      </header>
      <div className={styles.routeSummary}><span><b>{number(plan.sourceJobCount)}</b> scoop jobs</span><span><b>{number(plan.foodTaskCount)}</b> food deliveries</span><span><b>{minutes(plan.locations.reduce((sum, location) => sum + location.estimatedMinutes, 0))}</b> service estimate</span><span>Imported <b>{plan.importedAt ? new Date(plan.importedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</b></span></div>
      <ol className={styles.locations}>{plan.locations.map((location) => <li key={location.id}>
        <span className={styles.sequence}>{location.sequence}</span>
        <div className={styles.locationBody}>
          <div className={styles.locationHead}><div><strong>{location.customerName || "Service location"}</strong><p>{location.address}</p></div><small>{minutes(location.estimatedMinutes)}</small></div>
          <div className={styles.tasks}>{location.tasks.map((task) => <div className={`${styles.task} ${task.type === "dog_food" ? styles.foodTask : styles.scoopTask}`} key={task.id}>
            <span>{task.type === "dog_food" ? "FOOD" : "SCOOP"}</span>
            <div><strong>{task.type === "dog_food" ? task.productSummary || "Dog food delivery" : task.customerName || "Scooping service"}</strong><small>{task.type === "dog_food" ? task.placementNote || "Placement confirmation required" : `CRM completion ${task.crmCompletionStatus}`}</small></div>
            <Status value={task.status} />
          </div>)}</div>
        </div>
      </li>)}</ol>
    </article>)}</div>}

    <section className={styles.boundary}><strong>Initial operating boundary</strong><p>This release reads Sweep &amp; Go, versions the route, merges native food work, and records management approval. It does not change the CRM route, message customers, charge cards, or expose technician access yet.</p></section>
  </>;
}
