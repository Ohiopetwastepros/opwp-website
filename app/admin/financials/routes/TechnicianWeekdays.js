"use client";

import { ROUTE_DAYS, routeDay, summarizeRouteProfit } from "@/lib/route-profitability-calculations.mjs";
import styles from "./profitability.module.css";

const money = value => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const number = value => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

export default function TechnicianWeekdays({ rows, profitabilityView, onSelect, reliefName }) {
  const names = [...new Set(rows.map(row => row.name))].sort();
  return <section className={styles.ledger} aria-label="Technician weekday breakdown">
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Historical route assignments</span><h2>Each technician, Monday–Friday</h2><p>Selected date range. Revenue belongs to the technician recorded on each visit. Select a name to inspect their route.</p></div></div>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Technician / weekday</th><th>Service days</th><th>Visits</th><th>Revenue</th><th>Revenue / day</th><th>Clocked hours</th><th>Revenue / hr</th>{profitabilityView ? <><th>Allocated costs</th><th>Est. profit</th><th>Profit / hr</th></> : null}</tr></thead>
      <tbody>{names.flatMap(name => ROUTE_DAYS.slice(0, 5).map(day => {
        const total = summarizeRouteProfit(rows.filter(row => row.name === name && routeDay(row.date) === day));
        return <tr key={`${name}|${day}`}><td><button className={styles.dayDetailButton} onClick={() => onSelect(name, day)}><strong>{name}</strong><small>{day}</small></button></td><td>{total.operatingDays}</td><td>{total.jobs}</td><td>{total.jobs ? money(total.revenue) : "—"}{total.missingValues ? <small>Partial: {total.missingValues} missing service values</small> : null}</td><td>{money(total.averageRevenue)}</td><td>{total.hours ? number(total.hours) : "—"}</td><td>{money(total.revenuePerHour)}{total.jobs && total.revenuePerHour == null ? <small>{name === reliefName ? "Owner hours excluded" : total.missingValues ? "Prices incomplete" : "Shift coverage incomplete"}</small> : null}</td>{profitabilityView ? <><td>{money(total.totalCost)}</td><td>{money(total.profit)}</td><td>{money(total.profitPerHour)}</td></> : null}</tr>;
      }))}{!names.length ? <tr><td colSpan={profitabilityView ? 10 : 7} className={styles.empty}>No technician records in this date range.</td></tr> : null}</tbody>
    </table></div><p className={styles.note}>These are route earnings, not employee wages. Operational costs are not included in this revenue view. Missing shifts or prices leave hourly results unavailable. Weekend visits remain in the main totals and ledger.</p>
  </section>;
}
