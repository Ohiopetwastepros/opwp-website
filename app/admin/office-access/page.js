import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import AdminSectionShell from "../AdminSectionShell";
import OfficeAccessManager from "../routes/OfficeAccessManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Office Access | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function OfficeAccessPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/office-access/");
  return <AdminSectionShell section="office-access" title="Office access" description="Manage office accounts for customer route assignments." email={auth.email}><OfficeAccessManager /></AdminSectionShell>;
}
