import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAirtableBusinessCockpit, getAirtableSchema } from "@/lib/airtable";
import { listSngEvents, listSubmissions } from "@/lib/db";
import { getSngAdminSnapshot, sngConfigured, sngRows } from "@/lib/sweepandgo";
import { getQuickBooksFinancialSnapshot } from "@/lib/quickbooks";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Executive Cockpit | Ohio Pet Waste Pros", robots: { index: false, follow: false, nocache: true } };

const money = (value, digits = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(Number(value) || 0);
const number = (value, digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value) || 0);
const percent = (value) => `${number(value, 1)}%`;

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

function Badge({ children, tone = "" }) {
  return <span className={`${styles.badge} ${tone ? styles[tone] : ""}`}>{children}</span>;
}

function Table({ columns, rows = [], empty = "No records" }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key] ?? "—"}</td>)}</tr>) : <tr><td className={styles.empty} colSpan={columns.length}>{empty}</td></tr>}</tbody></table></div>;
}

function attentionItems(opwp, dogFood, cockpitOk) {
  if (!cockpitOk) return [{ title: "Airtable metrics unavailable", detail: "The cockpit could not refresh its operating data.", tone: "bad" }];
  const items = [];
  if (dogFood.reorderProducts > 0) items.push({ title: `${dogFood.reorderProducts} dog-food SKU${dogFood.reorderProducts === 1 ? "" : "s"} at reorder level`, detail: `${number(dogFood.inventoryUnits)} total bags remain on hand.`, tone: "warn" });
  if (dogFood.pastDueSubscriptions > 0) items.push({ title: `${dogFood.pastDueSubscriptions} food subscription${dogFood.pastDueSubscriptions === 1 ? "" : "s"} need payment attention`, detail: "Past-due or failed status is limiting recurring sales.", tone: "bad" });
  if (opwp.churnCount30 > 0) items.push({ title: `${opwp.churnCount30} churn event${opwp.churnCount30 === 1 ? "" : "s"} in 30 days`, detail: `${money(opwp.lostMrr30)} in MRR was lost.`, tone: opwp.churnRate30 > 3 ? "bad" : "warn" });
  if (opwp.completionRate30 && opwp.completionRate30 < 95) items.push({ title: `Completion rate is ${percent(opwp.completionRate30)}`, detail: `${opwp.skippedJobs30} skipped or no-access jobs in the last 30 days.`, tone: "warn" });
  if (!items.length) items.push({ title: "No material exceptions detected", detail: "Core operating signals are inside normal ranges.", tone: "" });
  return items.slice(0, 3);
}

export default async function AdminPage() {
  const requestHeaders = await headers();
  const auth = await verifyAdminRequest(requestHeaders);
  if (!auth.authorized) redirect("/");

  const today = new Date().toISOString().slice(0, 10);
  const [cockpit, schema, submissions, events, sng, quickBooks] = await Promise.all([
    getAirtableBusinessCockpit(), getAirtableSchema(), listSubmissions(30), listSngEvents(100), getSngAdminSnapshot(today), getQuickBooksFinancialSnapshot(),
  ]);
  const opwp = cockpit.opwp ?? {};
  const dogFood = cockpit.dogFood ?? {};
  const jobsToday = sngRows(sng.jobs);
  const activeSngClients = sng.clients?.rows?.length ? sng.clients.rows : sngRows(sng.clients);
  const alerts = attentionItems(opwp, dogFood, cockpit.ok);
  const primaryAlert = alerts[0];
  const dataAsOf = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date());

  return (
    <main className={`${styles.shell} opwp-admin-shell`}>
      <div className={styles.wrap}>
        <header className={styles.topbar}>
          <div><div className={styles.eyebrow}>Ohio Pet Waste Pros</div><h1 className={styles.title}>Executive cockpit</h1><div className={styles.subtle}>The operating picture, stripped down to what changes decisions.</div></div>
          <div className={styles.asof}><span className={styles.live} />Live systems · refreshed {dataAsOf} ET</div>
        </header>

        <nav className={styles.nav} aria-label="Dashboard sections"><a href="/admin/">Overview</a><a href="/admin/financials/">Financials</a><a href="#service">Service business</a><a href="#food">Dog food</a><a href="#scorecard">Scorecard</a><a href="#systems">Systems</a></nav>

        <div className={`${styles.alertStrip} ${primaryAlert.tone ? "" : styles.good}`}>
          <div className={styles.alertIcon}>{primaryAlert.tone ? "!" : "✓"}</div><div><div className={styles.alertTitle}>{primaryAlert.title}</div><div className={styles.alertText}>{primaryAlert.detail}</div></div><Badge tone={primaryAlert.tone}>Owner attention</Badge>
        </div>

        <section id="overview" className={styles.scoreGrid}>
          <ScoreCard tone="primary" label="Recurring revenue" value={money(opwp.mrr)} meta={`${money(opwp.arr)} annualized`} />
          <ScoreCard label="Service revenue · 30d" value={money(opwp.totalRevenue30)} delta={opwp.revenueChange30} meta="vs prior 30 days" />
          <ScoreCard label="Active service customers" value={number(opwp.activeCustomers)} meta={`${number(opwp.weightedStops, 1)} weighted weekly stops`} />
          <ScoreCard tone="food" label="Dog food sales · 30d" value={money(dogFood.revenue30)} delta={dogFood.revenueChange30} meta={`${number(dogFood.bagsSold30)} bags sold`} />
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Financial health</div><h2 className={styles.sectionTitle}>QuickBooks control panel</h2></div><div><div className={styles.sectionNote}>Reconciled accounting metrics anchor cash, profitability, advertising capacity, and capital-purchase decisions.</div>{quickBooks.ok ? <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}><a className={styles.button} href="/admin/financials/">Open financials</a><a href="/admin/quickbooks/disconnect" style={{ padding: "9px 5px", color: "#77858b", fontSize: 11, fontWeight: 800, textDecoration: "none" }}>Manage connection</a></div> : null}</div></div>
          {!quickBooks.connected ? <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>{quickBooks.configured ? "QuickBooks is ready to authorize" : "QuickBooks credentials required"}</h3><div className={styles.panelSub}>{quickBooks.configured ? "Connect the single QuickBooks Online company to activate live financial health." : "Add the Intuit production OAuth credentials and token-encryption key as Cloudflare secrets."}</div></div>{quickBooks.configured ? <a className={styles.button} href="/admin/quickbooks/connect">Connect QuickBooks</a> : <Badge tone="warn">Setup required</Badge>}</div></div> : quickBooks.ok ? <div className={styles.scoreGrid}>
            <ScoreCard tone="primary" label="Cash position" value={money(quickBooks.cash)} meta={quickBooks.companyName} />
            <ScoreCard label="Revenue · month to date" value={money(quickBooks.revenue)} meta={`${percent(quickBooks.grossMargin)} gross margin`} />
            <ScoreCard label="Net income · MTD" value={money(quickBooks.netIncome)} meta={`${percent(quickBooks.netMargin)} net margin`} />
            <ScoreCard label="Working capital" value={money((quickBooks.currentAssets || 0) - (quickBooks.currentLiabilities || 0))} meta={`${money(quickBooks.accountsReceivable)} receivable`} />
          </div> : <div className={styles.alertStrip}><div className={styles.alertIcon}>!</div><div><div className={styles.alertTitle}>QuickBooks authorization needs attention</div><div className={styles.alertText}>{quickBooks.error} Reconnect to restore the financial feed.</div></div><a className={styles.button} href="/admin/quickbooks/connect">Reconnect</a></div>}
        </section>

        <section id="service" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Service business</div><h2 className={styles.sectionTitle}>Growth, execution, retention</h2></div><div className={styles.sectionNote}>Revenue is based on completed Airtable job logs plus one-time client revenue. MRR comes from active customer records.</div></div>
          <div className={styles.twoCol}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>12-week service revenue</h3><div className={styles.panelSub}>Completed job revenue by week</div></div><div className={styles.legend}>{money(opwp.jobRevenue30)} recurring · 30d</div></div><TrendChart data={opwp.revenueTrend} /></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Operating leverage</h3><div className={styles.panelSub}>Revenue and route productivity</div></div></div><div className={styles.miniGrid}><MiniMetric label="Revenue / job hour" value={money(opwp.revenuePerJobHour30)} /><MiniMetric label="Revenue / job" value={money(opwp.revenuePerJob30)} /><MiniMetric label="Completion rate" value={percent(opwp.completionRate30)} /><MiniMetric label="Clocked hours · 30d" value={number(opwp.clockedHours30, 1)} /></div></div>
          </div>
          <div className={`${styles.equalCol} ${styles.section}`}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Growth engine</h3><div className={styles.panelSub}>Current demand and conversion</div></div></div><div className={styles.drivers}>
              <div className={styles.driver}><div><div className={styles.driverName}>Open quoted pipeline</div><div className={styles.driverMeta}>{number(opwp.openLeads)} active opportunities</div></div><div className={styles.driverValue}>{money(opwp.quotedPipeline)} MRR</div></div>
              <div className={styles.driver}><div><div className={styles.driverName}>Lead conversion · 30 days</div><div className={styles.driverMeta}>{number(opwp.convertedLeads30)} converted from {number(opwp.leads30)} captured</div></div><div className={styles.driverValue}>{opwp.leads30 ? percent((opwp.convertedLeads30 / opwp.leads30) * 100) : "—"}</div></div>
              <div className={styles.driver}><div><div className={styles.driverName}>One-time revenue · 30 days</div><div className={styles.driverMeta}>Expansion beyond recurring routes</div></div><div className={styles.driverValue}>{money(opwp.oneTimeRevenue30)}</div></div>
            </div></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Retention</h3><div className={styles.panelSub}>Customer and MRR durability</div></div><Badge tone={opwp.churnRate30 > 3 ? "bad" : opwp.churnCount30 ? "warn" : ""}>{opwp.churnCount30 ? "Monitor" : "Healthy"}</Badge></div><div className={styles.miniGrid}><MiniMetric label="30-day churn" value={percent(opwp.churnRate30)} /><MiniMetric label="Lost MRR" value={money(opwp.lostMrr30)} /><MiniMetric label="Churn events" value={number(opwp.churnCount30)} /><MiniMetric label="Paused accounts" value={number(opwp.pausedCustomers)} /></div></div>
          </div>
        </section>

        <section id="food" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Extreme Dog Fuel</div><h2 className={styles.sectionTitle}>Sales, recurring demand, inventory</h2></div><div className={styles.sectionNote}>Paid Airtable sales only. Subscription demand and inventory are forward-looking operating signals.</div></div>
          <div className={styles.twoCol}>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>12-week dog food sales</h3><div className={styles.panelSub}>Paid revenue by week</div></div><div className={styles.legend}>{money(dogFood.averageOrder30)} average order</div></div><TrendChart data={dogFood.salesTrend} color="#ad4b32" fill="#f8e8e2" /></div>
            <div className={styles.panel}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Recurring demand</h3><div className={styles.panelSub}>Subscription and fulfillment health</div></div></div><div className={styles.miniGrid}><MiniMetric label="Active subscriptions" value={number(dogFood.activeSubscriptions)} /><MiniMetric label="Monthly bag demand" value={number(dogFood.monthlyBagDemand)} /><MiniMetric label="Delivery rate · 30d" value={percent(dogFood.deliveryRate30)} /><MiniMetric label="Revenue / bag" value={money(dogFood.revenuePerBag30, 2)} /></div></div>
          </div>
          <div className={`${styles.panel} ${styles.section}`}><div className={styles.panelHead}><div><h3 className={styles.panelTitle}>Inventory position</h3><div className={styles.panelSub}>{number(dogFood.inventoryUnits)} bags on hand across active products</div></div><Badge tone={dogFood.reorderProducts ? "warn" : ""}>{dogFood.reorderProducts ? `${dogFood.reorderProducts} reorder` : "Stock healthy"}</Badge></div><Table rows={dogFood.inventory} empty="No active inventory records" columns={[{ key: "product", label: "Product" }, { key: "formula", label: "Formula" }, { key: "onHand", label: "On hand" }, { key: "reorderPoint", label: "Reorder point" }, { key: "status", label: "Position", render: (row) => <Badge tone={String(row.status).toLowerCase().includes("reorder") ? "warn" : ""}>{row.status}</Badge> }]} /></div>
        </section>

        <section id="scorecard" className={styles.section}>
          <div className={styles.sectionHead}><div><div className={styles.eyebrow}>Management scorecard</div><h2 className={styles.sectionTitle}>Targets and accountability</h2></div><div className={styles.sectionNote}>Targets remain controlled in Airtable, so operating standards can change without a deployment.</div></div>
          <div className={styles.panel}><Table rows={opwp.targets} empty="No KPI targets have been defined in Airtable." columns={[{ key: "metric", label: "Metric" }, { key: "current", label: "Current" }, { key: "target", label: "Target" }, { key: "day7", label: "7 day" }, { key: "day30", label: "30 day" }, { key: "day90", label: "90 day" }, { key: "status", label: "Status", render: (row) => <Badge tone={/attention|below/i.test(row.status) ? "bad" : /watch/i.test(row.status) ? "warn" : ""}>{row.status}</Badge> }]} /></div>
        </section>

        <details id="systems" className={styles.details}><summary>Systems, feeds, and operational detail</summary><div className={styles.detailsBody}><div className={styles.systemGrid}>
          <div className={styles.system}><strong>Airtable</strong><span>{cockpit.ok && schema.ok ? `Healthy · ${schema.bases.length} bases` : "Needs attention"}</span></div>
          <div className={styles.system}><strong>Sweep &amp; Go</strong><span>{sngConfigured() ? `Healthy · ${activeSngClients.length} active clients` : "Not configured"}</span></div>
          <div className={styles.system}><strong>Today&apos;s route</strong><span>{jobsToday.length} jobs returned</span></div>
          <div className={styles.system}><strong>Cloudflare D1</strong><span>{submissions.configured ? `${submissions.rows.length} recent submissions · ${events.rows.length} events` : "Not configured"}</span></div>
          <div className={styles.system}><strong>QuickBooks Online</strong><span>{quickBooks.ok ? `Healthy · ${quickBooks.companyName}` : quickBooks.connected ? "Connected · sync error" : quickBooks.configured ? "Ready to authorize" : "Credentials needed"}</span></div>
        </div><div className={`${styles.equalCol} ${styles.section}`}><div><h3 className={styles.panelTitle}>Owner attention queue</h3><div className={styles.drivers} style={{ marginTop: 12 }}>{alerts.map((alert) => <div className={styles.driver} key={alert.title}><div><div className={styles.driverName}>{alert.title}</div><div className={styles.driverMeta}>{alert.detail}</div></div><Badge tone={alert.tone}>{alert.tone ? "Review" : "Clear"}</Badge></div>)}</div></div><div><h3 className={styles.panelTitle}>Recent website activity</h3><Table rows={submissions.rows.slice(0, 6)} columns={[{ key: "created_at", label: "Received" }, { key: "kind", label: "Type" }, { key: "name", label: "Name" }, { key: "status", label: "Status" }]} /></div></div></div></details>

        <div className={styles.subtle} style={{ marginTop: 18 }}>Signed in as {auth.email}. Financial metrics are management indicators based on current Airtable records and are not a substitute for reconciled accounting statements.</div>
      </div>
    </main>
  );
}
