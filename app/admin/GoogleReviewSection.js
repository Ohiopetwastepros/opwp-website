"use client";

import { useState } from "react";
import GoogleReviewTable from "./GoogleReviewTable";
import GoogleReviewResolution from './GoogleReviewResolution';
import styles from "./dashboard.module.css";
import { reviewSyncNotice } from "@/lib/google-review-state.mjs";

export default function GoogleReviewSection({ initialRows = [], unmatchedCount = 0, health = {} }) {
  const [expanded, setExpanded] = useState(false);
  const [currentHealth,setHealth]=useState(health);
  const [rows,setRows]=useState(initialRows);
  const [revision,setRevision]=useState(0);
  const bodyId = "google-review-tracking-content";
  const notice = reviewSyncNotice(currentHealth);
  const audit = currentHealth?.audit;
  function update(data){setHealth(data.health);setRows(data.rows);setRevision(r=>r+1);}
  const formatTime = (value) => value ? new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'Never';

  return <>
    <button
      type="button"
      className={styles.collapsibleSummary}
      aria-expanded={expanded}
      aria-controls={bodyId}
      onClick={() => setExpanded((current) => !current)}
    >
      <span><span className={styles.panelTitle}>Google review tracking</span><span className={styles.panelSub}>{notice.warning ? 'Attention: automatic Google checking is unavailable' : 'Automatic Google review checking is active'} · expand for verification and alternate names</span></span>
      <span className={styles.collapseControl}><span className={styles.whenClosed}>Expand section</span><span className={styles.whenOpen}>Collapse section</span><i aria-hidden="true">⌄</i></span>
    </button>
    <div id={bodyId} className={styles.collapsibleBody} hidden={!expanded}>
      <p role="status" className={notice.warning ? styles.reviewSaveError : styles.subtle}>{notice.text}</p>
      <p className={styles.subtle}>Last pipeline attempt: {formatTime(currentHealth?.latest?.completed_at)} · {currentHealth?.latest?.status || 'No recorded attempt'}. Last Google reconciliation: {formatTime(audit?.capturedAt)}{audit ? ` · ${audit.reviewCount} Google reviews · ${audit.source === 'google_api' ? 'automatic API check' : 'manual audit'}` : ''}.</p>
      {expanded ? <GoogleReviewResolution initialHealth={currentHealth} initialRows={rows} onUpdate={update}/> : null}
      <GoogleReviewTable key={revision} initialRows={rows} audit={audit} />
      {unmatchedCount ? <div className={styles.subtle} style={{ marginTop: 10 }}>{new Intl.NumberFormat("en-US").format(unmatchedCount)} review names are preserved as unmatched records for manual alias verification; they are marked do not contact.</div> : null}
    </div>
  </>;
}
