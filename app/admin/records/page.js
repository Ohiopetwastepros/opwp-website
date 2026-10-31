import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import AdminSectionShell from '../AdminSectionShell';
import RecordWorkspace from './RecordWorkspace';
export const dynamic='force-dynamic';
export const metadata={title:'Manage business records | OPWP',robots:{index:false,follow:false,nocache:true}};
export default async function RecordsPage({searchParams}) {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized)redirect('/');
  const params=await searchParams;
  const initial=Object.fromEntries(['base','table','record','search'].map(k=>[k,typeof params?.[k]==='string'?params[k].slice(0,150):'']));
  return <AdminSectionShell section="records" title="Manage business records" description="Find, inspect and correct your business records here. Saves are verified against Airtable and recorded in change history." email={auth.email}><RecordWorkspace initial={initial}/></AdminSectionShell>;
}
