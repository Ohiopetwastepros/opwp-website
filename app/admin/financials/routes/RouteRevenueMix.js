"use client";

import { useEffect, useRef, useState } from "react";
import { ROUTE_REVENUE_CATEGORIES, subscriptionAsOf } from "@/lib/route-revenue.mjs";
import { ReviewItem } from "./RouteDataReview";
import CleanupWork, { CleanupBilling } from './CleanupWork';
import styles from "./profitability.module.css";
const money = value => value == null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

export function RevenueBreakdown({ mix, onOpen }) {
  if (!mix) return null;
  return <details className={styles.revenueDetails}><summary>Service mix</summary><dl>{Object.entries(ROUTE_REVENUE_CATEGORIES).filter(([key]) => mix[key]?.jobs).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{onOpen ? <button onClick={() => onOpen(key, label)}>{money(mix[key].revenue)}</button> : money(mix[key].revenue)}{mix[key].missingValues ? " · incomplete" : mix[key].estimatedJobs ? " · estimated" : ""}</dd></div>)}</dl></details>;
}

export function RevenueDetailDialog({ detail, onClose, onUpdate }) {
  const dialog = useRef(null);
  const [result, setResult] = useState({ loading: true, records: [] });
  const [revision, setRevision] = useState(0);
  const [reviewId, setReviewId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!detail) return;
    setMessage("");
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [detail]);
  useEffect(() => {
    if (!detail) return;
    const controller = new AbortController();
    setResult({ loading: true, records: [] }); setReviewId(null);
    const params = new URLSearchParams({ from: detail.from, through: detail.through, category: detail.category || "", weekday: detail.weekday || "All days", technician: detail.technician || "" });
    fetch(`/api/admin/route-profitability/revenue-details/?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load service records."); return data; })
      .then(data => setResult({ loading: false, records: data.records || [] }))
      .catch(error => { if (error.name !== "AbortError") setResult({ loading: false, records: [], error: error.message }); });
    return () => controller.abort();
  }, [detail, revision]);
  if (!detail) return null;
  async function refreshChecks() {
    setSyncing(true); setMessage("");
    try {
      const response = await fetch("/api/admin/route-profitability/", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Source checks could not be refreshed.");
      onUpdate(data); setMessage(data.warnings?.join(" ") || "Source checks updated. Open a record to verify its category."); setRevision(value => value + 1);
    } catch (error) { setMessage(error.message); } finally { setSyncing(false); }
  }
  const issue = result.records.find(record => record.id === reviewId)?.reviewIssue;
  const amount = result.records.reduce((sum, record) => sum + record.revenue, 0);
  return <dialog ref={dialog} className={styles.revenueModal} aria-labelledby="revenue-detail-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Service records</span><h2 id="revenue-detail-title">{detail.label}</h2><p>{detail.from} – {detail.through}{detail.technician ? ` · ${detail.technician}` : ""}{detail.weekday && detail.weekday !== "All days" ? ` · ${detail.weekday} only` : ""}</p></div><button className={styles.closeButton} aria-label="Close revenue detail" onClick={onClose}>×</button></div>
    {result.loading ? <p className={styles.empty} role="status">Loading service records…</p> : result.error ? <p role="alert" className={styles.notice}>{result.error} <button onClick={() => setRevision(value => value + 1)}>Try again</button></p> : <>
      <div className={styles.detailSummary}><strong>{money(amount)}</strong><span>{result.records.length} completed visits · {result.records.filter(record => record.estimated).length} estimated prices</span></div>
      {detail.expectedRevenue != null && Math.abs(amount - detail.expectedRevenue) > .02 ? <p className={styles.notice}>Source records have changed since the dashboard snapshot. Refresh route data to reconcile the totals.</p> : null}
      <div className={styles.detailTableWrap}><table className={styles.detailTable}><thead><tr><th>Service date / customer</th><th>Service & classification evidence</th><th>Crew & time</th><th>Revenue / invoice validation</th><th>Status</th></tr></thead><tbody>{result.records.map(record => <tr key={record.id}>
        <td><strong>{record.customer}</strong><small>{record.date} · {record.technician}</small><small>Job #{record.id}</small></td>
        <td><strong>{ROUTE_REVENUE_CATEGORIES[record.category]}</strong><small>{record.classificationReason}</small></td>
        <td><CleanupWork record={record} onSaved={() => setRevision(value => value + 1)} /></td>
        <td>{money(record.revenue)}<small>{record.valueSource}{record.missing ? " · needs verification" : ""}</small><CleanupBilling billing={record.billing} /></td>
        <td>{record.reviewIssue ? <button className={styles.textButton} onClick={() => setReviewId(record.id)}>Verify service →</button> : record.category === "other" ? <span className={styles.pendingBadge}>Source check needed</span> : <span className={styles.readyBadge}>{record.verified ? "Verified" : "Source classified"}</span>}</td>
      </tr>)}</tbody></table>{!result.records.length ? <p className={styles.empty}>No completed visits match these dates and filters.</p> : null}</div>
      {issue ? <ReviewItem key={issue.jobId} issue={issue} onUpdate={data => { onUpdate(data); setMessage(data.warning || "Correction saved. Service categories and totals recalculated."); setRevision(value => value + 1); }} /> : null}
      {result.records.some(record => record.category === "other" && !record.reviewIssue) ? <p className={styles.notice}>Automatic classification is pending for these records. <button className={styles.textButton} disabled={syncing} onClick={refreshChecks}>{syncing ? "Checking sources…" : "Refresh source checks"}</button> to retry matching their original service records.</p> : null}
    </>}
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    <p className={styles.note}>Service value, not cash collected. QBO checks compare invoice service lines and exclude tips. Elapsed time is the interval between recorded job timestamps; it may include interruptions. Crew size is never inferred from one technician’s name. Work notes retain revisions and do not change source timers or billing.</p>
  </dialog>;
}

export default function RouteRevenueMix({ total, subscriptions, mrrAudit, through, onOpen }) {
  const snapshot = subscriptionAsOf(subscriptions, through);
  const available = snapshot?.verified && snapshot.snapshot_date === through;
  const latest = subscriptions.filter(row => row.verified).sort((a,b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
  const mix = total.revenueMix;
  const categories = Object.entries(ROUTE_REVENUE_CATEGORIES).filter(([key]) => ["initial", "one_time", "recurring"].includes(key) || mix?.[key]?.jobs);
  return <section className={styles.weekPanel} aria-label="Revenue by service">
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Revenue composition</span><h2>Revenue for the selected dates</h2></div><span className={styles.subtle}>Select a service to see every visit</span></div>
    {categories.length ? <><div className={styles.compositionBar} aria-label="Revenue composition">{categories.map(([key, label]) => <button key={key} data-category={key} style={{ flexGrow: Math.max(0, mix[key].revenue) }} aria-label={`${label}: ${money(mix[key].revenue)}`} onClick={() => onOpen(key, label)} />)}</div><div className={styles.revenueGrid}>{categories.map(([key, label]) => <button key={key} data-category={key} onClick={() => onOpen(key, label)}><span><i />{label}</span><strong>{money(mix[key].revenue)}</strong><small>{mix[key].jobs} visits <b>↗</b></small>{mix[key].missingValues ? <small>{mix[key].missingValues} prices need verification</small> : mix[key].estimatedJobs ? <small>{mix[key].estimatedJobs} estimated prices</small> : null}</button>)}</div></> : <p className={styles.empty}>No service revenue in this selection.</p>}
    {mix?.other?.jobs ? <p className={styles.classificationNote}><span className={styles.statusDot} />{mix.other.jobs} visits have classification pending. <button className={styles.textButton} onClick={() => onOpen("other", "Services to classify")}>Review and resolve →</button></p> : null}
    <div className={styles.subscriptionDetail} aria-label="Monthly recurring revenue">
      <h3>MRR at the selected end date</h3>
      <strong>{available ? money(snapshot.total_mrr) : "Unavailable for this date"}</strong>
      <p>{available ? `${snapshot.active_plans} active recurring plans. Paused plans excluded: ${money(snapshot.paused_mrr)}/month across ${snapshot.paused_plans} plans. Verified SNG capture: ${snapshot.snapshot_date}.` : `No verified subscription capture is available for ${through}. Historical recurring revenue is shown in the selected-range service and billing totals.`}</p>
      <p>Company-wide monthly run rate, separate from revenue earned during these dates. Technician and weekday filters do not change MRR. Initial and one-time charges are excluded.</p>
      {!available && latest ? <p><strong>Latest verified MRR: {money(latest.total_mrr)}/month</strong> as of {latest.snapshot_date}, from {latest.active_plans} active plans. Paused: {money(latest.paused_mrr)}/month across {latest.paused_plans} plans. This amount is not substituted into the selected historical dates.</p> : null}
      {!available && snapshot && !snapshot.verified ? <p className={styles.notice}>{snapshot.unsupported_plans} subscription terms need verification before MRR can be shown.</p> : null}
      {!available && mrrAudit?.status === "needs_reconciliation" ? <p>Earlier saved MRR totals did not reconcile to SNG and are excluded until verified. Daily SNG captures preserve verified MRR going forward.</p> : null}
    </div>
  </section>;
}
