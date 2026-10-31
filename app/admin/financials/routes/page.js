import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getRouteProfitabilityData } from "@/lib/route-profitability";
import AdminSectionShell from "../../AdminSectionShell";
import RouteProfitabilityClient from "./RouteProfitabilityClient";
export const dynamic="force-dynamic";
export const metadata={title:"Route Revenue & Profitability | OPWP Financials",robots:{index:false,follow:false,nocache:true}};
export default async function RouteFinancialsPage(){
 const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect("/");
 let data={history:null,costs:null};try{data=await getRouteProfitabilityData();}catch{}
 return <AdminSectionShell section="route-profitability" title="Route profitability" description="Review historical service revenue, technician assignments, and daily and weekly performance. Operational costs will be added separately." email={auth.email}><RouteProfitabilityClient initialData={data} /></AdminSectionShell>;
}
