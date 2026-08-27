import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { updateGoogleReviewTrackingRecord } from "@/lib/airtable";
import { parseReviewAliases } from "@/lib/google-review-matching.mjs";

export const dynamic = "force-dynamic";

const ALLOWED = {
  clientType: { field: "Client Type", values: ["Recurring", "One-time", "Unmatched review"] },
  customerStatus: { field: "Customer Status", values: ["Active", "Paused", "Inactive", "Dropped", "Past", "Unknown", "Needs matching"] },
  reviewStatus: { field: "Google Review", values: ["Reviewed", "Not reviewed"] },
  reviewAliases: { field: "Google Review Aliases" },
};

async function boundedJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 2048) return null;
  const text = await request.text();
  if (text.length > 2048) return null;
  try { return JSON.parse(text); } catch { return null; }
}

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
  if (!db) return;
  const snapshot = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first();
  if (!snapshot?.payload) return;
  const data = JSON.parse(snapshot.payload);
  const record = data?.opwp?.reviewTracker?.find((row) => row.id === recordId);
  if (!record) return;
  record.fields = { ...record.fields, ...fields };
  await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key='business_cockpit' AND payload=?")
    .bind(JSON.stringify(data), snapshot.payload).run();
}

export async function PATCH(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await boundedJson(request);
  const recordId = String(body?.recordId || "");
  const setting = ALLOWED[String(body?.field || "")];
  const suppliedValue = String(body?.value || "");
  const value = setting?.field === "Google Review Aliases"
    ? parseReviewAliases(suppliedValue).join("\n")
    : suppliedValue;
  if (!/^rec[A-Za-z0-9]{14}$/.test(recordId) || !setting || (setting.values && !setting.values.includes(value)) || suppliedValue.length > 500) {
    return Response.json({ ok: false, error: "That review-tracking selection is not valid." }, { status: 400 });
  }

  try {
    const db = getDb();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "The review-tracking record could not be updated.";
    console.error(JSON.stringify({ event: "google_review_tracking_update_failed", recordId, field: body?.field, actor: auth.email, error: message }));
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
