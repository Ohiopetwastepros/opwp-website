"use client";

import { useState } from "react";
import { metaCleanupSummary, metaFollowUpDrafts } from "@/lib/meta-conversation.mjs";
import styles from "./growth-desk.module.css";

export default function MetaLeadPanel({ lead, mutate, onGuidance }) {
  const [days, setDays] = useState([]);
  const [busy, setBusy] = useState(false);
  const meta = lead.meta;
  if (!meta) return null;
  const guidance = meta.routeGuidance || {};
  async function route(action) {
    setBusy(true);
    try {
      const result = await mutate({ action, days, snapshotAt: guidance.capturedAt });
      if (result?.guidance) onGuidance(result.guidance, action === "audit_meta_route");
    } finally { setBusy(false); }
  }
  return <section className={styles.section}>
    <div className={styles.sectionHead}><h3>Facebook conversation</h3><a href={meta.sourceUrl} target="_blank" rel="noreferrer">Open Leads Center</a></div>
    <p><strong>Contact preference:</strong> {meta.preferredChannel || "Unknown"}. <strong>SMS opt-in:</strong> {meta.consentEvidence?.valid ? `Verified · ${meta.consentEvidence.version}` : "Not verified — automatic texts blocked"}.</p>
    <p>{meta.reviewReason}</p>
    <p style={{ whiteSpace: "pre-line" }}>{metaCleanupSummary(meta.state)}</p>
    {meta.duplicateOf ? <p>Another form uses this phone number. Review the earlier YardOps lead: {meta.duplicateOf}. Automatic duplicate contact is blocked.</p> : null}
    {lead.airtable?.error ? <p role="alert">Airtable sync needs attention: {lead.airtable.error}</p> : null}
    <div className={styles.deliveryList}>{meta.jobs.map((job) => <div className={styles.message} key={job.id}>
      <strong>{job.purpose.replaceAll("_", " ")} · {job.status}</strong>
      <p>{job.message_body}</p>
      <small>{job.block_reason || job.error_message || (job.status === "sent" ? "Accepted by Quo; awaiting delivery confirmation" : job.provider_message_id || "Awaiting approved automation")}</small>
    </div>)}</div>
    <details><summary>Original form and consent evidence</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ form: meta.originalForm, consent: meta.consentEvidence }, null, 2)}</pre></details>
    <details><summary>Proposed follow-ups: days 1, 3 and 7</summary><p>Requires separate cadence approval. Any reply cancels pending follow-ups. No-response closure waits until all three texts are delivered, then another 48 hours.</p>{metaFollowUpDrafts(lead.name).map((touch) => <p key={touch.step}><strong>Day {touch.day}:</strong> {touch.body}</p>)}</details>
    {meta.state?.ready_for_route_audit ? <div>
      <h4>Craig’s service-day audit</h4>
      <p>{meta.state.details?.address} · {meta.state.details?.zip} · {meta.state.details?.clean_up_frequency}</p>
      <p>{guidance.reason || "Refresh Airtable routing to see current day options."}</p>
      <p>Source snapshot: {guidance.capturedAt || "Unavailable"}</p>
      {meta.routeAuditedAt ? <p>Audited. Signup invitation appears in the message queue above.</p> : <>
        <button type="button" disabled={busy} onClick={() => route("refresh_meta_route")}>Refresh Airtable routing</button>
        {(guidance.candidates || []).map((candidate) => <label key={candidate.day} style={{ display: "block", margin: "8px 0" }}><input type="checkbox" checked={days.includes(candidate.day)} onChange={(event) => setDays(event.target.checked ? [...days, candidate.day] : days.filter((day) => day !== candidate.day))} /> {candidate.day} · {candidate.nearbyCustomers} active customers in this ZIP</label>)}
        <p>Confirm the exact address, route capacity and staffing before approving.</p>
        <button type="button" disabled={busy || !days.length} onClick={() => route("audit_meta_route")}>Approve audited day and queue signup invitation</button>
      </>}
    </div> : null}
  </section>;
}
