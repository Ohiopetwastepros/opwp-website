"use client";

import { useMemo, useState } from "react";
import styles from "./financials.module.css";

const PERIODS = [
  ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["yearly", "Yearly"],
];
const LIMITS = { daily: 14, weekly: 13, monthly: 12, quarterly: 8, yearly: 5 };
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);

export default function FinancialPeriodExplorer({ periods = {} }) {
  const [period, setPeriod] = useState("monthly");
  const rows = useMemo(() => (periods[period] || []).slice(-LIMITS[period]).reverse(), [periods, period]);
  return <section className={styles.periodPanel} aria-label="Financial performance by period">
    <div className={styles.periodTabs} role="tablist" aria-label="Choose financial period">
      {PERIODS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={period === key} className={period === key ? styles.periodActive : ""} onClick={() => setPeriod(key)}>{label}</button>)}
    </div>
    <div className={styles.tableScroll}><table className={styles.periodTable}>
      <thead><tr><th>Period</th><th>Revenue</th><th>Expenses</th><th>Net income</th><th>Margin</th></tr></thead>
      <tbody>{rows.length ? rows.map((row) => {
        const margin = row.revenue ? row.netIncome / row.revenue * 100 : 0;
        return <tr key={`${period}-${row.label}`}><td><strong>{row.label}</strong>{row.partial ? <span className={styles.partial}>Partial</span> : null}</td><td>{money(row.revenue)}</td><td>{money(row.expenses)}</td><td className={Number(row.netIncome) < 0 ? styles.cellNegative : styles.cellPositive}>{money(row.netIncome)}</td><td>{margin.toFixed(1)}%</td></tr>;
      }) : <tr><td colSpan="5">No {period} QuickBooks periods are available yet.</td></tr>}</tbody>
    </table></div>
  </section>;
}
