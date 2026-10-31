import AdminWorkspace from "../AdminWorkspace";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getRoutePartnerDay } from "@/lib/route-partner";
import { validDispatchDate } from "@/lib/daily-route-optimizer.mjs";
import RoutePartnerClient from "./RoutePartnerClient";
import styles from "./route-partner.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Route Partner | OPWP Operating System", robots: { index: false, follow: false, nocache: true } };

function operatingDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function RoutePartnerPage({ searchParams }) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/route-partner/");
  const params = await searchParams;
  const date = validDispatchDate(params?.date) ? params.date : operatingDate();
  const db = getDb();
  let initialDay = null;
  try { initialDay = db ? await getRoutePartnerDay(db, date) : null; } catch { initialDay = null; }

  return (
    <AdminWorkspace section="dispatch" email={auth.email}><main className={`opwp-admin-shell ${styles.shell}`}>

      <div className={styles.workspace} data-admin-content>
        <header className={styles.header}>
          <div><div className={styles.eyebrow}>Routing &amp; CRM · Route Partner</div><h1>Daily dispatch</h1><p>Prepare and release daily scooping and dog-food work for the field team.</p></div>
          <div className={styles.identity}><span>Signed in as</span><strong>{auth.email}</strong></div>
        </header>
        <p><a href="/admin/route-partner/sync/">Review field closeouts and SNG upload blockers</a></p>
        <RoutePartnerClient initialDate={date} initialDay={initialDay} />
      </div>
    </main></AdminWorkspace>
  );
}
