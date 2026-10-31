import { allowedOperationalDays } from "./route-day-policy.mjs";

export function routeGuidanceFromSnapshot(snapshot, details, now = Date.now()) {
  const capturedAt = String(snapshot?.captured_at || "");
  const timestamp = Date.parse(capturedAt.includes("T") ? capturedAt : `${capturedAt.replace(" ", "T")}Z`);
  const base = { source: "airtable_cockpit_snapshots", capturedAt, candidates: [], requiresCraigAudit: true };
  if (!Number.isFinite(timestamp) || Number(now) - timestamp > 15 * 60000 || timestamp > Number(now) + 60000 || snapshot.status !== "success") return { ...base, reason: "Refresh the Airtable routing snapshot; a complete snapshot less than fifteen minutes old is required." };
  if (details.clean_up_frequency === "One Time") return { ...base, reason: "One-time jobs require separate scheduling review." };
  let data;
  try { data = JSON.parse(snapshot.payload); } catch { return { ...base, reason: "Airtable routing data could not be read." }; }
  const customers = data?.opwp?.customers;
  if (!Array.isArray(customers)) return { ...base, reason: "Active customer routing data is missing." };
  const allowed = allowedOperationalDays({ city: details.city, zip: details.zip, frequency: details.clean_up_frequency });
  const counts = new Map();
  for (const customer of customers) {
    const fields = customer?.fields || {};
    if (String(fields.Status).toLowerCase() !== "active" || String(fields.ZIP).trim() !== details.zip) continue;
    for (const day of new Set([fields["Service Day"], fields["Service Day 2"]])) {
      if (allowed.includes(day)) counts.set(day, (counts.get(day) || 0) + 1);
    }
  }
  return { ...base, candidates: [...counts].map(([day, nearbyCustomers]) => ({ day, nearbyCustomers })).sort((a, b) => b.nearbyCustomers - a.nearbyCustomers), reason: "Guide from active customers in this ZIP. Craig must audit the exact address, route capacity, staffing and day before approval." };
}

export async function refreshMetaRouteGuidance(db, submissionId) {
  const row = await db.prepare(`SELECT response_state FROM meta_lead_intakes WHERE submission_id=? AND organization_id='org-opwp'`).bind(submissionId).first();
  if (!row) return null;
  let state;
  try { state = JSON.parse(row.response_state); } catch { return null; }
  if (!state.ready_for_route_audit) return null;
  const snapshot = await db.prepare(`SELECT payload,captured_at,status FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'`).first();
  const guidance = routeGuidanceFromSnapshot(snapshot, state.details);
  await db.prepare(`UPDATE meta_lead_intakes SET route_guidance=?,updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp'`).bind(JSON.stringify(guidance), submissionId).run();
  return guidance;
}

export async function auditMetaRoute(db, lead, { days, snapshotAt }, actor) {
  const row = await db.prepare(`SELECT response_state,route_audited_at FROM meta_lead_intakes WHERE submission_id=? AND organization_id='org-opwp'`).bind(lead.id).first();
  if (!row || row.route_audited_at || lead.source !== "facebook") throw new Error("Meta route is not awaiting audit.");
  const state = JSON.parse(row.response_state);
  const guidance = await refreshMetaRouteGuidance(db, lead.id);
  if (!guidance?.candidates.length || guidance.capturedAt !== snapshotAt || !state.ready_for_route_audit || !state.details.address) throw new Error("Refresh current routing guidance before approving this day.");
  if (days.length !== (state.details.clean_up_frequency === "Twice Weekly" ? 2 : 1) || !days.every((day) => guidance.candidates.some((candidate) => candidate.day === day))) throw new Error("Choose verified route day options for this frequency.");
  if (days.length === 2 && !["Monday / Thursday", "Tuesday / Friday", "Tuesday / Thursday"].includes(days.join(" / "))) throw new Error("Choose an approved twice-weekly route pair.");
  const auditId = crypto.randomUUID();
  const audited = { ...guidance, approvedDays: days, auditedBy: actor, auditId };
  const consent = JSON.parse(lead.payload).sms_consent_evidence?.valid === true;
  const results = await db.batch([
    db.prepare(`UPDATE meta_lead_intakes SET route_guidance=?,route_audited_by=?,route_audited_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id='org-opwp' AND route_audited_at IS NULL AND response_state=?`).bind(JSON.stringify(audited), actor, lead.id, row.response_state),
    db.prepare(`INSERT OR IGNORE INTO growth_lead_events (id,submission_id,organization_id,event_type,summary,details,actor_email)
      SELECT ?,?,'org-opwp','system','Service day audited; signup invitation queued',?,? FROM meta_lead_intakes
      WHERE submission_id=? AND organization_id='org-opwp' AND route_guidance=? AND response_state=? AND route_audited_at IS NOT NULL`).bind(`meta-route-audit-${auditId}`, lead.id, JSON.stringify(audited), actor, lead.id, JSON.stringify(audited), row.response_state),
    db.prepare(`INSERT OR IGNORE INTO meta_sms_jobs (id,purpose,trigger_id,submission_id,organization_id,conversation_id,message_body,status,block_reason)
      SELECT ?,'signup',?,?,'org-opwp',?,?,?,? FROM meta_lead_intakes
      WHERE submission_id=? AND organization_id='org-opwp' AND route_guidance=? AND response_state=? AND route_audited_at IS NOT NULL`).bind(`meta-signup-${auditId}`, auditId, lead.id, lead.conversation_id,
      `Craig has reviewed ${days.join(" and ")} as your service day${days.length > 1 ? "s" : ""}. You can complete signup at https://www.ohiopetwastepros.com/free-quote/ . Your start date is confirmed during setup. Reply STOP to opt out.`, consent ? "queued" : "blocked", consent ? "release_review_required" : "consent_unverified", lead.id, JSON.stringify(audited), row.response_state),
  ]);
  if (results[0]?.meta?.changes !== 1) throw new Error("Refresh current routing guidance before approving this day.");
  return audited;
}
