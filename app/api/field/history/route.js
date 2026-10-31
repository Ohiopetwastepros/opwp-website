import { getDb } from '@/lib/db';
import { verifyFieldRequest } from '@/lib/field-auth';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers,db);
  if (!auth.authorized) return Response.json({ok:false,error:'Sign in to view your shifts.'},{status:401});
  const rows = await db.prepare(`SELECT s.id,s.service_date,s.status,s.checked_in_at,s.completed_at,p.location_count,
    c.status AS sync_status FROM route_partner_field_shifts s JOIN route_partner_route_plans p ON p.id=s.route_plan_id
    LEFT JOIN route_partner_field_closeouts c ON c.shift_id=s.id
    WHERE s.organization_id=? AND s.technician_member_id=? AND s.status<>'cancelled'
    AND p.status IN ('finalized','in_progress','completed')
    AND s.service_date BETWEEN date('now','-30 days') AND date('now','+14 days')
    ORDER BY s.service_date DESC,s.created_at DESC LIMIT 90`).bind(auth.member.organizationId,auth.member.id).all();
  return Response.json({ok:true,shifts:rows.results || []},{headers:{'Cache-Control':'private, no-store'}});
}
