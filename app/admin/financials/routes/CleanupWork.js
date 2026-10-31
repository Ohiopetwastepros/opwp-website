"use client";

import { useState } from 'react';
import styles from './profitability.module.css';

const minutes = value => value == null ? 'Not recorded' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} min`;
const labels = { matched: 'QBO service lines match', service_difference: 'Job amount needs review', invoice_difference: 'Invoice lines differ', invoice_date_difference: 'Service lines match; invoice dates differ', ambiguous: 'Invoice match ambiguous', unlinked: 'Dated invoice not linked', not_checked: 'QBO check pending', not_found: 'Invoice absent from QBO capture' };

export function CleanupBilling({ billing }) {
  if (!billing) return null;
  return <small className={billing.status === 'matched' ? styles.workMatched : styles.workPending}>
    {labels[billing.status] || 'QBO check pending'}
    {billing.reference ? <span>{billing.reference}</span> : null}
    {billing.checkedAt ? <span>Checked {billing.checkedAt.slice(0, 10)}</span> : null}
    {billing.status === 'invoice_date_difference' ? <span>SNG: {billing.sngInvoiceDate} · QBO: {billing.qboInvoiceDate}</span> : null}
    {billing.status === 'matched' && billing.balance !== null ? <span>Invoice balance: ${billing.balance.toFixed(2)}</span> : null}
  </small>;
}

export default function CleanupWork({ record, onSaved }) {
  const work = record.work;
  const [editing, setEditing] = useState(false);
  const [crew, setCrew] = useState(work?.crew || []);
  const [confirmed, setConfirmed] = useState(work?.crewConfirmed || false);
  const [reported, setReported] = useState(work?.reportedMinutes ?? '');
  const [note, setNote] = useState(work?.note || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  if (!work) return <small>—</small>;
  function change(index, key, value) { setCrew(rows => rows.map((member, i) => i === index ? { ...member, [key]: value } : member)); }
  async function save(event) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/admin/route-profitability/job-work/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        jobId: record.id, date: record.date, revision: work.revision, crewConfirmed: confirmed,
        reportedMinutes: reported === '' ? null : Number(reported), note,
        crew: crew.map(member => ({ name: member.name, reportedMinutes: member.reportedMinutes === '' || member.reportedMinutes === null ? null : Number(member.reportedMinutes) })),
      }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Work details could not be saved.');
      setEditing(false); onSaved();
    } catch (error) { setMessage(error.message); } finally { setSaving(false); }
  }
  return <div className={styles.workDetails}>
    <strong>Elapsed: {minutes(work.elapsedMinutes)}</strong>
    <small>Technician reported: {minutes(work.reportedMinutes)}</small>
    <small>Estimate: {minutes(work.estimatedMinutes)}</small>
    {work.sourceDurationMinutes !== null ? <small>SNG duration: {minutes(work.sourceDurationMinutes)}</small> : work.legacyMinutes !== null ? <small>Legacy recorded duration: {minutes(work.legacyMinutes)}</small> : null}
    {work.varianceMinutes !== null ? <small>Reported − elapsed: {work.varianceMinutes > 0 ? '+' : ''}{minutes(work.varianceMinutes)}</small> : null}
    <small>{work.crewConfirmed ? 'Confirmed crew' : 'Recorded technician; full crew unconfirmed'}: {work.crew.map(member => member.name).join(', ') || 'Not recorded'}</small>
    {work.reportedLaborMinutes !== null ? <small>Reported labor: {minutes(work.reportedLaborMinutes)}</small> : null}
    {work.startedAt ? <small title={`${work.startedAt} → ${work.endedAt || 'No end timestamp'}`}>SNG job timestamps retained</small> : null}
    <details><summary>Crew and time details</summary>
      {work.crew.map((member, index) => <p key={index}>{member.name}: {minutes(member.reportedMinutes)} reported labor</p>)}
      {work.note ? <p>{work.note}</p> : null}
      {work.updatedAt ? <small>Recorded by {work.updatedBy} · {work.updatedAt.slice(0, 10)}</small> : null}
      {!editing ? <button type="button" className={styles.textButton} onClick={() => setEditing(true)}>Record crew / reported time</button> : <form onSubmit={save} className={styles.workForm}>
        <label>Technician-reported job minutes<input aria-label="Technician-reported job minutes" type="number" min="0" max="1440" step="0.01" value={reported} onChange={event => setReported(event.target.value)} /></label>
        {crew.map((member, index) => <div className={styles.crewEntry} key={index}>
          <label>Technician<input aria-label={`Crew member ${index + 1}`} maxLength={100} required value={member.name} onChange={event => change(index, 'name', event.target.value)} /></label>
          <label>Reported labor minutes<input aria-label={`Reported labor minutes for crew member ${index + 1}`} type="number" min="0" max="1440" step="0.01" value={member.reportedMinutes ?? ''} onChange={event => change(index, 'reportedMinutes', event.target.value)} /></label>
          <button type="button" disabled={crew.length === 1 || saving} onClick={() => setCrew(rows => rows.filter((_, i) => i !== index))}>Remove</button>
        </div>)}
        <button type="button" disabled={crew.length >= 8 || saving} onClick={() => setCrew(rows => [...rows, { name: '', reportedMinutes: null }])}>Add crew member</button>
        <label className={styles.crewConfirmed}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> This is the full crew on this job</label>
        <label>Source / explanation<input aria-label="Work details source note" required minLength={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="Who reported the time, and when" /></label>
        <small>Elapsed time comes from job timestamps. Reported job time and each person’s labor time are separate. Leave unknown minutes blank.</small>
        <div><button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save work details'}</button> <button disabled={saving} type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form>}
      {message ? <p role="alert">{message}</p> : null}
    </details>
  </div>;
}
