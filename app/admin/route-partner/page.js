import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getRoutePartnerDay } from "@/lib/route-partner";
import RoutePartnerClient from "./RoutePartnerClient";
import styles from "./route-partner.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Route Partner | OPWP Operating System", robots: { index: false, follow: false, nocache: true } };

function operatingDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function RoutePartnerPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/");
  const date = operatingDate();
  const db = getDb();
  let initialDay = null;
  try { initialDay = db ? await getRoutePartnerDay(db, date) : null; } catch { initialDay = null; }

  return (
    <main className={styles.shell}>
      <aside className={styles.rail}>
        <a className={styles.brand} href="/admin/"><span>O</span><div><strong>OPWP</strong><small>Operating system</small></div></a>
        <nav aria-label="Operations navigation">
          <a href="/admin/">Executive overview</a>
          <a href="/admin/routes/">Route intelligence</a>
          <a className={styles.active} href="/admin/route-partner/">Route Partner</a>
          <a href="/admin/?view=food">Extreme Dog Fuel</a>
          <a href="/admin/?view=systems">Systems &amp; controls</a>
        </nav>
        <div className={styles.railFoot}><span />Standalone operations layer</div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.header}>
          <div><div className={styles.eyebrow}>OPWP · standalone route operations</div><h1>One route. Every service.</h1><p>Review Sweep &amp; Go work beside native dog-food deliveries, then release one clean field route without creating food subscriptions in the CRM.</p></div>
          <div className={styles.identity}>Management access<br/><strong>{auth.email}</strong></div>
        </header>
        <RoutePartnerClient initialDate={date} initialDay={initialDay} />
      </div>
    </main>
  );
}
