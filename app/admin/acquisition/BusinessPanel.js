"use client";
import { useState } from 'react';
import styles from './acquisition.module.css';
const money=n=>n==null?'Unknown':n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const blank=()=>({id:crypto.randomUUID(),name:'',area:'',stage:'Research',askingPrice:null,customers:null,mrr:null,source:'',nextStep:'',nextActionAt:'',notes:''});
export default function BusinessPanel({snapshot,onSnapshot,stages,storageAvailable}) {
  const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[filter,setFilter]=useState('all');
  const set=(key,value)=>setDraft(current=>({...current,[key]:value}));
  function edit(row) {setDraft({...row});setError('');setMessage('');}
  async function save(event) {
    event.preventDefault();if(busy || !storageAvailable)return;setBusy(true);setError('');setMessage('');
    try {const response=await fetch('/api/admin/acquisition/businesses/',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:snapshot.revision,opportunity:draft})});const result=await response.json();if(!response.ok)throw Error(result.error || 'Unable to save opportunity.');onSnapshot(result.snapshot);setDraft(null);setMessage('Opportunity saved privately.');}
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function refresh() {setBusy(true);setError('');setMessage('');try {const response=await fetch('/api/admin/acquisition/businesses/',{credentials:'same-origin',cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error || 'Unable to refresh.');onSnapshot(result.snapshot);setMessage('Saved opportunities refreshed. Your open draft is retained for review.');} catch(e) {setError(e.message);} finally {setBusy(false);}}
  const rows=snapshot.opportunities.filter(r=>filter==='all' || r.stage===filter);
  return <div>
    <section className={styles.panel}><div className={styles.heading}><div><span className={styles.eyebrow}>FUTURE BUSINESS ACQUISITIONS</span><h2>Small-business opportunities</h2><p>Keep prospects and diligence in one private pipeline. Figures are seller-reported estimates until verified.</p></div><div className={styles.actions}><button disabled={busy || !storageAvailable} onClick={()=>edit(blank())}>Add opportunity</button><button disabled={busy || !storageAvailable} onClick={refresh}>Refresh saved opportunities</button></div></div>
      {!storageAvailable && <p className={styles.warning}>Private storage is unavailable in this environment. Opportunity saving is disabled.</p>}
      <div className={styles.actions}><label>Stage filter<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All stages</option>{stages.map(s=><option key={s}>{s}</option>)}</select></label><span className={styles.note}>{snapshot.opportunities.length} saved opportunities</span></div>
      {!rows.length ? <div className={styles.empty}><h3>{snapshot.opportunities.length?'No opportunities in this stage.':'Your acquisition pipeline starts here.'}</h3><p>Add a business when you identify one worth researching. Capture its service area, recurring customer book and your next action.</p></div> : <div className={styles.tableWrap}><table><thead><tr><th>Business / service area</th><th>Stage</th><th>Customers</th><th>Monthly revenue</th><th>Asking price</th><th>Next action</th><th>Review</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong><small>{r.area || 'Area unknown'}</small></td><td>{r.stage}</td><td>{r.customers ?? 'Unknown'}</td><td>{money(r.mrr)}</td><td>{money(r.askingPrice)}</td><td>{r.nextStep || 'Not set'}<small>{r.nextActionAt}</small></td><td><button disabled={busy} aria-label={`Review ${r.name}`} onClick={()=>edit(r)}>Review</button></td></tr>)}</tbody></table></div>}
    </section>
    {draft && <section className={styles.panel}><h2>{snapshot.opportunities.some(r=>r.id===draft.id)?'Review opportunity':'New opportunity'}</h2><form onSubmit={save}>
      <fieldset disabled={busy}><div className={styles.formGrid}>
        <label>Business name<input required maxLength={160} value={draft.name} onChange={e=>set('name',e.target.value)}/></label>
        <label>Service area / neighborhoods<input maxLength={240} value={draft.area} onChange={e=>set('area',e.target.value)}/></label>
        <label>Stage<select value={draft.stage} onChange={e=>set('stage',e.target.value)}>{stages.map(s=><option key={s}>{s}</option>)}</select></label>
        {[['customers','Recurring customers',100000,1],['mrr','Monthly recurring revenue ($)',10000000,.01],['askingPrice','Asking price ($)',100000000,.01]].map(([key,label,max,step])=><label key={key}>{label}<input type="number" min="0" max={max} step={step} placeholder="Unknown" value={draft[key] ?? ''} onChange={e=>set(key,e.target.value===''?null:Number(e.target.value))}/></label>)}
        <label>Source / referral<input maxLength={500} value={draft.source} onChange={e=>set('source',e.target.value)}/></label>
        <label>Next-action date<input type="date" value={draft.nextActionAt} onChange={e=>set('nextActionAt',e.target.value)}/></label>
      </div><label className={styles.fullField}>Next step<input maxLength={500} value={draft.nextStep} onChange={e=>set('nextStep',e.target.value)}/></label><label className={styles.fullField}>Private diligence notes<textarea rows={6} maxLength={6000} value={draft.notes} onChange={e=>set('notes',e.target.value)}/></label><p className={styles.note}>Check recurring-customer evidence, address-level overlap, retention, service obligations, staffing, equipment and verified cash flow before evaluating a purchase. Saving here does not contact a seller or commit to an offer.</p><div className={styles.actions}><button type="submit" disabled={!storageAvailable}>{busy?'Saving…':'Save opportunity'}</button><button type="button" onClick={()=>setDraft(null)}>Cancel</button></div></fieldset>
    </form></section>}
    {error && <p className={styles.warning} role="alert">{error}</p>}{message && <p className={styles.notice} role="status">{message}</p>}
    <section className={styles.panel}><h2>Evaluate the customer book, then the business</h2><div className={styles.cards}><div><h3>Route overlap</h3><p>Compare verified service addresses with OPWP’s existing corridors and available field hours.</p></div><div><h3>Revenue quality</h3><p>Verify recurring customers, payment history, churn and customer-transfer requirements. MRR alone does not establish profit.</p></div><div><h3>Purchase readiness</h3><p>Record the next diligence action. Valuation, documents and a verified acquired-route map can be added as the pipeline develops.</p></div></div></section>
  </div>;
}
