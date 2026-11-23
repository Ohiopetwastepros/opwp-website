import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import AdminWorkspace from '../../AdminWorkspace';
import SubscriptionWorkspace from './SubscriptionWorkspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer subscriptions | Ohio Pet Waste Pros', robots: { index: false, follow: false } };

export default async function Page() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/admin/login/?next=/admin/crm/subscriptions/');
  return <AdminWorkspace section='crm-subscriptions' email={auth.email}><SubscriptionWorkspace /></AdminWorkspace>;
}
