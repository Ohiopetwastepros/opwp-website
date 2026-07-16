import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import LoginForm from "./LoginForm";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Management sign in | OPWP", robots: { index: false, follow: false, nocache: true } };

function safeNext(value) {
  return typeof value === "string" && value.startsWith("/admin") && !value.startsWith("//") ? value : "/admin/route-partner/";
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = safeNext(params?.next);
  const auth = await verifyAdminRequest(await headers());
  if (auth.authorized) redirect(next);

  return (
    <main className={`opwp-admin-shell ${styles.page}`}>
      <section className={styles.story} aria-label="OPWP operating system">
        <a className={styles.brand} href="/"><span className={styles.brandMark}>O</span><span><strong>OPWP</strong><small>Operating system</small></span></a>
        <div className={styles.storyBody}>
          <span className={styles.kicker}>One operating layer</span>
          <h1>Routes, service, and delivery—working as one.</h1>
          <p>The management workspace built to keep field operations clear, accountable, and ready for the day.</p>
          <div className={styles.signalRow}><span><b>01</b> Plan</span><span><b>02</b> Review</span><span><b>03</b> Release</span></div>
        </div>
        <p className={styles.storyFoot}>Ohio Pet Waste Pros × Extreme Dog Fuel</p>
      </section>
      <section className={styles.access}>
        <div className={styles.accessInner}>
          <div className={styles.secureBadge}><span aria-hidden="true">✓</span> Secure management access</div>
          <h2>Welcome back.</h2>
          <p className={styles.intro}>Sign in to continue to the OPWP operating workspace.</p>
          <LoginForm next={next} />
          <p className={styles.support}>Access is limited to authorized OPWP team members.</p>
        </div>
      </section>
    </main>
  );
}
