import AdminWorkspace from "../AdminWorkspace";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { listFailedPaymentSms } from "@/lib/failed-payment-sms";
import FailedPaymentReviewClient from "./FailedPaymentReviewClient";
import styles from "./failed-payments.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Failed Payment Messages | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function FailedPaymentMessagesPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/failed-payments/");
  const queue = await listFailedPaymentSms(getDb());

  return <AdminWorkspace section="failed-payments" email={auth.email}><main className={styles.shell}>
    <div className={styles.topline}><Link href="/admin/">← Executive cockpit</Link><span>Signed in as {auth.email}</span></div>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>Billing controls</div><h1>Failed payment messages</h1><p>Review every customer and message before anything is sent through Quo.</p></div>
      <div className={styles.safety}><strong>Approval mode is on</strong><span>New payment failures cannot send automatically.</span></div>
    </header>
    {!queue.configured ? <div className={styles.error}>The D1 approval queue is not configured.</div> : <FailedPaymentReviewClient initialRows={queue.rows} />}
  </main></AdminWorkspace>;
}
