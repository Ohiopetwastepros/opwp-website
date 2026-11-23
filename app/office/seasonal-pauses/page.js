import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyOfficeRequest } from "@/lib/field-auth";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getSeasonalPauseReport, SEASONAL_PATTERN_LABELS } from "@/lib/seasonal-pause-report.mjs";
import styles from "./seasonal-pauses.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seasonal pauses | OPWP Office", robots: { index: false, follow: false, nocache: true } };

const display = value => value || "Not set";
const actionLabel = action => ({ re_pause: "Re-pause", follow_up: "Restart follow-up", scheduled_pause: "Scheduled pause begins" })[action];

export default async function SeasonalPausesPage() {
  const requestHeaders = await headers();
  const db = getDb();
  const office = await verifyOfficeRequest(requestHeaders, db);
  const officeAuthorized = office.authorized && office.member?.organizationId === "org-opwp";
  const auth = officeAuthorized ? office : await verifyAdminRequest(requestHeaders);
  if (!auth.authorized) redirect("/office/login/?next=%2Foffice%2Fseasonal-pauses%2F");
  let report = null;
  try { report = await getSeasonalPauseReport(db); } catch { /* Keep storage errors private. */ }

  return <main className={`opwp-admin-shell ${styles.shell}`}>
    <header className={styles.header}>
      <div><a href={officeAuthorized ? "/office/" : "/admin/"}>Back to {officeAuthorized ? "office" : "admin"}</a><h1>Seasonal pauses</h1><p>Pause history and upcoming restart work.</p></div>
      <a href="/api/office/seasonal-pauses/">View JSON report</a>
    </header>
    {!report ? <section className={styles.card}><h2>Report unavailable</h2><p>Seasonal pause records are not available yet. Try again after the approved setup is complete.</p></section> : <>
      <p className={styles.note}>As of {report.businessDate} · America/New_York. {report.totals.currentPausers} current pausers · {report.totals.documentedPeriods} documented periods. Unknown patterns need an explicit reason; pause dates alone do not establish a season.</p>
      <section className={styles.card}><h2>Clients by seasonal pattern</h2><p>All {report.totals.trackedClients} clients with captured pause history.</p><dl className={styles.counts}>{Object.entries(report.countsByPattern).map(([pattern, count]) => <div key={pattern}><dt>{SEASONAL_PATTERN_LABELS[pattern]}</dt><dd>{count}</dd></div>)}</dl></section>
      <section className={styles.card}><h2>Current pausers</h2>{!report.currentPausers.length ? <p>No current pausers are recorded.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Client</th><th>Pattern</th><th>Pause start</th><th>Planned restart</th><th>Next action</th><th>Reason</th></tr></thead><tbody>{report.currentPausers.map(client => <tr key={client.sngClientId}><th scope="row">{client.name}</th><td>{client.patternLabel}</td><td>{display(client.pauseStartDate)}</td><td>{display(client.plannedRestartDate)}</td><td>{display(client.nextActionDate)}</td><td>{display(client.reason)}</td></tr>)}</tbody></table></div>}</section>
      <div className={styles.columns}>
        <section className={styles.card}><h2>Next 90 days: actions</h2>{!report.upcomingActions.length ? <p>No actions are dated in this window.</p> : <ul className={styles.agenda}>{report.upcomingActions.map((client, index) => <li key={`${client.sngClientId}-${client.action}-${index}`}><time>{client.date}</time><div><strong>{client.name}</strong><span>{actionLabel(client.action)}</span></div></li>)}</ul>}</section>
        <section className={styles.card}><h2>Next 90 days: planned restarts</h2>{!report.upcomingRestarts.length ? <p>No restarts are dated in this window.</p> : <ul className={styles.agenda}>{report.upcomingRestarts.map(client => <li key={client.sngClientId}><time>{client.date}</time><div><strong>{client.name}</strong><span>{client.patternLabel}</span></div></li>)}</ul>}</section>
      </div>
      <section className={styles.card}><h2>Pause starts and planned restarts</h2><p>Each documented period is counted once. Restarts are planned dates, not confirmation that service resumed.</p><div className={styles.columns}>
        <div className={styles.tableWrap}><table><caption>By month</caption><thead><tr><th>Month</th><th>Pause starts</th><th>Planned restarts</th></tr></thead><tbody>{report.monthlyCounts.map(row => <tr key={row.month}><th scope="row">{row.month}</th><td>{row.pauseStarts}</td><td>{row.plannedRestarts}</td></tr>)}</tbody></table></div>
        <div className={styles.tableWrap}><table><caption>By season</caption><thead><tr><th>Year</th><th>Season</th><th>Pause starts</th><th>Planned restarts</th></tr></thead><tbody>{report.seasonCounts.map(row => <tr key={`${row.year}-${row.season}`}><th scope="row">{row.year}</th><td>{row.season}</td><td>{row.pauseStarts}</td><td>{row.plannedRestarts}</td></tr>)}</tbody></table></div>
      </div></section>
      <section className={styles.card}><h2>Airtable sync</h2><p>{report.airtableSync.synced} synced · {report.airtableSync.pending} pending · {report.airtableSync.failed} failed · {report.airtableSync.unmatched} unmatched.</p><p>Latest sync: {display(report.airtableSync.latestSyncedAt)}. Oldest waiting update: {display(report.airtableSync.oldestPendingAt)}.</p></section>
    </>}
  </main>;
}
