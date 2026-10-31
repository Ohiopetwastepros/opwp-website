import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminWorkspace from "../AdminWorkspace";
import NewClientCallGuide from "@/app/office/NewClientCallGuide";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getRuntimeEnv } from "@/lib/cloudflare";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "New Client Call Guide | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function AdminCallGuidePage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/call-guide/");
  const googleMapsKey = String(getRuntimeEnv().GOOGLE_MAPS_BROWSER_KEY || "").trim();

  return <AdminWorkspace section="call-guide" email={auth.email}>
    <main className={`opwp-admin-shell ${styles.page}`}>
      <NewClientCallGuide googleMapsKey={googleMapsKey} routeEndpoint="/api/admin/route-assignment/" />
    </main>
  </AdminWorkspace>;
}
