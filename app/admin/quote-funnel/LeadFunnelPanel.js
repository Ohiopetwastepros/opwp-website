'use client';
import {useState} from 'react';
import styles from './lead-inbox.module.css';

export default function LeadFunnelPanel() {
  const [data,setData]=useState(null),[mode,setMode]=useState('approval'),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  async function request(method='GET',body) {
    setBusy(true);setStatus('');
    try {
      const response=await fetch('/api/admin/lead-funnel/',{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Lead automation unavailable.');
      if(method==='GET'){setData(result);setMode(result.settings.initialTextMode);}else setStatus(method==='PATCH'?'Initial-text setting saved.':'Approved. Sending will respect quiet hours, consent and current release checks.');
      return result;
    }catch(error){setStatus(error.message);return null;}finally{setBusy(false);}
  }
  return <details id="lead-automation" className={styles.card} onToggle={event=>{if(event.currentTarget.open&&!data&&!busy)request();}}>
    <summary><strong>Initial texts and signup handoff</strong></summary>
    <p>One lead, one initial text. Customer quiet hours are always 8 PM to 8 AM Eastern. Facebook also requires a verified form disclosure and an approved release.</p>
    {status?<p role="status">{status}</p>:null}
    {data?<><p>{data.enabled?'Unified lead funnel is active.':'Unified lead funnel is awaiting release.'}</p>
      <form onSubmit={event=>{event.preventDefault();request('PATCH',{initialTextMode:mode});}}><label>Initial text<select value={mode} onChange={event=>setMode(event.target.value)}><option value="auto">Send automatically when eligible</option><option value="approval">Require my one-tap approval</option><option value="off">Off</option></select></label><button type="submit" disabled={busy}>Save initial-text setting</button></form>
      <p>Later conversation automation keeps its own settings. An approval cannot replace SMS consent.</p>
      {data.leads.map(lead=><details key={lead.id} className={styles.card}><summary>{lead.name} · {lead.delivery||lead.status} · {lead.status?.replaceAll('_',' ')}</summary>
        <p>{lead.source} · {lead.phone} · {lead.consent?'Consent recorded':'Consent required'}</p><p>Send window: {lead.dueAt?new Date(lead.dueAt).toLocaleString():'Review quiet hours'}</p>
        <blockquote>{lead.text}</blockquote><p>Recommended recurring day: {lead.route.day?`${lead.route.day}${lead.route.stale?' (refresh needed)':''}`:lead.route.reason||'Service address needed'}. Staffing and final availability are confirmed before scheduling.</p>
        {lead.error?<p role="status">{lead.error.replaceAll('_',' ')}</p>:null}
        {lead.delivery==='queued'&&lead.consent&&!lead.approvedAt?<button type="button" className={styles.primary} disabled={busy||!data.enabled} onClick={async()=>{const result=await request('POST',{leadId:lead.id,version:lead.version});if(result)await request();}}>Approve this initial text</button>:null}
        <details><summary>Sona signup brief</summary><p>{lead.sonaBrief}</p><p>Continue in the Quo conversation. Sona handles replies only after its inbox lead-capture settings have been verified.</p></details>
      </details>)}
    </>:null}<button type="button" disabled={busy} onClick={()=>request()}>{busy?'Loading...':'Refresh initial texts'}</button>
  </details>;
}
