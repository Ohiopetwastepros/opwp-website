import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getReconciliationStatus } from '@/lib/financial-reconciliation';
import AdminSectionShell from '../../AdminSectionShell';
import ReconciliationClient from './ReconciliationClient';

export const dynamic='force-dynamic';
export const metadata={title:'QuickBooks reconciliation | OPWP',robots:{index:false,follow:false}};
export default async function ReconciliationPage() {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized) redirect('/admin/login/');
  return <AdminSectionShell section="financial-overview" title="QuickBooks reconciliation" description="No-cost checks across the two Amex accounts in QuickBooks and the SNG invoice archive." email={auth.email}>
    <ReconciliationClient initial={await getReconciliationStatus(auth.email)}/>
  </AdminSectionShell>;
}
