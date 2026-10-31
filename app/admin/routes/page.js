import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getActiveSubscriptionRouteSummary } from "@/lib/route-intelligence";
import AdminSectionShell from "../AdminSectionShell";
import RouteAnalysisClient from "./RouteAnalysisClient";
import OnboardingRouteTool from "./OnboardingRouteTool";
import nav from "../admin-navigation.module.css";
import styles from "./routes.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Route Planning | OPWP Operations", robots: { index: false, follow: false, nocache: true } };

export default async function RoutesPage({ searchParams }) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/");
  const params = await searchParams;
  if (params?.manage === "office-access") redirect("/admin/office-access/");
  const db = getDb();
  let source = null;
  try { source = db ? await getActiveSubscriptionRouteSummary(db) : null; } catch {}

  return (
    <AdminSectionShell section="planning" title="Route planning & assignments" description="Plan customer placement, stop order, and future route capacity." email={auth.email}>
        <section className={nav.notice}><strong>Routing &amp; CRM workspace</strong>Use these tools to plan and assign work. Modeled revenue per hour is a planning estimate. Review completed service revenue and allocated costs in <a href="/admin/financials/routes/">Route profitability</a>.<div className={nav.shortcuts}><a href="#customer-assignment">Customer assignments</a><a href="#route-analysis">Road-time plan</a><a href="/admin/route-partner/">Daily dispatch</a><a id="office-access" href="/admin/office-access/">Office access</a></div></section>
        <div id="customer-assignment"><OnboardingRouteTool /></div>
        <section className={nav.notice} aria-label="Route data accuracy">
          <strong>Route data accuracy: {source?.accuracyAudit?.status === 'verified' ? 'Roster verified' : 'Not fully verified'}</strong>
          <p>{source?.accuracyAudit?.reason || (source?.accuracyAudit?.status === 'verified' ? 'Sweep & Go, Airtable, and the stored planning roster agree. Daily dispatch exceptions and stop order require separate dispatch evidence.' : 'The automatic comparison has missing evidence or differences. Review current Sweep & Go assignments before acting on a route proposal.')}</p>
          {source?.accuracyAudit?.capturedAt && <p>Last check: {source.accuracyAudit.capturedAt}. Findings: {source.accuracyAudit.counts?.issues ?? 'Source unavailable'}.</p>}
          {source?.accuracyAudit?.issues?.length > 0 && <details><summary>View differences and missing evidence</summary><ul>{source.accuracyAudit.issues.slice(0, 100).map((issue, index) => <li key={index}>Client {issue.clientId || 'source'}: {issue.code.replaceAll('_', ' ')} {issue.field && `(${issue.field})`}{issue.expected && ` — expected ${issue.expected}`}{issue.actual && `; found ${issue.actual}`}</li>)}</ul></details>}
        </section>
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
            <RouteAnalysisClient initialSummary={source} />
          </>
        )}
    </AdminSectionShell>
  );
}
