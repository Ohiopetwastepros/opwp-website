import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import AdminWorkspace from '../../AdminWorkspace';
import SyncReview from './SyncReview';
export const dynamic = 'force-dynamic';
export const metadata = {title:'Field closeouts | Route Partner',robots:{index:false,follow:false}};
export default async function Page() {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized)redirect('/admin/login/?next=/admin/route-partner/sync/');
  const db=getDb();
  const rows=await db.prepare(`SELECT c.id,c.status,c.reason,c.created_at,c.manifest,m.display_name,s.service_date
    FROM route_partner_field_closeouts c JOIN route_partner_field_shifts s ON s.id=c.shift_id
    JOIN route_partner_members m ON m.id=s.technician_member_id WHERE c.organization_id='org-opwp'
    ORDER BY c.created_at DESC LIMIT 60`).bind().all();
  const closeouts=(rows.results || []).map(row=>({...row,manifest:JSON.parse(row.manifest)}));
  return <AdminWorkspace section="dispatch" email={auth.email}><main style={{padding:'32px',maxWidth:1100,margin:'auto'}}><a href="/admin/route-partner/">← Daily dispatch</a><h1>Field closeouts</h1><p>Immutable day records saved at clock-out. SNG uploads are blocked until the supported write API, billing effects and notification behavior are verified.</p><SyncReview closeouts={closeouts}/></main></AdminWorkspace>;
}
