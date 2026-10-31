import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import AdminSectionShell from "../AdminSectionShell";
import StopTravelPanel from "./StopTravelPanel";
export const dynamic="force-dynamic";
export const metadata={title:"Operations | OPWP",robots:{index:false,follow:false,nocache:true}};
export default async function OperationsPage(){
 const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect("/");
 return <AdminSectionShell section="operations" title="Operations follow-up" description="Review each service day, spot time between stops, and prepare technician follow-up. Review only; no text messages are sent." email={auth.email}><StopTravelPanel /></AdminSectionShell>;
}
