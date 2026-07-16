import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_BYTES = 8 * 1024 * 1024;
const D1_MAX_BYTES = 1250 * 1024;

export async function PUT(request) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers, db);
  if (!auth.authorized) return Response.json({ ok: false, error: "Your field session has expired." }, { status: 401 });
  const bucket = getRuntimeEnv().FIELD_PROOFS;
  const url = new URL(request.url);
  const taskId = String(url.searchParams.get("taskId") || "");
  const contentType = String(request.headers.get("content-type") || "").split(";")[0].toLowerCase();
  const length = Number(request.headers.get("content-length") || 0);
  if (!taskId || !ALLOWED.has(contentType)) return Response.json({ ok: false, error: "Choose a JPG, PNG, WEBP, or HEIC delivery photo." }, { status: 400 });
  if (!length || length > MAX_BYTES) return Response.json({ ok: false, error: "Delivery photos must be smaller than 8 MB." }, { status: 413 });
  if (!bucket && length > D1_MAX_BYTES) return Response.json({ ok: false, error: "The compressed delivery photo must be smaller than 1.25 MB." }, { status: 413 });
  const task = await db.prepare(
    `SELECT t.id,t.route_plan_id FROM route_partner_tasks t JOIN route_partner_field_shifts s ON s.route_plan_id=t.route_plan_id
     WHERE t.id=? AND t.task_type='dog_food' AND s.technician_member_id=? LIMIT 1`
  ).bind(taskId, auth.member.id).first();
  if (!task) return Response.json({ ok: false, error: "This delivery is not assigned to your route." }, { status: 403 });
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/heic" ? "heic" : "jpg";
  const proofId = crypto.randomUUID();
  const objectKey = `${auth.member.organizationId}/${task.route_plan_id}/${taskId}/${proofId}.${extension}`;
  let imageData = null;
  if (bucket) await bucket.put(objectKey, request.body, { httpMetadata: { contentType }, customMetadata: { taskId, memberId: auth.member.id } });
  else imageData = new Uint8Array(await request.arrayBuffer());
  await db.prepare(
    `INSERT INTO route_partner_field_proofs
      (id,organization_id,task_id,object_key,content_type,byte_size,captured_latitude,captured_longitude,uploaded_by,storage_provider,image_data)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(proofId, auth.member.organizationId, taskId, objectKey, contentType, length, Number(url.searchParams.get("latitude")) || null, Number(url.searchParams.get("longitude")) || null, auth.member.id, bucket ? "r2" : "d1", imageData).run();
  return Response.json({ ok: true, proof: { id: proofId, url: `/api/field/photo/${proofId}/` } }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
