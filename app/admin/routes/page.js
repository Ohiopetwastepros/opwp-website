import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getActiveSubscriptionRouteSummary } from "@/lib/route-intelligence";
import RouteAnalysisClient from "./RouteAnalysisClient";
import OnboardingRouteTool from "./OnboardingRouteTool";
import styles from "./routes.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Route Intelligence | OPWP Executive Cockpit", robots: { index: false, follow: false, nocache: true } };

export default async function RoutesPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/");
  const db = getDb();
  let source = null;
  try { source = db ? await getActiveSubscriptionRouteSummary(db) : null; } catch { source = null; }

  return (
    <main className={`${styles.shell} opwp-admin-shell`}>
      <aside className={styles.rail}>
        <a className={styles.brand} href="/admin/"><span>O</span><div><strong>OPWP</strong><small>Operating Group</small></div></a>
        <nav aria-label="Route navigation">
          <a href="/admin/">Executive overview</a>
          <a href="/admin/?view=operations">Route operations</a>
          <a className={styles.active} href="/admin/routes/">Route intelligence</a>
          <a href="/admin/route-partner/">Route Partner</a>
          <a href="/admin/?view=food">Extreme Dog Fuel</a>
          <a href="/admin/?view=systems">Systems &amp; controls</a>
        </nav>
        <div className={styles.railFoot}><span />Protected executive access</div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.header}>
          <div><div className={styles.eyebrow}>Active subscriptions + road-time planning</div><h1>Route intelligence</h1><p>Protect fixed service commitments, increase route density, and expose the shortest practical path from one paid stop to the next.</p></div>
          <div className={styles.identity}>Signed in as<br/><strong>{auth.email}</strong></div>
        </header>
        {!source ? <div className={styles.error}>The protected active-subscription snapshot is not available. The hourly data refresh will retry automatically.</div> : (
          <>
            <section className={styles.guardrails}>
              <div className={styles.guardrailHead}><div><div className={styles.eyebrow}>Planning guardrails</div><h2>What the optimizer is not allowed to break</h2></div><p>Route recommendations must improve balance without disrupting established customer commitments.</p></div>
              <div className={styles.guardrailGrid}>
                <div><span>01</span><strong>Twice-weekly days stay fixed</strong><p>Existing twice-weekly service-day pairs are hard constraints.</p></div>
                <div><span>02</span><strong>Route areas stay established</strong><p>Daily service territories remain intact unless a specific scenario is approved.</p></div>
                <div><span>03</span><strong>Road time drives the sequence</strong><p>Within each route, the proposed order minimizes drive time between street addresses.</p></div>
                <div><span>04</span><strong>Owner approval is required</strong><p>No service day or technician assignment is ever pushed back automatically.</p></div>
              </div>
            </section>
            <OnboardingRouteTool />
            <RouteAnalysisClient initialSummary={source} />
          </>
        )}
      </div>
    </main>
  );
}
