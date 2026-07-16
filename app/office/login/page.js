import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyOfficeRequest } from "@/lib/field-auth";
import OfficeLoginForm from "./OfficeLoginForm";
import styles from "@/app/field/login/login.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Office sign in | OPWP", robots: { index: false, follow: false, nocache: true } };

function safeNext(value) { return typeof value === "string" && value.startsWith("/office") && !value.startsWith("//") ? value : "/office/"; }

export default async function OfficeLoginPage({ searchParams }) {
  const next = safeNext((await searchParams)?.next);
  const auth = await verifyOfficeRequest(await headers(), getDb());
  if (auth.authorized) redirect(next);
  return <main className={`opwp-field-shell ${styles.page}`}><section className={styles.brandPanel}><a href="/" className={styles.brand}><span>O</span><div><strong>OPWP</strong><small>Office operations</small></div></a><div className={styles.brandBody}><span>Customer routing</span><h1>Place every stop<br/>with purpose.</h1><p>Use the live customer book and actual road time to confirm the best service day for each new recurring customer.</p></div><div className={styles.connected}><i/>Connected to Airtable route intelligence</div></section><section className={styles.loginPanel}><div><span className={styles.secure}>Individual office access</span><h2>Welcome back.</h2><p>Use the email and six-digit PIN provided by management.</p><OfficeLoginForm next={next}/><small>Need access? Ask management to create or reset your office account.</small></div></section></main>;
}
