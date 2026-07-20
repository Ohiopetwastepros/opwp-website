import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { verifyAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const imageHeaders = (contentType, etag) => ({
  "Content-Type": contentType,
  "Cache-Control": "private, max-age=300",
  "X-Content-Type-Options": "nosniff",
  ...(etag ? { ETag: etag } : {}),
});

export async function GET(request, { params }) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Proof storage is not configured." }, { status: 503 });

  const { proofId } = await params;
  const proof = await db.prepare(
    `SELECT p.object_key,p.content_type,p.storage_provider,p.image_data
     FROM route_partner_field_proofs p
     WHERE p.id=? AND p.organization_id='org-opwp' LIMIT 1`
  ).bind(proofId).first();
  if (!proof) return new Response("Not found", { status: 404 });

  if (proof.storage_provider === "d1") {
    return new Response(proof.image_data, { headers: imageHeaders(proof.content_type) });
  }
  const object = await getRuntimeEnv().FIELD_PROOFS?.get(proof.object_key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: imageHeaders(proof.content_type, object.httpEtag) });
}
