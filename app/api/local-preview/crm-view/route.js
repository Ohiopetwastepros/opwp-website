import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { getDb } from '@/lib/db';
import { localPreviewPaymentOrigin } from '@/lib/local-preview-payments.mjs';
import { officeWorkdays } from '@/lib/field-workday-office.mjs';
import { workdayContext, workdayError } from '@/lib/field-workday-http';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { localCrmCommand } from '@/lib/local-preview-crm-commands.mjs';
export const dynamic = 'force-dynamic';
const reply = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function GET(request) {
  if (!localPreviewPaymentOrigin(getRuntimeEnv(),request.url)) return reply({error:'Local workspace is unavailable.'},404);
  if (!(await verifyAdminRequest(request.headers)).authorized) return reply({error:'Administrator sign-in is required.'},401);
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  try {
    const db=getDb();
    const rows=async(sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results||[];
    const [profiles,plans,stops,tasks,issues,office,drafts,shifts]=await Promise.all([
      rows('SELECT profile_json FROM local_preview_customers ORDER BY id LIMIT 100'),
      rows('SELECT id,technician_name,status,assigned_member_id FROM route_partner_route_plans WHERE organization_id=? AND service_date=? ORDER BY id LIMIT 20','org-opwp',date),
      rows('SELECT l.id,l.route_plan_id,l.sequence,l.address,l.latitude,l.longitude,l.customer_display_name,l.location_key,l.arrival_status,l.estimated_service_minutes,l.estimated_drive_minutes FROM route_partner_locations l JOIN route_partner_route_plans p ON p.id=l.route_plan_id AND p.organization_id=l.organization_id WHERE p.organization_id=? AND p.service_date=? ORDER BY l.route_plan_id,l.sequence LIMIT 120','org-opwp',date),
      rows('SELECT t.id,t.location_id,t.customer_external_id,t.product_summary,t.status,t.metadata FROM route_partner_tasks t JOIN route_partner_route_plans p ON p.id=t.route_plan_id AND p.organization_id=t.organization_id WHERE p.organization_id=? AND p.service_date=? ORDER BY t.id LIMIT 320','org-opwp',date),
      rows('SELECT t.id,t.customer_external_id,t.product_summary,t.status FROM route_partner_tasks t JOIN route_partner_route_plans p ON p.id=t.route_plan_id AND p.organization_id=t.organization_id WHERE p.organization_id=? AND p.service_date=? AND (t.status IN (?,?) OR t.crm_completion_status=?) ORDER BY t.id LIMIT 160','org-opwp',date,'failed','validation_pending','mismatch'),
      officeWorkdays(db,date),
      rows("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'local-preview:message:%' ORDER BY captured_at DESC LIMIT 100"),
      rows('SELECT id,route_plan_id,technician_member_id FROM route_partner_field_shifts WHERE organization_id=? AND service_date=? LIMIT 20','org-opwp',date),
    ]);
    office.released=office.released.map(shift=>{const identity=shifts.find(row=>row.id===shift.id);return {...shift,planId:identity?.route_plan_id,memberId:identity?.technician_member_id};});
    return reply({ok:true,date,profiles:profiles.map(row=>JSON.parse(row.profile_json)),plans,stops,tasks:tasks.map(t=>({...t,metadata:JSON.parse(t.metadata||'{}')})),issues,office,messageDrafts:drafts.map(row=>JSON.parse(row.payload))});
  }catch{return reply({error:'Local operations records could not be loaded.'},503);}
}
export async function POST(request) {
  if (!localPreviewPaymentOrigin(getRuntimeEnv(),request.url)) return reply({error:'Local workspace is unavailable.'},404);
  try {
    const {db,auth}=await workdayContext(request,{admin:true,write:true,scope:'local_preview_crm_write',limit:30});
    const body=await readBoundedProviderJson(request,12*1024);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    return reply(await localCrmCommand(db,auth.email,body,date));
  } catch(error) {
    if(error instanceof RangeError || error instanceof SyntaxError) return reply({error:'Provide a valid local workspace request of 12 KB or less.'},400);
    return workdayError(error);
  }
}
