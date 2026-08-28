import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getSystemHealth } from "@/lib/system-health";

export const dynamic = "force-dynamic";
export const metadata = { title: "System Health | OPWP", robots: { index: false, follow: false, nocache: true } };

const colors = { green: ["#e7f3e2", "#356b2c"], yellow: ["#fff0d3", "#805b18"], red: ["#fbe6e1", "#934532"] };

export default async function SystemHealthPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/system-health/");
  const health = await getSystemHealth();
  return <main style={{ maxWidth: 1040, margin: "0 auto", padding: "36px 22px 70px", fontFamily: "system-ui,sans-serif" }}>
    <Link href="/admin/">← Executive cockpit</Link>
    <h1 style={{ color: "#1a3c5a", marginBottom: 6 }}>System Health</h1>
    <p style={{ color: "#667680", marginTop: 0 }}>Safe operational metadata only. Generated {health.generatedAt}.</p>
    <p><Link href="/admin/quote-funnel/">Open YardOps Pipeline →</Link></p>
    <div style={{ display: "grid", gap: 12 }}>
      {health.rows.map((row) => <section key={row.name} style={{ border: "1px solid #dce4e6", borderRadius: 12, padding: 18, background: "#fff" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{row.name}</h2>
          <span style={{ background: colors[row.tone][0], color: colors[row.tone][1], borderRadius: 999, padding: "5px 9px", fontWeight: 800, fontSize: 11 }}>{row.tone.toUpperCase()}</span>
        </div>
        <strong style={{ display: "block", marginTop: 9 }}>{row.summary}</strong>
        {row.details ? <p style={{ color: "#64727a", marginBottom: 0, overflowWrap: "anywhere" }}>{row.details}</p> : null}
      </section>)}
    </div>
  </main>;
}
