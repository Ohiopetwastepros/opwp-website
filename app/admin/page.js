import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAirtableBusinessCockpit } from "@/lib/airtable";
import { getBriaRouteAllocation, getSngInvoiceMetrics, getSubscriptionCancellationMetrics, getSubscriptionStatusReviews, getSubscriptionSyncHealth, getSubscriptionTruth, listSngEvents, listSubmissions } from "@/lib/db";
import { buildSubscriptionReconciliation, getSngAdminSnapshot, sngConfigured, sngRows } from "@/lib/sweepandgo";
import { getQuickBooksFinancialSnapshot } from "@/lib/quickbooks";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Executive Cockpit | Ohio Pet Waste Pros", robots: { index: false, follow: false, nocache: true } };

const money = (value, digits = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(Number(value) || 0);
const number = (value, digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value) || 0);
const percent = (value) => `${number(value, 1)}%`;
const moneyOrDash = (value, digits = 0) => value === null || value === undefined ? "—" : money(value, digits);
const percentOrDash = (value) => value === null || value === undefined ? "—" : percent(value);

function easternDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function resolveChurnRange(params = {}) {
  const today = easternDate();
  const preset = String(params.churnRange || "month");
  if (preset === "week") return { preset, from: shiftDate(today, -6), to: today, label: "Last 7 days" };
  if (preset === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(String(params.churnFrom || "")) && /^\d{4}-\d{2}-\d{2}$/.test(String(params.churnTo || ""))) {
    const from = String(params.churnFrom);
    const to = String(params.churnTo);
    if (from <= to) return { preset, from, to, label: `${from} through ${to}` };
  }
  return { preset: "month", from: shiftDate(today, -29), to: today, label: "Last 30 days" };
}

function Delta({ value, inverse = false }) {
  const amount = Number(value) || 0;
  const positive = inverse ? amount <= 0 : amount >= 0;
  return <span className={`${styles.delta} ${positive ? "" : styles.down}`}>{amount > 0 ? "+" : ""}{number(amount, 1)}%</span>;
}

function ScoreCard({ label, value, meta, delta, inverse, tone = "" }) {
  return (
    <div className={`${styles.scoreCard} ${tone ? styles[tone] : ""}`}>
      <div className={styles.scoreLabel}>{label}</div>
      <div className={styles.scoreValue}>{value}</div>
      <div className={styles.scoreMeta}>{delta !== undefined ? <Delta value={delta} inverse={inverse} /> : null}<span>{meta}</span></div>
    </div>
  );
}

function TrendChart({ data = [], color = "#457b3b", fill = "#edf5ea" }) {
  const width = 640;
  const height = 150;
  const values = data.map((point) => Number(point.value) || 0);
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${index * step},${height - 12 - (value / max) * 125}`).join(" ");
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="12 week trend">
        <defs><linearGradient id={`fill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={fill} stopOpacity=".9"/><stop offset="1" stopColor={fill} stopOpacity=".15"/></linearGradient></defs>
        {[35, 75, 115].map((y) => <line key={y} x1="0" y1={y} x2={width} y2={y} stroke="#edf0ec" strokeWidth="1" />)}
        <polygon points={area} fill={`url(#fill-${color.replace("#", "")})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className={styles.axis}>{data.filter((_, index) => index % 2 === 0).map((point) => <span key={point.label}>{point.label}</span>)}</div>
    </>
  );
}

function MiniMetric({ label, value }) {
  return <div className={styles.miniMetric}><div className={styles.miniLabel}>{label}</div><div className={styles.miniValue}>{value}</div></div>;
}

function ValuePillar({ index, title, thesis, primaryLabel, primaryValue, metrics = [], href }) {
  return <a className={styles.valuePillar} href={href}><div className={styles.pillarTop}><span className={styles.pillarIndex}>{index}</span><span className={styles.pillarLink}>Open analysis →</span></div><h3>{title}</h3><p>{thesis}</p><div className={styles.pillarPrimary}><span>{primaryLabel}</span><strong>{primaryValue}</strong></div><div className={styles.pillarMetrics}>{metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value}</b></div>)}</div></a>;
}

function Badge({ children, tone = "" }) {
  return <span className={`${styles.badge} ${tone ? styles[tone] : ""}`}>{children}</span>;
}

function Table({ columns, rows = [], empty = "No records" }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? "—"}</td>)}</tr>) : <tr><td className={styles.empty} colSpan={columns.length}>{empty}</td></tr>}</tbody></table></div>;
}

function KpiScorecard({ rows = [] }) {
  if (!rows.length) return <div className={styles.panel}>No KPI targets have been defined in Airtable.</div>;
  return <div className={styles.kpiGrid}>{rows.map((row) => {
    const lowerIsBetter = /churn|lost|cost|complaint|missed/i.test(row.metric);
    const achievement = row.target ? Math.max(0, Math.min((lowerIsBetter ? row.target / Math.max(row.current, 0.01) : row.current / row.target) * 100, 100)) : 0;
    const tone = /attention|below/i.test(row.status) ? "bad" : /watch/i.test(row.status) ? "warn" : "";
    return <article className={styles.kpiCard} key={row.id}><div className={styles.kpiHead}><span>{row.metric}</span><Badge tone={tone}>{row.status}</Badge></div><div className={styles.kpiValue}>{number(row.current, 1)} <small>{row.unit}</small></div><div className={styles.kpiTarget}>Target {number(row.target, 1)} {row.unit}</div><div className={styles.kpiTrack}><span style={{ width: `${achievement}%` }} /></div><div className={styles.kpiPeriods}><span>7D <b>{number(row.day7, 1)}</b></span><span>30D <b>{number(row.day30, 1)}</b></span><span>90D <b>{number(row.day90, 1)}</b></span></div></article>;
  })}</div>;
}

function attentionItems(opwp, dogFood, cockpitOk, recurringSngCount, events = [], submissions = [], subscriptionReconciliation = null, subscriptionSyncHealth = null, cancellationMetrics = null, subscriptionStatusReviews = null) {
  const items = [];
  const eventFailures = events.filter((event) => event.status === "needs_attention");
  const submissionFailures = submissions.filter((submission) => submission.status === "needs_attention");
  const latestSubscriptionSync = subscriptionSyncHealth?.latest;
  const subscriptionSyncAge = latestSubscriptionSync?.completed_at ? Date.now() - Date.parse(`${latestSubscriptionSync.completed_at.replace(" ", "T")}Z`) : null;
  if (latestSubscriptionSync?.status === "failed") items.push({ title: "Daily subscription refresh failed", detail: latestSubscriptionSync.error || "The prior valid snapshot was preserved.", tone: "bad", href: "#systems" });
  else if (subscriptionSyncAge !== null && subscriptionSyncAge > 36 * 3600000) items.push({ title: "Daily subscription data is stale", detail: "The last successful SNG subscription refresh is more than 36 hours old; the prior valid snapshot is still being used.", tone: "bad", href: "#systems" });
  if (opwp.unmatchedLiveSubscriptionClients > 0) items.push({ title: `${opwp.unmatchedLiveSubscriptionClients} active subscription customer${opwp.unmatchedLiveSubscriptionClients === 1 ? " is" : "s are"} missing revenue baselines`, detail: "They are included in the active customer count, but their MRR needs a finalized invoice or baseline update before financial totals are complete.", tone: "bad", href: "#subscription-reconciliation" });
  if (subscriptionStatusReviews?.openCount > 0) items.push({ title: `${subscriptionStatusReviews.openCount} subscription status review${subscriptionStatusReviews.openCount === 1 ? "" : "s"} open`, detail: `${money(subscriptionStatusReviews.coreMrrAtRisk)} of scooping MRR is preserved pending confirmation; these records are not counted as churn.`, tone: "warn", href: "#subscription-status-reviews" });
  if (opwp.churnReasonReviewCount > 0) items.push({ title: `${opwp.churnReasonReviewCount} churn detail record${opwp.churnReasonReviewCount === 1 ? " needs" : "s need"} review`, detail: "The confirmed cancellation is missing either its standardized reason or required comment. Complete the Airtable Churn Log.", tone: "warn", href: "#churn-reason-review" });
  if (opwp.churnEligibilityReviewCount > 0) items.push({ title: `${opwp.churnEligibilityReviewCount} cancellation${opwp.churnEligibilityReviewCount === 1 ? " needs" : "s need"} eligibility validation`, detail: "These records have no completed-service or paid-invoice evidence and are excluded from churn until the office confirms a paid customer relationship.", tone: "warn", href: "#churn-eligibility-review" });
  if (eventFailures.length > 0) items.push({ title: `${eventFailures.length} backend event${eventFailures.length === 1 ? "" : "s"} need attention`, detail: "Automatic recovery is active and will retry these records when the next SNG event arrives.", tone: "bad", href: "/admin/events/" });
  if (!cockpitOk) items.push({ title: "Airtable metrics unavailable", detail: "The cockpit could not refresh its operating data.", tone: "bad", href: "#systems" });
  else if (opwp.airtableSnapshot?.status === "failed") items.push({ title: "Airtable refresh needs attention", detail: `The dashboard is safely using the last valid D1 snapshot. ${opwp.airtableSnapshot.error || "The hourly refresh will retry automatically."}`, tone: "bad", href: "#systems" });
  else if (opwp.airtableSnapshot?.stale) items.push({ title: "Airtable snapshot is stale", detail: `The dashboard is using its last valid snapshot from ${opwp.airtableSnapshot.capturedAt}; the hourly refresh will retry automatically.`, tone: "warn", href: "#systems" });
  if (submissionFailures.length > 0) items.push({ title: `${submissionFailures.length} website submission${submissionFailures.length === 1 ? "" : "s"} failed to sync`, detail: "The records are preserved in D1 and need review.", tone: "bad", href: "#systems" });
  if (subscriptionReconciliation && !subscriptionReconciliation.reconciled) items.push({ title: `${subscriptionReconciliation.issueRows.length} client routing record${subscriptionReconciliation.issueRows.length === 1 ? " needs" : "s need"} completion`, detail: `${subscriptionReconciliation.missingFromAirtable.length} SNG client${subscriptionReconciliation.missingFromAirtable.length === 1 ? " is" : "s are"} missing from Airtable and ${subscriptionReconciliation.missingSngId.length} active Airtable record${subscriptionReconciliation.missingSngId.length === 1 ? " lacks" : "s lack"} an SNG ID.`, tone: "bad", href: "#subscription-reconciliation" });
  if (!opwp.technicianEconomicsReady) items.push({ title: "Route efficiency needs more source data", detail: `The route ledger is ${percent(opwp.jobRevenueCoverage30)} complete across visit value and technician assignment. Rates are withheld until coverage reaches 90%.`, tone: "bad", href: "#route-efficiency" });
  if (opwp.serviceTimeCoverage30 < 90) items.push({ title: "Some service durations are missing", detail: `${percent(opwp.actualTimeCoverage30)} of completed visits have an actual duration. Route $/hour remains valid, but customer estimate coaching is provisional.`, tone: "warn", href: "#estimate-reviews" });
  if (opwp.suspiciousMileageRecords > 0) items.push({ title: `${opwp.suspiciousMileageRecords} mileage record${opwp.suspiciousMileageRecords === 1 ? "" : "s"} look invalid`, detail: "A shift contains more than 500 miles and is excluded from routing decisions until corrected.", tone: "warn", href: "#systems" });
  if (opwp.estimateReviewCount > 0) items.push({ title: `${opwp.estimateReviewCount} service estimate${opwp.estimateReviewCount === 1 ? "" : "s"} need review`, detail: "Repeated job durations are running materially above the current estimate.", tone: "warn", href: "#estimate-reviews" });
  if (cockpitOk && !dogFood.inventoryDataValid) items.push({ title: "Dog-food inventory contains negative quantities", detail: "Inventory KPIs remain a source-data exception until on-hand quantities are reconciled.", tone: "bad", href: "#food" });
  else if (dogFood.reorderProducts > 0) items.push({ title: `${dogFood.reorderProducts} dog-food SKU${dogFood.reorderProducts === 1 ? "" : "s"} at reorder level`, detail: `${number(dogFood.inventoryUnits)} total bags remain on hand.`, tone: "warn" });
  if (dogFood.pastDueSubscriptions > 0) items.push({ title: `${dogFood.pastDueSubscriptions} food subscription${dogFood.pastDueSubscriptions === 1 ? "" : "s"} need payment attention`, detail: "Past-due or failed status is limiting recurring sales.", tone: "bad" });
  if (cancellationMetrics?.dogFoodChurn > 0) items.push({ title: `${cancellationMetrics.dogFoodChurn} dog-food subscription cancellation${cancellationMetrics.dogFoodChurn === 1 ? "" : "s"} in 30 days`, detail: "These are tracked separately from scooping churn; review the cancellation reason and replacement opportunity.", tone: "warn", href: "#dog-food-churn" });
  if (opwp.churnCount30 > 0) items.push({ title: `${opwp.churnCount30} churn event${opwp.churnCount30 === 1 ? "" : "s"} in 30 days`, detail: `${money(opwp.lostMrr30)} in MRR was lost.`, tone: opwp.churnRate30 > 3 ? "bad" : "warn" });
  if (opwp.completionRate30 && opwp.completionRate30 < 95) items.push({ title: `Completion rate is ${percent(opwp.completionRate30)}`, detail: `${opwp.skippedJobs30} skipped or no-access jobs in the last 30 days.`, tone: "warn" });
  if (!items.length) items.push({ title: "No material exceptions detected", detail: "Core operating signals are inside normal ranges.", tone: "" });
  return items.slice(0, 3);
}

export default async function AdminPage({ searchParams }) {
  const requestHeaders = await headers();
  const auth = await verifyAdminRequest(requestHeaders);
  if (!auth.authorized) redirect("/");

  const params = await searchParams;
  const requestedView = String(params?.view || "overview");
  const view = ["overview", "operations", "customers", "food", "scorecard", "systems"].includes(requestedView) ? requestedView : "overview";
  const churnRange = resolveChurnRange(params);
  const viewConfig = {
    overview: { eyebrow: "Enterprise performance", title: "Executive overview", subtitle: "The few measures that change company value, cash generation, and owner priorities." },
    operations: { eyebrow: "Operating leverage", title: "Route operations", subtitle: "Technician productivity, paid-hour economics, service execution, and route data confidence." },
    customers: { eyebrow: "Customer economics", title: "Growth & retention", subtitle: "Recurring revenue, pipeline, one-time demand, churn, pauses, and reactivation opportunities." },
    food: { eyebrow: "Growth platform", title: "Extreme Dog Fuel", subtitle: "Sales, recurring demand, fulfillment economics, churn, and inventory exposure." },
    scorecard: { eyebrow: "Accountability", title: "Management scorecard", subtitle: "The operating targets that convert strategy into weekly management behavior." },
    systems: { eyebrow: "Data governance", title: "Systems & controls", subtitle: "Feed health, reconciliation, event processing, and exceptions that can distort decisions." },
  }[view];

  const today = easternDate();
  const [briaRouteAllocation, sngInvoiceMetrics, subscriptionTruth, subscriptionSyncHealth, cancellationMetrics, subscriptionStatusReviews] = await Promise.all([
    getBriaRouteAllocation(31), getSngInvoiceMetrics(30), getSubscriptionTruth(30), getSubscriptionSyncHealth(), getSubscriptionCancellationMetrics(30), getSubscriptionStatusReviews(),
  ]);
  const cockpit = await getAirtableBusinessCockpit({ briaRouteAllocation, sngInvoiceMetrics, subscriptionTruth, cancellationMetrics, churnRange });
  const seededSnapshot = Boolean(cockpit.snapshot?.seeded);
  const [submissions, events, sng, quickBooks] = await Promise.all([
    listSubmissions(30),
    listSngEvents(100),
    seededSnapshot ? Promise.resolve({ clients: { rows: [] }, clientsWithoutSubscription: { rows: [] }, recurringClients: [], jobs: null }) : getSngAdminSnapshot(today),
    seededSnapshot ? Promise.resolve({ ok: false, connected: true, configured: true }) : getQuickBooksFinancialSnapshot(),
  ]);
  const opwp = cockpit.opwp ?? {};
  opwp.airtableSnapshot = cockpit.snapshot ? { ...cockpit.snapshot, error: cockpit.error || "" } : null;
  const dogFood = cockpit.dogFood ?? {};
  const jobsToday = sngRows(sng.jobs);
  const activeSngClientCount = sng.clients?.rows?.length || 0;
  const recurringSngCount = sng.recurringClients?.length || 0;
  const currentRecurringCount = opwp.activeSubscriptionCustomers ?? recurringSngCount;
  const subscriptionReconciliation = buildSubscriptionReconciliation(opwp.customerLedger ?? [], sng.clients?.rows ?? [], sng.clientsWithoutSubscription?.rows ?? []);
  const completedToday = jobsToday.filter((job) => String(job.status_name).toLowerCase() === "completed" || Number(job.status_id) === 2).length;
  const todayCompletionRate = jobsToday.length ? (completedToday / jobsToday.length) * 100 : 0;
  const trustedTargets = (opwp.targets ?? []).filter((row) => !/\$\/hr|route load|recurring \$\/clocked hr|active recurring customers|active recurring mrr/i.test(row.metric));
  const alerts = attentionItems(opwp, dogFood, cockpit.ok, currentRecurringCount, events.rows, submissions.rows, subscriptionReconciliation, subscriptionSyncHealth, cancellationMetrics, subscriptionStatusReviews);
  const primaryAlert = alerts[0];
  const dataAsOf = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date());
  const invoiceFeedSince = opwp.oneTimeInvoiceFeedSince
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${opwp.oneTimeInvoiceFeedSince.replace(" ", "T")}Z`))
    : null;
  const alertDestination = (href = "") => {
    if (href.startsWith("/admin/events")) return href;
    if (/food/i.test(href)) return "/admin/?view=food";
    if (/route|estimate/i.test(href)) return "/admin/?view=operations";
    if (/churn|subscription-status/i.test(href)) return "/admin/?view=customers";
    return "/admin/?view=systems";
  };

  return (
    <main className={`${styles.shell} opwp-admin-shell`}>
      <aside className={styles.rail}>
        <div className={styles.railBrand}><span className={styles.mark}>O</span><div><strong>OPWP</strong><small>Operating Group</small></div></div>
        <nav className={styles.nav} aria-label="Executive navigation">
          <a className={view === "overview" ? styles.active : ""} href="/admin/"><span>01</span>Executive overview</a>
          <a href="/admin/financials/"><span>02</span>Financial performance</a>
          <a className={view === "operations" ? styles.active : ""} href="/admin/?view=operations"><span>03</span>Route operations</a>
          <a href="/admin/routes/"><span>04</span>Route intelligence</a>
          <a href="/admin/route-partner/"><span>05</span>Route Partner</a>
          <a className={view === "customers" ? styles.active : ""} href="/admin/?view=customers"><span>06</span>Growth &amp; retention</a>
          <a className={view === "food" ? styles.active : ""} href="/admin/?view=food"><span>07</span>Extreme Dog Fuel</a>
          <a className={view === "scorecard" ? styles.active : ""} href="/admin/?view=scorecard"><span>08</span>Management scorecard</a>
          <a className={view === "systems" ? styles.active : ""} href="/admin/?view=systems"><span>09</span>Systems &amp; controls</a>
        </nav>
        <div className={styles.railFoot}><span className={styles.live} /><div><strong>Systems online</strong><small>Protected executive access</small></div></div>
      </aside>
      <div className={styles.workspace}><div className={styles.wrap}>
        <header className={styles.topbar}>
          <div><div className={styles.eyebrow}>{viewConfig.eyebrow}</div><h1 className={styles.title}>{viewConfig.title}</h1><div className={styles.subtle}>{viewConfig.subtitle}</div></div>
          <div className={styles.asof}><span className={styles.live} />Live systems · refreshed {dataAsOf} ET</div>
        </header>

        <div className={`${styles.alertStrip} ${primaryAlert.tone ? "" : styles.good}`}>
          <div className={styles.alertIcon}>{primaryAlert.tone ? "!" : "✓"}</div><div><div className={styles.alertTitle}>{primaryAlert.title}</div><div className={styles.alertText}>{primaryAlert.detail}</div></div>{primaryAlert.tone ? <a className={styles.alertAction} href={alertDestination(primaryAlert.href)}>Review issue</a> : <Badge tone={primaryAlert.tone}>Owner attention</Badge>}
        </div>

        {view === "overview" ? <>
          <section id="overview" className={styles.executiveHero}>
            <div className={styles.heroStatement}><span>Enterprise recurring run rate</span><strong>{money(opwp.arr)}</strong><p>{money(opwp.mrr)} active subscription MRR across {number(currentRecurringCount)} paying cleanup customers.</p></div>
            <div className={styles.heroMetrics}><MiniMetric label="Cash position" value={quickBooks.ok ? money(quickBooks.cash) : "Unavailable"} /><MiniMetric label="MTD revenue" value={quickBooks.ok ? money(quickBooks.revenue) : "Unavailable"} /><MiniMetric label="MTD net margin" value={quickBooks.ok ? percent(quickBooks.netMargin) : "Unavailable"} /><MiniMetric label="Route value / paid hr" value={opwp.technicianEconomicsReady ? moneyOrDash(opwp.routeRevenuePerHour30) : "Pending"} /></div>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Enterprise value drivers</div><h2 className={styles.sectionTitle}>What is moving the business</h2></div><div className={styles.sectionNote}>Each view answers one management question and keeps supporting detail off the owner landing page.</div></div>
            <div className={styles.valueGrid}>
              <ValuePillar index="01" title="Financial strength" thesis="Can the company fund growth while protecting liquidity?" primaryLabel="Cash available" primaryValue={quickBooks.ok ? money(quickBooks.cash) : "Unavailable"} metrics={[{ label: "MTD revenue", value: quickBooks.ok ? money(quickBooks.revenue) : "—" }, { label: "Net income", value: quickBooks.ok ? money(quickBooks.netIncome) : "—" }]} href="/admin/financials/" />
              <ValuePillar index="02" title="Route economics" thesis="Are paid route hours converting into enough recurring value?" primaryLabel="Route value / paid hour" primaryValue={opwp.technicianEconomicsReady ? moneyOrDash(opwp.routeRevenuePerHour30) : "Pending"} metrics={[{ label: "Operating target", value: "$100/hr+" }, { label: "Data confidence", value: percent(opwp.jobRevenueCoverage30) }]} href="/admin/?view=operations" />
              <ValuePillar index="03" title="Recurring customer base" thesis="Is the core subscription asset growing and staying durable?" primaryLabel="Cleanup MRR" primaryValue={money(opwp.coreSubscriptionMrr ?? opwp.mrr)} metrics={[{ label: "Paying customers", value: number(currentRecurringCount) }, { label: "Churn · 30d", value: `${number(opwp.grossChurnCount30)} · ${money(opwp.grossLostMrr30)}` }]} href="/admin/?view=customers" />
              <ValuePillar index="04" title="Growth platforms" thesis="Is new demand building beyond the existing route book?" primaryLabel="Open quoted MRR" primaryValue={money(opwp.quotedPipeline)} metrics={[{ label: "One-time revenue · 30d", value: opwp.oneTimeDataAvailable ? money(opwp.oneTimeRevenue30) : "Unavailable" }, { label: "Dog food sales · 30d", value: money(dogFood.revenue30) }]} href="/admin/?view=customers" />
            </div>
          </section>
          <section className={`${styles.equalCol} ${styles.section}`}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Owner action queue</h3><div className={styles.panelSub}>Only exceptions that can change revenue, cost, cash, or customer trust</div></div><Badge tone={alerts.some((alert) => alert.tone) ? "warn" : ""}>{alerts.some((alert) => alert.tone) ? `${alerts.length} priorities` : "Clear"}</Badge></div><div className={styles.drivers}>{alerts.map((alert, index) => <a className={styles.driver} href={alertDestination(alert.href)} key={alert.title}><div><div className={styles.driverName}>{index + 1}. {alert.title}</div><div className={styles.driverMeta}>{alert.detail}</div></div><Badge tone={alert.tone}>{alert.tone ? "Review" : "Clear"}</Badge></a>)}</div></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Today&apos;s operating pulse</h3><div className={styles.panelSub}>Current-day execution with customer risk separated</div></div></div><div className={styles.miniGrid}><MiniMetric label="Scheduled visits" value={number(jobsToday.length)} /><MiniMetric label="Completed" value={number(completedToday)} /><MiniMetric label="Completion" value={percent(todayCompletionRate)} /><MiniMetric label="Paused customers" value={number(opwp.pausedCustomers)} /><MiniMetric label="Held MRR" value={money(opwp.pausedMrr)} /><MiniMetric label="Open quoted MRR" value={money(opwp.quotedPipeline)} /></div></div>
          </section>
        </> : null}

        {view === "operations" ? <section id="route-efficiency" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Primary operating constraint</div><h2 className={styles.sectionTitle}>Route efficiency command center</h2></div><div className={styles.sectionNote}>Target: at least $100 of allocated recurring route value per paid route hour. Office, training, and administrative time must be separated from route time.</div></div>
          <div className={styles.scoreGrid}>
            <ScoreCard tone="primary" label="Route value / paid hour" value={opwp.technicianEconomicsReady ? moneyOrDash(opwp.routeRevenuePerHour30) : "Pending"} meta="Craig + Tony team benchmark · Bria measured separately" />
            <ScoreCard label="Route target" value="$100/hr+" meta="Minimum technician operating standard" />
            <ScoreCard label="Gap to target" value={opwp.technicianEconomicsReady ? moneyOrDash(Math.max(opwp.routeRevenueGap30 || 0, 0)) : "Pending"} meta="Additional route value required per paid hour" />
            <ScoreCard label="Route data confidence" value={percent(opwp.jobRevenueCoverage30)} meta="Visit value and technician assignment coverage" />
          </div>
          <div className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Technician route accountability</h3><div className={styles.panelSub}>Allocated subscription value · paid route hours · trailing 30 days</div></div><Badge tone={opwp.technicianEconomicsReady ? "" : "bad"}>{opwp.technicianEconomicsReady ? "Decision-ready" : "Data repair in progress"}</Badge></div><Table rows={opwp.technicians} empty="Route accountability appears after completed jobs and shifts are matched." columns={[{ key: "name", label: "Technician", render: (row) => <div>{row.name}{row.temporarySplit ? <div className={styles.subtle}>Temporary split · {row.measurementDays} matched day{row.measurementDays === 1 ? "" : "s"} · {number(row.officeHours, 1)} office hrs</div> : null}</div> }, { key: "jobs", label: "Completed visits" }, { key: "revenue", label: "Allocated route value", render: (row) => money(row.revenue) }, { key: "jobHours", label: "Active service hours" }, { key: "clockedHours", label: "Paid route hours", render: (row) => row.clockedHours ? number(row.clockedHours, 1) : "No matched shifts" }, { key: "revenuePerClockedHour", label: "Route value / hour", render: (row) => row.mixedDuty ? <Badge tone="warn">Awaiting matched day</Badge> : !opwp.technicianEconomicsReady ? "Pending data repair" : moneyOrDash(row.revenuePerClockedHour) }, { key: "target", label: "$100 target", render: (row) => row.mixedDuty ? "Pending route cutoff" : row.revenuePerClockedHour === null || !opwp.technicianEconomicsReady ? "Pending" : <Badge tone={row.revenuePerClockedHour >= 100 ? "" : "bad"}>{row.revenuePerClockedHour >= 100 ? "On target" : `${money(100 - row.revenuePerClockedHour)}/hr gap`}</Badge> }]} /></div>
          <div className={`${styles.equalCol} ${styles.section}`}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>What to work on first</h3><div className={styles.panelSub}>Management sequence for route cost</div></div></div><div className={styles.drivers}><div className={styles.driver}><div><div className={styles.driverName}>1. Close the route-density gap</div><div className={styles.driverMeta}>Review each technician below $100/hour by day and ZIP cluster; move isolated stops before changing service estimates.</div></div></div><div className={styles.driver}><div><div className={styles.driverName}>2. Monitor Bria&apos;s temporary split</div><div className={styles.driverMeta}>Her route day ends 30 minutes after the final completed job; remaining shift time is office time. Only matched days affect her KPI.</div></div></div><div className={styles.driver}><div><div className={styles.driverName}>3. Review repeat service overruns</div><div className={styles.driverMeta}>Adjust a customer estimate only after at least three comparable visits consistently exceed it.</div></div></div></div></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Source confidence</h3><div className={styles.panelSub}>The dashboard will not promote incomplete inputs as KPIs</div></div></div><div className={styles.miniGrid}><MiniMetric label="Visit value matched" value={percent(opwp.routeValueCoverage30)} /><MiniMetric label="Technician assigned" value={percent(opwp.assignedTechCoverage30)} /><MiniMetric label="Estimated time" value={percent(opwp.estimatedTimeCoverage30)} /><MiniMetric label="Actual time" value={percent(opwp.actualTimeCoverage30)} /></div></div>
          </div>
        </section> : null}

        {view === "customers" ? <section id="service" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Service business</div><h2 className={styles.sectionTitle}>Growth, execution, retention</h2></div><div className={styles.sectionNote}>Route value allocates each active subscription&apos;s MRR across its expected monthly visits; accounting revenue remains in QuickBooks.</div></div>
          <div className={styles.rangeBar}>
            <div><strong>Churn reporting period</strong><span>Only validated primary scooping cancellations are included.</span></div>
            <div className={styles.rangePresets}><a className={churnRange.preset === "week" ? styles.rangeActive : ""} href="/admin/?view=customers&churnRange=week">Weekly</a><a className={churnRange.preset === "month" ? styles.rangeActive : ""} href="/admin/?view=customers&churnRange=month">Monthly</a></div>
            <form className={styles.rangeForm} method="get"><input type="hidden" name="view" value="customers" /><input type="hidden" name="churnRange" value="custom" /><label>From<input type="date" name="churnFrom" defaultValue={churnRange.from} /></label><label>To<input type="date" name="churnTo" defaultValue={churnRange.to} /></label><button type="submit">Apply range</button></form>
          </div>
          <div className={styles.twoCol}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>5-week allocated route value</h3><div className={styles.panelSub}>Subscription value assigned to completed visits by week</div></div><div className={styles.legend}>{money(opwp.jobRevenue30)} · 30d</div></div><TrendChart data={opwp.revenueTrend} /></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Operating leverage</h3><div className={styles.panelSub}>Route productivity and current execution</div></div></div><div className={styles.miniGrid}><MiniMetric label="Route value / paid hour" value={opwp.technicianEconomicsReady ? moneyOrDash(opwp.routeRevenuePerHour30) : "Pending"} /><MiniMetric label="Route data confidence" value={percent(opwp.jobRevenueCoverage30)} /><MiniMetric label="Today completed" value={`${completedToday}/${jobsToday.length} · ${percent(todayCompletionRate)}`} /><MiniMetric label="Clocked hours · 30d" value={number(opwp.clockedHours30, 1)} /></div></div>
          </div>
          <div className={`${styles.equalCol} ${styles.section}`}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Growth engine</h3><div className={styles.panelSub}>Current demand and conversion</div></div></div><div className={styles.drivers}>
              <div className={styles.driver}><div><div className={styles.driverName}>Open quoted pipeline</div><div className={styles.driverMeta}>{number(opwp.openLeads)} active opportunities</div></div><div className={styles.driverValue}>{money(opwp.quotedPipeline)} MRR</div></div>
              <div className={styles.driver}><div><div className={styles.driverName}>Lead conversion · 30 days</div><div className={styles.driverMeta}>{number(opwp.convertedLeads30)} converted from {number(opwp.leads30)} captured</div></div><div className={styles.driverValue}>{opwp.leads30 ? percent((opwp.convertedLeads30 / opwp.leads30) * 100) : "—"}</div></div>
              <div className={styles.driver}><div><div className={styles.driverName}>One-time revenue · 30 days</div><div className={styles.driverMeta}>{opwp.oneTimeInvoiceFeedConnected ? `Live capture since ${invoiceFeedSince} · ${number(opwp.oneTimeInvoices30)} finalized one-time invoices · ${number(opwp.oneTimeJobs30)} non-recurring jobs logged` : "Waiting for the first finalized Sweep & Go invoice event"}</div></div><div className={styles.driverValue}>{opwp.oneTimeDataAvailable ? money(opwp.oneTimeRevenue30) : "Unavailable"}</div></div>
            </div></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Retention</h3><div className={styles.panelSub}>{opwp.churnSource} · {opwp.churnPeriodLabel} · one-time jobs and add-ons excluded</div></div><Badge tone={opwp.churnRate30 > 3 ? "bad" : opwp.grossChurnCount30 ? "warn" : ""}>{opwp.grossChurnCount30 ? "Monitor" : "Healthy"}</Badge></div><div className={styles.miniGrid}><MiniMetric label="Gross churn" value={number(opwp.grossChurnCount30)} /><MiniMetric label="Reactivations" value={number(opwp.reactivations30)} /><MiniMetric label="Net churn" value={number(opwp.netChurnCount30)} /><MiniMetric label="Net lost MRR" value={money(opwp.netLostMrr30)} /></div></div>
          </div>
          <div className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Paused customer return schedule</h3><div className={styles.panelSub}>Paused accounts are excluded from active route capacity and churn; actual duration closes when an unpause event arrives.</div></div><Badge tone={(opwp.pausedAccounts ?? []).length ? "warn" : ""}>{(opwp.pausedAccounts ?? []).length ? `${opwp.pausedAccounts.length} paused · ${money(opwp.pausedMrr)} held MRR` : "Clear"}</Badge></div><Table rows={opwp.pausedAccounts} empty="No primary scooping customers are currently paused." columns={[{ key: "customer", label: "Customer" }, { key: "paused", label: "Paused" }, { key: "plannedResume", label: "Planned return", render: (row) => row.plannedResume || "Not scheduled" }, { key: "reason", label: "Reason" }, { key: "mrr", label: "Held MRR", render: (row) => money(row.mrr) }]} /></div>
          <div className={`${styles.equalCol} ${styles.section}`}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Why customers cancel</h3><div className={styles.panelSub}>Confirmed primary scooping churn · {opwp.churnPeriodLabel}</div></div><Badge>{number(opwp.grossChurnCount30)} gross</Badge></div><Table rows={opwp.churnReasons30} empty={`No confirmed scooping cancellations in ${String(opwp.churnPeriodLabel || "the selected period").toLowerCase()}.`} columns={[{ key: "reason", label: "Reason" }, { key: "cancellations", label: "Cancellations" }, { key: "share", label: "Share", render: (row) => percent(row.share) }, { key: "lostMrr", label: "Lost MRR", render: (row) => money(row.lostMrr) }]} /></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Seasonal restart pipeline</h3><div className={styles.panelSub}>Seasonal cancellations awaiting reactivation</div></div><Badge tone={(opwp.seasonalFollowUps ?? []).length ? "warn" : ""}>{(opwp.seasonalFollowUps ?? []).length ? `${opwp.seasonalFollowUps.length} follow-up` : "Clear"}</Badge></div><Table rows={opwp.seasonalFollowUps} empty="No seasonal customers currently require restart follow-up." columns={[{ key: "customer", label: "Customer" }, { key: "canceled", label: "Canceled" }, { key: "lostMrr", label: "MRR opportunity", render: (row) => money(row.lostMrr) }, { key: "comment", label: "Context", render: (row) => row.comment || "No comment required" }]} /></div>
          </div>
          <div className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Validated churn log</h3><div className={styles.panelSub}>{opwp.churnPeriodLabel} · service or payment eligibility required</div></div><Badge>{number(opwp.churnRows?.length)} records</Badge></div><Table rows={opwp.churnRows} empty="No validated churn in the selected period." columns={[{ key: "date", label: "Canceled" }, { key: "customer", label: "Customer" }, { key: "plan", label: "Plan" }, { key: "reason", label: "Reason" }, { key: "lostMrr", label: "Lost MRR", render: (row) => money(row.lostMrr) }]} /></div>
          {opwp.churnEligibilityReviewCount > 0 ? <div id="churn-eligibility-review" className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Cancellation eligibility review</h3><div className={styles.panelSub}>Excluded from churn until the office confirms paid-invoice evidence for an account with no completed service</div></div><Badge tone="warn">{opwp.churnEligibilityReviewCount} open</Badge></div><Table rows={opwp.churnEligibilityReviews} columns={[{ key: "customer", label: "Customer" }, { key: "date", label: "Canceled" }, { key: "plan", label: "Plan" }, { key: "reason", label: "Reason" }, { key: "potentialMrr", label: "Potential MRR", render: (row) => money(row.potentialMrr) }, { key: "evidence", label: "Current evidence" }]} /></div> : null}
          <div id="subscription-reconciliation" className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Client routing data coverage</h3><div className={styles.panelSub}>Sweep &amp; Go enriches frequency, service weekdays, and technician assignments. Customer status changes only from lifecycle events.</div></div><Badge tone={subscriptionReconciliation.reconciled ? "" : "bad"}>{subscriptionReconciliation.reconciled ? "Complete" : `${subscriptionReconciliation.issueRows.length} issues`}</Badge></div><div className={styles.miniGrid}><MiniMetric label="SNG schedule feed returned" value={number(subscriptionReconciliation.recurringCount)} /><MiniMetric label="Airtable active records" value={number(subscriptionReconciliation.airtableActiveCount)} /><MiniMetric label="Missing from Airtable" value={number(subscriptionReconciliation.missingFromAirtable.length)} /><MiniMetric label="Missing SNG ID" value={number(subscriptionReconciliation.missingSngId.length)} /></div><div style={{ marginTop: 18 }}><Table rows={subscriptionReconciliation.issueRows.slice(0, 20)} empty="All returned SNG routing records are represented in Airtable." columns={[{ key: "name", label: "Customer" }, { key: "sngClientId", label: "SNG Client ID", render: (row) => row.sngClientId || "Missing" }, { key: "issue", label: "Difference" }, { key: "action", label: "Recommended action" }]} /></div>{subscriptionReconciliation.issueRows.length > 20 ? <div className={styles.subtle} style={{ marginTop: 10 }}>Showing the first 20 of {subscriptionReconciliation.issueRows.length} issues.</div> : null}</div>
          {subscriptionStatusReviews.openCount > 0 ? <div id="subscription-status-reviews" className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Event-driven subscription review</h3><div className={styles.panelSub}>Only ambiguous subscription lifecycle events appear here; active-feed absence never opens a review.</div></div><Badge tone="warn">{subscriptionStatusReviews.openCount} open</Badge></div><Table rows={subscriptionStatusReviews.rows} columns={[{ key: "customer", label: "Customer" }, { key: "address", label: "Address" }, { key: "coreMrr", label: "Scooping MRR", render: (row) => money(row.coreMrr) }, { key: "firstMissing", label: "Event date" }, { key: "evidence", label: "Current evidence" }]} /></div> : null}
          <div id="churn-reason-review" className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Churn detail review</h3><div className={styles.panelSub}>Comments are required only for Don&apos;t need service anymore, Dissatisfied, and Other</div></div><Badge tone={opwp.churnReasonReviewCount ? "warn" : ""}>{opwp.churnReasonReviewCount ? `${opwp.churnReasonReviewCount} open` : "Complete"}</Badge></div><Table rows={opwp.churnReasonReviews} empty="Every confirmed cancellation satisfies its reason and comment rules." columns={[{ key: "customer", label: "Customer" }, { key: "date", label: "Canceled" }, { key: "plan", label: "Plan" }, { key: "reason", label: "Reason", render: (row) => row.reason || "Needs reason" }, { key: "comment", label: "Comment", render: (row) => row.comment || "Not required" }, { key: "lostMrr", label: "Lost MRR", render: (row) => money(row.lostMrr) }, { key: "action", label: "Action", render: () => <a className={styles.button} href="https://airtable.com/appcAWPBQB8GmOrcT/tblyhWKl99rwpiIRI" target="_blank" rel="noreferrer">Complete in Airtable</a> }]} /></div>
          <div id="estimate-reviews" className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Service-time review queue</h3><div className={styles.panelSub}>Manual checkpoint · trailing 30 days · minimum 3 comparable visits</div></div><Badge tone={opwp.estimateReviewCount ? "warn" : ""}>{opwp.estimateReviewCount ? `${opwp.estimateReviewCount} review` : "Within range"}</Badge></div><Table rows={opwp.estimateReviews} empty="No repeated service-time overruns currently meet the review threshold." columns={[{ key: "customer", label: "Customer" }, { key: "tech", label: "Technician" }, { key: "jobs", label: "Visits" }, { key: "estimated", label: "Median estimate", render: (row) => `${number(row.estimated, 1)} min` }, { key: "actual", label: "Median actual", render: (row) => `${number(row.actual, 1)} min` }, { key: "varianceMinutes", label: "Variance", render: (row) => <Badge tone="warn">+{number(row.varianceMinutes, 1)} min · {percent(row.variancePercent)}</Badge> }, { key: "overrunRate", label: "Visits over", render: (row) => percent(row.overrunRate) }]} /></div>
        </section> : null}

        {view === "food" ? <section id="food" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Extreme Dog Fuel</div><h2 className={styles.sectionTitle}>Sales, recurring demand, inventory</h2></div><div className={styles.sectionNote}>Paid Airtable sales only. Subscription demand and inventory are forward-looking operating signals.</div></div>
          <div className={styles.twoCol}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>12-week dog food sales</h3><div className={styles.panelSub}>Paid revenue by week</div></div><div className={styles.legend}>{money(dogFood.averageOrder30)} average order</div></div><TrendChart data={dogFood.salesTrend} color="#ad4b32" fill="#f8e8e2" /></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Recurring demand</h3><div className={styles.panelSub}>Subscription and fulfillment health</div></div></div><div className={styles.miniGrid}><MiniMetric label="Active subscriptions" value={number(dogFood.activeSubscriptions)} /><MiniMetric label="Monthly bag demand" value={number(dogFood.monthlyBagDemand)} /><MiniMetric label="Delivery rate · 30d" value={dogFood.deliveryDataAvailable ? percent(dogFood.deliveryRate30) : "No data"} /><MiniMetric label="Revenue / bag" value={money(dogFood.revenuePerBag30, 2)} /><MiniMetric label="Dog-food churn · 30d" value={number(cancellationMetrics.dogFoodChurn)} /></div></div>
          </div>
          <div id="dog-food-churn" className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Dog-food churn</h3><div className={styles.panelSub}>Dog-food subscription cancellations only; scooping and add-ons are excluded</div></div><Badge tone={cancellationMetrics.dogFoodChurn ? "warn" : ""}>{cancellationMetrics.dogFoodChurn ? `${cancellationMetrics.dogFoodChurn} in 30d` : "No churn"}</Badge></div><Table rows={cancellationMetrics.dogFoodRows} empty="No dog-food subscription cancellations in the last 30 days." columns={[{ key: "customer", label: "Customer" }, { key: "date", label: "Canceled" }, { key: "plan", label: "Plan" }, { key: "reason", label: "Reason" }]} /></div>
          <div className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Inventory position</h3><div className={styles.panelSub}>{dogFood.inventoryDataValid ? `${number(dogFood.inventoryUnits)} bags on hand across active products` : "Negative on-hand quantities require reconciliation"}</div></div><Badge tone={!dogFood.inventoryDataValid ? "bad" : dogFood.reorderProducts ? "warn" : ""}>{!dogFood.inventoryDataValid ? "Data error" : dogFood.reorderProducts ? `${dogFood.reorderProducts} reorder` : "Stock healthy"}</Badge></div><Table rows={dogFood.inventory} empty="No active inventory records" columns={[{ key: "product", label: "Product" }, { key: "formula", label: "Formula" }, { key: "onHand", label: "On hand" }, { key: "reorderPoint", label: "Reorder point" }, { key: "status", label: "Position", render: (row) => <Badge tone={row.onHand < 0 ? "bad" : String(row.status).toLowerCase().includes("reorder") ? "warn" : ""}>{row.onHand < 0 ? "Invalid quantity" : row.status}</Badge> }]} /></div>
        </section> : null}

        {view === "scorecard" ? <section id="scorecard" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Management scorecard</div><h2 className={styles.sectionTitle}>Targets and accountability</h2></div><div className={styles.sectionNote}>Targets remain controlled in Airtable, so operating standards can change without a deployment.</div></div>
          <KpiScorecard rows={trustedTargets} />
        </section> : null}

        {view === "systems" ? <details open id="systems" className={styles.details}><summary>Systems, feeds, and operational detail</summary><div className={styles.detailsBody}><div className={styles.systemGrid}>
          <div className={styles.system}><strong>Airtable</strong><span>{cockpit.ok ? `${cockpit.snapshot?.status === "failed" ? "Last valid snapshot" : "Healthy"} · D1 snapshot ${cockpit.snapshot?.capturedAt || "seeded"}` : cockpit.error || "Needs attention"}</span></div>
          <div className={styles.system}><strong>Sweep &amp; Go</strong><span>{sngConfigured() ? `Healthy · ${recurringSngCount} recurring / ${activeSngClientCount} total active` : "Not configured"}</span></div>
          <div className={styles.system}><strong>Daily subscription refresh</strong><span>{subscriptionSyncHealth.latest ? `${subscriptionSyncHealth.latest.status === "success" ? "Healthy" : "Needs attention"} · ${subscriptionSyncHealth.latest.completed_at}` : `Scheduled · using ${opwp.subscriptionSnapshotDate || "baseline"} snapshot`}</span></div>
          <div className={styles.system}><strong>Add-on cancellations</strong><span>{number(cancellationMetrics.addonCancellations)} in 30 days · operational only, excluded from churn</span></div>
          <div className={styles.system}><strong>Today&apos;s route</strong><span>{jobsToday.length} jobs returned</span></div>
          <a className={styles.system} href="/admin/events/"><strong>Cloudflare D1 →</strong><span>{submissions.configured ? `${submissions.rows.length} recent submissions · ${events.rows.length} events` : "Not configured"}</span></a>
          <div className={styles.system}><strong>QuickBooks Online</strong><span>{quickBooks.ok ? `Healthy · ${quickBooks.companyName}` : quickBooks.connected ? "Connected · sync error" : quickBooks.configured ? "Ready to authorize" : "Credentials needed"}</span></div>
        </div><div className={`${styles.equalCol} ${styles.section}`}><div><h3 className={styles.panelTitle}>Owner attention queue</h3><div className={styles.drivers} style={{ marginTop: 12 }}>{alerts.map((alert) => <div className={styles.driver} key={alert.title}><div><div className={styles.driverName}>{alert.title}</div><div className={styles.driverMeta}>{alert.detail}</div></div><Badge tone={alert.tone}>{alert.tone ? "Review" : "Clear"}</Badge></div>)}</div></div><div><h3 className={styles.panelTitle}>Recent website activity</h3><Table rows={submissions.rows.slice(0, 6)} columns={[{ key: "created_at", label: "Received" }, { key: "kind", label: "Type" }, { key: "name", label: "Name" }, { key: "status", label: "Status" }]} /></div></div></div></details> : null}

        <div className={styles.subtle} style={{ marginTop: 18 }}>Signed in as {auth.email}. Financial metrics are management indicators based on current Airtable records and are not a substitute for reconciled accounting statements.</div>
      </div></div>
    </main>
  );
}
