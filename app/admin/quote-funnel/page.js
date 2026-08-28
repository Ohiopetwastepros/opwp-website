import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { listQuoteFunnel } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote Funnel | OPWP", robots: { index: false, follow: false, nocache: true } };

const cell = { padding: "10px 12px", borderBottom: "1px solid #e3e8e9", textAlign: "left", verticalAlign: "top", fontSize: 13 };

function followupConsent(row) {
  try {
    const payload = JSON.parse(row.payload || "{}");
    if (!payload.follow_up_consent) return { label: "No", at: "" };
    return { label: "Yes", at: payload.follow_up_consent_at || payload.follow_up_consent_version || "recorded" };
  } catch {
    return { label: "Unknown", at: "" };
  }
}

export default async function QuoteFunnelPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/quote-funnel/");
  const funnel = await listQuoteFunnel(300);
  const rows = funnel.rows;
  const counts = {
    open: rows.filter((row) => row.kind === "partial_quote" && row.status === "follow_up_pending").length,
    converted: rows.filter((row) => row.lifecycle_stage === "converted").length,
    customers: rows.filter((row) => row.kind === "onboarding" && row.sng_sync_state === "succeeded").length,
    attention: rows.filter((row) => row.status === "needs_attention" || String(row.notifications || "").includes(":failed")).length,
  };
  return <main style={{ maxWidth: 1320, margin: "0 auto", padding: "34px 22px 70px", fontFamily: "system-ui,sans-serif", color: "#17384f" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}><Link href="/admin/">← Executive cockpit</Link><Link href="/admin/system-health/">System health →</Link></div>
    <h1 style={{ color: "#1a3c5a", marginBottom: 6 }}>Website quote funnel</h1>
    <p style={{ color: "#667680", marginTop: 0 }}>Private pre-conversion leads, questions, waitlist requests, and completed Sweep &amp; Go customer creation.</p>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, margin: "24px 0" }}>
      {[["Open partial quotes", counts.open], ["Converted partials", counts.converted], ["SNG customers created", counts.customers], ["Needs attention", counts.attention]].map(([label, value]) => <article key={label} style={{ padding: 18, border: "1px solid #dce4e6", borderRadius: 12, background: "#fff" }}><small style={{ color: "#697b86", fontWeight: 700 }}>{label}</small><strong style={{ display: "block", marginTop: 8, fontSize: 28 }}>{value}</strong></article>)}
    </section>
    <div style={{ overflowX: "auto", border: "1px solid #dce4e6", borderRadius: 12, background: "#fff" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Last activity","Stage","Contact","ZIP","Quote follow-up","SMS follow-up","SNG","Owner email"].map((label) => <th key={label} style={{ ...cell, color: "#5a6b75", fontSize: 11, textTransform: "uppercase" }}>{label}</th>)}</tr></thead><tbody>
      {rows.length ? rows.map((row) => { const consent = followupConsent(row); return <tr key={row.id}><td style={cell}>{row.last_activity_at || row.created_at}</td><td style={cell}><strong>{row.kind}</strong><br /><small>{row.lifecycle_stage || row.status}</small></td><td style={cell}>{row.name || "Name pending"}<br />{row.email || "—"}<br />{row.phone || "—"}</td><td style={cell}>{row.zip || "—"}</td><td style={cell}>{consent.label}<br /><small>{consent.at}</small></td><td style={cell}>{row.sms_followup || "not queued"}</td><td style={cell}>{row.sng_sync_state || "not attempted"}{row.sng_entity_id ? <><br /><small>ID {row.sng_entity_id}</small></> : null}</td><td style={cell}>{row.notifications || "not queued"}</td></tr>; }) : <tr><td style={cell} colSpan={8}>No website funnel activity yet.</td></tr>}
    </tbody></table></div>
  </main>;
}
