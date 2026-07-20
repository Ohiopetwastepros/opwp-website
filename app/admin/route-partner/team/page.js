import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import SignOutButton from "../SignOutButton";
import TeamClient from "./TeamClient";
import styles from "./team.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Field Team | OPWP Operating System", robots: { index: false, follow: false, nocache: true } };

export default async function FieldTeamPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/route-partner/team/");
  return <main className={`opwp-admin-shell ${styles.page}`}>
    <header className={styles.topbar}><a href="/admin/route-partner/" className={styles.brand}><span>O</span><strong>OPWP</strong><small>Field operations</small></a><nav><a href="/admin/route-partner/">Route control</a><a className={styles.active} href="/admin/route-partner/team/">Field team</a><a href="/admin/dog-food/">Dog food</a><a href="/field/">Technician view</a></nav><div className={styles.identity}><span>{auth.email}</span><SignOutButton /></div></header>
    <section className={styles.workspace}><div className={styles.hero}><span>Management · Field access</span><h1>Put the right route in the right hands.</h1><p>Create individual technician access, match CRM employee IDs, and confirm every released route has an accountable owner.</p></div><TeamClient /></section>
  </main>;
}
