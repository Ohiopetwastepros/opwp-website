import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { verifyOfficeRequest } from "@/lib/field-auth";
import NewClientCallGuide from "./NewClientCallGuide";
import OfficeSignOut from "./OfficeSignOut";
import styles from "./office.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Office Route Assignment | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function OfficePage() {
  const auth = await verifyOfficeRequest(await headers(), getDb());
  if (!auth.authorized) redirect("/office/login/");
  const googleMapsKey = String(getRuntimeEnv().GOOGLE_MAPS_BROWSER_KEY || "").trim();
  return <main className={`opwp-admin-shell ${styles.shell}`}><header className={styles.header}><a className={styles.brand} href="/office/"><span>O</span><div><strong>OPWP</strong><small>Office operations</small></div></a><div className={styles.identity}>Signed in as<strong>{auth.member.name}</strong><OfficeSignOut/></div></header><NewClientCallGuide googleMapsKey={googleMapsKey}/></main>;
}
