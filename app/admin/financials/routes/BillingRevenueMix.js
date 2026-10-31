"use client";
import { REVENUE_PRODUCTS, summarizeInvoiceRevenue } from "@/lib/revenue-report.mjs";
import styles from "./profitability.module.css";
const money = value => new Intl.NumberFormat("en-US", { style:"currency",currency:"USD" }).format(value);

export default function BillingRevenueMix({ data, from, through }) {
  const total = summarizeInvoiceRevenue(data?.facts || [],from,through);
  return <section className={styles.weekPanel} aria-label="Subscription and one-time billing">
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Billing by product</span><h2>Subscription &amp; one-time revenue</h2></div><span className={styles.subtle}>All accounts · {from} – {through}</span></div>
    {data?.unavailable || !data ? <p role="status">Billing source is temporarily unavailable. Automatic checks will retry.</p> : <>
      <div className={styles.detailTableWrap}><table className={styles.detailTable}><thead><tr><th>Product</th><th>Subscription</th><th>One-time</th><th>Total</th></tr></thead><tbody>{Object.entries(REVENUE_PRODUCTS).map(([key,label])=><tr key={key}><th scope="row">{label}</th><td>{money(total.matrix[key].subscription)}</td><td>{money(total.matrix[key].one_time)}</td><td>{money(total.matrix[key].subscription+total.matrix[key].one_time)}</td></tr>)}</tbody></table></div>
      <p className={styles.note}>{total.invoices} invoices · {data.sources?.join(" + ")}. Pre-tax amounts by invoice date, across all service days. Initial cleanups are shown separately as one-time charges and never count toward MRR. These amounts are separate from service-day values and MRR and are not added to either total.</p>
      {total.unresolvedLines ? <p className={styles.note}>{money(total.unclassified)} remains unclassified across {total.unresolvedLines} billing lines; classified totals are partial.</p> : null}
      {total.tips ? <p className={styles.note}>{money(total.tips)} in tips is tracked separately from product revenue.</p> : null}
      {!data.firstInvoice || from < data.firstInvoice ? <p className={styles.note}>The invoice archive starts {data.firstInvoice || "after this period"}; earlier billing coverage is unavailable.</p> : null}
      <p className={styles.note}>Billing does not establish cash collection. Payment status remains in the payment ledger and QuickBooks.</p>
    </>}
  </section>;
}
