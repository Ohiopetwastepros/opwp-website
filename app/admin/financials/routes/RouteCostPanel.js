"use client";

import { useState } from "react";
import styles from "./profitability.module.css";
import { COST_GROUPS } from "@/lib/quickbooks-route-cost-calculations.mjs";

const money = (value) => value === null || value === undefined ? "Pending" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export default function RouteCostPanel({ initialData, onUpdate, revenueOnly = false }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState("");
  const costs = data?.costs;
  const selected = costs?.months?.find((row) => row.month === month) || costs?.months?.at(-1);
  async function refresh() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/route-profitability/", { method: "POST", cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The connection could not be refreshed.");
      setData(result); onUpdate?.(result);
      setMessage(result.warnings?.length ? result.warnings.join(" ") : "Route history and QuickBooks costs are up to date.");
    } catch (error) { setMessage(error.message || "The connection could not be refreshed."); }
    finally { setBusy(false); }
  }
  if (revenueOnly) return <section className={styles.costPanel} aria-label="Route data freshness"><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Connected service records</span><h2>Route data</h2><p>All serviced accounts included. Craig&apos;s hours excluded.</p></div><button className={styles.primaryButton} disabled={busy} onClick={refresh}>{busy ? "Refreshing records…" : "Refresh route data"}</button></div>{data?.history?.capturedAt ? <p className={styles.note}>Last captured: {new Date(data.history.capturedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}</p> : null}{message ? <p className={styles.notice} role="status">{message}</p> : null}</section>;
  return <section className={styles.costPanel} id="route-costs">
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Connected financials</span><h2>Allocated route costs</h2><p>QuickBooks company expenses allocated to completed service visits.</p></div><button className={styles.primaryButton} disabled={busy} onClick={refresh}>{busy ? "Syncing history & costs…" : "Sync QuickBooks & route history"}</button></div>
    <div className={styles.sourceGrid}>
      <div><span>Expense source</span><strong>{costs ? "QuickBooks · accrual" : "Awaiting first sync"}</strong><small>{costs ? `${costs.companyName} · ${costs.environment}` : "Connect QuickBooks in Financials, then sync."}</small></div>
      <div><span>Route measurement</span><strong>Historical technician routes</strong><small>Craig&apos;s revenue included; Craig&apos;s time excluded</small></div>
      <div><span>Attribution</span><strong>Allocated estimate</strong><small>All company expenses spread across completed visits.</small></div>
    </div>
    <p className={styles.note}>QuickBooks supplies booked payroll, benefits, vehicle costs, supplies, and other expenses. Employee pay rates and technician-specific payroll are not provided by this P&amp;L feed. Profit is an allocation estimate, not payroll-verified route profit. Costs follow their booked month, including overtime and payroll costs already posted; no additional wage model is added.</p>
    {costs ? <p className={styles.note}>Cost sync: {new Date(costs.capturedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} · reports through {costs.throughDate}. {Date.now() - Date.parse(costs.capturedAt) > 24 * 3600000 ? "Cost data is over 24 hours old; refresh before making decisions." : ""}</p> : null}
    {costs && costs.booksStatus !== "verified" ? <p className={styles.notice}>The financial ledger is marked {costs.booksStatus || "provisional"}. Route profit inherits that status until the books are reconciled.</p> : null}
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    {selected ? <details className={styles.details}><summary>Inspect expense accounts and reconciliation</summary>
      <label className={styles.monthLabel}>Cost month<select value={selected.month} onChange={(event) => setMonth(event.target.value)}>{costs.months.map((row) => <option key={row.month} value={row.month}>{row.month}</option>)}</select></label>
      <div className={styles.costGrid}>{COST_GROUPS.map((group) => <div key={group}><span>{group}</span><strong>{money(selected.groups[group])}</strong></div>)}</div>
      <p className={styles.note}>Company income: {money(selected.income)} · company expenses: {money(selected.totalCosts)} · {selected.reconciled ? "Account detail reconciles to expense totals." : `Reconciliation required: ${money(selected.difference)} difference. Route profit is withheld.`} Account categories are inferred from names; their combined total includes all expense accounts.</p>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>QuickBooks account</th><th>Cost category</th><th>Booked cost</th></tr></thead><tbody>{selected.accounts.map((account, index) => <tr key={`${account.id}-${index}`}><td>{account.name}</td><td>{account.group}</td><td>{money(account.amount)}</td></tr>)}</tbody></table></div>
    </details> : null}
  </section>;
}
