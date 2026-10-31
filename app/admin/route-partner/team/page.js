import AdminWorkspace from "../../AdminWorkspace";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import TeamClient from "./TeamClient";
import styles from "./team.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Field Team | OPWP Operating System", robots: { index: false, follow: false, nocache: true } };

export default async function FieldTeamPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/route-partner/team/");
  return <AdminWorkspace section="team" email={auth.email}><main className={`opwp-admin-shell ${styles.page}`}>
    <section className={styles.workspace}><div className={styles.hero}><span>Management · Field access</span><h1>Field team &amp; access</h1><p>Create individual technician access, match CRM employee IDs, and confirm every released route has an accountable owner.</p></div><TeamClient /></section>
  </main></AdminWorkspace>;
}
