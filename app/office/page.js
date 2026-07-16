import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyOfficeRequest } from "@/lib/field-auth";
import OnboardingRouteTool from "@/app/admin/routes/OnboardingRouteTool";
import OfficeSignOut from "./OfficeSignOut";
import styles from "./office.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Office Route Assignment | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function OfficePage() {
  const auth = await verifyOfficeRequest(await headers(), getDb());
  if (!auth.authorized) redirect("/office/login/");
  return <main className={`opwp-admin-shell ${styles.shell}`}><header className={styles.header}><a className={styles.brand} href="/office/"><span>O</span><div><strong>OPWP</strong><small>Office operations</small></div></a><div className={styles.identity}>Signed in as<strong>{auth.member.name}</strong><OfficeSignOut/></div></header><div className={styles.note}><strong>Office workflow:</strong> Enter the complete service address, confirm frequency, and use the recommended day when scheduling the recurring service in Sweep &amp; Go. No customer schedule is changed automatically from this screen.</div><OnboardingRouteTool endpoint="/api/office/route-assignment/" officeMode/></main>;
}
