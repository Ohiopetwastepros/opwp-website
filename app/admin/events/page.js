import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { listSngEvents } from "@/lib/db";
import styles from "../dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Event Ledger | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function EventLedgerPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/");
  const events = await listSngEvents(500);
  const counts = events.rows.reduce((map, event) => ({ ...map, [event.status]: (map[event.status] || 0) + 1 }), {});
  return <main className={`${styles.shell} opwp-admin-shell`}><aside className={styles.rail}>
    <div className={styles.railBrand}><span className={styles.mark}>O</span><div><strong>OPWP</strong><small>Operating Group</small></div></div>
    <nav className={styles.nav}><a href="/admin/"><span>01</span>Executive overview</a><a className={styles.active} href="/admin/events/"><span>02</span>D1 event ledger</a><a href="/admin/financials/"><span>03</span>Financial performance</a></nav>
  </aside><div className={styles.workspace}><div className={styles.wrap}>
    <header className={styles.topbar}><div><div className={styles.eyebrow}>Systems &amp; controls</div><h1 className={styles.title}>D1 event ledger</h1><div className={styles.subtle}>Every Sweep &amp; Go event received by the backend, with processing lineage.</div></div><div className={styles.asof}>{events.rows.length} retained events</div></header>
    <section className={styles.scoreGrid}><div className={styles.scoreCard}><div className={styles.scoreLabel}>Processed</div><div className={styles.scoreValue}>{counts.processed || 0}</div></div><div className={styles.scoreCard}><div className={styles.scoreLabel}>Archived</div><div className={styles.scoreValue}>{counts.archived || 0}</div></div><div className={styles.scoreCard}><div className={styles.scoreLabel}>Needs attention</div><div className={styles.scoreValue}>{counts.needs_attention || 0}</div></div><div className={styles.scoreCard}><div className={styles.scoreLabel}>Pending</div><div className={styles.scoreValue}>{counts.received || 0}</div></div></section>
    <div className={styles.panel}><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Received</th><th>Event</th><th>External ID</th><th>Entity</th><th>Status</th><th>Processed</th><th>Diagnostic</th></tr></thead><tbody>{events.rows.map((event)=><tr key={event.id}><td>{event.received_at}</td><td>{event.event_type}</td><td>{event.external_id || "—"}</td><td>{event.customer_name || "—"}</td><td><span className={`${styles.badge} ${event.status === "needs_attention" ? styles.bad : event.status === "received" ? styles.warn : ""}`}>{event.status}</span></td><td>{event.processed_at || "—"}</td><td>{event.processing_error || "—"}</td></tr>)}</tbody></table></div></div>
  </div></div></main>;
}
