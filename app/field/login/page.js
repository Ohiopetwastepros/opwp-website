import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";
import FieldLoginForm from "./FieldLoginForm";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Field sign in | OPWP", robots: { index: false, follow: false, nocache: true } };

function safeNext(value) { return typeof value === "string" && value.startsWith("/field") && !value.startsWith("//") ? value : "/field/"; }

export default async function FieldLoginPage({ searchParams }) {
  const next = safeNext((await searchParams)?.next);
  const auth = await verifyFieldRequest(await headers(), getDb());
  if (auth.authorized) redirect(next);
  return <main className={`opwp-field-shell ${styles.page}`}><section className={styles.brandPanel}><a href="/" className={styles.brand}><span>O</span><div><strong>OPWP</strong><small>Field operations</small></div></a><div className={styles.brandBody}><span>Route Partner</span><h1>Your day,<br/>clearly routed.</h1><p>Scooping and Extreme Dog Fuel delivery—one stop at a time.</p></div><div className={styles.connected}><i/>Connected to management release</div></section><section className={styles.loginPanel}><div><span className={styles.secure}>Individual technician access</span><h2>Ready for the route?</h2><p>Use the email and six-digit PIN provided by management.</p><FieldLoginForm next={next}/><small>Need access? Contact your route manager.</small></div></section></main>;
}
