import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getQuickBooksFinancialDashboard } from "@/lib/quickbooks";
import { getFinancialManagementDashboard, listDailyFinancialSnapshots, recordDailyFinancialSnapshot } from "@/lib/financial-management";
import FinancialPeriodExplorer from "./FinancialPeriodExplorer";
import FinancialPlanClient from "./FinancialPlanClient";
import styles from "./financials.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Financials | OPWP Executive Cockpit", robots: { index: false, follow: false } };

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const signedMoney = (value) => `${Number(value) > 0 ? "+" : ""}${money(value)}`;

function Trend({ rows = [] }) {
  const clean = rows.filter((row) => !/^total$/i.test(String(row.label || "")));
  const width = 760, height = 210;
  const max = Math.max(...clean.flatMap((row) => [row.revenue, row.expenses, Math.abs(row.netIncome)]), 1);
  const step = clean.length > 1 ? width / (clean.length - 1) : width;
  const points = (key) => clean.map((row, index) => `${index * step},${height - 24 - ((Number(row[key]) || 0) / max) * 165}`).join(" ");
  return <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly income statement trend">
    {[45,95,145,185].map((y) => <line key={y} x1="0" y1={y} x2={width} y2={y} stroke="#edf0ec"/>)}
    <polyline points={points("revenue")} fill="none" stroke="#315f7d" strokeWidth="3" strokeLinecap="round"/>
    <polyline points={points("expenses")} fill="none" stroke="#b67850" strokeWidth="3" strokeLinecap="round"/>
    <polyline points={points("netIncome")} fill="none" stroke="#57864a" strokeWidth="4" strokeLinecap="round"/>
    {clean.map((row,index) => <text key={row.label} x={index * step} y={height - 4} textAnchor={index === 0 ? "start" : index === clean.length - 1 ? "end" : "middle"} fontSize="9" fill="#687980">{row.label}</text>)}
  </svg>;
}

function Metric({ label, value, detail, tone = "" }) {
  return <article className={`${styles.metricCard} ${tone ? styles[tone] : ""}`}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

export default async function FinancialsPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/");
  const data = await getQuickBooksFinancialDashboard();
  if (!data.connected) redirect("/admin/");
  const management = await getFinancialManagementDashboard(data);
  await recordDailyFinancialSnapshot(data);
  const snapshots = await listDailyFinancialSnapshots(31);
  const currentLiabilityAccounts = (data.accounts ?? []).filter((account) => /current liability|accounts payable|credit card/i.test(`${account.type} ${account.subtype}`));
  const derivedCurrentAssets = data.currentAssets || (data.cash || 0) + (data.accountsReceivable || 0);
  const derivedCurrentLiabilities = data.currentLiabilities || currentLiabilityAccounts.reduce((sum, account) => sum + Math.abs(account.balance || 0), 0);
  const workingCapital = derivedCurrentAssets - derivedCurrentLiabilities;
  const averageExpenses = management.normalized.averageExpenses || 0;
  const runway = averageExpenses > 0 ? management.cash.verified / averageExpenses : 0;
  const cogsTracked = Number(data.costOfGoodsSold) > 0;
  const banks = (data.accounts ?? []).filter((account) => /bank|cash/i.test(account.type));
  const liabilities = (data.accounts ?? []).filter((account) => /liability|credit card/i.test(account.type));

  return <main className={`${styles.shell} opwp-admin-shell`}><div className={styles.wrap}>
    <header className={styles.header}><div><div className={styles.eyebrow}>QuickBooks + management ledger · {data.environment}</div><h1 className={styles.title}>Financial command center</h1><div className={styles.muted}>{data.companyName} · through {data.periodEnd} · signed in as {auth.email}</div></div><div className={styles.bookBadge} data-status={management.settings.books_status}>{management.settings.books_status === "verified" ? "Books verified" : management.settings.books_status === "rectifying" ? "Books being rectified" : "Books provisional"}</div></header>
    <nav className={styles.nav}><a href="/admin/">Overview</a><a href="/admin/financials/">Financials</a><a href="#periods">Periods</a><a href="#plan">Owner plan</a><a href="#position">Position</a></nav>

    {management.dataWarnings.length ? <section className={styles.qualityBanner}><div><strong>Decision-data controls are active</strong><p>Verified management values override unreliable accounting fields for planning. QuickBooks remains visible for reconciliation.</p></div><ul>{management.dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}

    <section className={styles.hero}><div className={styles.heroMain}><div className={styles.label}>{management.cash.source} cash</div><div className={styles.heroValue}>{money(management.cash.verified)}</div><div className={styles.heroSub}>Verified {management.cash.asOf} · QuickBooks currently reports {money(management.cash.quickBooks)}</div><div className={styles.healthLine}><span className={styles.dot}/>{runway > 0 ? `${runway.toFixed(1)} months of normalized pre-owner operating expenses` : "Runway appears after monthly history is available"}</div></div><div className={styles.heroAside}>
      <div className={styles.heroMetric}><div className={styles.label}>MTD revenue</div><div className={styles.heroValue}>{money(data.revenue)}</div><div className={styles.heroSub}>QuickBooks · provisional</div></div>
      <div className={styles.heroMetric}><div className={styles.label}>MTD net income</div><div className={styles.heroValue}>{money(data.netIncome)}</div><div className={styles.heroSub}>{pct(data.netMargin)} reported margin</div></div>
      <div className={styles.heroMetric}><div className={styles.label}>Normalized monthly net</div><div className={styles.heroValue}>{money(management.normalized.averageNetIncome)}</div><div className={styles.heroSub}>{management.normalized.completedMonths} completed month{management.normalized.completedMonths === 1 ? "" : "s"}</div></div>
      <div className={styles.heroMetric}><div className={styles.label}>Above cash floor</div><div className={styles.heroValue}>{money(management.cash.availableAboveFloor)}</div><div className={styles.heroSub}>{money(management.cash.protectedFloor)} protected</div></div>
    </div></section>

    <section id="periods" className={styles.section}><div className={styles.sectionHead}><div><div className={styles.eyebrow}>Time-based performance</div><h2 className={styles.sectionTitle}>What is happening at every operating horizon</h2><div className={styles.muted}>Daily and weekly views show recent movement; monthly and quarterly views show earning power and seasonality.</div></div></div><FinancialPeriodExplorer periods={data.periods || { monthly: data.monthly || [] }}/></section>

    <section className={styles.section}><div className={styles.sectionHead}><div><div className={styles.eyebrow}>Normalized performance</div><h2 className={styles.sectionTitle}>Completed-month operating baseline</h2></div><div className={styles.legend}><span className={styles.key} style={{"--color":"#315f7d"}}>Revenue</span><span className={styles.key} style={{"--color":"#b67850"}}>Expenses</span><span className={styles.key} style={{"--color":"#57864a"}}>Net income</span></div></div><div className={styles.grid2}><div className={styles.panel}><Trend rows={data.monthly}/></div><div className={styles.panel}><div className={styles.statement}>
      <div className={styles.statementRow}><strong>Average revenue</strong><span>{money(management.normalized.averageRevenue)}</span></div>
      <div className={styles.statementRow}><strong>Average expenses</strong><span>({money(management.normalized.averageExpenses)})</span></div>
      <div className={styles.statementRow}><strong>Average net income</strong><span>{money(management.normalized.averageNetIncome)}</span></div>
      <div className={styles.statementRow}><strong>Modeled payroll change</strong><span>{signedMoney(management.normalized.payrollChange)}</span></div>
      <div className={styles.statementRow}><strong>Pre-owner cash after staffing</strong><span>{money(management.normalized.normalizedPreOwnerCash)}</span></div>
      <div className={`${styles.statementRow} ${styles.total}`}><strong>Gross margin</strong><span>{cogsTracked ? pct(data.grossMargin) : "Not reliable yet"}</span></div>
    </div></div></div></section>

    <section id="plan" className={styles.section}><div className={styles.sectionHead}><div><div className={styles.eyebrow}>Owner, payroll and truck plan</div><h2 className={styles.sectionTitle}>Can the current plan fund everything?</h2><div className={styles.muted}>These are editable management assumptions. Every change is audited in D1 and never writes to QuickBooks.</div></div></div><div className={styles.metricGrid}>
      <Metric label="Owner target" value={`${money(management.owner.targetPay)}/mo`} detail={`${money(management.annualOwnerPay)} annual target`} tone={management.owner.supported ? "metricGood" : "metricWarn"}/>
      <Metric label="Calculated safe owner pay" value={`${money(management.owner.safeMonthlyPay)}/mo`} detail={`Keeps ${money(management.settings.minimum_monthly_retained_cash)} monthly`} tone={management.owner.supported ? "metricGood" : "metricWarn"}/>
      <Metric label="Retained after full plan" value={`${money(management.owner.plannedMonthlyRetained)}/mo`} detail="After owner payroll burden and truck" tone={management.owner.supported ? "metricGood" : "metricBad"}/>
      <Metric label="Target team payroll" value={`${money(management.normalized.targetPayroll)}/mo`} detail={`${signedMoney(management.normalized.payrollChange)} versus current model`}/>
      <Metric label="Truck payment" value={`${money(management.truck.payment)}/mo`} detail={`${money(management.truck.financed)} financed`}/>
      <Metric label="Truck all-in" value={`${money(management.truck.monthlyCost)}/mo`} detail="Payment + insurance + maintenance"/>
      <Metric label="Cash after truck" value={money(management.truck.cashAfterPurchase)} detail={`${signedMoney(management.truck.reserveGap)} versus protected floor`} tone={management.truck.reserveGap >= 0 ? "metricGood" : "metricBad"}/>
      <Metric label="Monthly tax reserve" value={money(management.settings.monthly_tax_reserve)} detail="Management allocation; not an expense"/>
    </div><div className={styles.panel}><FinancialPlanClient initialSettings={management.settings}/></div></section>

    <section id="position" className={styles.section}><div className={styles.sectionHead}><div><div className={styles.eyebrow}>Financial position</div><h2 className={styles.sectionTitle}>Liquidity and obligations</h2></div></div><div className={styles.equal}><div className={styles.panel}><div className={styles.balance}><div className={styles.balanceGroup}><h3>Management position</h3><div className={styles.balanceItem}><span>Verified cash</span><b>{money(management.cash.verified)}</b></div><div className={styles.balanceItem}><span>Protected floor</span><b>{money(management.cash.protectedFloor)}</b></div><div className={styles.balanceItem}><span>Available above floor</span><b>{money(management.cash.availableAboveFloor)}</b></div></div><div className={styles.balanceGroup}><h3>QuickBooks reconciliation</h3><div className={styles.balanceItem}><span>QuickBooks cash</span><b>{money(data.cash)}</b></div><div className={styles.balanceItem}><span>Accounts receivable</span><b>{money(data.accountsReceivable)}</b></div><div className={styles.balanceItem}><span>Working capital</span><b>{money(workingCapital)}</b></div></div></div></div><div className={styles.panel}><div className={styles.eyebrow}>Daily management ledger</div>{snapshots.length ? <div className={styles.snapshotList}>{snapshots.slice(-7).reverse().map((row) => <div key={row.snapshot_date}><span>{row.snapshot_date}</span><strong>{money(row.verified_cash || row.qbo_cash)}</strong><small>{row.books_status}</small></div>)}</div> : <div className={styles.emptyState}><strong>Daily snapshots begin after deployment.</strong><p>The scheduled Worker will preserve one management snapshot per day so cash and reported results can be compared over time.</p></div>}</div></div></section>

    <section className={styles.section}><div className={styles.equal}><div className={styles.panel}><div className={styles.eyebrow}>Cash accounts · QuickBooks reconciliation</div><table className={styles.table}><tbody>{banks.map((account) => <tr key={account.id}><td>{account.name}</td><td>{account.type}</td><td>{money(account.balance)}</td></tr>)}</tbody></table></div><div className={styles.panel}><div className={styles.eyebrow}>Liability accounts · QuickBooks reconciliation</div><table className={styles.table}><tbody>{liabilities.map((account) => <tr key={account.id}><td>{account.name}</td><td>{account.type}</td><td>{money(account.balance)}</td></tr>)}</tbody></table></div></div></section>
  </div></main>;
}
