import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import AdminSectionShell from "../AdminSectionShell";
import ReviewRequestsClient from "./ReviewRequestsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review requests | OPWP", robots: { index: false, follow: false, nocache: true } };

export default async function ReviewRequestsPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect("/admin/login/?next=/admin/review-requests/");
  return <AdminSectionShell section="review-requests" title="Google review requests" description="Review delivery history and customer contact preferences." email={auth.email}>
    <ReviewRequestsClient />
  </AdminSectionShell>;
}
