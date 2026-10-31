import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";
import { readBoundedBytes } from "@/lib/bounded-body.mjs";
import { imageMatches, coordinates } from "@/lib/field-policy.mjs";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fieldQuota } from "@/lib/field-quota.mjs";

export const dynamic = "force-dynamic";
const MAX_BYTES = 1250 * 1024;
const json = (body,status = 200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function PUT(request) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers, db);
  if (!auth.authorized) return json({ok:false,error:'Your field session has expired.'},401);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ok:false,error:'Cross-site request blocked.'},403);
  const rate = await checkRateLimit(request,{scope:`field_photo:${auth.member.id}`,limit:20,windowSeconds:60,failClosed:true});
  if (!rate.allowed) return rateLimitResponse(rate);
  try { if (!await fieldQuota(db,auth.member.id,'field_photos_daily',500,86400)) return json({ok:false,error:'Daily photo limit reached. Contact the office.'},429); }
  catch { return json({ok:false,error:'Upload protection unavailable. Please retry.'},503); }
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId') || '';
  const type = (request.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!taskId || taskId.length > 100 || !['image/jpeg','image/png','image/webp'].includes(type)) return json({ok:false,error:'Choose a JPG, PNG or WEBP photo.'},400);
  const task = await db.prepare(`SELECT t.id,t.route_plan_id FROM route_partner_tasks t
    JOIN route_partner_field_shifts s ON s.route_plan_id=t.route_plan_id
    WHERE t.id=? AND t.organization_id=? AND s.organization_id=? AND s.technician_member_id=?
    AND t.status IN ('scheduled','ready','in_progress') AND s.status='in_progress'
    AND NOT EXISTS (SELECT 1 FROM route_partner_field_breaks b WHERE b.shift_id=s.id AND b.ended_at IS NULL)`)
    .bind(taskId,auth.member.organizationId,auth.member.organizationId,auth.member.id).first();
  if (!task) return json({ok:false,error:'Photos require an open task on your active route. End any active break first.'},403);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM route_partner_field_proofs WHERE task_id=?').bind(taskId).first();
  if (Number(count?.count) >= 8) return json({ok:false,error:'This task already has eight proof photos.'},409);
  let bytes;
  try { bytes = await readBoundedBytes(request,MAX_BYTES); }
  catch { return json({ok:false,error:'The photo must be smaller than 1.25 MB.'},413); }
  if (!imageMatches(bytes,type)) return json({ok:false,error:'The file contents do not match a supported image.'},415);
  const bucket = getRuntimeEnv().FIELD_PROOFS;
  const id = crypto.randomUUID();
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const key = `${auth.member.organizationId}/${task.route_plan_id}/${taskId}/${id}.${ext}`;
  const position = coordinates(Object.fromEntries(url.searchParams));
  try {
    if (bucket) await bucket.put(key,bytes,{httpMetadata:{contentType:type}});
    const saved = await db.prepare(`INSERT INTO route_partner_field_proofs
      (id,organization_id,task_id,object_key,content_type,byte_size,captured_latitude,captured_longitude,uploaded_by,storage_provider,image_data)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM route_partner_tasks t JOIN route_partner_field_shifts s ON s.route_plan_id=t.route_plan_id
        WHERE t.id=? AND s.technician_member_id=? AND s.organization_id=? AND s.status='in_progress'
        AND t.status IN ('scheduled','ready','in_progress')
        AND NOT EXISTS (SELECT 1 FROM route_partner_field_breaks b WHERE b.shift_id=s.id AND b.ended_at IS NULL)
      ) AND (SELECT COUNT(*) FROM route_partner_field_proofs WHERE task_id=?)<8 RETURNING id`)
      .bind(id,auth.member.organizationId,taskId,key,type,bytes.byteLength,position.latitude,position.longitude,auth.member.id,bucket?'r2':'d1',bucket?null:bytes,taskId,auth.member.id,auth.member.organizationId,taskId).first();
    if (!saved) { if (bucket) await bucket.delete(key); return json({ok:false,error:'The task changed while uploading. Refresh your route.'},409); }
    return json({ok:true,proof:{id,url:`/api/field/photo/${id}/`}},201);
  } catch {
    if (bucket) await bucket.delete(key).catch(()=>{});
    return json({ok:false,error:'The photo could not be saved. Please retry.'},503);
  }
}
