import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { listGrowthDesk } from "@/lib/growth-desk";
import GrowthDeskClient from "./GrowthDeskClient";
import styles from "./growth-desk.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "YardOps Pipeline | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function GrowthDeskPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/quote-funnel/");
  const desk = await listGrowthDesk(300);
  return <main className={`${styles.workspace} opwp-admin-shell`}>
    <div className={styles.wrap}>
      <nav className={styles.topLinks}><Link href="/admin/">← Executive cockpit</Link><Link href="/admin/system-health/">System health →</Link></nav>
      <header className={styles.header}>
        <div><div className={styles.eyebrow}>OPWP lead operations</div><h1 className={styles.title}>YardOps Pipeline</h1><p className={styles.subtitle}>Turn website interest into clean yards and recurring routes, with every quote, follow-up, next action, note, and Sweep &amp; Go result in one private OPWP workspace.</p></div>
        <aside className={styles.safety}><strong>Quote-safe by design.</strong><br />Office stages and notes are stored separately. This screen cannot change public pricing, customer consent, the ten-minute recovery schedule, or the onboarding payload.</aside>
      </header>
      {desk.configured
        ? <GrowthDeskClient initialLeads={desk.leads} currentAdmin={auth.email} />
        : <section className={styles.panel} style={{ marginTop: 24 }}><div className={styles.empty}>YardOps Pipeline storage is not configured in this environment.</div></section>}
    </div>
  </main>;
}
