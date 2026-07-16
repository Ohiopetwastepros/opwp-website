import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { verifyFieldRequest } from "@/lib/field-auth";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const db = getDb();
  const auth = await verifyFieldRequest(request.headers, db);
  if (!auth.authorized) return Response.json({ ok: false, error: "Your field session has expired." }, { status: 401 });
  const { proofId } = await params;
  const proof = await db.prepare(
    `SELECT p.object_key,p.content_type,p.storage_provider,p.image_data FROM route_partner_field_proofs p JOIN route_partner_tasks t ON t.id=p.task_id
     JOIN route_partner_field_shifts s ON s.route_plan_id=t.route_plan_id
     WHERE p.id=? AND s.technician_member_id=? LIMIT 1`
  ).bind(proofId, auth.member.id).first();
  if (!proof) return new Response("Not found", { status: 404 });
  if (proof.storage_provider === "d1") return new Response(proof.image_data, { headers: { "Content-Type": proof.content_type, "Cache-Control": "private, max-age=300" } });
  const object = await getRuntimeEnv().FIELD_PROOFS?.get(proof.object_key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": proof.content_type, "Cache-Control": "private, max-age=300", ETag: object.httpEtag } });
}
