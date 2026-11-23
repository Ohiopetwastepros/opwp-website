import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import AdminWorkspace from '../../AdminWorkspace';
import BillingWorkspace from './BillingWorkspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Monthly billing review | Ohio Pet Waste Pros', robots: { index: false, follow: false } };
export default async function Page() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/admin/login/?next=/admin/crm/billing/');
  return <AdminWorkspace section='crm-billing' email={auth.email}><BillingWorkspace /></AdminWorkspace>;
}
