"use client";

import { useState } from "react";
import { ROUTE_DAYS, routeDay, summarizeRouteProfit, selectRouteWindow } from "@/lib/route-profitability-calculations.mjs";
import { technicianStatus } from "@/lib/route-technicians.mjs";
import styles from "./profitability.module.css";

const metrics = { averageRevenue: "Revenue / service day", revenue: "Total route revenue", revenuePerHour: "Revenue / clocked hour" };
const money = value => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

export default function TechnicianComparison({ rows, roster, from, through }) {
  const names = [...new Set(rows.filter(row => row.jobs > 0).map(row => row.name))].sort();
  const [chosen, setChosen] = useState([]);
  const [range, setRange] = useState("selected");
  const [metric, setMetric] = useState("averageRevenue");
  const selected = chosen.filter(name => names.includes(name));
  const source = range === "selected" ? selectRouteWindow(rows, from, through) : rows;
  const groups = selected.map(name => ({ name, rows: source.filter(row => row.name === name) }));
  return <section className={styles.ledger} aria-label="Compare technicians">
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Side-by-side</span><h2>Compare technicians</h2><p>Choose up to four technicians. Average per service day accounts for different numbers of working days.</p></div></div>
    <div className={styles.filterRow}>{names.map(name => <label key={name}><input type="checkbox" checked={selected.includes(name)} disabled={!selected.includes(name) && selected.length >= 4} onChange={event => setChosen(event.target.checked ? [...selected, name] : selected.filter(value => value !== name))} />{name} ({technicianStatus(name, roster)})</label>)}</div>
    <div className={styles.filterRow}><label>Comparison period<select value={range} onChange={event => setRange(event.target.value)}><option value="selected">Selected reporting dates</option><option value="history">Each technician’s available history</option></select></label><label>Comparison metric<select value={metric} onChange={event => setMetric(event.target.value)}>{Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {groups.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{metrics[metric]}</th>{groups.map(group => <th key={group.name}>{group.name}<small>({technicianStatus(group.name, roster)})</small><small>{group.rows.length ? `${group.rows.map(row => row.date).sort()[0]} – ${group.rows.map(row => row.date).sort().at(-1)}` : "No records in selected dates"}</small></th>)}</tr></thead><tbody>{[...ROUTE_DAYS.slice(0, 5), "All days"].map(day => <tr key={day}><th>{day}</th>{groups.map(group => {
      const total = summarizeRouteProfit(group.rows.filter(row => day === "All days" || routeDay(row.date) === day));
      return <td key={group.name}><strong>{total.routeDays ? money(total[metric]) : "—"}</strong><small>{total.operatingDays} days · {total.jobs} visits · {total.hours.toFixed(1)} recorded hours</small>{total.missingValues ? <small>{total.missingValues} missing service values; revenue partial</small> : total.routeDays && total[metric] == null ? <small>Required hours unavailable</small> : null}</td>;
    })}</tr>)}</tbody></table></div> : <p className={styles.note}>Select technicians above to compare their Monday–Friday results.</p>}
    <p className={styles.note}>Status is the current staff status, not their status on the service date.{roster?.capturedAt ? ` Verified in Sweep & Go on ${String(roster.capturedAt).slice(0, 10)}.` : " Staff status has not been verified."} Available-history comparisons may cover different dates; the dates and sample sizes are shown for each person. Revenue is recorded service value before operational costs.</p>
  </section>;
}
