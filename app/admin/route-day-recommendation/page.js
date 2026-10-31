import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import AdminSectionShell from '../AdminSectionShell';
import RouteDayRecommendation from './RouteDayRecommendation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Route Day Recommendation | OPWP', robots: { index: false, follow: false, nocache: true } };

export default async function RouteDayPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/admin/login/?next=/admin/route-day-recommendation/');
  return <AdminSectionShell section="route-day" title="Route Day Recommendation" description="Find the closest fit to your current routes. Enter an address to compare service days and nearby streets." email={auth.email}>
    <RouteDayRecommendation />
  </AdminSectionShell>;
}
