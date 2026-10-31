'use client';
import { useState } from 'react';
import styles from './reconciliation.module.css';

const money=value=>value==null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const time=value=>value?new Date(value).toLocaleString():'Not yet checked';

export default function ReconciliationClient({initial}) {
  const [data,setData]=useState(initial),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  async function runCheck() {
    setBusy(true);setNotice('');
    try {
      const response=await fetch('/api/admin/bank-reconciliation/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check'})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || 'Check unavailable.');
      const status=await fetch('/api/admin/bank-reconciliation/',{cache:'no-store'});
      if(!status.ok) throw new Error('Could not reload reconciliation status.');
      setData(await status.json());
      setNotice(result.skipped?'A check is already running or the next hourly check is not due.':result.status==='incomplete'?'The check was incomplete. Previous evidence remains visible and the next scheduled run will retry.':'QuickBooks and SNG were checked.');
    } catch(error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  const latest=data.runs?.[0];
  const accounts=data.accounts || [];
  const stale=!latest || Date.now()-Date.parse(latest.checked_at)>2*3600000;
  const combined=accounts.length===2?accounts.reduce((sum,account)=>sum+account.bookCents,0):null;
  return <div className={styles.wrap}>
    <section className={styles.panel}>
      <h2>One no-cost accounting view</h2>
      <p>QuickBooks supplies the book balances and cash activity for General Operations and Fuel. The website checks the archived SNG invoice number, customer name and total against QuickBooks every hour.</p>
      <p><strong>Coverage: partial.</strong> QuickBooks is the only bank source in this version, so it cannot independently verify its own Amex feed. Amex statement balances, available cash, pending transactions and the QuickBooks bank-review queue remain outside this automated check.</p>
    </section>
    {!data.storageReady || !data.configured?<section className={styles.warning}><h2>QuickBooks setup required</h2><p>{!data.storageReady?'The reconciliation database migration must be applied. ':''}Connect the production QuickBooks company before this check can run.</p></section>:null}
    <section className={styles.panel}>
      <h2>Amex accounts recorded in QuickBooks</h2>
      <div className={styles.metrics}>
        <div><span>Combined QBO book balance</span><strong>{money(combined)}</strong></div>
        <div><span>Open invoice checks</span><strong>{data.openCount ?? '—'}</strong></div>
        <div><span>Last checked</span><strong>{time(data.state?.last_checked_at)}</strong></div>
      </div>
      <div className={styles.list}>{accounts.map(account=><article key={account.id}><h3>{account.name} · {account.mask}</h3><p>QuickBooks book balance: {money(account.bookCents)}</p><p>Supported cash entries in the 90-day review window: {account.activityCount ?? 0}</p></article>)}</div>
      {!accounts.length?<p>Run the first due check to load both book accounts and balances.</p>:null}
      <p>These are QuickBooks register balances. They are not Amex current or available balances, and transfers between the two accounts are not revenue.</p>
      <p>QuickBooks company: {data.connection?.company_name || 'Connected company'}<br/>Next eligible check: {time(data.state?.next_check_at)}</p>
      {data.state?.last_error?<p role="status">The last check was incomplete. Verify both QuickBooks bank accounts still use the expected names and endings.</p>:null}
      <div className={styles.actions}><button disabled={busy || !data.configured || !data.storageReady} onClick={runCheck}>Run due check</button></div>
      <p aria-live="polite">{busy?'Working…':notice}</p>
    </section>
    <section className={stale?styles.warning:styles.panel}>
      <h2>{stale?'Checks need attention':'Latest check'}</h2>
      <p>{time(latest?.checked_at)} · {latest?.status?.replaceAll('_',' ') || 'Not run'}</p>
      {stale?<p>No recent attempt is recorded. Check the scheduled Worker before relying on this view.</p>:null}
      <p>Open invoice discrepancies remain in history through failed checks and review-window changes.</p>
    </section>
    <section className={styles.panel}>
      <h2>Invoice items to investigate</h2>
      <p>Showing {data.cases?.length || 0} of {data.openCount || 0} open SNG-to-QuickBooks checks.</p>
      <div className={styles.list}>{data.cases?.map(entry=><article key={entry.id}><h3>Invoice {entry.evidence.invoiceNumber || entry.evidence.sngInvoiceId}</h3><p>{entry.evidence.message}</p><p>SNG {money(entry.evidence.sngCents)} · QuickBooks total {money(entry.evidence.qboCents)}{entry.evidence.qboSubtotalCents!=null?` · QBO subtotal ${money(entry.evidence.qboSubtotalCents)}`:''}</p><small>First seen {time(entry.first_seen_at)} · Last checked {time(entry.last_seen_at)}</small></article>)}</div>
      {!data.cases?.length?<p>No open invoice discrepancies are recorded. The source and coverage limits above still apply.</p>:null}
    </section>
    <section className={styles.panel}><h2>Recent checks</h2><ul>{data.runs?.map(row=><li key={row.checked_at}>{time(row.checked_at)} — {row.status.replaceAll('_',' ')}</li>)}</ul></section>
  </div>;
}
