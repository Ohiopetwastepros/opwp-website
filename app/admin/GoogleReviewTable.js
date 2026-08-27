"use client";

import { useMemo, useState } from "react";
import styles from "./dashboard.module.css";

const TYPE_OPTIONS = ["Recurring", "One-time", "Unmatched review"];
const STATUS_OPTIONS = ["Active", "Paused", "Inactive", "Dropped", "Past", "Unknown", "Needs matching"];
const REVIEW_OPTIONS = ["Reviewed", "Not reviewed"];

function Metric({ label, value }) {
  return <div className={styles.miniMetric}><div className={styles.miniLabel}>{label}</div><div className={styles.miniValue}>{new Intl.NumberFormat("en-US").format(value)}</div></div>;
}

function AliasEditor({ row, saving, onSave }) {
  const [value, setValue] = useState(row.reviewAliases || "");
  const changed = value.trim() !== String(row.reviewAliases || "").trim();
  return <div className={styles.reviewAliasCell}>
    <input value={value} onChange={(event) => setValue(event.target.value)} maxLength="500" placeholder="Google reviewer name" aria-label={`Google review aliases for ${row.customer}`} />
    <button type="button" disabled={!changed || saving} onClick={() => onSave(row, value)}>{saving ? "Saving..." : "Save"}</button>
  </div>;
}

export default function GoogleReviewTable({ initialRows = [] }) {
  const [rows, setRows] = useState(initialRows);
  const [clientSearch, setClientSearch] = useState("");
  const [clientTypeFilter, setClientTypeFilter] = useState("");
  const [customerStatusFilter, setCustomerStatusFilter] = useState("");
  const [reviewStatusFilter, setReviewStatusFilter] = useState("");
  const [savingReview, setSavingReview] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const metrics = useMemo(() => {
    const clients = rows.filter((row) => row.clientType !== "Unmatched review");
    return {
      clients: clients.length,
      reviewed: clients.filter((row) => row.reviewStatus === "Reviewed").length,
      missing: clients.filter((row) => row.reviewStatus === "Not reviewed").length,
      recent: rows.filter((row) => row.priority === "Highlight - recent one-time").length,
    };
  }, [rows]);
  const filteredRows = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesClient = !query || row.customer.toLocaleLowerCase().includes(query);
      const matchesType = !clientTypeFilter || row.clientType === clientTypeFilter;
      const matchesStatus = !customerStatusFilter || row.customerStatus === customerStatusFilter;
      const matchesReview = !reviewStatusFilter || row.reviewStatus === reviewStatusFilter;
      return matchesClient && matchesType && matchesStatus && matchesReview;
    });
  }, [rows, clientSearch, clientTypeFilter, customerStatusFilter, reviewStatusFilter]);

  async function saveReviewField(row, field, value) {
    setSavingReview(`${row.id}:${field}`);
    setSaveMessage("");
    setSaveError("");
    try {
      const response = await fetch("/api/admin/google-reviews/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: row.id, field, value }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The review status could not be saved.");
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, ...data.record } : item));
      setSaveMessage(field === "reviewAliases" ? `${row.customer}'s Google review aliases were saved to Airtable.` : `${row.customer} was marked reviewed and saved to Airtable.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The review status could not be saved.");
    } finally {
      setSavingReview("");
    }
  }

  async function markReviewed(row) {
    await saveReviewField(row, "reviewStatus", "Reviewed");
  }

  function confirmReviewed(row) {
    const confirmed = window.confirm(`Are you sure you want to mark ${row.customer} as reviewed? This will save the change to Airtable.`);
    if (confirmed) void markReviewed(row);
  }

  return <>
    <div className={styles.miniGrid}><Metric label="Clients tracked" value={metrics.clients} /><Metric label="Reviewed" value={metrics.reviewed} /><Metric label="Not reviewed" value={metrics.missing} /><Metric label="Recent one-time follow-up" value={metrics.recent} /></div>
    <div className={styles.reviewTableStatus}>
      <div className={styles.reviewSaveMessage} aria-live="polite">{saveError ? <span className={styles.reviewSaveError}>{saveError}</span> : saveMessage}</div>
      <div className={styles.resultCount} aria-live="polite">Showing {filteredRows.length} of {rows.length} records</div>
    </div>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr>
      <th><label className={styles.tableFilter}><span>Client</span><input className={styles.tableFilterInput} type="search" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search client..." aria-label="Search clients by name" /></label></th>
      <th><label className={styles.tableFilter}><span>Client type</span><select className={styles.tableFilterSelect} value={clientTypeFilter} onChange={(event) => setClientTypeFilter(event.target.value)} aria-label="Filter by client type"><option value="">All client types</option>{TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></th>
      <th><label className={styles.tableFilter}><span>Customer status</span><select className={styles.tableFilterSelect} value={customerStatusFilter} onChange={(event) => setCustomerStatusFilter(event.target.value)} aria-label="Filter by customer status"><option value="">All statuses</option>{STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></th>
      <th><label className={styles.tableFilter}><span>Google review</span><select className={styles.tableFilterSelect} value={reviewStatusFilter} onChange={(event) => setReviewStatusFilter(event.target.value)} aria-label="Filter by Google review status"><option value="">All review statuses</option>{REVIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></th>
      <th>Review name</th><th>Google aliases</th><th>Last completed</th><th>Jobs</th><th>Follow-up</th>
    </tr></thead><tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id}><td>{row.customer}</td><td>{row.clientType || "\u2014"}</td><td>{row.customerStatus || "\u2014"}</td><td><div className={styles.reviewStatusCell}><span>{row.reviewStatus || "\u2014"}</span>{row.reviewStatus !== "Reviewed" ? <button className={styles.markReviewedButton} type="button" disabled={savingReview === `${row.id}:reviewStatus`} onClick={() => confirmReviewed(row)}>{savingReview === `${row.id}:reviewStatus` ? "Saving..." : "Mark reviewed"}</button> : null}</div></td><td>{row.reviewName || "\u2014"}</td><td><AliasEditor row={row} saving={savingReview === `${row.id}:reviewAliases`} onSave={(item, aliases) => saveReviewField(item, "reviewAliases", aliases)} /></td><td>{row.lastCompleted || "\u2014"}</td><td>{row.completedJobs}</td><td><span className={`${styles.badge} ${row.priority === "Highlight - recent one-time" ? styles.warn : ""}`}>{row.priority || "\u2014"}</span></td></tr>) : <tr><td className={styles.empty} colSpan="9">{rows.length ? "No clients match the selected filters." : "No review-tracking records are available."}</td></tr>}</tbody></table></div>
  </>;
}
