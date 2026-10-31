import AdminWorkspace from "../AdminWorkspace";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { listGrowthDesk } from "@/lib/growth-desk";
import LeadInboxClient from "./LeadInboxClient";
import { getRuntimeEnv } from "@/lib/cloudflare";
import styles from "./growth-desk.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function GrowthDeskPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/quote-funnel/");
  const desk = await listGrowthDesk(100);
  return <AdminWorkspace section="pipeline" email={auth.email}><main className="opwp-admin-shell">
      {desk.configured
        ? <LeadInboxClient initialLeads={desk.leads} initialAnswers={desk.answers} assistantSettings={desk.settings} initialHealth={desk.health} googleMapsKey={String(getRuntimeEnv().GOOGLE_MAPS_BROWSER_KEY||'')} />
        : <section className={styles.panel} style={{ marginTop: 24 }}><div className={styles.empty}>YardOps Pipeline storage is not configured in this environment.</div></section>}
  </main></AdminWorkspace>;
}
