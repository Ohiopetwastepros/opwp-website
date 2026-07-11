import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disconnect QuickBooks | OPWP" };

export default async function DisconnectQuickBooksPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/");
  return <main style={{ minHeight: "80vh", padding: "150px 24px 80px", background: "#f3f5f2" }}><section style={{ maxWidth: 560, margin: "0 auto", padding: 28, border: "1px solid #dfe5de", borderRadius: 16, background: "#fff" }}><div style={{ color: "#5a7958", fontSize: 11, fontWeight: 850, letterSpacing: ".13em", textTransform: "uppercase" }}>QuickBooks Online</div><h1 style={{ margin: "7px 0 10px", color: "#18364b", fontSize: 28 }}>Disconnect accounting data?</h1><p style={{ color: "#66767d", lineHeight: 1.6 }}>This revokes OPWP Backend’s Intuit authorization and permanently removes its encrypted tokens from Cloudflare D1. It does not change or delete anything in QuickBooks.</p><form action="/admin/quickbooks/disconnect/confirm" method="post" style={{ display: "flex", gap: 10, marginTop: 22 }}><button type="submit" style={{ border: 0, borderRadius: 9, padding: "10px 14px", background: "#9b402d", color: "#fff", fontWeight: 850 }}>Disconnect QuickBooks</button><a href="/admin/" style={{ padding: "10px 14px", borderRadius: 9, background: "#eef1ed", color: "#314955", fontWeight: 850, textDecoration: "none" }}>Cancel</a></form></section></main>;
}
