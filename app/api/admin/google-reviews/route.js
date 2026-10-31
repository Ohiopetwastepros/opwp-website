import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { updateGoogleReviewTrackingRecord } from "@/lib/airtable";
import { parseReviewAliases } from "@/lib/google-review-matching.mjs";
import { protectJsonRequest } from "@/lib/public-api-security";
import { withRecordLease, patchCockpitRecord } from '@/lib/admin-record-store.mjs';
import { RecordError } from '@/lib/admin-record-policy.mjs';
import { refreshSavedReviewAudit } from '@/lib/google-review-state.mjs';

export const dynamic = "force-dynamic";

const ALLOWED = {
  clientType: { field: "Client Type", values: ["Recurring", "One-time", "Unmatched review"] },
  customerStatus: { field: "Customer Status", values: ["Active", "Paused", "Inactive", "Dropped", "Past", "Unknown", "Needs matching"] },
  reviewStatus: { field: "Google Review", values: ["Reviewed", "Not reviewed"] },
  reviewAliases: { field: "Google Review Aliases" },
};

function followUpPriority(fields) {
  if (fields["Google Review"] === "Reviewed") return "Do not contact - reviewed";
  const completedJobs = Number(fields["Completed Jobs"]) || 0;
  if (!completedJobs && !fields["Last Completed Job"]) return "No completed job";
  if (fields["Client Type"] === "Recurring") return "Future automation";
  const completedAt = Date.parse(`${fields["Last Completed Job"] || ""}T12:00:00Z`);
  return Number.isFinite(completedAt) && completedAt >= Date.now() - 30 * 86400000
    ? "Highlight - recent one-time"
    : "Do not contact - past one-time";
}

async function updateSnapshot(db, recordId, fields) {
  await patchCockpitRecord(db,'tblzRg9DZKdIRQDrn',{id:recordId,fields});
  await refreshSavedReviewAudit(db);
}

export async function PATCH(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ ok: false, error: 'Cross-site request blocked.' }, { status: 403 });
  const guarded = await protectJsonRequest(request, { scope: `google_review_edit:${auth.email}`, limit: 30, windowSeconds: 600, maxBytes: 2048, turnstile: false, failClosed: true });
  if (guarded.response) return guarded.response;
  const body = guarded.body;
  const recordId = String(body?.recordId || "");
  const field = String(body?.field || "");
  const setting = Object.hasOwn(ALLOWED, field) ? ALLOWED[field] : null;
  const suppliedValue = String(body?.value || "");
  const value = setting?.field === "Google Review Aliases"
    ? parseReviewAliases(suppliedValue).join("\n")
    : suppliedValue;
  if (!/^rec[A-Za-z0-9]{14}$/.test(recordId) || !setting || (setting.values && !setting.values.includes(value)) || suppliedValue.length > 500) {
    return Response.json({ ok: false, error: "That review-tracking selection is not valid." }, { status: 400 });
  }

  try {
    const db = getDb();
    if (!db) return Response.json({ok:false,error:'Review storage is unavailable.'},{status:503});
    return await withRecordLease(db,'google-reviews',async()=>{
    const snapshot = db ? await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first() : null;
    const snapshotData = snapshot?.payload ? JSON.parse(snapshot.payload) : null;
    const current = snapshotData?.opwp?.reviewTracker?.find((row) => row.id === recordId)?.fields;
    if (!current) return Response.json({ ok: false, error: "The review-tracking record could not be found." }, { status: 404 });
    const fields = { [setting.field]: value };
    const priority = followUpPriority({ ...current, ...fields });
    if (setting.field !== "Google Review Aliases") fields["Follow-up Priority"] = priority;
    const record = await updateGoogleReviewTrackingRecord(recordId, fields);
    if (!record) throw new Error("Airtable did not return the updated review record.");
    await updateSnapshot(db, recordId, fields);
    console.log(JSON.stringify({ event: "google_review_tracking_updated", recordId, field: setting.field, actor: auth.email }));
    return Response.json({ ok: true, record: { id: recordId, [body.field]: value, priority } }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The review-tracking record could not be updated.";
    console.error(JSON.stringify({ event: "google_review_tracking_update_failed", recordId, field: body?.field, actor: auth.email, error: message }));
    return Response.json({ ok: false, error: error instanceof RecordError ? error.message : 'The update could not be confirmed. Reload before another change.' }, { status: error instanceof RecordError ? error.status : 500 });
  }
}
