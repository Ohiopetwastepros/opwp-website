'use client';
import {useState} from 'react';
import styles from './playbook.module.css';

function DraftCard({draft, token, onAction, busy}) {
  const [body, setBody] = useState(draft.body), [reason, setReason] = useState(''), [editing, setEditing] = useState(false);
  return <article className={styles.card}>
    <div className={styles.row}><h2>{draft.lead_name || 'Lead conversation'}</h2><span>{draft.status}</span></div>
    <p><strong>{draft.intent}</strong> ({Math.round(draft.confidence * 100)}%) · {draft.template_key || draft.answer_key} · {draft.reason}</p>
    <details><summary>Thread and detected details</summary><div className={styles.thread}>{draft.thread.map((turn, index) => <p key={index}><strong>{turn.direction === 'inbound' ? 'Lead' : 'OPWP'}</strong><small>{turn.created_at}</small><br />{turn.body}</p>)}</div><pre>{JSON.stringify(draft.slots, null, 2)}</pre></details>
    {editing ? <label>Text to send<textarea rows={8} maxLength={1000} value={body} onChange={event => setBody(event.target.value)} /></label> : <p className={styles.message}>{draft.body}</p>}
    <small>Expires {draft.expires_at} UTC</small>
    {draft.status === 'pending' && <><div className={styles.actions}>
      <button disabled={busy} onClick={() => onAction(draft.id, {action: editing ? 'edit_send' : 'approve', body, token})}>{editing ? 'Send edited text' : 'Approve and send'}</button>
      <button disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Cancel edit' : 'Edit'}</button>
      <button disabled={busy} onClick={() => onAction(draft.id, {action: 'take_over', token})}>Take over</button>
    </div><label>Rejection reason<input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => onAction(draft.id, {action: 'reject', reason, token})}>Reject draft</button></>}
    {draft.status === 'failed' && <p>Check the delivery in Quo before preparing another text.</p>}
  </article>;
}
function CandidateCard({candidate, onAction, busy}) {
  const [body, setBody] = useState(candidate.proposed_template), [reason, setReason] = useState('');
  let violations = []; try { violations = JSON.parse(candidate.rule_violations_json || '[]'); } catch {}
  return <article className={styles.card}><h2>{candidate.intent}</h2><p>{candidate.support_count} supporting threads · {candidate.win_rate == null ? 'Outcome unknown' : `${Math.round(candidate.win_rate * 100)}% won`} · {candidate.source}</p>
    <blockquote>{candidate.question_redacted || candidate.objection_text}</blockquote>
    <label>Approved answer template<textarea rows={6} maxLength={950} value={body} onChange={event => setBody(event.target.value)} /></label>
    {violations.length > 0 && <p role="note">Review: {violations.join(', ')}</p>}
    <div className={styles.actions}><button disabled={busy} onClick={() => onAction(candidate.id, {action: 'approve', body})}>Approve answer</button></div>
    <label>Rejection reason<input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => onAction(candidate.id, {action: 'reject', reason})}>Reject candidate</button>
  </article>;
}
export default function PlaybookQueueClient({initialWorkspace, token = null, libraryOnly = false}) {
  const [workspace, setWorkspace] = useState(initialWorkspace), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  async function act(path, command) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(path, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(command)});
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Review could not be saved.');
      setNotice(result.status === 'sent' ? 'Text accepted by Quo.' : 'Review saved.');
      if (token) setWorkspace({...workspace, drafts: []});
      else { const latest = await fetch('/api/admin/playbook/', {cache: 'no-store', credentials: 'same-origin'}); const data = await latest.json(); if (!latest.ok) throw new Error(data.error); setWorkspace(data); }
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  if (!workspace.enabled) return <section className={styles.card}><h1>Lead playbook</h1><p>The playbook is currently disabled.</p><a href="/admin/quote-funnel/">Back to leads</a></section>;
  return <div className={styles.workspace}><div className={styles.row}><h1>{libraryOnly ? 'Playbook library review' : token ? 'Review lead reply' : 'Playbook drafts'}</h1>{!token && <a href={libraryOnly ? '/admin/playbook/' : '/admin/playbook/library/'}>{libraryOnly ? 'Drafts' : 'Library review'}</a>}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
    {token && <p>Review this reply and tap Approve and send. This link requires your management sign-in and can be used once.</p>}
    {workspace.alerts?.length > 0 && <section className={styles.alert}><h2>Follow-up needs attention</h2>{workspace.alerts.map(alert => <p key={alert.kind + alert.record_id}>{alert.kind}: {alert.status} {alert.error_message || alert.mismatch_json}{alert.kind.startsWith('owner_') && ' Check the provider before sending another notification.'}</p>)}</section>}
    {libraryOnly ? <>{!workspace.candidates.length && <p>No candidates need review.</p>}{workspace.candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} busy={busy} onAction={(id, command) => act(`/api/admin/playbook/library/${id}/`, command)} />)}</>
      : <>{!workspace.drafts.length && <p>No drafts need review.</p>}{workspace.drafts.map(draft => <DraftCard key={draft.id} draft={draft} token={token} busy={busy} onAction={(id, command) => act(`/api/admin/playbook/drafts/${id}/`, command)} />)}
      {(workspace.pausedThreads || []).map(thread => <section className={styles.card} key={thread.conversation_id}><p>{thread.name || 'Lead thread'} · Craig owns this conversation</p><button disabled={busy} onClick={() => act(`/api/admin/playbook/conversations/${thread.conversation_id}/`, {action: 'hand_back'})}>Hand back to playbook</button></section>)}
      {!token && <details><summary>Approval history by intent</summary><table><thead><tr><th>Intent</th><th>Unedited approvals</th><th>Edits</th><th>Rejections</th></tr></thead><tbody>{workspace.stats.map(stat => <tr key={stat.intent}><td>{stat.intent}</td><td>{stat.approvals}</td><td>{stat.edits}</td><td>{stat.rejections}</td></tr>)}</tbody></table></details>}</>}
  </div>;
}
