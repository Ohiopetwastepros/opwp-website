import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";
import { getFieldToday } from "@/lib/field-operations";
import FieldClient from "./FieldClient";
import styles from "./field.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today’s route | OPWP Field", robots: { index: false, follow: false, nocache: true } };

function operatingDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}

export default async function FieldPage(){const db=getDb();const auth=await verifyFieldRequest(await headers(),db);if(!auth.authorized)redirect("/field/login/");const date=operatingDate();let initialDay={date,member:auth.member,shift:null,route:null};try{initialDay=await getFieldToday(db,auth,date)}catch{}return <main className={`opwp-field-shell ${styles.shell}`}><FieldClient initialDay={initialDay}/></main>}
