import { getRuntimeEnv } from "@/lib/cloudflare";
import {
  workdayContext,
  workdayJson,
  workdayError,
} from "@/lib/field-workday-http";
import { fieldDigest, ownedWorkdayShift } from "@/lib/field-workday-store.mjs";
import {
  FieldError,
  imageMatches,
  operatingDate,
} from "@/lib/field-policy.mjs";
import { readBoundedBytes } from "@/lib/bounded-body.mjs";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { verifyFieldRequest } from "@/lib/field-auth";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function PUT(request) {
  try {
    const { db, auth } = await workdayContext(request, {
        write: true,
        scope: "workday_photos",
        limit: 30,
      }),
      url = new URL(request.url),
      id = url.searchParams.get("id"),
      shiftId = url.searchParams.get("shiftId"),
      taskId = url.searchParams.get("taskId"),
      purpose = url.searchParams.get("purpose"),
      capturedAt = url.searchParams.get("capturedAt");
    if (
      !/^[a-f0-9-]{36}$/i.test(id || "") ||
      !["gate", "service", "delivery", "observation"].includes(purpose) ||
      request.headers.get("content-type") !== "image/jpeg" ||
      !Number.isFinite(Date.parse(capturedAt))
    )
      throw new FieldError("Provide a JPEG with its original capture context.");
    const shift = await ownedWorkdayShift(db, auth.member, shiftId),
      row = await db
        .prepare(
          "SELECT state_json FROM field_workdays WHERE shift_id=? AND member_id=?",
        )
        .bind(shift.id, auth.member.id)
        .first();
    if (!row) throw new FieldError("Open your assigned workday first.", 409);
    const day = JSON.parse(row.state_json),
      task = day.stops.flatMap((s) => s.tasks).find((t) => t.id === taskId),
      at = Date.parse(capturedAt);
    if (
      !task ||
      ["completed", "skipped", "cancelled"].includes(task.status) ||
      day.shift.status !== "on_route" ||
      day.shift.activeBreak ||
      operatingDate(new Date(at)) !== day.date ||
      at > Date.now() + 120000 ||
      at < Date.parse(day.createdAt) - 120000
    )
      throw new FieldError(
        "Proof requires an unfinished service during the assigned workday.",
        403,
      );
    const bucket = getRuntimeEnv().FIELD_PROOFS;
    if (!bucket)
      throw new FieldError("Private proof storage is not configured.", 503);
    const bytes = await readBoundedBytes(request, 400 * 1024);
    if (!bytes.byteLength || !imageMatches(bytes, "image/jpeg"))
      throw new FieldError("The photo contents are not a JPEG.", 415);
    const digest = await fieldDigest(bytes),
      key = `${auth.member.organizationId}/workdays/${shift.id}/${id}-${digest}.jpg`,
      existing = await db
        .prepare("SELECT * FROM field_workday_proofs WHERE id=?")
        .bind(id)
        .first();
    if (
      existing &&
      (existing.member_id !== auth.member.id ||
        existing.shift_id !== shift.id ||
        existing.task_id !== taskId ||
        existing.digest !== digest ||
        existing.purpose !== purpose ||
        existing.captured_at !== capturedAt)
    )
      throw new FieldError("Photo ID was reused for different proof.", 409);
    if (existing?.uploaded) return workdayJson({ ok: true, id });
    if (!existing)
      await db
        .prepare(
          "INSERT INTO field_workday_proofs(id,shift_id,task_id,member_id,purpose,captured_at,digest,byte_size,object_key) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          id,
          shift.id,
          taskId,
          auth.member.id,
          purpose,
          capturedAt,
          digest,
          bytes.byteLength,
          key,
        )
        .run();
    const reserved = await db
      .prepare("SELECT * FROM field_workday_proofs WHERE id=?")
      .bind(id)
      .first();
    if (
      !reserved ||
      reserved.member_id !== auth.member.id ||
      reserved.shift_id !== shift.id ||
      reserved.task_id !== taskId ||
      reserved.digest !== digest ||
      reserved.purpose !== purpose ||
      reserved.captured_at !== capturedAt
    )
      throw new FieldError(
        "Another upload reserved this proof ID. Your device photo is retained.",
        409,
      );
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await db.batch([
      db
        .prepare(
          "INSERT INTO route_partner_field_proofs(id,organization_id,task_id,object_key,content_type,byte_size,uploaded_by,storage_provider) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(
          id,
          auth.member.organizationId,
          taskId,
          key,
          "image/jpeg",
          bytes.byteLength,
          auth.member.id,
          "r2",
        ),
      db
        .prepare(
          "UPDATE field_workday_proofs SET uploaded=1 WHERE id=? AND digest=?",
        )
        .bind(id, digest),
    ]);
    return workdayJson({ ok: true, id }, 201);
  } catch (error) {
    return workdayError(
      error instanceof RangeError
        ? new FieldError("Compress the photo below 400 KB.", 413)
        : error,
    );
  }
}
export async function GET(request) {
  try {
    const db = getDb();
    if (!db) throw new FieldError("Storage is unavailable.", 503);
    const auth = await verifyFieldRequest(request.headers, db),
      admin = auth.authorized
        ? null
        : await verifyAdminRequest(request.headers);
    if (!auth.authorized && !admin?.authorized)
      throw new FieldError("Sign in to review private proof.", 401);
    const id = new URL(request.url).searchParams.get("id");
    if (!/^[a-f0-9-]{36}$/i.test(id || ""))
      throw new FieldError("Choose a valid proof.");
    const row = auth.authorized
      ? await db
          .prepare(
            "SELECT p.object_key FROM field_workday_proofs p JOIN route_partner_field_shifts s ON s.id=p.shift_id WHERE p.id=? AND p.uploaded=1 AND p.member_id=? AND s.technician_member_id=? AND s.organization_id=?",
          )
          .bind(id, auth.member.id, auth.member.id, auth.member.organizationId)
          .first()
      : await db
          .prepare(
            "SELECT p.object_key FROM field_workday_proofs p JOIN route_partner_field_shifts s ON s.id=p.shift_id WHERE p.id=? AND p.uploaded=1 AND s.organization_id='org-opwp'",
          )
          .bind(id)
          .first();
    if (!row) throw new FieldError("Proof was not found.", 404);
    const object = await getRuntimeEnv().FIELD_PROOFS?.get(row.object_key);
    if (!object) throw new FieldError("Proof is unavailable.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return workdayError(error);
  }
}
