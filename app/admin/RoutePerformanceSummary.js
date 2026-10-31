import styles from "./dashboard.module.css";

const number = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const money = (value) => value === null ? "Pending" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

function Results({ rows, weekly = false, fromDate, throughDate }) {
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>{weekly ? "Week starting Monday" : "Service date"}</th>{!weekly ? <th>Technician</th> : null}<th>Visits</th><th>Allocated value</th><th>Clocked route hours</th><th>Value / hour</th><th>Shortfall to $100/hr</th><th>Coverage</th></tr></thead>
    <tbody>{rows.length ? rows.map((row) => <tr key={row.id || row.week}>
      <td>{row.date || row.week}{weekly && (row.week < fromDate || new Date(`${row.week}T12:00:00Z`).getTime() + 6 * 86400000 > new Date(`${throughDate}T12:00:00Z`).getTime()) ? <div className={styles.subtle}>Partial week within reporting dates</div> : null}</td>
      {!weekly ? <td>{row.name}</td> : null}<td>{row.jobs}</td><td>{money(row.revenue)}</td><td>{number(row.clockedHours)}</td><td>{money(row.revenuePerClockedHour)}</td><td>{money(row.gapToTarget)}</td>
      <td>{row.ready ? "Recorded value and hours present" : `${row.missingValues} missing values; ${row.missingShiftDays} days without hours; ${row.invalidShifts} invalid shifts`}</td>
    </tr>) : <tr><td colSpan={weekly ? 7 : 8}>No eligible records in this period.</td></tr>}</tbody>
  </table></div>;
}

export default function RoutePerformanceSummary({ summary }) {
  if (!summary) return null;
  return <section className={`${styles.panel} ${styles.section}`} id="daily-weekly-routes">
    <div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Daily and weekly route performance</h3><div className={styles.panelSub}>{summary.fromDate} through {summary.throughDate}; today is excluded while shifts are in progress.</div></div></div>
    <p className={styles.sectionNote}>{summary.policy} Revenue means allocated completed-service value, not cash collected. Weekly rates divide total included value by total included hours. These are productivity summaries; labor, vehicle, and other route costs are not yet allocated here.</p>
    <h4>Weekly totals</h4><Results rows={summary.weeks} weekly fromDate={summary.fromDate} throughDate={summary.throughDate} />
    <h4>Daily results by technician</h4><Results rows={summary.days} />
  </section>;
}
