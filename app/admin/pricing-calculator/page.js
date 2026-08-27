import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getFinancialManagementSettings } from "@/lib/financial-management";
import { getQuickBooksPricingInputs } from "@/lib/quickbooks";
import PricingCalculator from "./PricingCalculator";
import styles from "./pricing-calculator.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Job Pricing Calculator | OPWP",
  description: "Private OPWP labor and job pricing calculator.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PricingCalculatorPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/pricing-calculator/");

  const settings = await getFinancialManagementSettings();
  const quickBooks = await getQuickBooksPricingInputs({ tonyWeeklyHours: settings.tony_current_weekly_hours });
  const pricingInputs = {
    source: quickBooks.ok ? "quickbooks" : "management-fallback",
    status: quickBooks.ok ? "current" : (!quickBooks.configured || !quickBooks.connected ? "not-connected" : "unavailable"),
    companyName: quickBooks.companyName || "Ohio Pet Waste Pros",
    periodStart: quickBooks.periodStart || null,
    periodEnd: quickBooks.periodEnd || null,
    accountingMethod: quickBooks.accountingMethod || null,
    tonyWage: settings.tony_current_rate,
    tonyWeeklyHours: settings.tony_current_weekly_hours,
    burdenPercent: quickBooks.burdenPercent ?? settings.payroll_burden_percent,
    fixedOverheadPerCrewHour: quickBooks.fixedOverheadPerCrewHour ?? 0,
    burdenCost: quickBooks.burdenCost ?? null,
    directPayroll: quickBooks.directPayroll ?? null,
    fixedOperatingCosts: quickBooks.fixedOperatingCosts ?? null,
    booksStatus: settings.books_status,
  };

  return <main className={`${styles.page} opwp-admin-shell`}>
    <header className={styles.header}>
      <a className={styles.brand} href="/admin/"><span>O</span><div><strong>OPWP</strong><small>Management tools</small></div></a>
      <div className={styles.headerCopy}><span>Private tool</span><strong>Job Pricing Calculator</strong></div>
      <a className={styles.back} href="/admin/">Executive cockpit</a>
    </header>
    <PricingCalculator pricingInputs={pricingInputs} />
    <footer className={styles.footer}>Signed in as {auth.email}. Estimates are management guidance; confirm unusual properties and scope before quoting.</footer>
  </main>;
}
