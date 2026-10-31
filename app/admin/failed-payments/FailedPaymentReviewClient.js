"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from 'next/navigation';
import styles from "./failed-payments.module.css";
import { PAYMENT_VIEWS, paymentInView } from '@/lib/failed-payment-views.mjs';

function money(value) {
  const amount = Number(String(value ?? "0").replace(/[$,]/g, ""));
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount) : "—";
}

function phone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
    : value || "—";
}

function statusLabel(value) {
  return { awaiting_approval: "Awaiting approval", payment_recorded: "Outreach stopped", sent: "Sent", failed: "Needs attention", cancelled: "Dismissed", sending: "Sending", held: "Confirmation required", skipped: "No longer eligible" }[value] || value;
}

export default function FailedPaymentReviewClient({ initialRows = [] }) {
  const router=useRouter();
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState('active');
  const visibleRows = useMemo(() => rows.filter(row => paymentInView(row, view)), [rows, view]);
  function changeView(next) { setView(next); setSelected([]); setNotice(''); setError(''); }
  useEffect(()=>{setRows(initialRows);setSelected(current=>current.filter(id=>initialRows.some(r=>r.id===id&&r.status==='awaiting_approval')));},[initialRows]);
  useEffect(()=>{const timer=setInterval(()=>{if(!busy && document.visibilityState==='visible')router.refresh();},60000);return()=>clearInterval(timer);},[busy,router]);
  const pending = useMemo(() => visibleRows.filter((row) => row.status === "awaiting_approval" && paymentInView(row, 'active')), [visibleRows]);
  const allPendingSelected = pending.length > 0 && pending.every((row) => selected.includes(row.id));

  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(0, 25));
  }

  function toggleAll() {
    setSelected(allPendingSelected ? [] : pending.slice(0, 25).map((row) => row.id));
  }

  async function act(action) {
    if ((action!=='refresh' && !selected.length) || busy) return;
    const verb = action === "send" ? "send a separate Quo text to" : "dismiss";
    if (action!=='refresh' && !window.confirm(`Confirm you want to ${verb} ${selected.length} selected customer${selected.length === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/failed-payments/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selected }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The bulk action failed.");
      if(action==='refresh') { setNotice(`Rechecked payment evidence. ${data.recovery?.held||0} checks require attention. No messages sent.`); }
      else if (action === "dismiss") {
        setRows((current) => current.map((row) => selected.includes(row.id) ? { ...row, status: "cancelled" } : row));
        setNotice(`${data.dismissed} message${data.dismissed === 1 ? " was" : "s were"} dismissed.`);
      } else {
        const byId = new Map(data.results.map((result) => [result.id, result.status]));
        setRows((current) => current.map((row) => byId.has(row.id) ? { ...row, status: byId.get(row.id) } : row));
        setNotice(`${data.sent} individual Quo message${data.sent === 1 ? " was" : "s were"} sent.${data.failed ? ` ${data.failed} failed and need review.` : ""}${data.skipped ? ` ${data.skipped} became ineligible; check payment/status and refresh.` : ""}`);
      }
      setSelected([]);
      if(data.rows) setRows(data.rows);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The bulk action failed.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className={styles.metrics} aria-label="Payment views">
      {['awaiting_approval', 'sent', 'attention', 'resolved'].map(key => <button key={key} type="button" disabled={busy} aria-pressed={view === key} aria-controls="payment-results" onClick={() => changeView(key)}>
        <span>{PAYMENT_VIEWS[key]}</span><strong>{rows.filter(row => paymentInView(row, key)).length}</strong>
      </button>)}
    </section>
    <section className={styles.panel} id="payment-results" aria-label={PAYMENT_VIEWS[view]}>
    <div className={styles.viewHeader}>
      <div><h2>{PAYMENT_VIEWS[view]}</h2><p>{visibleRows.length} records{view === 'active' ? ' · Paid, resolved, and dismissed records are excluded.' : ' · Showing the selected category.'}</p></div>
      <button type="button" className={styles.secondary} disabled={busy} aria-pressed={view === 'active'} onClick={() => changeView('active')}>Active failed payments</button>
    </div>
    <div className={styles.toolbar}>
      <div><strong>{selected.length} selected</strong><span>Select up to 25. Each customer receives an individual message.</span></div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={busy} onClick={()=>act('refresh')}>Recheck payments</button>
        <button type="button" className={styles.secondary} disabled={!selected.length || busy} onClick={() => act("dismiss")}>Dismiss selected</button>
        <button type="button" className={styles.primary} disabled={!selected.length || busy} onClick={() => act("send")}>{busy ? "Processing…" : "Send selected in Quo"}</button>
      </div>
    </div>
    <div className={styles.feedback} aria-live="polite">{error ? <span className={styles.error}>{error}</span> : notice}</div>
    <div className={styles.tableWrap}><table>
      <thead><tr><th><input type="checkbox" disabled={busy || !pending.length} checked={allPendingSelected} onChange={toggleAll} aria-label="Select pending messages in this view" /></th><th>Customer</th><th>Amount</th><th>Failure</th><th>Phone</th><th>Message preview</th><th>Status</th></tr></thead>
      <tbody>{visibleRows.length ? visibleRows.map((row) => {
        const selectable = row.status === "awaiting_approval" && paymentInView(row, 'active');
        return <tr key={row.id}>
          <td><input type="checkbox" disabled={!selectable || busy} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.client_name || "customer"}`} /></td>
          <td><strong>{row.client_name || "Unknown customer"}</strong><small>Invoice {row.invoice_id}</small></td>
          <td>{money(row.amount)}</td>
          <td><span>{row.decline_message || row.decline_code || "Card declined"}</span>{row.failed_charge_count ? <small>{row.failed_charge_count} failed attempt{Number(row.failed_charge_count) === 1 ? "" : "s"}</small> : null}</td>
          <td>{phone(row.recipient)}</td>
          <td><details><summary>Review exact text</summary><p>{row.preview}</p></details></td>
          <td><span className={`${styles.status} ${styles[row.status] || ""}`}>{statusLabel(row.status)}</span><small>Billing: {row.payment_state||'Confirmation pending'} · SMS: {statusLabel(row.sms_status||row.status)}</small><small>{row.evidence}</small><small>Airtable: {row.sync_error|| (row.airtable_confirmed_at?`confirmed ${row.airtable_confirmed_at}`:'sync pending')}</small>{row.error_message ? <small>{row.error_message}</small> : null}</td>
        </tr>;
      }) : <tr><td colSpan="7" className={styles.empty}>No records in {PAYMENT_VIEWS[view].toLowerCase()}.</td></tr>}</tbody>
    </table></div>
  </section></>;
}
