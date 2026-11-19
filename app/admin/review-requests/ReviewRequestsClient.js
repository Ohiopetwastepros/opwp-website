"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./review-requests.module.css";

const STATUSES = ["queued", "sending", "sent", "skipped", "failed"];

function timestamp(value) {
  if (!value) return "-";
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("en-US", { timeZone: "America/New_York" });
}

export default function ReviewRequestsClient() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [customerKey, setCustomerKey] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/review-requests/", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Review history is unavailable.");
      setData(result);
    } catch (failure) { setError(failure.message || "Review history is unavailable."); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function setContact(key, blocked) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/review-requests/", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ customerKey: key, blocked }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The preference could not be saved.");
      setData(result); setCustomerKey("");
      setMessage(blocked ? "Do not contact is set for review requests." : "Do not contact is cleared. Other eligibility and opt-out checks still apply.");
    } catch (failure) { setError(failure.message || "The preference could not be saved."); }
    finally { setBusy(false); }
  }

  const rows = data?.rows || [];
  const contacts = data?.contacts || [];
  const blocked = new Set(contacts.filter(contact => Number(contact.do_not_contact) === 1 || contact.do_not_contact === true).map(contact => contact.customer_key));
  const shown = status === "all" ? rows : rows.filter(row => row.status === status);

  return <div className={styles.content}>
    <section className={styles.notice}>
      <strong>Review requests: {data ? (data.enabled ? "ENABLED" : "DISABLED") : "Loading status..."}</strong>
      <p>{data?.enabled ? "Eligible requests may send between 9:00 AM and 8:00 PM America/New_York." : "Review texts and emails are disabled. Public technician pages remain available."}</p>
      <p>First enabled: {data?.enabledAt ? timestamp(data.enabledAt) : "Not recorded"}. Earlier completed jobs are excluded from automatic sending.</p>
    </section>
    <div className={styles.toolbar}>
      <label>Status <select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All ({rows.length})</option>{STATUSES.map(value => <option key={value} value={value}>{value} ({rows.filter(row => row.status === value).length})</option>)}</select></label>
      <button type="button" onClick={refresh} disabled={busy}>Refresh</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    <section className={styles.panel}>
      <h2>Delivery ledger</h2>
      <p>Times are America/New_York. Showing the latest {rows.length} delivery rows. Each channel has its own audit row.</p>
      {shown.length ? <div className={styles.tableWrap}><table><thead><tr><th>Customer</th><th>Job date / technician</th><th>Channel</th><th>Status / reason</th><th>Queued / sent</th><th>Review contact preference</th></tr></thead><tbody>{shown.map(row => <tr key={row.id}>
        <td><strong>{row.customer_name || "Unknown customer"}</strong><small>{row.customer_key}</small>{row.phone_last4 && <small>Phone ending {row.phone_last4}</small>}</td>
        <td>{row.job_date || "-"}<small>{row.tech || "Team"}</small></td>
        <td>{row.channel || "-"}</td>
        <td><strong>{row.status}</strong><small>{row.reason || "-"}</small></td>
        <td>{timestamp(row.created_at)}<small>Sent: {timestamp(row.sent_at)}</small></td>
        <td><button type="button" disabled={busy || !row.customer_key} onClick={() => setContact(row.customer_key, !blocked.has(row.customer_key))}>{blocked.has(row.customer_key) ? "Clear do not contact" : "Set do not contact"}</button></td>
      </tr>)}</tbody></table></div> : <p>{data ? "No matching review-request rows." : "Loading delivery history..."}</p>}
    </section>
    <section className={styles.panel}>
      <h2>Manual do not contact</h2>
      <p>This flag prevents review requests through both SMS and email. Clearing it never overrides STOP, unsubscribe, marketing permission, or an earlier request.</p>
      <form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setContact(customerKey.trim(), true); }}>
        <label>Customer key <input value={customerKey} onChange={event => setCustomerKey(event.target.value)} pattern="[A-Za-z0-9:_-]{1,180}" maxLength={180} required placeholder="Customer key from the delivery ledger" /></label>
        <button disabled={busy} type="submit">Set do not contact</button>
      </form>
      {contacts.filter(contact => blocked.has(contact.customer_key)).length ? <ul>{contacts.filter(contact => blocked.has(contact.customer_key)).map(contact => <li key={contact.customer_key}><span>{contact.customer_name || contact.customer_key}</span> <button type="button" disabled={busy} onClick={() => setContact(contact.customer_key, false)}>Clear do not contact</button></li>)}</ul> : <p>No manual review-request blocks recorded.</p>}
    </section>
  </div>;
}
