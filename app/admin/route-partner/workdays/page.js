import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import AdminWorkspace from "../../AdminWorkspace";
import WorkdayOffice from "./WorkdayOffice";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Field operations & services",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized)
    redirect("/admin/login/?next=/admin/route-partner/workdays/");
  return (
    <AdminWorkspace section="dispatch" email={auth.email}>
      <WorkdayOffice />
    </AdminWorkspace>
  );
}
