import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
export const dynamic = 'force-dynamic';
export const metadata = {title:'Ad acquisition | OPWP',robots:{index:false,follow:false,nocache:true}};
export default async function MarketingPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/admin/login/?next=/admin/marketing/');
  redirect('/admin/acquisition/?tab=advertising');
}
