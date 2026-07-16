import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getRoutePartnerDay } from "@/lib/route-partner";
import RoutePartnerClient from "./RoutePartnerClient";
import SignOutButton from "./SignOutButton";
import styles from "./route-partner.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Route Partner | OPWP Operating System", robots: { index: false, follow: false, nocache: true } };

function operatingDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function RoutePartnerPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/route-partner/");
  const date = operatingDate();
  const db = getDb();
  let initialDay = null;
  try { initialDay = db ? await getRoutePartnerDay(db, date) : null; } catch { initialDay = null; }

  return (
    <main className={`opwp-admin-shell ${styles.shell}`}>
      <aside className={styles.rail}>
        <a className={styles.brand} href="/admin/"><span>O</span><div><strong>OPWP</strong><small>Operating system</small></div></a>
        <nav aria-label="Operations navigation">
          <a href="/admin/">Executive overview</a>
          <a href="/admin/routes/">Route intelligence</a>
          <a className={styles.active} href="/admin/route-partner/">Route Partner</a>
          <a href="/admin/route-partner/team/">Field team</a>
          <a href="/admin/?view=food">Extreme Dog Fuel</a>
          <a href="/admin/?view=systems">Systems &amp; controls</a>
        </nav>
        <div className={styles.railFoot}><span />Systems connected</div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.header}>
          <div><div className={styles.eyebrow}>OPWP · Route Partner</div><h1>Daily route control</h1><p>Bring scooping and dog-food work into one clear, field-ready route.</p></div>
          <div className={styles.identity}><span>Signed in as</span><strong>{auth.email}</strong><SignOutButton /></div>
        </header>
        <RoutePartnerClient initialDate={date} initialDay={initialDay} />
      </div>
    </main>
  );
}
